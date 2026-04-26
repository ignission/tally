import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { Node } from '@tally/core';
import { newChatMessageId } from '@tally/core';
import { FileSystemChatStore, FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SdkLike } from './agent-runner';
import { buildChatPrompt, ChatRunner, formatNodeForContext } from './chat-runner';
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

    const entry = runner.buildToolRegistry().find((t) => t.name === 'mcp__tally__create_node');
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

    const entry = runner.buildToolRegistry().find((t) => t.name === 'mcp__tally__create_node');
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

  // issue #11: contextNodeIds を runUserTurn に渡したとき、prompt の <context_nodes>
  // ブロックに該当ノードの内容が埋め込まれて SDK に届くことを担保する。
  it('contextNodeIds 指定時: prompt に <context_nodes> ブロックが入り SDK の prompt に届く', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    // 添付対象ノードを 1 件作る (requirement)。
    const target = (await projectStore.addNode({
      type: 'requirement',
      x: 0,
      y: 0,
      title: '招待メールから登録できる',
      body: '既存ユーザが新規ユーザを招待できる',
      priority: 'must',
    })) as Node;

    let capturedPrompt = '';
    const sdk: SdkLike = {
      query: ({ prompt }: { prompt: string }) => {
        capturedPrompt = prompt;
        return (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: 'OK' }] },
          } as unknown as SdkMessageLike;
          yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
        })();
      },
    };

    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });

    const events: ChatEvent[] = [];
    for await (const e of runner.runUserTurn('この要求を分解してほしい', [target.id])) {
      events.push(e);
    }

    expect(capturedPrompt).toContain('<context_nodes>');
    expect(capturedPrompt).toContain(`id: ${target.id}`);
    expect(capturedPrompt).toContain('type: requirement');
    expect(capturedPrompt).toContain('title: 招待メールから登録できる');
    expect(capturedPrompt).toContain('priority: must');
    // codex セカンドオピニオン #16 修正後: user メッセージは <current_user_message> に入る。
    // <context_nodes> ブロックは <current_user_message> より前に位置する。
    expect(capturedPrompt).toContain('<current_user_message>');
    const ctxIdx = capturedPrompt.indexOf('<context_nodes>');
    const curIdx = capturedPrompt.indexOf('<current_user_message>');
    expect(ctxIdx).toBeGreaterThanOrEqual(0);
    expect(curIdx).toBeGreaterThan(ctxIdx);
    // 「この要求を分解してほしい」は current_user_message ブロック内にある。
    expect(capturedPrompt.slice(curIdx)).toContain('この要求を分解してほしい');
    // 履歴に user 入力が紛れていない (今回が初ターンなので conversation_history 自体が出ない)。
    expect(capturedPrompt).not.toContain('<conversation_history>');
  });

  // codex セカンドオピニオン #16 (ロジックバグ): runUserTurn は内部で空 assistant message を
  // append するため、prompt 組立を append 前にスナップショットしないと末尾が assistant となり
  // <current_user_message> が出ず、<context_nodes> が user 入力の後ろに並ぶ問題があった。
  // この回帰を防ぐ:
  //   1) <context_nodes> ブロックが <current_user_message> より前にある
  //   2) 今ターンの user 入力が <conversation_history> 内に出現しない (= 履歴に埋もれていない)
  it('runUserTurn: <context_nodes> は <current_user_message> より前、user 入力は履歴に埋もれない', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    // 過去ターンを 1 往復仕込む。新しい user 入力が conversation_history に紛れないことを
    // この過去 user 入力の有無と対比して確認するため。
    await chatStore.appendMessage(thread.id, {
      id: newChatMessageId(),
      role: 'user',
      blocks: [{ type: 'text', text: '過去のユーザー発話' }],
      createdAt: new Date().toISOString(),
    });
    await chatStore.appendMessage(thread.id, {
      id: newChatMessageId(),
      role: 'assistant',
      blocks: [{ type: 'text', text: '過去のアシスタント応答' }],
      createdAt: new Date().toISOString(),
    });

    const target = (await projectStore.addNode({
      type: 'requirement',
      x: 0,
      y: 0,
      title: 'T1',
      body: '',
    })) as Node;

    let capturedPrompt = '';
    const sdk: SdkLike = {
      query: ({ prompt }: { prompt: string }) => {
        capturedPrompt = prompt;
        return (async function* () {
          yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
        })();
      },
    };
    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });

    const NEW_USER_TEXT = '今ターンの新しい入力XYZ';
    for await (const _e of runner.runUserTurn(NEW_USER_TEXT, [target.id])) {
      // drain
    }

    const histIdx = capturedPrompt.indexOf('<conversation_history>');
    const histEndIdx = capturedPrompt.indexOf('</conversation_history>');
    const ctxIdx = capturedPrompt.indexOf('<context_nodes>');
    const curIdx = capturedPrompt.indexOf('<current_user_message>');

    // 順序: history → context → current
    expect(histIdx).toBeGreaterThanOrEqual(0);
    expect(ctxIdx).toBeGreaterThan(histIdx);
    expect(curIdx).toBeGreaterThan(ctxIdx);

    // 今ターンの user 入力は <current_user_message> ブロック内にあり、conversation_history には無い。
    const historyBlock = capturedPrompt.slice(histIdx, histEndIdx);
    expect(historyBlock).toContain('過去のユーザー発話');
    expect(historyBlock).not.toContain(NEW_USER_TEXT);
    expect(capturedPrompt.slice(curIdx)).toContain(NEW_USER_TEXT);
  });

  // 不在 ID は黙って捨てる: 削除済みノードを混ぜても他のノードは渡る + エラーにならない。
  it('contextNodeIds に不在 ID が混ざっても残りは prompt に入る', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
    const valid = (await projectStore.addNode({
      type: 'usecase',
      x: 0,
      y: 0,
      title: 'UC1',
      body: '',
    })) as Node;

    let capturedPrompt = '';
    const sdk: SdkLike = {
      query: ({ prompt }: { prompt: string }) => {
        capturedPrompt = prompt;
        return (async function* () {
          yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
        })();
      },
    };
    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });
    for await (const _e of runner.runUserTurn('q', ['nonexistent', valid.id, 'also-gone'])) {
      // drain
    }
    expect(capturedPrompt).toContain('<context_nodes>');
    expect(capturedPrompt).toContain(`id: ${valid.id}`);
    expect(capturedPrompt).not.toContain('id: nonexistent');
    expect(capturedPrompt).not.toContain('id: also-gone');
  });

  // contextNodeIds が空 (または省略) なら <context_nodes> ブロックは生成しない。
  it('contextNodeIds 空のとき <context_nodes> は出ない', async () => {
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    let capturedPrompt = '';
    const sdk: SdkLike = {
      query: ({ prompt }: { prompt: string }) => {
        capturedPrompt = prompt;
        return (async function* () {
          yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
        })();
      },
    };
    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });
    for await (const _e of runner.runUserTurn('hello', [])) {
      // drain
    }
    expect(capturedPrompt).not.toContain('<context_nodes>');
    // user 文字列自体は (履歴経由で) 必ず prompt に入る
    expect(capturedPrompt).toContain('hello');
  });
});

