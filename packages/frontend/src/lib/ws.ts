'use client';

import type { AgentEvent, ChatEvent } from '@tally/ai-engine';
import type { AgentName } from '@tally/core';

export interface StartAgentOptions {
  url?: string;
  agent: AgentName;
  projectId: string;
  // agent によって形が違う。nodeId を持つものが多いが、ingest-document は { text }。
  // サーバ側で zod スキーマで型を検証するのでここでは unknown で受ける。
  input: unknown;
}

export interface AgentHandle {
  events: AsyncIterable<AgentEvent>;
  close: () => void;
}

// WS ベースの agent 呼び出し。受信した NDJSON を AgentEvent の AsyncIterable に変換する。
// close() で接続を明示的に終わらせる。サーバ側が close したら AsyncIterable も終了する。
export function startAgent(opts: StartAgentOptions): AgentHandle {
  const url = opts.url ?? process.env.NEXT_PUBLIC_AI_ENGINE_URL ?? 'ws://localhost:3322';
  const ws = new WebSocket(`${url}/agent`);

  const buf: AgentEvent[] = [];
  const waiters: Array<(v: IteratorResult<AgentEvent>) => void> = [];
  let finished = false;

  const push = (e: AgentEvent) => {
    if (finished) return;
    const w = waiters.shift();
    if (w) w({ value: e, done: false });
    else buf.push(e);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    while (waiters.length > 0) {
      const w = waiters.shift();
      w?.({ value: undefined as never, done: true });
    }
  };

  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        type: 'start',
        agent: opts.agent,
        projectId: opts.projectId,
        input: opts.input,
      }),
    );
  });
  ws.addEventListener('message', (ev: MessageEvent) => {
    try {
      push(JSON.parse(String(ev.data)) as AgentEvent);
    } catch {
      // 破損フレームは捨てる。
    }
  });
  ws.addEventListener('close', finish);
  ws.addEventListener('error', finish);

  const events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          const head = buf.shift();
          if (head !== undefined) return Promise.resolve({ value: head, done: false });
          if (finished) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise<IteratorResult<AgentEvent>>((resolve) => waiters.push(resolve));
        },
        return() {
          ws.close();
          finish();
          return Promise.resolve({ value: undefined as never, done: true });
        },
      };
    },
  };

  return { events, close: () => ws.close() };
}

// ChatHandle: /chat WS 接続のハンドル。events は ChatEvent の AsyncIterable、
// sendUserMessage / approveTool は client → server 方向のメッセージ送信。
// close() で WS を閉じる (サーバ側も runner を破棄する)。
//
// sendUserMessage の contextNodeIds は issue #11 で追加。空 / 省略時はサーバが
// 「context 添付なし」として扱う。
export interface ChatHandle {
  events: AsyncIterable<ChatEvent>;
  sendUserMessage: (text: string, contextNodeIds?: string[]) => void;
  approveTool: (toolUseId: string, approved: boolean) => void;
  // 外部 MCP の OAuth コールバック URL を構造化送信する (PR-B CR Major)。
  // 自然文 user_message に mcpServerId を埋め込むのを避け、サーバ側で AI に
  // 「指定 server の complete_authentication を呼べ」と決定論的に prompt 化させる。
  sendOAuthCallback: (mcpServerId: string, callbackUrl: string) => void;
  close: () => void;
}

export interface OpenChatOptions {
  url?: string;
  projectId: string;
  threadId: string;
}

// /chat WS に接続し、ChatEvent を AsyncIterable 化する長寿命ハンドル。
// open フレームは本関数内で送信済み。呼び出し側は events を for-await でループし、
// sendUserMessage / approveTool を任意のタイミングで呼ぶ。
// サーバが close した場合は events も終了する。
export function openChat(opts: OpenChatOptions): ChatHandle {
  const url = opts.url ?? process.env.NEXT_PUBLIC_AI_ENGINE_URL ?? 'ws://localhost:3322';
  const ws = new WebSocket(`${url}/chat`);

  const buf: ChatEvent[] = [];
  const waiters: Array<(v: IteratorResult<ChatEvent>) => void> = [];
  let finished = false;

  const push = (e: ChatEvent) => {
    if (finished) return;
    const w = waiters.shift();
    if (w) w({ value: e, done: false });
    else buf.push(e);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    while (waiters.length > 0) {
      const w = waiters.shift();
      w?.({ value: undefined as never, done: true });
    }
  };

  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        type: 'open',
        projectId: opts.projectId,
        threadId: opts.threadId,
      }),
    );
  });
  ws.addEventListener('message', (ev: MessageEvent) => {
    try {
      push(JSON.parse(String(ev.data)) as ChatEvent);
    } catch (err) {
      push({ type: 'error', code: 'bad_request', message: `invalid frame: ${String(err)}` });
    }
  });
  ws.addEventListener('close', finish);
  ws.addEventListener('error', () => {
    push({ type: 'error', code: 'ws_error', message: 'websocket error' });
    finish();
  });

  // open 送信前の user_message / approve_tool も扱えるように、open 未到達時はキューに積む。
  const sendWhenReady = (payload: unknown) => {
    const raw = JSON.stringify(payload);
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(raw);
    } else {
      ws.addEventListener('open', () => ws.send(raw), { once: true });
    }
  };

  const events: AsyncIterable<ChatEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          const head = buf.shift();
          if (head !== undefined) return Promise.resolve({ value: head, done: false });
          if (finished) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise<IteratorResult<ChatEvent>>((resolve) => waiters.push(resolve));
        },
        return() {
          ws.close();
          finish();
          return Promise.resolve({ value: undefined as never, done: true });
        },
      };
    },
  };

  return {
    events,
    sendUserMessage: (text, contextNodeIds) =>
      sendWhenReady({
        type: 'user_message',
        text,
        ...(contextNodeIds && contextNodeIds.length > 0 ? { contextNodeIds } : {}),
      }),
    approveTool: (toolUseId, approved) =>
      sendWhenReady({ type: 'approve_tool', toolUseId, approved }),
    sendOAuthCallback: (mcpServerId, callbackUrl) =>
      sendWhenReady({ type: 'oauth_callback', mcpServerId, callbackUrl }),
    close: () => ws.close(),
  };
}
