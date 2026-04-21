import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FileSystemProjectStore } from './project-store';

// examples/sample-project を tmp にコピーし、updateEdge 後にコメント・空行が残ることを実検証する。
// Phase 4 で AI が頻繁に書き換えるシナリオを想定したリグレッションテスト。

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_ROOT = path.resolve(here, '../../../examples/sample-project');

async function cpR(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await cpR(s, d);
    else await fs.copyFile(s, d);
  }
}

describe('examples/sample-project コメント保存の実動作', () => {
  let workspace: string;
  let store: FileSystemProjectStore;

  beforeAll(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-preserve-'));
    await cpR(SAMPLE_ROOT, workspace);
    store = new FileSystemProjectStore(workspace);
  });

  afterAll(async () => {
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('updateEdge 後も edges.yaml のグループコメントが残る', async () => {
    const edgesPath = path.join(workspace, '.tally', 'edges', 'edges.yaml');
    const before = await fs.readFile(edgesPath, 'utf8');
    expect(before).toContain('# 要求 → 論点 (derive)');
    expect(before).toContain('# 要求 → AI提案 UC (satisfy)');

    const edges = await store.listEdges();
    const first = edges[0];
    if (!first) throw new Error('エッジが 0 件');
    await store.updateEdge(first.id, { type: 'refine' });

    const after = await fs.readFile(edgesPath, 'utf8');
    // グループコメントが保存されている
    expect(after).toContain('# 要求 → 論点 (derive)');
    expect(after).toContain('# 要求 → AI提案 UC (satisfy)');
    expect(after).toContain('# AI提案 UC → 既存コード (refine)');
    // 変更が反映されている
    const edgesAfter = await store.listEdges();
    expect(edgesAfter.find((e) => e.id === first.id)?.type).toBe('refine');
  });

  it('saveProjectMeta 後も project.yaml 本文 (description の block literal) が壊れない', async () => {
    const meta = await store.getProjectMeta();
    if (!meta) throw new Error('meta null');
    await store.saveProjectMeta({ ...meta, updatedAt: '2026-04-19T00:00:00Z' });
    const reloaded = await store.getProjectMeta();
    expect(reloaded?.description).toContain('タスク管理SaaS');
    expect(reloaded?.updatedAt).toBe('2026-04-19T00:00:00Z');
  });
});
