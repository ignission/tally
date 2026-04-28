import type { Edge, Node } from '@tally/core';

// Tally フロントエンドと ai-engine の間で流す進捗イベント。
// NDJSON (WS text frame) でサーバ → クライアント方向に 1 メッセージ 1 行で送る。
export type AgentEvent =
  | { type: 'start'; agent: string; input: unknown }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; output: unknown }
  | { type: 'node_created'; node: Node }
  | { type: 'edge_created'; edge: Edge }
  | { type: 'done'; summary: string }
  | {
      type: 'error';
      code: 'not_authenticated' | 'bad_request' | 'not_found' | 'agent_failed';
      message: string;
    };

// ChatRunner がクライアントに流す進捗イベント。
// AgentEvent と名前空間を分けることで WS メッセージ側でも区別しやすくする。
// SDK 内部の tool_use_id は使わず、ChatRunner が生成した ui-toolUseId (tool-<nanoid>) を用いる。
export type ChatEvent =
  | { type: 'chat_opened'; threadId: string }
  | { type: 'chat_user_message_appended'; messageId: string }
  | { type: 'chat_assistant_message_started'; messageId: string }
  | { type: 'chat_text_delta'; messageId: string; text: string }
  | {
      type: 'chat_tool_pending';
      messageId: string;
      toolUseId: string;
      name: string;
      input: unknown;
    }
  | {
      type: 'chat_tool_result';
      messageId: string;
      toolUseId: string;
      ok: boolean;
      output: string;
    }
  | { type: 'chat_assistant_message_completed'; messageId: string }
  | { type: 'chat_turn_ended' }
  // 外部 MCP (mcp__tally__ 以外) の tool_use を承認なしで永続化するときに発火。
  // AI が外部ソースを read したことを UI に見える形で残す (Task 12)。
  | {
      type: 'chat_tool_external_use';
      messageId: string;
      toolUseId: string;
      name: string;
      input: unknown;
    }
  // 外部 MCP の tool_result。AI が読んだ外部ソースの内容を UI に展開可能で表示する (Task 12)。
  | {
      type: 'chat_tool_external_result';
      messageId: string;
      toolUseId: string;
      ok: boolean;
      output: string;
    }
  // 外部 MCP の OAuth 2.1 認証要求。SDK の authenticate tool_use を検出して
  // tool_use/tool_result の代わりに UI に流す。pending → completed/failed の遷移は
  // 同 thread 内の complete_authentication tool_use 検出時に追って emit する。
  | {
      type: 'chat_auth_request';
      messageId: string;
      mcpServerId: string;
      mcpServerLabel: string;
      authUrl: string;
      status: 'pending' | 'completed' | 'failed';
      failureMessage?: string;
    }
  | { type: 'error'; code: string; message: string };

// SDK の厳密な型に依存せず、実行時に触る最小限のプロパティだけで型付けする。
export interface SdkMessageLike {
  type: string;
  subtype?: string;
  result?: unknown;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
}

// Agent SDK から流れてくる生メッセージを AgentEvent 列に変換する。
// SDK 型は `@anthropic-ai/claude-agent-sdk` が `SDKMessage` として提供する想定。
// ここでは実行時形状 (type/message.content[]) に依存して decode する。
export function sdkMessageToAgentEvent(msg: SdkMessageLike): AgentEvent[] {
  if (msg.type === 'assistant' && msg.message?.content) {
    const out: AgentEvent[] = [];
    for (const block of msg.message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({ type: 'thinking', text: block.text });
      } else if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        out.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        });
      }
    }
    return out;
  }
  if (msg.type === 'user' && msg.message?.content) {
    const out: AgentEvent[] = [];
    for (const block of msg.message.content) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        // content は string or content block 配列で返ってくる。文字列化して output に詰める。
        const output = flattenToolResultContent(block.content);
        out.push({
          type: 'tool_result',
          id: block.tool_use_id,
          ok: block.is_error !== true,
          output,
        });
      }
    }
    return out;
  }
  if (msg.type === 'result') {
    if (msg.subtype === 'success') {
      return [{ type: 'done', summary: typeof msg.result === 'string' ? msg.result : '' }];
    }
    // error_max_turns / error_during_execution 等。
    return [
      {
        type: 'error',
        code: 'agent_failed',
        message:
          typeof msg.result === 'string' ? msg.result : `agent ended: ${msg.subtype ?? 'unknown'}`,
      },
    ];
  }
  return [];
}

function flattenToolResultContent(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // {type: 'text', text: '...'} の配列を結合する。
    return content
      .map((c: { type?: string; text?: string }) =>
        c.type === 'text' && typeof c.text === 'string' ? c.text : '',
      )
      .join('');
  }
  return content;
}
