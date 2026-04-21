import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { ProjectStore } from '@tally/storage';
import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentEvent } from '../stream';
import { createNodeHandler } from './create-node';

describe('create_node tool', () => {
  let root: string;
  let store: FileSystemProjectStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-tool-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('proposal ノードを作り、node_created イベントを発行する', async () => {
    const events: AgentEvent[] = [];
    const handler = createNodeHandler({
      store,
      emit: (e) => events.push(e),
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'find-related-code',
    });
    const result = await handler({
      adoptAs: 'userstory',
      title: '[AI] new',
      body: 'body',
    });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.id).toMatch(/^prop-/);
    expect(parsed.type).toBe('proposal');
    expect(parsed.adoptAs).toBe('userstory');

    const nodes = await store.listNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe('proposal');

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('node_created');
  });

  it('title が [AI] プレフィックス無しの場合は自動付与する', async () => {
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'find-related-code',
    });
    const result = await handler({
      adoptAs: 'userstory',
      title: 'プレフィックス無し',
      body: '',
    });
    const parsed = JSON.parse(result.output);
    expect(parsed.title).toBe('[AI] プレフィックス無し');
  });

  it('x/y 未指定時は anchor を基準に自動配置', async () => {
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 100, y: 200 },
      anchorId: 'uc-1',
      agentName: 'find-related-code',
    });
    const result = await handler({ adoptAs: 'userstory', title: 't', body: 'b' });
    const parsed = JSON.parse(result.output);
    expect(parsed.x).toBeGreaterThan(100);
    expect(parsed.y).toBeGreaterThanOrEqual(200);
  });

  it('adoptAs が invalid なら ok:false', async () => {
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'find-related-code',
    });
    const result = await handler({ adoptAs: 'proposal' as never, title: 't', body: '' });
    expect(result.ok).toBe(false);
  });

  it('additional で type や adoptAs を送られても既知フィールドが勝つ', async () => {
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'find-related-code',
    });
    const result = await handler({
      adoptAs: 'userstory',
      title: '正しい',
      body: 'b',
      additional: {
        type: 'requirement',
        adoptAs: 'requirement',
        title: '乗っ取り',
      } as Record<string, unknown>,
    });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.type).toBe('proposal');
    expect(parsed.adoptAs).toBe('userstory');
    expect(parsed.title).toBe('[AI] 正しい');
  });

  it('同じ anchor で 2 回呼ぶと座標が重ならない', async () => {
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'find-related-code',
    });
    const r1 = await handler({ adoptAs: 'userstory', title: 'a', body: '' });
    const r2 = await handler({ adoptAs: 'userstory', title: 'b', body: '' });
    const p1 = JSON.parse(r1.output);
    const p2 = JSON.parse(r2.output);
    expect(p1.y).not.toBe(p2.y);
  });
});

