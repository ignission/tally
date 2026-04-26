import type { Edge, Project, RequirementNode } from '@tally/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from './store';

function baseProject(): Project {
  const now = new Date().toISOString();
  const n1: RequirementNode = {
    id: 'req-a',
    type: 'requirement',
    x: 0,
    y: 0,
    title: 'A',
    body: '',
  };
  return {
    id: 'proj-1',
    name: 'P',
    codebases: [],
    createdAt: now,
    updatedAt: now,
    nodes: [n1],
    edges: [],
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  useCanvasStore.getState().hydrate(baseProject());
});
afterEach(() => {
  vi.restoreAllMocks();
});

function okJson<T>(body: T, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('useCanvasStore', () => {
  it('hydrate はノード/エッジを Record に展開する', () => {
    const state = useCanvasStore.getState();
    expect(state.projectId).toBe('proj-1');
    expect(Object.keys(state.nodes)).toEqual(['req-a']);
  });

  it('moveNode は楽観更新 + PATCH', async () => {
    okJson({ id: 'req-a', type: 'requirement', x: 10, y: 20, title: 'A', body: '' });
    await useCanvasStore.getState().moveNode('req-a', 10, 20);
    expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 10, y: 20 });
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({ method: 'PATCH' });
  });

  it('moveNode 失敗時は元の座標に戻る', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
    await expect(useCanvasStore.getState().moveNode('req-a', 99, 99)).rejects.toThrow();
    expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 0, y: 0 });
  });

  it('removeNode は楽観削除 + 付随エッジも消す、失敗で復元', async () => {
    const e: Edge = { id: 'e-1', from: 'req-a', to: 'req-a', type: 'trace' };
    useCanvasStore.setState({ edges: { 'e-1': e } });
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
    await expect(useCanvasStore.getState().removeNode('req-a')).rejects.toThrow();
    expect(useCanvasStore.getState().nodes['req-a']).toBeDefined();
    expect(useCanvasStore.getState().edges['e-1']).toEqual(e);
  });

  it('addNodeFromPalette は POST 応答を待って追加', async () => {
    const created = {
      id: 'req-new',
      type: 'requirement',
      x: 100,
      y: 100,
      title: '',
      body: '',
    };
    okJson(created, 201);
    const result = await useCanvasStore.getState().addNodeFromPalette('requirement', 100, 100);
    expect(result.id).toBe('req-new');
    expect(useCanvasStore.getState().nodes['req-new']).toMatchObject(created);
  });

  it('connectEdge は 500 で何も増やさない', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
    await expect(
      useCanvasStore.getState().connectEdge('req-a', 'req-a', 'trace'),
    ).rejects.toThrow();
    expect(useCanvasStore.getState().edges).toEqual({});
  });

  it('changeEdgeType は id を保ったまま type を差し替える', async () => {
    const e: Edge = { id: 'e-1', from: 'req-a', to: 'req-a', type: 'trace' };
    useCanvasStore.setState({ edges: { 'e-1': e } });
    okJson({ id: 'e-1', from: 'req-a', to: 'req-a', type: 'refine' });
    await useCanvasStore.getState().changeEdgeType('e-1', 'refine');
    expect(useCanvasStore.getState().edges['e-1']?.type).toBe('refine');
    expect(Object.keys(useCanvasStore.getState().edges)).toEqual(['e-1']);
  });

  describe('startDecompose', () => {
    it('AgentEvent 列を受けて nodes/edges を拡張し、runningAgent に積む', async () => {
      const newNode = {
        id: 'prop-new',
        type: 'proposal',
        x: 0,
        y: 0,
        title: '[AI] s',
        body: '',
      };
      const newEdge = { id: 'e-x', from: 'uc-1', to: 'prop-new', type: 'derive' };
      // startAgent をモック。
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: () => ({
          events: (async function* () {
            yield { type: 'start', agent: 'decompose-to-stories', input: {} };
            yield { type: 'thinking', text: 'go' };
            yield { type: 'node_created', node: newNode };
            yield { type: 'edge_created', edge: newEdge };
            yield { type: 'done', summary: 'done' };
          })(),
          close: () => {},
        }),
      }));
      const { useCanvasStore } = await import('./store');
      useCanvasStore.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 'uc', body: '' }],
        edges: [],
      });
      await useCanvasStore.getState().startDecompose('uc-1');
      const state = useCanvasStore.getState();
      expect(state.nodes['prop-new']).toEqual(newNode);
      expect(state.edges['e-x']).toEqual(newEdge);
      expect(state.runningAgent).toBeNull();
    });
  });

  describe('startFindRelatedCode', () => {
    it('find-related-code の AgentEvent 列で nodes/edges を拡張し runningAgent をクリアする', async () => {
      const newNode = {
        id: 'prop-cr',
        type: 'proposal',
        x: 0,
        y: 0,
        title: '[AI] src/invite.ts:10',
        body: '',
        adoptAs: 'coderef',
        filePath: 'src/invite.ts',
        startLine: 10,
        endLine: 20,
      };
      const newEdge = { id: 'e-cr', from: 'uc-1', to: 'prop-cr', type: 'derive' };
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: (opts: { agent: string }) => ({
          events: (async function* () {
            yield { type: 'start', agent: opts.agent, input: {} };
            yield { type: 'node_created', node: newNode };
            yield { type: 'edge_created', edge: newEdge };
            yield { type: 'done', summary: 'ok' };
          })(),
          close: () => {},
        }),
      }));
      const { useCanvasStore } = await import('./store');
      useCanvasStore.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 'uc', body: '' }],
        edges: [],
      });
      await useCanvasStore.getState().startFindRelatedCode('uc-1');
      const state = useCanvasStore.getState();
      expect(state.nodes['prop-cr']).toEqual(newNode);
      expect(state.edges['e-cr']).toEqual(newEdge);
      expect(state.runningAgent).toBeNull();
    });
  });

  describe('startAnalyzeImpact', () => {
    it('analyze-impact の AgentEvent 列で coderef + issue + derive エッジを反映し runningAgent をクリア', async () => {
      const events = [
        { type: 'start', agent: 'analyze-impact', input: { nodeId: 'uc-1' } },
        {
          type: 'node_created',
          node: {
            id: 'cref-ai-1',
            type: 'proposal',
            adoptAs: 'coderef',
            x: 200,
            y: 100,
            title: '[AI] src/b.ts:30',
            body: '現状 / 影響',
            filePath: 'src/b.ts',
            startLine: 30,
            endLine: 35,
            summary: '現状',
            impact: '影響',
            sourceAgentId: 'analyze-impact',
          },
        },
        {
          type: 'node_created',
          node: {
            id: 'iss-ai-1',
            type: 'proposal',
            adoptAs: 'issue',
            x: 240,
            y: 220,
            title: '[AI] テスト未整備',
            body: '詳細',
            sourceAgentId: 'analyze-impact',
          },
        },
        {
          type: 'edge_created',
          edge: { id: 'e-1', from: 'uc-1', to: 'cref-ai-1', type: 'derive' },
        },
        { type: 'edge_created', edge: { id: 'e-2', from: 'uc-1', to: 'iss-ai-1', type: 'derive' } },
        { type: 'result', subtype: 'success', result: 'ok' },
      ];
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: (_opts: { agent: string }) => ({
          events: (async function* () {
            for (const e of events) yield e;
          })(),
          close: () => {},
        }),
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 'uc', body: '' }],
        edges: [],
      });
      await store.getState().startAnalyzeImpact('uc-1');
      const state = store.getState();
      expect(state.nodes['cref-ai-1']).toBeDefined();
      expect(state.nodes['iss-ai-1']).toBeDefined();
      expect(state.edges['e-1']?.type).toBe('derive');
      expect(state.edges['e-2']?.type).toBe('derive');
      expect(state.runningAgent).toBeNull();
    });
  });

  describe('startExtractQuestions', () => {
    it('extract-questions の AgentEvent 列で question proposal + derive エッジを反映し runningAgent をクリア', async () => {
      const events = [
        { type: 'start', agent: 'extract-questions', input: { nodeId: 'uc-1' } },
        {
          type: 'node_created',
          node: {
            id: 'q-ai-1',
            type: 'proposal',
            adoptAs: 'question',
            x: 200,
            y: 100,
            title: '[AI] 認証方式を何にするか',
            body: '問いの背景',
            options: [
              { id: 'opt-aaaaaaaaaa', text: 'OAuth', selected: false },
              { id: 'opt-bbbbbbbbbb', text: 'Email+Pass', selected: false },
            ],
            decision: null,
            sourceAgentId: 'extract-questions',
          },
        },
        {
          type: 'edge_created',
          edge: { id: 'e-q-1', from: 'uc-1', to: 'q-ai-1', type: 'derive' },
        },
        { type: 'result', subtype: 'success', result: 'ok' },
      ];
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: (_opts: { agent: string }) => ({
          events: (async function* () {
            for (const e of events) yield e;
          })(),
          close: () => {},
        }),
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 'uc', body: '' }],
        edges: [],
      });
      await store.getState().startExtractQuestions('uc-1');
      const state = store.getState();
      expect(state.nodes['q-ai-1']).toBeDefined();
      expect(state.edges['e-q-1']?.type).toBe('derive');
      expect(state.runningAgent).toBeNull();
    });
  });

  describe('startIngestDocument', () => {
    it('paste 入力で AgentEvent 列を反映する', async () => {
      const events = [
        { type: 'start', agent: 'ingest-document', input: { source: 'paste', text: '要求書' } },
        {
          type: 'node_created',
          node: {
            id: 'req-ai-1',
            type: 'proposal',
            adoptAs: 'requirement',
            x: 0,
            y: 0,
            title: '[AI] 招待',
            body: '',
            sourceAgentId: 'ingest-document',
          },
        },
        {
          type: 'node_created',
          node: {
            id: 'uc-ai-1',
            type: 'proposal',
            adoptAs: 'usecase',
            x: 280,
            y: 0,
            title: '[AI] 招待を送る',
            body: '',
            sourceAgentId: 'ingest-document',
          },
        },
        {
          type: 'edge_created',
          edge: { id: 'e-id-1', from: 'req-ai-1', to: 'uc-ai-1', type: 'satisfy' },
        },
        { type: 'result', subtype: 'success', result: 'ok' },
      ];
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: (_opts: { agent: string }) => ({
          events: (async function* () {
            for (const e of events) yield e;
          })(),
          close: () => {},
        }),
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      });
      const result = await store
        .getState()
        .startIngestDocument({ source: 'paste', text: '要求書の本文' });
      expect(result.ok).toBe(true);
      const state = store.getState();
      expect(state.nodes['req-ai-1']).toBeDefined();
      expect(state.nodes['uc-ai-1']).toBeDefined();
      expect(state.edges['e-id-1']?.type).toBe('satisfy');
      expect(state.runningAgent).toBeNull();
    });

    it('docs-dir 入力で WS に { source: "docs-dir", dirPath } を送る', async () => {
      const events = [
        { type: 'start', agent: 'ingest-document', input: { source: 'docs-dir', dirPath: 'docs' } },
        { type: 'result', subtype: 'success', result: 'ok' },
      ];
      let captured: { agent: string; projectId: string; input: unknown } | null = null;
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: (opts: { agent: string; projectId: string; input: unknown }) => {
          captured = { agent: opts.agent, projectId: opts.projectId, input: opts.input };
          return {
            events: (async function* () {
              for (const e of events) yield e;
            })(),
            close: () => {},
          };
        },
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-2',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      });
      const result = await store
        .getState()
        .startIngestDocument({ source: 'docs-dir', dirPath: 'docs' });
      expect(result.ok).toBe(true);
      expect(captured).not.toBeNull();
      // TS の制御フロー解析が doMock コールバック経由の再代入を追えず never に narrow するため
      // 明示的に型アサーションで取り出す。
      const c = captured as { agent: string; projectId: string; input: unknown } | null;
      expect(c?.input).toEqual({ source: 'docs-dir', dirPath: 'docs' });
    });
  });

  describe('patchProjectMeta', () => {
    it('PATCH 応答で projectMeta を置き換える', async () => {
      useCanvasStore.getState().hydrate({
        id: 'proj-1',
        name: 'P',
        codebases: [],
        createdAt: '2026-04-18T00:00:00Z',
        updatedAt: '2026-04-18T00:00:00Z',
        nodes: [],
        edges: [],
      });
      okJson({
        id: 'proj-1',
        name: 'P',
        codebases: [{ id: 'backend', label: 'Backend', path: '../backend' }],
        createdAt: '2026-04-18T00:00:00Z',
        updatedAt: '2026-04-19T00:00:00Z',
      });
      await useCanvasStore
        .getState()
        .patchProjectMeta({ codebases: [{ id: 'backend', label: 'Backend', path: '../backend' }] });
      expect(useCanvasStore.getState().projectMeta?.codebases).toEqual([
        { id: 'backend', label: 'Backend', path: '../backend' },
      ]);
      const call = fetchMock.mock.calls[0];
      expect(call?.[1]).toMatchObject({ method: 'PATCH' });
    });

    it('patchProjectMeta で codebases を全置換できる', async () => {
      useCanvasStore.getState().hydrate({
        id: 'proj-1',
        name: 'P',
        codebases: [{ id: 'old', label: 'Old', path: '/old' }],
        createdAt: '2026-04-18T00:00:00Z',
        updatedAt: '2026-04-18T00:00:00Z',
        nodes: [],
        edges: [],
      });
      okJson({
        id: 'proj-1',
        name: 'P',
        codebases: [{ id: 'new', label: 'New', path: '/n' }],
        createdAt: '2026-04-18T00:00:00Z',
        updatedAt: '2026-04-19T00:00:00Z',
      });
      await useCanvasStore
        .getState()
        .patchProjectMeta({ codebases: [{ id: 'new', label: 'New', path: '/n' }] });
      expect(useCanvasStore.getState().projectMeta?.codebases).toEqual([
        { id: 'new', label: 'New', path: '/n' },
      ]);
    });
  });

  describe('adoptProposal', () => {
    it('成功時に proposal ノードが新 type のノードで置換される', async () => {
      // hydrate に proposal を含む状態に差し替える。
      useCanvasStore.getState().hydrate({
        id: 'proj-1',
        name: 'P',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          {
            id: 'prop-xxx',
            type: 'proposal',
            x: 0,
            y: 0,
            title: '[AI] タイトル',
            body: 'body',
            adoptAs: 'userstory',
          },
        ],
        edges: [],
      });
      okJson({
        id: 'prop-xxx',
        type: 'userstory',
        x: 0,
        y: 0,
        title: 'タイトル',
        body: 'body',
      });
      const result = await useCanvasStore.getState().adoptProposal('prop-xxx', 'userstory');
      expect(result.type).toBe('userstory');
      expect(useCanvasStore.getState().nodes['prop-xxx']?.type).toBe('userstory');

      const call = fetchMock.mock.calls[0];
      expect(call).toBeDefined();
      expect(String(call?.[0])).toContain('/adopt');
      expect(call?.[1]).toMatchObject({ method: 'POST' });
    });

    it('失敗時は例外を投げ、proposal のまま残す', async () => {
      useCanvasStore.getState().hydrate({
        id: 'proj-1',
        name: 'P',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          {
            id: 'prop-xxx',
            type: 'proposal',
            x: 0,
            y: 0,
            title: '[AI] タイトル',
            body: 'body',
          },
        ],
        edges: [],
      });
      fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));
      await expect(
        useCanvasStore.getState().adoptProposal('prop-xxx', 'userstory'),
      ).rejects.toThrow();
      expect(useCanvasStore.getState().nodes['prop-xxx']?.type).toBe('proposal');
    });
  });

  describe('moveHistory / undoMoveNode (issue #13)', () => {
    it('moveNode 成功で履歴に「移動前座標」が push される', async () => {
      okJson({ id: 'req-a', type: 'requirement', x: 10, y: 20, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 10, 20);
      const hist = useCanvasStore.getState().moveHistory;
      expect(hist).toHaveLength(1);
      expect(hist[0]).toEqual({ id: 'req-a', x: 0, y: 0 });
    });

    it('moveNode 失敗時は履歴も巻き戻る (push されない)', async () => {
      fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
      await expect(useCanvasStore.getState().moveNode('req-a', 99, 99)).rejects.toThrow();
      expect(useCanvasStore.getState().moveHistory).toEqual([]);
    });

    it('同じ座標への moveNode は履歴に積まない', async () => {
      okJson({ id: 'req-a', type: 'requirement', x: 0, y: 0, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 0, 0);
      expect(useCanvasStore.getState().moveHistory).toEqual([]);
    });

    it('undoMoveNode は最大 3 回まで動作する', async () => {
      // 4 回連続で move (履歴は 3 件まで保持される)。
      okJson({ id: 'req-a', type: 'requirement', x: 1, y: 1, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 1, 1);
      okJson({ id: 'req-a', type: 'requirement', x: 2, y: 2, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 2, 2);
      okJson({ id: 'req-a', type: 'requirement', x: 3, y: 3, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 3, 3);
      okJson({ id: 'req-a', type: 'requirement', x: 4, y: 4, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 4, 4);

      // 履歴は最大 3 件 = 古い (0,0) は捨てられ、(1,1) (2,2) (3,3) が残る。
      expect(useCanvasStore.getState().moveHistory).toHaveLength(3);

      // 1 回目 Undo: (3,3) へ戻る。
      okJson({ id: 'req-a', type: 'requirement', x: 3, y: 3, title: 'A', body: '' });
      const r1 = await useCanvasStore.getState().undoMoveNode();
      expect(r1).toBe(true);
      expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 3, y: 3 });

      // 2 回目 Undo: (2,2) へ戻る。
      okJson({ id: 'req-a', type: 'requirement', x: 2, y: 2, title: 'A', body: '' });
      const r2 = await useCanvasStore.getState().undoMoveNode();
      expect(r2).toBe(true);
      expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 2, y: 2 });

      // 3 回目 Undo: (1,1) へ戻る。
      okJson({ id: 'req-a', type: 'requirement', x: 1, y: 1, title: 'A', body: '' });
      const r3 = await useCanvasStore.getState().undoMoveNode();
      expect(r3).toBe(true);
      expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 1, y: 1 });

      // 4 回目: 履歴は空 (古い (0,0) は溢れて捨てられた)。何もせず false を返す。
      const r4 = await useCanvasStore.getState().undoMoveNode();
      expect(r4).toBe(false);
      // 座標は最後の Undo で戻した (1,1) のまま。
      expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 1, y: 1 });
    });

    it('履歴空のとき undoMoveNode は false を返し座標は変わらない', async () => {
      const before = useCanvasStore.getState().nodes['req-a'];
      const r = await useCanvasStore.getState().undoMoveNode();
      expect(r).toBe(false);
      expect(useCanvasStore.getState().nodes['req-a']).toEqual(before);
      // 余計な fetch も走らない。
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('undoMoveNode が API 失敗した場合、履歴と座標を巻き戻して例外を投げる', async () => {
      okJson({ id: 'req-a', type: 'requirement', x: 50, y: 60, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 50, 60);
      expect(useCanvasStore.getState().moveHistory).toHaveLength(1);

      fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
      await expect(useCanvasStore.getState().undoMoveNode()).rejects.toThrow();
      // ロールバック: 座標は (50,60) のまま、履歴も維持。
      expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 50, y: 60 });
      expect(useCanvasStore.getState().moveHistory).toHaveLength(1);
    });

    it('アコーディオン操作 (toggleNodeExpanded) は履歴を増やさない', () => {
      const before = useCanvasStore.getState().moveHistory;
      useCanvasStore.getState().toggleNodeExpanded('req-a');
      useCanvasStore.getState().expandAllNodes();
      useCanvasStore.getState().collapseAllNodes();
      expect(useCanvasStore.getState().moveHistory).toEqual(before);
    });

    it('addNodeFromPalette / connectEdge は履歴を増やさない', async () => {
      const created = {
        id: 'req-new',
        type: 'requirement',
        x: 100,
        y: 100,
        title: '',
        body: '',
      };
      okJson(created, 201);
      await useCanvasStore.getState().addNodeFromPalette('requirement', 100, 100);
      expect(useCanvasStore.getState().moveHistory).toEqual([]);

      okJson({ id: 'e-1', from: 'req-a', to: 'req-new', type: 'trace' }, 201);
      await useCanvasStore.getState().connectEdge('req-a', 'req-new', 'trace');
      expect(useCanvasStore.getState().moveHistory).toEqual([]);
    });

    it('削除済みノードを指す履歴は undoMoveNode で skip されて false になる', async () => {
      // 1) ノードを移動 (履歴に 1 件積む)。
      okJson({ id: 'req-a', type: 'requirement', x: 10, y: 20, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 10, 20);
      expect(useCanvasStore.getState().moveHistory).toHaveLength(1);

      // 2) ノードを削除 (DELETE 成功)。これで履歴の末尾は「もう存在しないノード」を指す。
      okJson({});
      await useCanvasStore.getState().removeNode('req-a');
      expect(useCanvasStore.getState().nodes['req-a']).toBeUndefined();

      // 3) Undo: skip された結果、何も戻せず false が返り、履歴は空になる。
      //    余計な PATCH も走らない (削除済みなので API 呼び出しはスキップされる)。
      const callsBefore = fetchMock.mock.calls.length;
      const r = await useCanvasStore.getState().undoMoveNode();
      expect(r).toBe(false);
      expect(useCanvasStore.getState().moveHistory).toEqual([]);
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });

    it('A 移動 → B 移動 → A 削除 → Undo で B が戻り、もう 1 回 Undo は false (A は skip)', async () => {
      // 2 ノードを持つ project に差し替え。
      useCanvasStore.getState().hydrate({
        id: 'proj-1',
        name: 'P',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          { id: 'req-a', type: 'requirement', x: 0, y: 0, title: 'A', body: '' },
          { id: 'req-b', type: 'requirement', x: 100, y: 100, title: 'B', body: '' },
        ],
        edges: [],
      });

      // A を移動 → 履歴: [A:(0,0)]
      okJson({ id: 'req-a', type: 'requirement', x: 11, y: 22, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 11, 22);
      // B を移動 → 履歴: [A:(0,0), B:(100,100)]
      okJson({ id: 'req-b', type: 'requirement', x: 200, y: 200, title: 'B', body: '' });
      await useCanvasStore.getState().moveNode('req-b', 200, 200);
      expect(useCanvasStore.getState().moveHistory).toHaveLength(2);

      // A を削除 → 履歴は変わらないが、末尾以外に「削除済み」を指すエントリが残る。
      okJson({});
      await useCanvasStore.getState().removeNode('req-a');
      expect(useCanvasStore.getState().nodes['req-a']).toBeUndefined();

      // 1 回目 Undo: 末尾 (B) は生きているので普通に戻せる。
      okJson({ id: 'req-b', type: 'requirement', x: 100, y: 100, title: 'B', body: '' });
      const r1 = await useCanvasStore.getState().undoMoveNode();
      expect(r1).toBe(true);
      expect(useCanvasStore.getState().nodes['req-b']).toMatchObject({ x: 100, y: 100 });
      // 履歴は [A:(0,0)] が残るが、A は削除済みなので次回 skip 対象になる。
      expect(useCanvasStore.getState().moveHistory).toHaveLength(1);

      // 2 回目 Undo: 末尾の A は削除済み → skip され、履歴は空に → false を返す。
      // PATCH は走らない。
      const callsBefore = fetchMock.mock.calls.length;
      const r2 = await useCanvasStore.getState().undoMoveNode();
      expect(r2).toBe(false);
      expect(useCanvasStore.getState().moveHistory).toEqual([]);
      expect(fetchMock.mock.calls.length).toBe(callsBefore);
    });

    it('hydrate でプロジェクト切替時は履歴がクリアされる', async () => {
      okJson({ id: 'req-a', type: 'requirement', x: 10, y: 20, title: 'A', body: '' });
      await useCanvasStore.getState().moveNode('req-a', 10, 20);
      expect(useCanvasStore.getState().moveHistory).toHaveLength(1);
      useCanvasStore.getState().hydrate(baseProject());
      expect(useCanvasStore.getState().moveHistory).toEqual([]);
    });
  });

  describe('アコーディオン (expandedNodes)', () => {
    it('hydrate 直後は全ノード折りたたみ (expandedNodes が空)', () => {
      expect(useCanvasStore.getState().expandedNodes).toEqual({});
    });

    it('toggleNodeExpanded で展開⇄折りたたみがトグルする', () => {
      const { toggleNodeExpanded } = useCanvasStore.getState();
      toggleNodeExpanded('req-a');
      expect(useCanvasStore.getState().expandedNodes['req-a']).toBe(true);
      toggleNodeExpanded('req-a');
      expect(useCanvasStore.getState().expandedNodes['req-a']).toBeUndefined();
    });

    it('expandAllNodes はキャンバス上の全ノードを展開する', () => {
      useCanvasStore.setState({
        nodes: {
          'n-1': { id: 'n-1', type: 'requirement', x: 0, y: 0, title: '', body: '' },
          'n-2': { id: 'n-2', type: 'issue', x: 0, y: 0, title: '', body: '' },
        },
      });
      useCanvasStore.getState().expandAllNodes();
      expect(useCanvasStore.getState().expandedNodes).toEqual({ 'n-1': true, 'n-2': true });
    });

    it('collapseAllNodes で expandedNodes が空になる', () => {
      useCanvasStore.setState({ expandedNodes: { 'req-a': true, 'n-x': true } });
      useCanvasStore.getState().collapseAllNodes();
      expect(useCanvasStore.getState().expandedNodes).toEqual({});
    });

    it('addNodeFromPalette は新規ノードを展開状態で挿入する (空ボディなのでユーザーが編集しやすい)', async () => {
      const created = {
        id: 'req-new',
        type: 'requirement',
        x: 10,
        y: 10,
        title: '',
        body: '',
      };
      okJson(created, 201);
      await useCanvasStore.getState().addNodeFromPalette('requirement', 10, 10);
      expect(useCanvasStore.getState().expandedNodes['req-new']).toBe(true);
    });

    it('removeNode で削除ノードの展開エントリも掃除される', async () => {
      useCanvasStore.setState({ expandedNodes: { 'req-a': true } });
      okJson({});
      await useCanvasStore.getState().removeNode('req-a');
      expect(useCanvasStore.getState().expandedNodes['req-a']).toBeUndefined();
    });
  });

  describe('chat threads', () => {
    it('loadChatThreads: API から取得して chatThreadList に保存', async () => {
      okJson({
        threads: [
          {
            id: 'chat-1',
            projectId: 'proj-1',
            title: 'X',
            createdAt: '2026-04-20T00:00:00Z',
            updatedAt: '2026-04-20T00:00:00Z',
          },
        ],
      });
      await useCanvasStore.getState().loadChatThreads();
      expect(useCanvasStore.getState().chatThreadList).toHaveLength(1);
      expect(useCanvasStore.getState().chatThreadList[0]?.id).toBe('chat-1');
    });

    it('createChatThread: POST → chatThreadList 先頭に追加', async () => {
      okJson(
        {
          id: 'chat-new',
          projectId: 'proj-1',
          title: 'New',
          createdAt: '2026-04-20T00:00:00Z',
          updatedAt: '2026-04-20T00:00:00Z',
        },
        201,
      );
      const id = await useCanvasStore.getState().createChatThread('New');
      expect(id).toBe('chat-new');
      expect(useCanvasStore.getState().chatThreadList[0]?.id).toBe('chat-new');
    });

    it('openChatThread → sendChatMessage → text delta → turn_ended で messages 反映', async () => {
      const events = [
        { type: 'chat_opened', threadId: 'chat-1' },
        { type: 'chat_user_message_appended', messageId: 'msg-u' },
        { type: 'chat_assistant_message_started', messageId: 'msg-a' },
        { type: 'chat_text_delta', messageId: 'msg-a', text: 'こん' },
        { type: 'chat_text_delta', messageId: 'msg-a', text: 'にちは' },
        { type: 'chat_turn_ended' },
      ];
      const sent: unknown[] = [];
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: vi.fn(),
        openChat: () => ({
          events: (async function* () {
            for (const e of events) yield e;
          })(),
          sendUserMessage: (text: string) => sent.push({ type: 'user_message', text }),
          approveTool: vi.fn(),
          close: () => {},
        }),
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chat-1', messages: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await store.getState().openChatThread('chat-1');
      // event loop が fire-and-forget なので少し待つ
      await new Promise((r) => setTimeout(r, 50));
      await store.getState().sendChatMessage('hi');
      await new Promise((r) => setTimeout(r, 50));
      const state = store.getState();
      expect(state.activeChatThreadId).toBe('chat-1');
      // assistant message が text 結合された状態で存在する
      const assistantMsg = state.chatThreadMessages.find((m) => m.id === 'msg-a');
      expect(assistantMsg).toBeDefined();
      const textBlock = assistantMsg?.blocks[0];
      expect(textBlock?.type).toBe('text');
      if (textBlock?.type === 'text') expect(textBlock.text).toBe('こんにちは');
      expect(sent).toEqual([{ type: 'user_message', text: 'hi' }]);
      // sendChatMessage で streaming=true に立ち、モック generator はすでに枯渇済みなので
      // 新規 chat_turn_ended は来ず true のまま。実運用ではサーバからの turn_ended で落ちる。
      expect(state.chatThreadStreaming).toBe(true);
    });

    it('approveChatTool: handle.approveTool を呼ぶ', async () => {
      const approveSpy = vi.fn();
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: vi.fn(),
        openChat: () => ({
          events: (async function* () {
            yield { type: 'chat_opened', threadId: 'chat-1' };
          })(),
          sendUserMessage: vi.fn(),
          approveTool: approveSpy,
          close: () => {},
        }),
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [],
        edges: [],
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chat-1', messages: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await store.getState().openChatThread('chat-1');
      await new Promise((r) => setTimeout(r, 20));
      store.getState().approveChatTool('tool-1', true);
      expect(approveSpy).toHaveBeenCalledWith('tool-1', true);
    });
  });

  // issue #11: チャットコンテキストノード添付の操作と sendChatMessage への伝搬。
  describe('chat context nodes', () => {
    it('add/remove/clear で chatContextNodeIds が変化する', () => {
      const s = useCanvasStore.getState();
      s.addChatContextNode('req-a');
      expect(useCanvasStore.getState().chatContextNodeIds).toEqual(['req-a']);
      // 重複追加は no-op
      useCanvasStore.getState().addChatContextNode('req-a');
      expect(useCanvasStore.getState().chatContextNodeIds).toEqual(['req-a']);
      useCanvasStore.getState().addChatContextNode('req-b');
      expect(useCanvasStore.getState().chatContextNodeIds).toEqual(['req-a', 'req-b']);
      useCanvasStore.getState().removeChatContextNode('req-a');
      expect(useCanvasStore.getState().chatContextNodeIds).toEqual(['req-b']);
      useCanvasStore.getState().clearChatContext();
      expect(useCanvasStore.getState().chatContextNodeIds).toEqual([]);
    });

    it('sendChatMessage は chatContextNodeIds を 2 引数目に渡す (削除済み id は除外)', async () => {
      const sent: { text: string; ctx: string[] | undefined }[] = [];
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: vi.fn(),
        openChat: () => ({
          events: (async function* () {
            yield { type: 'chat_opened', threadId: 'chat-1' };
          })(),
          sendUserMessage: (text: string, ctx?: string[]) => sent.push({ text, ctx }),
          approveTool: vi.fn(),
          close: () => {},
        }),
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          { id: 'req-a', type: 'requirement', x: 0, y: 0, title: 'A', body: '' },
          { id: 'req-b', type: 'requirement', x: 0, y: 0, title: 'B', body: '' },
        ],
        edges: [],
      });
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chat-1', messages: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await store.getState().openChatThread('chat-1');
      await new Promise((r) => setTimeout(r, 20));
      // 存在する 2 件 + 削除済み 1 件を仕込む
      store.getState().addChatContextNode('req-a');
      store.getState().addChatContextNode('req-b');
      store.getState().addChatContextNode('req-deleted');
      await store.getState().sendChatMessage('深掘りして');
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toBe('深掘りして');
      // 存在しない req-deleted は除外される
      expect(sent[0]?.ctx).toEqual(['req-a', 'req-b']);
    });

    it('スレッド切替時に chatContextNodeIds はリセットされる', async () => {
      vi.resetModules();
      vi.doMock('./ws', () => ({
        startAgent: vi.fn(),
        openChat: () => ({
          events: (async function* () {
            yield { type: 'chat_opened', threadId: 'chat-1' };
          })(),
          sendUserMessage: vi.fn(),
          approveTool: vi.fn(),
          close: () => {},
        }),
      }));
      const { useCanvasStore: store } = await import('./store');
      store.getState().hydrate({
        id: 'proj-1',
        name: 't',
        codebases: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [{ id: 'req-a', type: 'requirement', x: 0, y: 0, title: 'A', body: '' }],
        edges: [],
      });
      store.getState().addChatContextNode('req-a');
      expect(store.getState().chatContextNodeIds).toEqual(['req-a']);
      fetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'chat-1', messages: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      await store.getState().openChatThread('chat-1');
      // openChatThread の中で chatContextNodeIds: [] にリセットされる
      expect(store.getState().chatContextNodeIds).toEqual([]);
    });
  });
});
