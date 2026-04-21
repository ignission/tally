import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileSystemProjectStore } from './project-store';

// 各テスト用に tmp ディレクトリを作る。モックは使わず実ファイルシステムに書く。
async function makeWorkspace(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tally-test-'));
}

async function rmrf(p: string): Promise<void> {
  await fs.rm(p, { recursive: true, force: true });
}

describe('FileSystemProjectStore', () => {
  let workspace: string;
  let store: FileSystemProjectStore;

  beforeEach(async () => {
    workspace = await makeWorkspace();
    store = new FileSystemProjectStore(workspace);
  });

  afterEach(async () => {
    await rmrf(workspace);
  });

  describe('project meta', () => {
    it('未初期化なら null を返す', async () => {
      expect(await store.getProjectMeta()).toBeNull();
      expect(await store.loadProject()).toBeNull();
    });

    it('saveProjectMeta → getProjectMeta で往復できる', async () => {
      await store.saveProjectMeta({
        id: 'proj-test',
        name: 'テストプロジェクト',
        description: '説明',
        codebasePath: '../backend',
        createdAt: '2026-04-18T10:00:00Z',
        updatedAt: '2026-04-18T10:00:00Z',
      });
      const meta = await store.getProjectMeta();
      expect(meta?.name).toBe('テストプロジェクト');
      expect(meta?.codebasePath).toBe('../backend');
    });
  });

  describe('nodes CRUD', () => {
    it('addNode で ID が採番され、getNode / listNodes に反映される', async () => {
      const created = await store.addNode({
        type: 'requirement',
        x: 10,
        y: 20,
        title: '要求1',
        body: '本文',
        kind: 'functional',
        priority: 'must',
      });
      expect(created.id).toMatch(/^req-[a-zA-Z0-9]{10}$/);

      const fetched = await store.getNode(created.id);
      expect(fetched?.id).toBe(created.id);

      const all = await store.listNodes();
      expect(all).toHaveLength(1);
    });

    it('updateNode でフィールドが上書きされる', async () => {
      const created = await store.addNode({
        type: 'question',
        x: 0,
        y: 0,
        title: '論点',
        body: '本文',
        options: [
          { id: 'o1', text: 'A', selected: false },
          { id: 'o2', text: 'B', selected: false },
        ],
        decision: null,
      });
      const updated = await store.updateNode<'question'>(created.id, { decision: 'o2' });
      expect(updated.decision).toBe('o2');

      const fetched = await store.getNode(created.id);
      expect(fetched?.type).toBe('question');
      if (fetched?.type === 'question') {
        expect(fetched.decision).toBe('o2');
      }
    });

    it('deleteNode は該当ファイルを消し、付随エッジも削除する', async () => {
      const a = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'A', body: '' });
      const b = await store.addNode({ type: 'userstory', x: 0, y: 0, title: 'B', body: '' });
      await store.addEdge({ from: a.id, to: b.id, type: 'contain' });

      await store.deleteNode(a.id);

      expect(await store.getNode(a.id)).toBeNull();
      expect(await store.listEdges()).toHaveLength(0);
    });

    it('存在しないノードの update はエラー', async () => {
      await expect(store.updateNode('req-missing', { title: 'x' })).rejects.toThrow(
        /存在しないノード/,
      );
    });

    it('updateNode は patch に null を渡すと該当フィールドを削除する', async () => {
      const created = await store.addNode({
        type: 'requirement',
        x: 0,
        y: 0,
        title: 't',
        body: '',
        kind: 'functional',
        priority: 'must',
      });
      expect(created.kind).toBe('functional');
      expect(created.priority).toBe('must');

      const updated = await store.updateNode<'requirement'>(created.id, {
        kind: null,
      } as Record<string, unknown>);
      expect(updated.kind).toBeUndefined();
      expect(updated.priority).toBe('must');

      const persisted = await store.getNode(created.id);
      expect(persisted?.type).toBe('requirement');
      if (persisted?.type === 'requirement') {
        expect(persisted.kind).toBeUndefined();
        expect(persisted.priority).toBe('must');
      }
    });

    it('findNodesByType で型による絞り込みができる', async () => {
      await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'r', body: '' });
      await store.addNode({ type: 'question', x: 0, y: 0, title: 'q', body: '' });
      await store.addNode({ type: 'question', x: 0, y: 0, title: 'q2', body: '' });

      const questions = await store.findNodesByType('question');
      expect(questions).toHaveLength(2);
      expect(questions.every((n) => n.type === 'question')).toBe(true);
    });
  });

  describe('edges CRUD', () => {
    it('addEdge で追加し、listEdges で取り出せる', async () => {
      const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'r', body: '' });
      const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'u', body: '' });
      const edge = await store.addEdge({ from: a.id, to: b.id, type: 'satisfy' });
      expect(edge.id).toMatch(/^e-[a-zA-Z0-9]{10}$/);

      const edges = await store.listEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0]?.type).toBe('satisfy');
    });

    it('deleteEdge で消える', async () => {
      const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'r', body: '' });
      const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'u', body: '' });
      const e = await store.addEdge({ from: a.id, to: b.id, type: 'satisfy' });
      await store.deleteEdge(e.id);
      expect(await store.listEdges()).toHaveLength(0);
    });

    it('updateEdge は id を変えずに type を差し替える', async () => {
      const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'a', body: '' });
      const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'b', body: '' });
      const edge = await store.addEdge({ from: a.id, to: b.id, type: 'satisfy' });

      const updated = await store.updateEdge(edge.id, { type: 'refine' });
      expect(updated.id).toBe(edge.id);
      expect(updated.type).toBe('refine');
      expect(updated.from).toBe(edge.from);
      expect(updated.to).toBe(edge.to);

      const edges = await store.listEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0]).toEqual(updated);
    });

    it('updateEdge は存在しない id で Error を投げる', async () => {
      await expect(store.updateEdge('e-unknown', { type: 'refine' })).rejects.toThrow(
        /存在しないエッジ/,
      );
    });
  });

  describe('findRelatedNodes', () => {
    it('双方向の関連ノードを返す', async () => {
      const req = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'r', body: '' });
      const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'u', body: '' });
      const q = await store.addNode({ type: 'question', x: 0, y: 0, title: 'q', body: '' });
      const other = await store.addNode({ type: 'issue', x: 0, y: 0, title: 'i', body: '' });

      await store.addEdge({ from: req.id, to: uc.id, type: 'satisfy' });
      await store.addEdge({ from: q.id, to: req.id, type: 'trace' });

      const related = await store.findRelatedNodes(req.id);
      const ids = related.map((n) => n.id).sort();
      expect(ids).toEqual([q.id, uc.id].sort());
      expect(related.some((n) => n.id === other.id)).toBe(false);
    });

    it('関連ノードが無いとき空配列を返す', async () => {
      const a = await store.addNode({ type: 'issue', x: 0, y: 0, title: 'a', body: '' });
      expect(await store.findRelatedNodes(a.id)).toEqual([]);
    });
  });

  describe('YAML 往復', () => {
    it('手編集の YAML を読み直せる (外部編集許容)', async () => {
      const dir = path.join(workspace, '.tally', 'nodes');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'req-manual.yaml'),
        'id: req-manual\ntype: requirement\nx: 0\ny: 0\ntitle: 手書き要求\nbody: 本文\nkind: functional\npriority: must\n',
        'utf8',
      );
      const nodes = await store.listNodes();
      expect(nodes).toHaveLength(1);
      expect(nodes[0]?.id).toBe('req-manual');
    });

    it('不正な YAML は例外にする', async () => {
      const dir = path.join(workspace, '.tally', 'nodes');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(
        path.join(dir, 'broken.yaml'),
        'id: broken\ntype: invalidtype\nx: 0\ny: 0\ntitle: x\nbody: x\n',
        'utf8',
      );
      await expect(store.listNodes()).rejects.toThrow();
    });
  });

  describe('transmuteNode (proposal 採用)', () => {
    async function addProposal(extras: Partial<{ adoptAs: string }> = {}) {
      return store.addNode({
        type: 'proposal',
        x: 10,
        y: 20,
        title: '[AI] 提案タイトル',
        body: '提案本文',
        adoptAs: (extras.adoptAs ?? 'userstory') as
          | 'requirement'
          | 'usecase'
          | 'userstory'
          | 'question'
          | 'coderef'
          | 'issue',
        sourceAgentId: 'decompose-to-stories',
      });
    }

    it('userstory に採用すると type が変わり [AI] と proposal 固有属性が落ちる', async () => {
      const p = await addProposal();
      const adopted = await store.transmuteNode(p.id, 'userstory');
      expect(adopted.id).toBe(p.id);
      expect(adopted.type).toBe('userstory');
      expect(adopted.title).toBe('提案タイトル');
      expect(adopted.body).toBe('提案本文');
      expect(adopted.x).toBe(10);
      expect(adopted.y).toBe(20);
      expect('adoptAs' in adopted).toBe(false);
      expect('sourceAgentId' in adopted).toBe(false);
    });

    it('requirement に採用し additional を受け取る', async () => {
      const p = await addProposal({ adoptAs: 'requirement' });
      const adopted = await store.transmuteNode(p.id, 'requirement', {
        kind: 'functional',
        priority: 'must',
      });
      expect(adopted.type).toBe('requirement');
      if (adopted.type === 'requirement') {
        expect(adopted.kind).toBe('functional');
        expect(adopted.priority).toBe('must');
      }
    });

    it('userstory に採用し additional.acceptanceCriteria を受け取る', async () => {
      const p = await addProposal();
      const adopted = await store.transmuteNode(p.id, 'userstory', {
        acceptanceCriteria: [{ id: 'ac1', text: '動く', done: false }],
        points: 3,
      });
      expect(adopted.type).toBe('userstory');
      if (adopted.type === 'userstory') {
        expect(adopted.acceptanceCriteria).toEqual([{ id: 'ac1', text: '動く', done: false }]);
        expect(adopted.points).toBe(3);
      }
    });

    it('存在しない id は Error を投げる', async () => {
      await expect(store.transmuteNode('prop-missing', 'userstory')).rejects.toThrow(
        /存在しないノード/,
      );
    });

    it('proposal 以外は Error を投げる', async () => {
      const req = await store.addNode({
        type: 'requirement',
        x: 0,
        y: 0,
        title: 'r',
        body: '',
      });
      await expect(store.transmuteNode(req.id, 'userstory')).rejects.toThrow(
        /proposal 以外は採用対象外/,
      );
    });

    it('採用前に張られたエッジが採用後も残る', async () => {
      const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: '' });
      const p = await addProposal();
      const edge = await store.addEdge({ from: uc.id, to: p.id, type: 'derive' });

      await store.transmuteNode(p.id, 'userstory');

      const edges = await store.listEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0]?.id).toBe(edge.id);
      expect(edges[0]?.from).toBe(uc.id);
      expect(edges[0]?.to).toBe(p.id);
    });
  });
});