describe('coderef duplicate guard', () => {
  function setupWithExisting(existingNodes: Array<Record<string, unknown>>) {
    const added: Array<Record<string, unknown>> = [];
    const store = {
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
        const created = { ...n, id: `n-${added.length + 1}` };
        added.push(created);
        return created;
      }),
      listNodes: vi.fn().mockResolvedValue(existingNodes),
    } as unknown as ProjectStore;
    return { store, added };
  }

  it('同一 filePath + 同一 startLine の既存 coderef と重複する場合は ok:false', async () => {
    const existing = [
      {
        id: 'cref-old',
        type: 'coderef',
        x: 0,
        y: 0,
        title: '',
        body: '',
        filePath: 'src/a.ts',
        startLine: 10,
      },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 10, endLine: 12 },
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('重複');
    expect(added).toHaveLength(0);
  });

  it('startLine 差 ±10 行以内は重複扱い', async () => {
    const existing = [
      {
        id: 'cref-old',
        type: 'coderef',
        x: 0,
        y: 0,
        title: '',
        body: '',
        filePath: 'src/a.ts',
        startLine: 10,
      },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 15 },
    });
    expect(r.ok).toBe(false);
    expect(added).toHaveLength(0);
  });

  it('startLine 差 11 以上は新規作成を許可', async () => {
    const existing = [
      {
        id: 'cref-old',
        type: 'coderef',
        x: 0,
        y: 0,
        title: '',
        body: '',
        filePath: 'src/a.ts',
        startLine: 10,
      },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 22 },
    });
    expect(r.ok).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('filePath 違いは新規作成を許可', async () => {
    const existing = [
      {
        id: 'cref-old',
        type: 'coderef',
        x: 0,
        y: 0,
        title: '',
        body: '',
        filePath: 'src/a.ts',
        startLine: 10,
      },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/b.ts', startLine: 10 },
    });
    expect(r.ok).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('adoptAs !== coderef ではガード発動しない', async () => {
    const existing = [
      {
        id: 'cref-old',
        type: 'coderef',
        x: 0,
        y: 0,
        title: '',
        body: '',
        filePath: 'src/a.ts',
        startLine: 10,
      },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    const r = await handler({
      adoptAs: 'issue',
      title: 'テスト未整備',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 10 },
    });
    expect(r.ok).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('既存 proposal (adoptAs=coderef) とも重複判定する', async () => {
    const existing = [
      {
        id: 'prop-old',
        type: 'proposal',
        adoptAs: 'coderef',
        x: 0,
        y: 0,
        title: '',
        body: '',
        filePath: 'src/a.ts',
        startLine: 10,
      },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 10 },
    });
    expect(r.ok).toBe(false);
    expect(added).toHaveLength(0);
  });

  it('filePath を正規化して保存する (./src/a.ts → src/a.ts)', async () => {
    const { store, added } = setupWithExisting([]);
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: './src/a.ts', startLine: 10 },
    });
    expect(added[0]?.filePath).toBe('src/a.ts');
  });

  it('正規化後の filePath で重複判定する (./src/a.ts と src/a.ts を同一視)', async () => {
    const existing = [
      {
        id: 'cref-old',
        type: 'coderef',
        x: 0,
        y: 0,
        title: '',
        body: '',
        filePath: 'src/a.ts',
        startLine: 10,
      },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: './src/a.ts', startLine: 10 },
    });
    expect(r.ok).toBe(false);
    expect(added).toHaveLength(0);
  });
});

describe('sourceAgentId 注入', () => {
  it('作成された proposal ノードに sourceAgentId=agentName が刻まれる', async () => {
    const added: Array<Record<string, unknown>> = [];
    const store = {
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
        const created = { ...n, id: `n-${added.length + 1}` };
        added.push(created);
        return created;
      }),
      listNodes: vi.fn().mockResolvedValue([]),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'analyze-impact',
    });
    await handler({ adoptAs: 'issue', title: 'テスト', body: '' });
    expect(added[0]?.sourceAgentId).toBe('analyze-impact');
  });

  it('agentName=find-related-code で呼ばれた場合もその名前が刻まれる', async () => {
    const added: Array<Record<string, unknown>> = [];
    const store = {
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
        const created = { ...n, id: `n-${added.length + 1}` };
        added.push(created);
        return created;
      }),
      listNodes: vi.fn().mockResolvedValue([]),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'find-related-code',
    });
    await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/x.ts', startLine: 1, endLine: 3 },
    });
    expect(added[0]?.sourceAgentId).toBe('find-related-code');
  });
});

describe('adoptAs=question の options 補完', () => {
  it('options 配列の各要素に opt- 接頭辞 ID + selected:false を付ける', async () => {
    const stored: Record<string, unknown>[] = [];
    const store = {
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
        stored.push(n);
        return { ...n, id: 'q-1' };
      }),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'extract-questions',
    });
    const res = await handler({
      adoptAs: 'question',
      title: 'X を Y にするか',
      body: '',
      additional: { options: [{ text: 'A' }, { text: 'B' }] },
    });
    expect(res.ok).toBe(true);
    expect(stored.length).toBe(1);
    const first = stored[0];
    if (!first) throw new Error('stored[0] is undefined');
    const opts = first.options as { id: string; text: string; selected: boolean }[];
    expect(opts).toHaveLength(2);
    const [opt0, opt1] = opts;
    if (!opt0 || !opt1) throw new Error('options missing');
    expect(opt0.id.startsWith('opt-')).toBe(true);
    expect(opt0.text).toBe('A');
    expect(opt0.selected).toBe(false);
    expect(opt1.id.startsWith('opt-')).toBe(true);
    expect(opt1.text).toBe('B');
    expect(first.decision).toBeNull();
  });

  it('options 未指定なら「決定不能な proposal」として reject する', async () => {
    const store = {
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addNode: vi.fn(),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'extract-questions',
    });
    const res = await handler({
      adoptAs: 'question',
      title: '問い',
      body: '',
    });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('options は最低 2');
    expect(store.addNode).not.toHaveBeenCalled();
  });

  it('options が 1 件以下 / 空文字のみなら reject する', async () => {
    const store = {
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addNode: vi.fn(),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'extract-questions',
    });
    // 1 件のみ
    const r1 = await handler({
      adoptAs: 'question',
      title: '問い1',
      body: '',
      additional: { options: [{ text: 'A' }] },
    });
    expect(r1.ok).toBe(false);
    expect(r1.output).toContain('options は最低 2');
    // 全部空文字
    const r2 = await handler({
      adoptAs: 'question',
      title: '問い2',
      body: '',
      additional: { options: [{ text: '' }, { text: '   ' }] },
    });
    expect(r2.ok).toBe(false);
    expect(r2.output).toContain('options は最低 2');
    expect(store.addNode).not.toHaveBeenCalled();
  });
});

