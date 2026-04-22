import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemChatStore, FileSystemProjectStore, registerProject } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { startServer } from './server';
import type { AgentEvent } from './stream';

describe('WS /agent', () => {
  let root: string;
  let tallyHome: string;
  let close: (() => Promise<void>) | null = null;
  const prevTallyHome = process.env.TALLY_HOME;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
    tallyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
    process.env.TALLY_HOME = tallyHome;
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-ws',
      name: 'WS',
      codebases: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    await registerProject({ id: 'proj-ws', path: root });
  });

  afterEach(async () => {
    if (prevTallyHome === undefined) delete process.env.TALLY_HOME;
    else process.env.TALLY_HOME = prevTallyHome;
    if (close) await close();
    close = null;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(tallyHome, { recursive: true, force: true });
  });

  it('start → mock sdk → done が WS で返ってくる', async () => {
    const store = new FileSystemProjectStore(root);
    // biome-ignore lint/style/noNonNullAssertion: beforeEach で usecase を 1 件追加済みのため必ず存在する
    const ucId = (await store.findNodesByType('usecase'))[0]!.id;
    const sdk = {
      async *query() {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'ok' }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          result: '完了',
        };
      },
    };
    const handle = await startServer({ port: 0, sdk });
    close = handle.close;

    const ws = new WebSocket(`ws://localhost:${handle.port}/agent`);
    const events: AgentEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            agent: 'decompose-to-stories',
            projectId: 'proj-ws',
            input: { nodeId: ucId },
          }),
        );
      });
      ws.on('message', (data) => {
        events.push(JSON.parse(data.toString()));
      });
      ws.on('close', () => resolve());
      ws.on('error', reject);
    });
    expect(events[0]?.type).toBe('start');
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('done');
  }, 10_000);

  it('find-related-code の start を受理して codebasePath 未設定なら error:bad_request', async () => {
    const store = new FileSystemProjectStore(root);
    // biome-ignore lint/style/noNonNullAssertion: beforeEach で必ず作られる
    const ucId = (await store.findNodesByType('usecase'))[0]!.id;
    const sdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const handle = await startServer({ port: 0, sdk });
    close = handle.close;

    const ws = new WebSocket(`ws://localhost:${handle.port}/agent`);
    const events: AgentEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            agent: 'find-related-code',
            projectId: 'proj-ws',
            input: { nodeId: ucId },
          }),
        );
      });
      ws.on('message', (data) => events.push(JSON.parse(data.toString())));
      ws.on('close', () => resolve());
      ws.on('error', reject);
    });
    const errorEvt = events.find((e) => e.type === 'error');
    expect(errorEvt).toBeDefined();
    if (errorEvt?.type === 'error') {
      expect(errorEvt.code).toBe('bad_request');
      expect(errorEvt.message).toContain('codebasePath');
    }
  }, 10_000);

  it('start メッセージが不正だと error:bad_request', async () => {
    const sdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const handle = await startServer({ port: 0, sdk });
    close = handle.close;
    const ws = new WebSocket(`ws://localhost:${handle.port}/agent`);
    const events: AgentEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => ws.send('{ not json'));
      ws.on('message', (data) => events.push(JSON.parse(data.toString())));
      ws.on('close', () => resolve());
      ws.on('error', reject);
    });
    expect(events[0]?.type).toBe('error');
    if (events[0]?.type === 'error') expect(events[0].code).toBe('bad_request');
  }, 10_000);
});

describe('WS /chat', () => {
  let root: string;
  let tallyHome: string;
  let close: (() => Promise<void>) | null = null;
  const prevTallyHome = process.env.TALLY_HOME;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-chat-'));
    tallyHome = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
    process.env.TALLY_HOME = tallyHome;
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-ws',
      name: 'WS',
      codebases: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await registerProject({ id: 'proj-ws', path: root });
  });

  afterEach(async () => {
    if (prevTallyHome === undefined) delete process.env.TALLY_HOME;
    else process.env.TALLY_HOME = prevTallyHome;
    if (close) await close();
    close = null;
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(tallyHome, { recursive: true, force: true });
  });

  it('/chat: open → user_message で text 応答と turn_ended が返る', async () => {
    const chatStore = new FileSystemChatStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-ws', title: 't' });

    const sdk = {
      async *query() {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'こんにちは' }] },
        };
        yield { type: 'result', subtype: 'success', result: 'ok' };
      },
    };
    const handle = await startServer({ port: 0, sdk });
    close = handle.close;

    const ws = new WebSocket(`ws://localhost:${handle.port}/chat`);
    const events: { type: string; [k: string]: unknown }[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'open', projectId: 'proj-ws', threadId: thread.id }));
        // open 応答 (chat_opened) を受けてから user_message を送る。
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'user_message', text: 'hi' }));
        }, 50);
      });
      ws.on('message', (data) => {
        const evt = JSON.parse(data.toString());
        events.push(evt);
        if (evt.type === 'chat_turn_ended') {
          ws.close();
        }
      });
      ws.on('close', () => resolve());
      ws.on('error', reject);
    });
    expect(events[0]).toEqual({ type: 'chat_opened', threadId: thread.id });
    expect(events.some((e) => e.type === 'chat_text_delta' && e.text === 'こんにちは')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('chat_turn_ended');
  }, 10_000);

  it('/chat: 存在しないスレッド ID は not_found + close', async () => {
    const sdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const handle = await startServer({ port: 0, sdk });
    close = handle.close;

    const ws = new WebSocket(`ws://localhost:${handle.port}/chat`);
    const events: { type: string; code?: string; [k: string]: unknown }[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'open', projectId: 'proj-ws', threadId: 'chat-missing' }));
      });
      ws.on('message', (data) => events.push(JSON.parse(data.toString())));
      ws.on('close', () => resolve());
      ws.on('error', reject);
    });
    expect(events[0]?.type).toBe('error');
    expect(events[0]?.code).toBe('not_found');
  }, 10_000);

  it('/chat: open 前に user_message を送ると error', async () => {
    const sdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const handle = await startServer({ port: 0, sdk });
    close = handle.close;

    const ws = new WebSocket(`ws://localhost:${handle.port}/chat`);
    const events: { type: string; message?: string; [k: string]: unknown }[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'user_message', text: 'hi' }));
        setTimeout(() => ws.close(), 100);
      });
      ws.on('message', (data) => events.push(JSON.parse(data.toString())));
      ws.on('close', () => resolve());
      ws.on('error', reject);
    });
    expect(events[0]?.type).toBe('error');
    expect(events[0]?.message).toContain('open 未送信');
  }, 10_000);
});
