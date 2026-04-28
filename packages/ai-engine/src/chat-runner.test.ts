import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ChatMessage, Node } from '@tally/core';
import { newChatMessageId } from '@tally/core';
import { FileSystemChatStore, FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SdkLike } from './agent-runner';
import { buildChatPrompt, ChatRunner, formatNodeForContext } from './chat-runner';
import type { ChatEvent, SdkMessageLike } from './stream';

// long-lived Query 化に伴い prompt は AsyncIterable<SdkUserMessageLike> 型に変わった。
// テスト側で「最初に push された user message の content」を読むためのヘルパ。
// string で渡された場合 (互換) も同じ shape で扱えるようにする。
function startCapturePromptText(prompt: unknown): { read: () => string } {
  const captured = { value: '' };
  if (typeof prompt === 'string') {
    captured.value = prompt;
  } else if (
    prompt &&
    typeof (prompt as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function'
  ) {
    const it = (prompt as AsyncIterable<{ message?: { content?: string } }>)[
      Symbol.asyncIterator
    ]();
    it.next().then((r) => {
      if (!r.done && r.value?.message?.content) captured.value = r.value.message.content;
    });
  }
  return { read: () => captured.value };
}

describe('ChatRunner', () => {
  let root: string;

  beforeEach(async () => {
    root = mkdtempSync(path.join(tmpdir(), 'tally-chat-runner-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [],
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

    let promptCapture: { read: () => string } = { read: () => '' };
    const sdk: SdkLike = {
      query: ({ prompt }: { prompt: unknown }) => {
        promptCapture = startCapturePromptText(prompt);
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

    const capturedPrompt = promptCapture.read();
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

    let promptCapture: { read: () => string } = { read: () => '' };
    const sdk: SdkLike = {
      query: ({ prompt }: { prompt: unknown }) => {
        promptCapture = startCapturePromptText(prompt);
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

    const capturedPrompt = promptCapture.read();
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

    let promptCapture: { read: () => string } = { read: () => '' };
    const sdk: SdkLike = {
      query: ({ prompt }: { prompt: unknown }) => {
        promptCapture = startCapturePromptText(prompt);
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
    const capturedPrompt = promptCapture.read();
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

    let promptCapture: { read: () => string } = { read: () => '' };
    const sdk: SdkLike = {
      query: ({ prompt }: { prompt: unknown }) => {
        promptCapture = startCapturePromptText(prompt);
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
    const capturedPrompt = promptCapture.read();
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

describe('ChatRunner — buildMcpServers 統合 (Task 11)', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('プロジェクト設定の mcpServers[] を sdk.query に動的に渡す (url のみ、auth は SDK 任せ)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-task11-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [
        {
          id: 'test-mcp',
          name: 'T',
          kind: 'atlassian',
          url: 'https://t.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    const querySpy = vi.fn(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
      })(),
    );
    const sdk: SdkLike = { query: querySpy };
    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });
    for await (const _ of runner.runUserTurn('hi')) {
      /* drain */
    }

    expect(querySpy).toHaveBeenCalled();
    const callArg = (querySpy.mock.calls as unknown[][])[0]?.[0] as unknown as {
      options?: {
        mcpServers?: Record<string, { url?: string; headers?: unknown }>;
        allowedTools?: string[];
      };
    };
    expect(Object.keys(callArg.options?.mcpServers ?? {})).toEqual(
      expect.arrayContaining(['tally', 'test-mcp']),
    );
    const testMcp = callArg.options?.mcpServers?.['test-mcp'];
    expect(testMcp?.url).toBe('https://t.test/mcp');
    expect(testMcp?.headers).toBeUndefined();
    expect(callArg.options?.allowedTools).toContain('mcp__tally__*');
    expect(callArg.options?.allowedTools).toContain('mcp__test-mcp__*');

    rmSync(root, { recursive: true, force: true });
  });

  it('mcpServers[] が空配列なら tally のみ (退行なし)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-task11b-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
    const querySpy = vi.fn(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
      })(),
    );
    const sdk: SdkLike = { query: querySpy };
    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });
    for await (const _ of runner.runUserTurn('hi')) {
      /* drain */
    }

    const callArg = (querySpy.mock.calls as unknown[][])[0]?.[0] as unknown as {
      options?: { mcpServers?: Record<string, unknown>; allowedTools?: string[] };
    };
    expect(Object.keys(callArg.options?.mcpServers ?? {})).toEqual(['tally']);
    expect(callArg.options?.allowedTools).toEqual(['mcp__tally__*']);

    rmSync(root, { recursive: true, force: true });
  });

  it('OAuth 採用後: SDK 設定に Authorization header は付かない (auth は MCP/SDK 任せ)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-task11c-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [
        {
          id: 'atlassian',
          name: 'A',
          kind: 'atlassian',
          url: 'https://api.atlassian.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
    const querySpy = vi.fn(() =>
      (async function* () {
        yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
      })(),
    );
    const sdk: SdkLike = { query: querySpy };
    const runner = new ChatRunner({
      sdk,
      chatStore,
      projectStore,
      projectDir: root,
      threadId: thread.id,
    });
    for await (const _ of runner.runUserTurn('hi')) {
      /* drain */
    }

    const callArg = (querySpy.mock.calls as unknown[][])[0]?.[0] as unknown as {
      options?: { mcpServers?: Record<string, { url?: string; headers?: unknown }> };
    };
    const atlassian = callArg.options?.mcpServers?.atlassian;
    expect(atlassian?.url).toBe('https://api.atlassian.test/mcp');
    // OAuth 2.1 採用: Tally は Authorization header を組み立てない
    expect(atlassian?.headers).toBeUndefined();

    rmSync(root, { recursive: true, force: true });
  });
});

describe('ChatRunner — 外部 MCP tool_use/tool_result 永続化 (Task 12)', () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('外部 MCP の tool_use を source=external で永続化、chat_tool_external_use event を emit', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-task12a-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [
        {
          id: 'atlassian',
          name: 'A',
          kind: 'atlassian',
          url: 'https://t.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });

    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Jira を読みます' },
                {
                  type: 'tool_use',
                  id: 'atlassian-tu-1',
                  name: 'mcp__atlassian__jira_get_issue',
                  input: { issueKey: 'EPIC-1' },
                },
              ],
            },
          } as unknown as SdkMessageLike;
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'atlassian-tu-1',
                  content: [{ type: 'text', text: '{"summary":"Epic title"}' }],
                },
              ],
            },
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
    for await (const e of runner.runUserTurn('@JIRA EPIC-1')) events.push(e);

    const useEvent = events.find((e) => e.type === 'chat_tool_external_use');
    expect(useEvent).toBeDefined();
    if (useEvent && useEvent.type === 'chat_tool_external_use') {
      expect(useEvent.toolUseId).toBe('atlassian-tu-1');
      expect(useEvent.name).toBe('mcp__atlassian__jira_get_issue');
    }
    const resultEvent = events.find((e) => e.type === 'chat_tool_external_result');
    expect(resultEvent).toBeDefined();
    if (resultEvent && resultEvent.type === 'chat_tool_external_result') {
      expect(resultEvent.toolUseId).toBe('atlassian-tu-1');
      expect(resultEvent.ok).toBe(true);
      expect(resultEvent.output).toContain('Epic title');
    }

    const reloaded = await chatStore.getChat(thread.id);
    const asstMsg = reloaded?.messages.find((m) => m.role === 'assistant');
    const toolUse = asstMsg?.blocks.find((b) => b.type === 'tool_use');
    expect(toolUse).toBeDefined();
    if (toolUse?.type === 'tool_use') {
      expect(toolUse.source).toBe('external');
      expect(toolUse.name).toBe('mcp__atlassian__jira_get_issue');
      expect(toolUse.approval).toBeUndefined();
    }
    const toolResult = asstMsg?.blocks.find((b) => b.type === 'tool_result');
    expect(toolResult).toBeDefined();
    if (toolResult?.type === 'tool_result') {
      expect(toolResult.ok).toBe(true);
      expect(toolResult.output).toContain('Epic title');
    }

    rmSync(root, { recursive: true, force: true });
  });

  it('mcp__tally__ で始まる tool_use は無視 (intercept 経路で処理されるため)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-task12b-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: '作ります' },
                {
                  type: 'tool_use',
                  id: 'tally-tu',
                  name: 'mcp__tally__create_node',
                  input: {},
                },
              ],
            },
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
    for await (const e of runner.runUserTurn('hi')) events.push(e);

    expect(events.find((e) => e.type === 'chat_tool_external_use')).toBeUndefined();

    rmSync(root, { recursive: true, force: true });
  });

  it('tool_result output が 4KB 超えると永続化時に truncate、event は full (Task 13)', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-task13-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [
        {
          id: 'atlassian',
          name: 'A',
          kind: 'atlassian',
          url: 'https://t.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
    const bigOutput = 'X'.repeat(10_000);
    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'big-1',
                  content: [{ type: 'text', text: bigOutput }],
                },
              ],
            },
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
    for await (const e of runner.runUserTurn('q')) events.push(e);

    // event はフル
    const evt = events.find((e) => e.type === 'chat_tool_external_result');
    expect(evt).toBeDefined();
    if (evt && evt.type === 'chat_tool_external_result') {
      expect(evt.output.length).toBe(10_000);
    }

    // YAML 永続化は truncate
    const reloaded = await chatStore.getChat(thread.id);
    const tr = reloaded?.messages.flatMap((m) => m.blocks).find((b) => b.type === 'tool_result');
    expect(tr).toBeDefined();
    if (tr?.type === 'tool_result') {
      expect(tr.output.length).toBeLessThanOrEqual(4200);
      expect(tr.output).toContain('(truncated');
      expect(tr.output).toContain('10000');
    }

    rmSync(root, { recursive: true, force: true });
  });

  it('tool_result output が 4KB 以下なら truncate しない', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-task13b-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [
        {
          id: 'atlassian',
          name: 'A',
          kind: 'atlassian',
          url: 'https://t.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
    const smallOutput = 'small result';
    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'small-1',
                  content: [{ type: 'text', text: smallOutput }],
                },
              ],
            },
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
    for await (const _ of runner.runUserTurn('q')) {
      /* drain */
    }

    const reloaded = await chatStore.getChat(thread.id);
    const tr = reloaded?.messages.flatMap((m) => m.blocks).find((b) => b.type === 'tool_result');
    if (tr?.type === 'tool_result') {
      expect(tr.output).toBe(smallOutput);
      expect(tr.output).not.toContain('truncated');
    }

    rmSync(root, { recursive: true, force: true });
  });

  it('外部 tool_result が is_error=true なら ok=false で記録', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-task12c-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [
        {
          id: 'atlassian',
          name: 'A',
          kind: 'atlassian',
          url: 'https://t.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'err-tu',
                  name: 'mcp__atlassian__jira_get_issue',
                  input: { issueKey: 'BOGUS' },
                },
              ],
            },
          } as unknown as SdkMessageLike;
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'err-tu',
                  content: [{ type: 'text', text: '404 not found' }],
                  is_error: true,
                },
              ],
            },
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
    for await (const e of runner.runUserTurn('q')) events.push(e);

    const evt = events.find((e) => e.type === 'chat_tool_external_result');
    expect(evt).toBeDefined();
    if (evt && evt.type === 'chat_tool_external_result') {
      expect(evt.ok).toBe(false);
      expect(evt.output).toContain('404');
    }

    rmSync(root, { recursive: true, force: true });
  });
});