describe('adoptAs=question の anchor+同タイトル重複ガード', () => {
  it('anchor に繋がる正規 question に同タイトルがあれば reject', async () => {
    const anchorId = 'uc-1';
    const existing = {
      id: 'q-0',
      type: 'question',
      x: 0,
      y: 0,
      title: 'X を Y にするか',
      body: '',
    };
    const store = {
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([existing]),
      addNode: vi.fn(),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId,
      agentName: 'extract-questions',
    });
    const res = await handler({
      adoptAs: 'question',
      title: '[AI] X を Y にするか',
      body: '',
      additional: { options: [{ text: 'A' }, { text: 'B' }] },
    });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('重複');
    expect(store.addNode).not.toHaveBeenCalled();
  });

  it('anchor に繋がる proposal (adoptAs=question) に同タイトルがあっても reject', async () => {
    const anchorId = 'uc-1';
    const existingProposal = {
      id: 'q-prop-0',
      type: 'proposal',
      adoptAs: 'question',
      x: 0,
      y: 0,
      title: '[AI] X を Y にするか',
      body: '',
    };
    const store = {
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([existingProposal]),
      addNode: vi.fn(),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId,
      agentName: 'extract-questions',
    });
    const res = await handler({
      adoptAs: 'question',
      title: 'X を Y にするか',
      body: '',
      additional: { options: [{ text: 'A' }, { text: 'B' }] },
    });
    expect(res.ok).toBe(false);
    expect(res.output).toContain('重複');
  });

  it('異なる anchor の同タイトル question は通す', async () => {
    const store = {
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => ({
        ...n,
        id: 'q-x',
      })),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-2',
      agentName: 'extract-questions',
    });
    const res = await handler({
      adoptAs: 'question',
      title: 'X を Y にするか',
      body: '',
      additional: { options: [{ text: 'A' }, { text: 'B' }] },
    });
    expect(res.ok).toBe(true);
    expect(store.findRelatedNodes).toHaveBeenCalledWith('uc-2');
  });

  it('同一 handler (セッション) 内で同 anchor+同タイトルを 2 回作ろうとすると 2 回目は reject', async () => {
    // edge が張られる前に create_node が連続呼ばれるケース: findRelatedNodes は
    // 両方とも空配列を返すが、session-local Set で 2 回目を弾く。
    const store = {
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => ({
        ...n,
        id: 'q-s1',
      })),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'extract-questions',
    });
    const r1 = await handler({
      adoptAs: 'question',
      title: '同じ論点',
      body: '',
      additional: { options: [{ text: 'A' }, { text: 'B' }] },
    });
    expect(r1.ok).toBe(true);
    const r2 = await handler({
      adoptAs: 'question',
      title: '[AI] 同じ論点',
      body: '',
      additional: { options: [{ text: 'C' }, { text: 'D' }] },
    });
    expect(r2.ok).toBe(false);
    expect(r2.output).toContain('同一セッション内');
    expect(store.addNode).toHaveBeenCalledTimes(1);
  });

  it('addNode が失敗した場合 session-local Set は汚染されない (同タイトル再試行が通る)', async () => {
    let attempt = 0;
    const store = {
      listNodes: vi.fn().mockResolvedValue([]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
        attempt += 1;
        if (attempt === 1) throw new Error('disk full');
        return { ...n, id: 'q-retry' };
      }),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: 'uc-1',
      agentName: 'extract-questions',
    });
    const r1 = await handler({
      adoptAs: 'question',
      title: 'リトライ対象',
      body: '',
      additional: { options: [{ text: 'A' }, { text: 'B' }] },
    });
    expect(r1.ok).toBe(false);
    const r2 = await handler({
      adoptAs: 'question',
      title: 'リトライ対象',
      body: '',
      additional: { options: [{ text: 'A' }, { text: 'B' }] },
    });
    expect(r2.ok).toBe(true);
  });
});
