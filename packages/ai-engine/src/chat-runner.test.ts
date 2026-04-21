import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newChatMessageId } from '@tally/core';
import { FileSystemChatStore, FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SdkLike } from './agent-runner';
import { ChatRunner } from './chat-runner';
import type { ChatEvent, SdkMessageLike } from './stream';

describe('ChatRunner', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'tally-chat-runner-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    rmSync(root, { recursive: true, force: true });
  });

  // SDK 経由の text ストリーム。MCP 登録後も text 系の挙動が壊れていないことを担保する。
  it('text-only 応答: user msg append → text delta → turn ended', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'こんにちは' }] },
          } as unknown as SdkMessageLike;
          yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
        })(),
    };

    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });

    const events: ChatEvent[] = [];
    for await (const e of runner.runUserTurn('こんにちは')) events.push(e);

    expect(events.some((e) => e.type === 'chat_user_message_appended')).toBe(true);
    expect(events.some((e) => e.type === 'chat_text_delta' && e.text === 'こんにちは')).toBe(true);
    expect(events.some((e) => e.type === 'chat_turn_ended')).toBe(true);

    const reloaded = await chatStore.getChat(thread.id);
    expect(reloaded?.messages).toHaveLength(2);
    expect(reloaded?.messages[0]?.role).toBe('user');
    expect(reloaded?.messages[1]?.role).toBe('assistant');
    expect(reloaded?.messages[1]?.blocks[0]?.type).toBe('text');
  });

  // 以下 2 テストは MCP 経由の tool 呼び出し (SDK 内部で MCP client-server を仲介する) が
  // モックしづらいため、MCP ハンドラが実際に呼ぶ invokeInterceptedTool を直接駆動して
  // pending → 承認 / 却下 → 永続化・イベント発火の流れを検証する。
  // 本番は SDK → MCP ハンドラ → invokeInterceptedTool → done の {ok, output} → CallToolResult
  // の一本道なので、invokeInterceptedTool の挙動が正しければ MCP ハンドラも問題なく動く。

  it('invokeInterceptedTool 承認経路: pending 発火 → approveTool(true) で node 作成 + done.ok=true', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    // 親 assistant message を事前に仕込む (本来 runUserTurn が作る部分)。
    const assistantMsgId = newChatMessageId();
    await chatStore.appendMessage(thread.id, {
      id: assistantMsgId,
      role: 'assistant',
      blocks: [],
      createdAt: new Date().toISOString(),
    });

    const addNodeSpy = vi.spyOn(projectStore, 'addNode');

    // SDK は使わないのでダミー。
    const sdk: SdkLike = { query: () => (async function* () {})() };
    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });

    const entry = runner
      .buildToolRegistry()
      .find((t) => t.name === 'mcp__tally__create_node');
    if (!entry) throw new Error('entry missing');

    const events: ChatEvent[] = [];
    const { pendingEmitted, done } = runner.invokeInterceptedTool({
      entry,
      input: { adoptAs: 'requirement', title: 'X', body: '' },
      emit: (e) => events.push(e),
      assistantMsgId,
    });

    await pendingEmitted;
    const pending = events.find((e) => e.type === 'chat_tool_pending');
    if (pending?.type !== 'chat_tool_pending') throw new Error('pending not emitted');
    expect(pending.name).toBe('mcp__tally__create_node');

    runner.approveTool(pending.toolUseId, true);

    const result = await done;
    expect(result.ok).toBe(true);
    expect(addNodeSpy).toHaveBeenCalledTimes(1);

    const resultEvt = events.find((e) => e.type === 'chat_tool_result');
    expect(resultEvt?.type === 'chat_tool_result' && resultEvt.ok).toBe(true);
  });

  it('invokeInterceptedTool 却下経路: approveTool(false) で addNode 呼ばれず done.ok=false', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    const assistantMsgId = newChatMessageId();
    await chatStore.appendMessage(thread.id, {
      id: assistantMsgId,
      role: 'assistant',
      blocks: [],
      createdAt: new Date().toISOString(),
    });

    const addNodeSpy = vi.spyOn(projectStore, 'addNode');

    const sdk: SdkLike = { query: () => (async function* () {})() };
    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });

    const entry = runner
      .buildToolRegistry()
      .find((t) => t.name === 'mcp__tally__create_node');
    if (!entry) throw new Error('entry missing');

    const events: ChatEvent[] = [];
    const { pendingEmitted, done } = runner.invokeInterceptedTool({
      entry,
      input: { adoptAs: 'requirement', title: 'X', body: '' },
      emit: (e) => events.push(e),
      assistantMsgId,
    });

    await pendingEmitted;
    const pending = events.find((e) => e.type === 'chat_tool_pending');
    if (pending?.type !== 'chat_tool_pending') throw new Error('pending not emitted');

    runner.approveTool(pending.toolUseId, false);

    const result = await done;
    expect(result.ok).toBe(false);
    expect(addNodeSpy).not.toHaveBeenCalled();

    const resultEvt = events.find((e) => e.type === 'chat_tool_result');
    expect(resultEvt?.type === 'chat_tool_result' && resultEvt.ok === false).toBe(true);
  });
});