describe('formatNodeForContext / buildChatPrompt', () => {
  it('formatNodeForContext: question の options を *(selected) / -(unselected) で示す', () => {
    const node: Node = {
      id: 'q-1',
      type: 'question',
      x: 0,
      y: 0,
      title: '招待時の認証方式',
      body: '',
      options: [
        { id: 'opt-1', text: 'メールリンク', selected: true },
        { id: 'opt-2', text: '電話SMS', selected: false },
      ],
      decision: 'opt-1',
    };
    const out = formatNodeForContext(node);
    expect(out).toContain('id: q-1');
    expect(out).toContain('type: question');
    expect(out).toContain('* メールリンク');
    expect(out).toContain('- 電話SMS');
    expect(out).toContain('decision: opt-1');
  });

  it('formatNodeForContext: proposal は未採用注釈と adoptAs を含み sourceAgentId は含まない', () => {
    // codex セカンドオピニオン #16: proposal の sourceAgentId は AI にとって意味の無い内部属性。
    // 代わりに「未採用の AI 提案」であることを note として AI に伝える (ADR-0005)。
    const node: Node = {
      id: 'p-1',
      type: 'proposal',
      x: 0,
      y: 0,
      title: '[AI] 提案タイトル',
      body: '提案ボディ',
      adoptAs: 'requirement',
      sourceAgentId: 'agent-decompose-to-stories',
    };
    const out = formatNodeForContext(node);
    expect(out).toContain('id: p-1');
    expect(out).toContain('type: proposal');
    expect(out).toContain('未採用の AI 提案');
    expect(out).toContain('adoptAs: requirement');
    expect(out).not.toContain('sourceAgentId');
    expect(out).not.toContain('agent-decompose-to-stories');
  });

  it('formatNodeForContext: coderef の filePath/startLine などを含む', () => {
    const node: Node = {
      id: 'code-1',
      type: 'coderef',
      x: 0,
      y: 0,
      title: 'auth/invite.ts',
      body: '',
      codebaseId: 'main',
      filePath: 'src/auth/invite.ts',
      startLine: 12,
      endLine: 30,
      summary: 'invite token 発行',
    };
    const out = formatNodeForContext(node);
    expect(out).toContain('filePath: src/auth/invite.ts');
    expect(out).toContain('startLine: 12');
    expect(out).toContain('endLine: 30');
    expect(out).toContain('summary: invite token 発行');
  });

  it('buildChatPrompt: 履歴 + context + current の順序で並ぶ', () => {
    const history = [
      {
        id: 'm1',
        role: 'user' as const,
        blocks: [{ type: 'text' as const, text: '過去質問' }],
        createdAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'm2',
        role: 'user' as const,
        blocks: [{ type: 'text' as const, text: '今回の質問' }],
        createdAt: '2026-01-01T00:01:00Z',
      },
    ];
    const ctx: Node[] = [{ id: 'r-1', type: 'requirement', x: 0, y: 0, title: 'R1', body: '本文' }];
    const out = buildChatPrompt(history, ctx);
    const histIdx = out.indexOf('<conversation_history>');
    const ctxIdx = out.indexOf('<context_nodes>');
    const curIdx = out.indexOf('<current_user_message>');
    expect(histIdx).toBeGreaterThanOrEqual(0);
    expect(ctxIdx).toBeGreaterThan(histIdx);
    expect(curIdx).toBeGreaterThan(ctxIdx);
    // current_user_message の中身は最後の user message。
    expect(out.slice(curIdx)).toContain('今回の質問');
    expect(out.slice(curIdx)).not.toContain('過去質問');
  });
});
