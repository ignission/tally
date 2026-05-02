import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { UseCaseNode } from '@tally/core';
import { FileSystemOAuthStore, FileSystemProjectStore, type ProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runAgent, type SdkLike } from './agent-runner';
import type { AgentEvent, SdkMessageLike } from './stream';

describe('runAgent', () => {
  let root: string;
  let store: FileSystemProjectStore;
  let ucNode: UseCaseNode;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-runner-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    ucNode = await store.addNode({
      type: 'usecase',
      x: 0,
      y: 0,
      title: '招待',
      body: 'メール招待',
    });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('SDK モックが thinking と done を流すと AgentEvent に変換される', async () => {
    const ucId = ucNode.id;
    const queryCalls: Array<{
      prompt: string;
      options?: {
        systemPrompt?: string;
        mcpServers?: Record<string, unknown>;
        tools?: string[];
        allowedTools?: string[];
        cwd?: string;
        settingSources?: string[];
        permissionMode?: string;
      };
    }> = [];
    const mockSdk = {
      async *query(opts: {
        prompt: string;
        options?: {
          systemPrompt?: string;
          mcpServers?: Record<string, unknown>;
          allowedTools?: string[];
          cwd?: string;
          settingSources?: string[];
        };
      }) {
        queryCalls.push(opts);
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: '分解します' }] },
        };
        // tool_use は SDK の内部ループで発火するため、ここでは「結果」相当を流すのではなく
        // agent-runner 側が直接 store を触る経路を検証する。
        // そのため、この統合テストでは SDK message の変換のみを検証し、
        // create_node 呼び出しの実体は tools のテストで担保されている前提とする。
        yield {
          type: 'result',
          subtype: 'success',
          result: '分解完了',
        };
      },
    };
    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk: mockSdk as never,
      store,
      oauthStore: new FileSystemOAuthStore(root),
      projectDir: root,
      req: {
        type: 'start',
        agent: 'decompose-to-stories',
        projectId: 'proj-test',
        input: { nodeId: ucId },
      },
    })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === 'start')).toBe(true);
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('done');

    // SDK query が Options ラッパ経由で呼ばれていることを検証
    // (systemPrompt / mcpServers / allowedTools は options 配下でないと SDK が無視する)
    expect(queryCalls).toHaveLength(1);
    const call = queryCalls[0];
    expect(typeof call?.prompt).toBe('string');
    expect(call?.options?.systemPrompt).toContain('proposal');
    expect(call?.options?.mcpServers).toHaveProperty('tally');
    expect(call?.options?.allowedTools).toContain('mcp__tally__create_node');
    expect(call?.options?.allowedTools).toContain('mcp__tally__create_edge');
    // 外部設定ファイルを読み込まないことを検証
    expect(call?.options?.settingSources).toEqual([]);
    // allowedTools を厳格な whitelist として機能させるための permissionMode
    expect(call?.options?.permissionMode).toBe('dontAsk');
    // decompose-to-stories は built-in ツールを要求しないため tools は []
    expect(call?.options?.tools).toEqual([]);
  });

  it('存在しない nodeId は error:not_found を流して終わる', async () => {
    const mockSdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk: mockSdk as never,
      store,
      oauthStore: new FileSystemOAuthStore(root),
      projectDir: root,
      req: {
        type: 'start',
        agent: 'decompose-to-stories',
        projectId: 'proj-test',
        input: { nodeId: 'uc-missing' },
      },
    })) {
      events.push(e);
    }
    const last = events[events.length - 1];
    expect(last?.type).toBe('error');
    if (last?.type === 'error') expect(last.code).toBe('not_found');
  });

  it('usecase 以外のノードは error:bad_request', async () => {
    const story = await store.addNode({
      type: 'userstory',
      x: 0,
      y: 0,
      title: 's',
      body: 'b',
    });
    const mockSdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk: mockSdk as never,
      store,
      oauthStore: new FileSystemOAuthStore(root),
      projectDir: root,
      req: {
        type: 'start',
        agent: 'decompose-to-stories',
        projectId: 'proj-test',
        input: { nodeId: story.id },
      },
    })) {
      events.push(e);
    }
    const last = events[events.length - 1];
    expect(last?.type).toBe('error');
    if (last?.type === 'error') expect(last.code).toBe('bad_request');
  });

  it('未知 agent は error:bad_request', async () => {
    const mockSdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk: mockSdk as never,
      store,
      oauthStore: new FileSystemOAuthStore(root),
      projectDir: root,
      req: {
        type: 'start',
        // biome-ignore lint/suspicious/noExplicitAny: 未知 agent を注入するための意図的キャスト
        agent: 'unknown-agent' as any,
        projectId: 'proj-test',
        input: { nodeId: 'uc-x' },
      },
    })) {
      events.push(e);
    }
    const last = events[events.length - 1];
    expect(last?.type).toBe('error');
    if (last?.type === 'error') expect(last.code).toBe('bad_request');
  });

  it('SDK が throw したら error:agent_failed を流す', async () => {
    const ucId = ucNode.id;
    const mockSdk = {
      async *query() {
        throw new Error('ブー');
        // biome-ignore lint/correctness/noUnreachable: AsyncGenerator 型のために yield を残す
        yield { type: 'result', subtype: 'success', result: '' };
      },
    };
    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk: mockSdk as never,
      store,
      oauthStore: new FileSystemOAuthStore(root),
      projectDir: root,
      req: {
        type: 'start',
        agent: 'decompose-to-stories',
        projectId: 'proj-test',
        input: { nodeId: ucId },
      },
    })) {
      events.push(e);
    }
    const last = events[events.length - 1];
    expect(last?.type).toBe('error');
    if (last?.type === 'error') {
      expect(last.code).toBe('agent_failed');
      expect(last.message).toContain('ブー');
    }
  });

  it('find-related-code では built-in ツールが Read/Glob/Grep のみに絞られ Bash/Edit/Write は含まない', async () => {
    // codebasePath を解決可能にするため、projectDir に meta と codebase dir を仕立てる。
    const codebaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-codebase-'));
    try {
      await store.saveProjectMeta({
        id: 'proj-test',
        name: 'FRC integration',
        codebases: [{ id: 'main', label: 'Main', path: codebaseDir }],
        mcpServers: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const queryCalls: Array<{
        options?: {
          tools?: string[];
          allowedTools?: string[];
          cwd?: string;
          permissionMode?: string;
        };
      }> = [];
      const mockSdk = {
        async *query(opts: {
          options?: {
            tools?: string[];
            allowedTools?: string[];
            cwd?: string;
            permissionMode?: string;
          };
        }) {
          queryCalls.push(opts);
          yield { type: 'result', subtype: 'success', result: 'ok' };
        },
      };
      const events: AgentEvent[] = [];
      for await (const e of runAgent({
        sdk: mockSdk as never,
        store,
        oauthStore: new FileSystemOAuthStore(root),
        projectDir: root,
        req: {
          type: 'start',
          agent: 'find-related-code',
          projectId: 'proj-test',
          input: { nodeId: ucNode.id },
        },
      })) {
        events.push(e);
      }
      expect(events[events.length - 1]?.type).toBe('done');
      const opts = queryCalls[0]?.options;
      expect(opts?.tools).toEqual(['Read', 'Glob', 'Grep']);
      expect(opts?.tools).not.toContain('Bash');
      expect(opts?.tools).not.toContain('Edit');
      expect(opts?.tools).not.toContain('Write');
      expect(opts?.allowedTools).toContain('mcp__tally__create_node');
      expect(opts?.allowedTools).toContain('Read');
      expect(opts?.permissionMode).toBe('dontAsk');
      // cwd が resolved 絶対パスで渡ることを確認
      expect(opts?.cwd).toBe(path.resolve(root, codebaseDir));
    } finally {
      await fs.rm(codebaseDir, { recursive: true, force: true });
    }
  });

  it('analyze-impact の start → validateInput → sdk.query を cwd / tools / allowedTools / permissionMode 付きで呼ぶ', async () => {
    const codebaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-codebase-'));
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'P',
      codebases: [{ id: 'main', label: 'Main', path: codebaseDir }],
      mcpServers: [],
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T00:00:00Z',
    });

    const queryCalls: Array<{
      prompt: string;
      options?: {
        systemPrompt?: string;
        mcpServers?: Record<string, unknown>;
        tools?: string[];
        allowedTools?: string[];
        cwd?: string;
        settingSources?: string[];
        permissionMode?: string;
      };
    }> = [];
    const mockSdk = {
      async *query(opts: unknown) {
        queryCalls.push(opts as never);
        yield { type: 'result', subtype: 'success', result: 'done' };
      },
    };

    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk: mockSdk as never,
      store,
      oauthStore: new FileSystemOAuthStore(root),
      projectDir: root,
      req: {
        type: 'start',
        agent: 'analyze-impact',
        projectId: 'proj-test',
        input: { nodeId: ucNode.id },
      },
    })) {
      events.push(e);
    }

    expect(events[0]).toEqual({
      type: 'start',
      agent: 'analyze-impact',
      input: { nodeId: ucNode.id },
    });
    expect(queryCalls).toHaveLength(1);
    const call = queryCalls[0];
    expect(call?.options?.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(call?.options?.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__tally__create_node',
        'mcp__tally__create_edge',
        'mcp__tally__find_related',
        'mcp__tally__list_by_type',
        'Read',
        'Glob',
        'Grep',
      ]),
    );
    expect(call?.options?.permissionMode).toBe('dontAsk');
    expect(call?.options?.settingSources).toEqual([]);
    expect(call?.options?.cwd).toBe(codebaseDir);
    expect(call?.options?.systemPrompt).toContain('影響');

    await fs.rm(codebaseDir, { recursive: true, force: true });
  });

  it('extract-questions: codebasePath 無しで start + tool_use イベントを流す', async () => {
    const projectDir = '/ws';
    const anchor = {
      id: 'uc-1',
      type: 'usecase' as const,
      x: 0,
      y: 0,
      title: '招待',
      body: '',
    };
    const store = {
      getNode: vi.fn().mockResolvedValue(anchor),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({ id: 'p', name: 'x', createdAt: '', updatedAt: '' }),
      addNode: vi.fn(),
      listNodes: vi.fn().mockResolvedValue([anchor]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addEdge: vi.fn(),
    } as unknown as ProjectStore;

    // Mock SDK: assistant が create_node tool_use を 1 回発行する。
    // 実 SDK と違い mock は MCP handler を内部で呼ばないため、ここでは
    // agent-runner が tool_use を AgentEvent として素通しすることだけ検証する。
    // create_node の options 正規化は create-node.test.ts で単体テスト済み。
    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'mcp__tally__create_node',
                  input: {
                    adoptAs: 'question',
                    title: '認証方式を何にするか',
                    body: '...',
                    additional: {
                      options: [{ text: 'OAuth' }, { text: 'Email+Pass' }],
                      decision: null,
                    },
                  },
                },
              ],
            },
          } as unknown as SdkMessageLike;
        })(),
    };

    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk,
      store,
      oauthStore: new FileSystemOAuthStore(projectDir),
      projectDir,
      req: {
        type: 'start',
        agent: 'extract-questions',
        projectId: 'p',
        input: { nodeId: 'uc-1' },
      },
    })) {
      events.push(e);
    }

    // start イベントが最初に発火し、codebasePath 未設定でも validateInput を通り抜ける
    expect(events[0]).toEqual({
      type: 'start',
      agent: 'extract-questions',
      input: { nodeId: 'uc-1' },
    });
    // validateInput が通っていれば agent_failed / error は出ない
    expect(events.some((e) => e.type === 'error')).toBe(false);
    // SDK が流した tool_use が AgentEvent として素通しされる
    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    expect(toolUseEvents.length).toBeGreaterThan(0);
  });

  it('ingest-document: anchor 無しで起動し、tool_use を素通しする', async () => {
    const store = {
      getNode: vi.fn(),
      // Task 15: agent-runner は mcpServers[] を取得するため毎ターン getProjectMeta を呼ぶ。
      // 空 (mcpServers なし) を返して既存挙動と同等にする。
      getProjectMeta: vi.fn().mockResolvedValue(null),
      addNode: vi.fn(),
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addEdge: vi.fn(),
    } as unknown as ProjectStore;

    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'mcp__tally__create_node',
                  input: {
                    adoptAs: 'requirement',
                    title: '招待機能',
                    body: 'メンバーが招待を送れる',
                  },
                },
              ],
            },
          } as unknown as SdkMessageLike;
        })(),
    };

    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk,
      store,
      oauthStore: new FileSystemOAuthStore('/ws'),
      projectDir: '/ws',
      req: {
        type: 'start',
        agent: 'ingest-document',
        projectId: 'p',
        input: { source: 'paste', text: '招待機能を追加する。' },
      },
    })) {
      events.push(e);
    }

    expect(events[0]).toEqual({
      type: 'start',
      agent: 'ingest-document',
      input: { source: 'paste', text: '招待機能を追加する。' },
    });
    expect(events.some((e) => e.type === 'error')).toBe(false);
    const toolUseEvents = events.filter((e) => e.type === 'tool_use');
    expect(toolUseEvents.length).toBeGreaterThan(0);
    // anchor 無しなので store.getNode は呼ばれない
    expect(store.getNode).not.toHaveBeenCalled();
    // Task 15: getProjectMeta は mcpServers[] を取るため必ず呼ばれる
    expect(store.getProjectMeta).toHaveBeenCalled();
  });

  describe('Task 15: agent-runner で buildMcpServers を共有', () => {
    it('プロジェクト mcpServers[] を sdk.query に動的に渡す (url のみ、auth は SDK 任せ)', async () => {
      const store = {
        getNode: vi.fn().mockResolvedValue({
          id: 'uc-1',
          type: 'usecase',
          x: 0,
          y: 0,
          title: 'UC',
          body: '',
        }),
        getProjectMeta: vi.fn().mockResolvedValue({
          id: 'p',
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
          createdAt: '2026-04-24T00:00:00Z',
          updatedAt: '2026-04-24T00:00:00Z',
        }),
        addNode: vi.fn(),
        listNodes: vi.fn().mockResolvedValue([]),
        findRelatedNodes: vi.fn().mockResolvedValue([]),
        addEdge: vi.fn(),
      } as unknown as ProjectStore;

      const querySpy = vi.fn(() =>
        (async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: 'ok',
          } as unknown as SdkMessageLike;
        })(),
      );
      const sdk: SdkLike = { query: querySpy };

      for await (const _ of runAgent({
        sdk,
        store,
        oauthStore: new FileSystemOAuthStore('/ws'),
        projectDir: '/ws',
        req: {
          type: 'start',
          agent: 'extract-questions',
          projectId: 'p',
          input: { nodeId: 'uc-1' },
        },
      })) {
        /* drain */
      }

      const callArg = (querySpy.mock.calls as unknown[][])[0]?.[0] as unknown as {
        options?: {
          mcpServers?: Record<string, { url?: string; headers?: unknown }>;
          allowedTools?: string[];
        };
      };
      expect(Object.keys(callArg.options?.mcpServers ?? {})).toEqual(
        expect.arrayContaining(['tally', 'atlassian']),
      );
      const atlassian = callArg.options?.mcpServers?.atlassian;
      expect(atlassian?.url).toBe('https://t.test/mcp');
      // OAuth 2.1 採用: Tally は Authorization header を組み立てない
      expect(atlassian?.headers).toBeUndefined();
      // agent 固有の allowedTools + 外部 MCP wildcard
      expect(callArg.options?.allowedTools).toContain('mcp__atlassian__*');
    });
  });
});
