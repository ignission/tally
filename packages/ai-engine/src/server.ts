import { AGENT_NAMES } from '@tally/core';
import type { AgentName } from '@tally/core';
import { FileSystemChatStore, FileSystemProjectStore, listProjects } from '@tally/storage';
import { type WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';

import { runAgent } from './agent-runner';
import type { SdkLike } from './agent-runner';
import { ChatRunner } from './chat-runner';
import type { AgentEvent, ChatEvent } from './stream';

const StartSchema = z.object({
  type: z.literal('start'),
  agent: z.enum([...AGENT_NAMES] as [AgentName, ...AgentName[]]),
  projectId: z.string().min(1),
  // agent ごとに形が違う (nodeId 必須のもの、ingest-document の { text } など)。
  // agent-runner が agent 固有の inputSchema で safeParse するため、ここでは unknown で受ける。
  input: z.unknown(),
});

// /chat 用メッセージスキーマ。open → user_message → approve_tool の 3 種。
const ChatOpenSchema = z.object({
  type: z.literal('open'),
  projectId: z.string().min(1),
  threadId: z.string().min(1),
});

const ChatUserMessageSchema = z.object({
  type: z.literal('user_message'),
  text: z.string().min(1),
});

const ChatApproveToolSchema = z.object({
  type: z.literal('approve_tool'),
  toolUseId: z.string().min(1),
  approved: z.boolean(),
});

// registry からプロジェクト ID に対応するディレクトリパスを返す。
// 見つからなければ null。
async function resolveDir(id: string): Promise<string | null> {
  const list = await listProjects();
  return list.find((p) => p.id === id)?.path ?? null;
}

export interface StartServerOptions {
  port: number;
  sdk: SdkLike;
}

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

// WS サーバ: /agent と /chat の 2 パスを受け付ける。
// /agent: 1 接続 = 1 エージェント実行 (既存挙動、完了 or エラーで close)。
// /chat: 1 接続 = 1 スレッド、長寿命。open → user_message / approve_tool を多重に処理。
export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const wss = new WebSocketServer({ port: opts.port });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const addr = wss.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;

  wss.on('connection', (ws, req) => {
    const url = req.url ?? '';
    if (url.startsWith('/agent')) {
      handleAgentConnection(ws, opts.sdk);
    } else if (url.startsWith('/chat')) {
      handleChatConnection(ws, opts.sdk);
    } else {
      ws.close(1008, `unknown path: ${url}`);
    }
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve()))),
  };
}

// /agent: 最初の text frame を start メッセージとして 1 回だけ処理する。
function handleAgentConnection(ws: WebSocket, sdk: SdkLike): void {
  const send = (evt: AgentEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(evt));
  };
  ws.once('message', async (raw) => {
    let parsed: z.infer<typeof StartSchema>;
    try {
      const json = JSON.parse(raw.toString());
      parsed = StartSchema.parse(json);
    } catch (err) {
      send({ type: 'error', code: 'bad_request', message: String(err) });
      ws.close();
      return;
    }
    const dir = await resolveDir(parsed.projectId);
    if (!dir) {
      send({
        type: 'error',
        code: 'not_found',
        message: `project が存在しない: ${parsed.projectId}`,
      });
      ws.close();
      return;
    }
    const store = new FileSystemProjectStore(dir);
    try {
      // z.unknown() は undefined を許容するため parsed.input は unknown | undefined。
      // StartRequest.input は unknown (必須) なので ?? {} で埋める。agent-runner 内で
      // 各 agent の inputSchema.safeParse が実データを検証する。
      for await (const evt of runAgent({
        sdk,
        store,
        projectDir: dir,
        req: {
          type: parsed.type,
          agent: parsed.agent,
          projectId: parsed.projectId,
          input: parsed.input ?? {},
        },
      })) {
        send(evt);
      }
    } catch (err) {
      send({ type: 'error', code: 'agent_failed', message: String(err) });
    } finally {
      ws.close();
    }
  });
}

// /chat: 長寿命接続。1 接続 = 1 ChatRunner = 1 スレッド。
// open で runner を初期化 → user_message ごとに runUserTurn を回す。
// approve_tool は runner.approveTool へ同期的にデリゲート (pendingApprovals の Promise を resolve)。
// 切断で runner は破棄 (pending な承認は喪失するが、次回 open で永続化済み状態から再開できる)。
function handleChatConnection(ws: WebSocket, sdk: SdkLike): void {
  const send = (evt: ChatEvent) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(evt));
  };
  let runner: ChatRunner | null = null;

  ws.on('message', async (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send({ type: 'error', code: 'bad_request', message: 'invalid JSON' });
      return;
    }
    const obj = parsed as { type?: unknown };

    if (obj.type === 'open') {
      const result = ChatOpenSchema.safeParse(parsed);
      if (!result.success) {
        send({
          type: 'error',
          code: 'bad_request',
          message: `invalid open: ${result.error.message}`,
        });
        return;
      }
      if (runner) {
        // 1 接続 = 1 スレッドの想定。再 open は拒否 (新規接続を張り直す運用)。
        send({ type: 'error', code: 'bad_request', message: 'already opened' });
        return;
      }
      const dir = await resolveDir(result.data.projectId);
      if (!dir) {
        send({ type: 'error', code: 'not_found', message: `project: ${result.data.projectId}` });
        ws.close();
        return;
      }
      const chatStore = new FileSystemChatStore(dir);
      const thread = await chatStore.getChat(result.data.threadId);
      if (!thread) {
        send({ type: 'error', code: 'not_found', message: `thread: ${result.data.threadId}` });
        ws.close();
        return;
      }
      const projectStore = new FileSystemProjectStore(dir);
      runner = new ChatRunner({
        sdk,
        chatStore,
        projectStore,
        projectDir: dir,
        threadId: result.data.threadId,
      });
      send({ type: 'chat_opened', threadId: result.data.threadId });
      return;
    }

    if (!runner) {
      send({ type: 'error', code: 'bad_request', message: 'open 未送信' });
      return;
    }

    if (obj.type === 'user_message') {
      const result = ChatUserMessageSchema.safeParse(parsed);
      if (!result.success) {
        send({
          type: 'error',
          code: 'bad_request',
          message: `invalid user_message: ${result.error.message}`,
        });
        return;
      }
      try {
        for await (const evt of runner.runUserTurn(result.data.text)) {
          send(evt);
        }
      } catch (err) {
        send({ type: 'error', code: 'agent_failed', message: String(err) });
      }
      return;
    }

    if (obj.type === 'approve_tool') {
      const result = ChatApproveToolSchema.safeParse(parsed);
      if (!result.success) {
        send({
          type: 'error',
          code: 'bad_request',
          message: `invalid approve_tool: ${result.error.message}`,
        });
        return;
      }
      // approveTool は同期的に pendingApprovals の Promise を resolve する。
      // 対応する runUserTurn iterator が続きを進め、tool_result イベントを emit する。
      runner.approveTool(result.data.toolUseId, result.data.approved);
      return;
    }

    send({
      type: 'error',
      code: 'bad_request',
      message: `unknown message type: ${String(obj.type)}`,
    });
  });
}
