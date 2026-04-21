import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { initProject } from './init-project';
import { FileSystemProjectStore } from './project-store';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'tally-init-'));
}

describe('initProject', () => {
  it('workspaceRoot 配下に .tally/ と project.yaml / edges.yaml / nodes/ を作る', async () => {
    const root = makeRoot();
    try {
      const r = await initProject({ workspaceRoot: root, name: 'MyProject' });
      expect(r.id.startsWith('proj-')).toBe(true);
      expect(r.workspaceRoot).toBe(path.resolve(root));

      const store = new FileSystemProjectStore(root);
      const meta = await store.getProjectMeta();
      expect(meta).not.toBeNull();
      expect(meta?.name).toBe('MyProject');
      expect(meta?.id).toBe(r.id);

      const edges = await store.listEdges();
      expect(edges).toEqual([]);

      const nodesDirStat = await fs.stat(path.join(root, '.tally', 'nodes'));
      expect(nodesDirStat.isDirectory()).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('description を渡すと meta に保存される', async () => {
    const root = makeRoot();
    try {
      await initProject({ workspaceRoot: root, name: 'P', description: '説明文' });
      const store = new FileSystemProjectStore(root);
      const meta = await store.getProjectMeta();
      expect(meta?.description).toBe('説明文');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('workspaceRoot が存在しなければ throw', async () => {
    await expect(
      initProject({ workspaceRoot: '/nonexistent/path/xyz', name: 'P' }),
    ).rejects.toThrow(/存在しない/);
  });

  it('workspaceRoot がファイルなら throw', async () => {
    const root = makeRoot();
    const file = path.join(root, 'a.txt');
    await fs.writeFile(file, 'x');
    try {
      await expect(initProject({ workspaceRoot: file, name: 'P' })).rejects.toThrow(
        /ディレクトリではない/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('既に .tally/ があれば throw', async () => {
    const root = makeRoot();
    try {
      await initProject({ workspaceRoot: root, name: 'First' });
      await expect(initProject({ workspaceRoot: root, name: 'Second' })).rejects.toThrow(
        /既に .tally/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('name が空なら throw', async () => {
    const root = makeRoot();
    try {
      await expect(initProject({ workspaceRoot: root, name: '   ' })).rejects.toThrow(
        /name が空/,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