describe('buildChatPrompt — tool_use/tool_result replay (Task 14, T4 fix)', () => {
  it('過去 turn の text + tool_use + tool_result が conversation_history に含まれる', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        blocks: [{ type: 'text', text: '@JIRA EPIC-1 を読んで' }],
        createdAt: '2026-04-24T00:00:00Z',
      },
      {
        id: 'a1',
        role: 'assistant',
        blocks: [
          { type: 'text', text: 'Jira を読みます' },
          {
            type: 'tool_use',
            toolUseId: 'tu-1',
            name: 'mcp__atlassian__jira_get_issue',
            input: { key: 'EPIC-1' },
            source: 'external',
          },
          { type: 'tool_result', toolUseId: 'tu-1', ok: true, output: '{"summary":"Epic X"}' },
          { type: 'text', text: '読みました。Epic X です' },
        ],
        createdAt: '2026-04-24T00:01:00Z',
      },
      {
        id: 'u2',
        role: 'user',
        blocks: [{ type: 'text', text: '続けて子チケット STORY-42 を読んで' }],
        createdAt: '2026-04-24T00:02:00Z',
      },
    ];

    const prompt = buildChatPrompt(messages);

    // 過去 turn の Jira 内容が prompt に含まれる (T4 fix の核)
    expect(prompt).toContain('Epic X');
    expect(prompt).toContain('mcp__atlassian__jira_get_issue');
    expect(prompt).toContain('source="external"');
    // 直近 user message は current_user_message として独立
    expect(prompt).toContain('<current_user_message>');
    expect(prompt).toContain('STORY-42');
    // tool_use / tool_result タグが正しく出る
    expect(prompt).toContain('<tool_use');
    expect(prompt).toContain('<tool_result');
  });

  it('source 未指定 (internal) の tool_use は source 属性が出ない', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        blocks: [{ type: 'text', text: '作って' }],
        createdAt: '2026-04-24T00:00:00Z',
      },
      {
        id: 'a1',
        role: 'assistant',
        blocks: [
          {
            type: 'tool_use',
            toolUseId: 'tu-1',
            name: 'mcp__tally__create_node',
            input: {},
            source: 'internal',
            approval: 'approved',
          },
        ],
        createdAt: '2026-04-24T00:01:00Z',
      },
      {
        id: 'u2',
        role: 'user',
        blocks: [{ type: 'text', text: 'next' }],
        createdAt: '2026-04-24T00:02:00Z',
      },
    ];

    const prompt = buildChatPrompt(messages);
    expect(prompt).toContain('mcp__tally__create_node');
    expect(prompt).not.toContain('source="external"');
    expect(prompt).not.toContain('source="internal"');
  });

  it('blocks が空の message は省く (履歴前段の空 assistant 想定)', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        blocks: [{ type: 'text', text: 'hello' }],
        createdAt: '2026-04-24T00:00:00Z',
      },
      {
        id: 'a-empty',
        role: 'assistant',
        blocks: [],
        createdAt: '2026-04-24T00:01:00Z',
      },
      {
        id: 'u2',
        role: 'user',
        blocks: [{ type: 'text', text: 'continue' }],
        createdAt: '2026-04-24T00:02:00Z',
      },
    ];
    const prompt = buildChatPrompt(messages);
    // 空 assistant は省かれる
    const messageOpens = prompt.match(/<message role="assistant">/g) ?? [];
    expect(messageOpens.length).toBe(0);
    // user の "hello" は履歴に残る
    expect(prompt).toContain('hello');
    expect(prompt).toContain('continue');
  });

  it('過去 turn が無く current user のみのケース (初回 turn)', () => {
    const messages: ChatMessage[] = [
      {
        id: 'u1',
        role: 'user',
        blocks: [{ type: 'text', text: '初回' }],
        createdAt: '2026-04-24T00:00:00Z',
      },
    ];
    const prompt = buildChatPrompt(messages);
    expect(prompt).not.toContain('<conversation_history>');
    expect(prompt).toContain('<current_user_message>');
    expect(prompt).toContain('初回');
  });
});

// 外部 MCP の OAuth 2.1 フロー: authenticate / complete_authentication tool_use を
// 検出して auth_request ブロックに変換する経路の検証。raw な tool_use/tool_result が
// チャット履歴に並ばず、UI が描画する auth_request 1 等地ブロックだけ残る。
describe('ChatRunner — auth_request 変換 (OAuth 2.1)', () => {
  async function setup() {
    const root = mkdtempSync(path.join(tmpdir(), 'tally-chat-auth-'));
    const ps = new FileSystemProjectStore(root);
    await ps.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      mcpServers: [
        {
          id: 'atlassian',
          name: 'My Atlassian',
          kind: 'atlassian',
          url: 'https://t.test/mcp',
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const chatStore = new FileSystemChatStore(root);
    const projectStore = new FileSystemProjectStore(root);
    const thread = await chatStore.createChat({ projectId: 'proj-1', title: 't' });
    return { root, chatStore, projectStore, thread };
  }

  function makeAuthSdk(authUrl: string): SdkLike {
    return {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: '認証フローを開始します' },
                {
                  type: 'tool_use',
                  id: 'auth-tu-1',
                  name: 'mcp__atlassian__authenticate',
                  input: {},
                },
              ],
            },
          } as unknown as SdkMessageLike;
          yield {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'auth-tu-1',
                  content: [{ type: 'text', text: `Open: ${authUrl}` }],
                },
              ],
            },
          } as unknown as SdkMessageLike;
          yield { type: 'result', subtype: 'success', result: 'ok' } as unknown as SdkMessageLike;
        })(),
    };
  }

  it('authenticate: tool_use/tool_result を消化し、auth_request{pending} ブロック + chat_auth_request event を出す', async () => {
    const { root, chatStore, projectStore, thread } = await setup();
    try {
      const authUrl =
        'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc&state=xyz';
      const runner = new ChatRunner({
        sdk: makeAuthSdk(authUrl),
        chatStore,
        projectStore,
        projectDir: root,
        threadId: thread.id,
      });
      const events: ChatEvent[] = [];
      for await (const e of runner.runUserTurn('jira を読んで')) events.push(e);

      // raw な tool_use / tool_result event は出ない (auth は auth_request 1 等地)
      expect(events.find((e) => e.type === 'chat_tool_external_use')).toBeUndefined();
      expect(events.find((e) => e.type === 'chat_tool_external_result')).toBeUndefined();

      const authEvt = events.find((e) => e.type === 'chat_auth_request');
      expect(authEvt).toBeDefined();
      if (authEvt && authEvt.type === 'chat_auth_request') {
        expect(authEvt.mcpServerId).toBe('atlassian');
        expect(authEvt.mcpServerLabel).toBe('My Atlassian');
        expect(authEvt.authUrl).toBe(authUrl);
        expect(authEvt.status).toBe('pending');
      }

      // 永続化: assistant message に auth_request ブロックがあって、tool_use/tool_result は無い
      const reloaded = await chatStore.getChat(thread.id);
      const assistant = reloaded?.messages.find((m) => m.role === 'assistant');
      const blocks = assistant?.blocks ?? [];
      const hasRawToolUse = blocks.some(
        (b) => b.type === 'tool_use' && b.name.includes('authenticate'),
      );
      expect(hasRawToolUse).toBe(false);
      const authBlock = blocks.find((b) => b.type === 'auth_request');
      expect(authBlock).toBeDefined();
      if (authBlock && authBlock.type === 'auth_request') {
        expect(authBlock.status).toBe('pending');
        expect(authBlock.authUrl).toBe(authUrl);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('complete_authentication 成功: 同 thread の最新 pending auth_request が completed に更新される', async () => {
    const { root, chatStore, projectStore, thread } = await setup();
    try {
      const authUrl =
        'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc&state=xyz';
      // turn 1: authenticate を流して pending auth_request を作る
      const runner1 = new ChatRunner({
        sdk: makeAuthSdk(authUrl),
        chatStore,
        projectStore,
        projectDir: root,
        threadId: thread.id,
      });
      for await (const _ of runner1.runUserTurn('jira を読んで')) {
        void _;
      }

      // turn 2: complete_authentication が走るシナリオ
      const sdk2: SdkLike = {
        query: () =>
          (async function* () {
            yield {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'tool_use',
                    id: 'auth-tu-2',
                    name: 'mcp__atlassian__complete_authentication',
                    input: { url: 'http://localhost:54801/callback?code=xxx&state=xyz' },
                  },
                ],
              },
            } as unknown as SdkMessageLike;
            yield {
              type: 'user',
              message: {
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: 'auth-tu-2',
                    content: [{ type: 'text', text: 'authenticated' }],
                  },
                ],
              },
            } as unknown as SdkMessageLike;
            yield {
              type: 'result',
              subtype: 'success',
              result: 'done',
            } as unknown as SdkMessageLike;
          })(),
      };
      const runner2 = new ChatRunner({
        sdk: sdk2,
        chatStore,
        projectStore,
        projectDir: root,
        threadId: thread.id,
      });
      const events: ChatEvent[] = [];
      for await (const e of runner2.runUserTurn(
        '[OAuth callback] http://localhost:54801/callback?code=xxx&state=xyz',
      ))
        events.push(e);

      const authEvt = events.find((e) => e.type === 'chat_auth_request');
      expect(authEvt).toBeDefined();
      if (authEvt && authEvt.type === 'chat_auth_request') {
        expect(authEvt.status).toBe('completed');
        expect(authEvt.mcpServerId).toBe('atlassian');
      }

      // 永続化: 元の pending auth_request ブロックが completed に書き換わっている
      const reloaded = await chatStore.getChat(thread.id);
      const allAuthBlocks = (reloaded?.messages ?? []).flatMap((m) =>
        m.blocks.filter((b) => b.type === 'auth_request'),
      );
      // 同 server の auth_request は 1 個のままで、status が completed に変わっている
      expect(allAuthBlocks).toHaveLength(1);
      const ab = allAuthBlocks[0];
      if (ab && ab.type === 'auth_request') {
        expect(ab.status).toBe('completed');
        expect(ab.authUrl).toBe(authUrl);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('complete_authentication 失敗 (ok=false): 最新 pending が failed + failureMessage 付きで更新', async () => {
    const { root, chatStore, projectStore, thread } = await setup();
    try {
      const authUrl =
        'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc&state=xyz';
      const runner1 = new ChatRunner({
        sdk: makeAuthSdk(authUrl),
        chatStore,
        projectStore,
        projectDir: root,
        threadId: thread.id,
      });
      for await (const _ of runner1.runUserTurn('jira を読んで')) {
        void _;
      }

      const sdk2: SdkLike = {
        query: () =>
          (async function* () {
            yield {
              type: 'assistant',
              message: {
                content: [
                  {
                    type: 'tool_use',
                    id: 'auth-tu-2',
                    name: 'mcp__atlassian__complete_authentication',
                    input: { url: 'http://localhost:54801/callback?code=bad' },
                  },
                ],
              },
            } as unknown as SdkMessageLike;
            yield {
              type: 'user',
              message: {
                content: [
                  {
                    type: 'tool_result',
                    tool_use_id: 'auth-tu-2',
                    content: [{ type: 'text', text: 'invalid_grant: state mismatch' }],
                    is_error: true,
                  },
                ],
              },
            } as unknown as SdkMessageLike;
            yield {
              type: 'result',
              subtype: 'success',
              result: 'done',
            } as unknown as SdkMessageLike;
          })(),
      };
      const runner2 = new ChatRunner({
        sdk: sdk2,
        chatStore,
        projectStore,
        projectDir: root,
        threadId: thread.id,
      });
      const events: ChatEvent[] = [];
      for await (const e of runner2.runUserTurn('callback URL: ...')) events.push(e);

      const authEvt = events.find((e) => e.type === 'chat_auth_request');
      expect(authEvt).toBeDefined();
      if (authEvt && authEvt.type === 'chat_auth_request') {
        expect(authEvt.status).toBe('failed');
        expect(authEvt.failureMessage).toContain('invalid_grant');
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
