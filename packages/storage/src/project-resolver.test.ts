import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  discoverProjects,
  listWorkspaceCandidates,
  resolveProjectById,
} from './project-resolver';
import { FileSystemProjectStore } from './project-store';

describe('project-resolver', () => {
  let root: string;
  const prev = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-resolve-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-a',
      name: 'A',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prev;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('TALLY_WORKSPACE から単一プロジェクトを解決する', async () => {
    const handle = await resolveProjectById('proj-a');
    expect(handle?.meta.name).toBe('A');
    expect(handle?.workspaceRoot).toBe(root);
  });

  it('未知の id は null', async () => {
    expect(await resolveProjectById('nope')).toBeNull();
  });

  it('discoverProjects で一覧が取れる', async () => {
    const list = await discoverProjects();
    expect(list.map((h) => h.id)).toContain('proj-a');
  });

  it('listWorkspaceCandidates: TALLY_WORKSPACE 直下のディレクトリ群を hasTally フラグ付きで返す', async () => {
    // root 自身は .tally 持ち (beforeEach で作成済み)。追加で .tally 無し子ディレクトリを 1 つ作る。
    const freshChild = path.join(root, 'fresh-repo');
    await fs.mkdir(freshChild, { recursive: true });

    const candidates = await listWorkspaceCandidates({ tallyWorkspace: root });
    const byPath = new Map(candidates.map((c) => [c.path, c]));
    expect(byPath.get(freshChild)?.hasTally).toBe(false);
    expect(byPath.get(root)?.hasTally).toBe(true);
    // 未初期化が先頭 (hasTally=false) に来ること
    const firstInitialized = candidates.findIndex((c) => c.hasTally);
    const lastUninitialized = candidates.map((c) => c.hasTally).lastIndexOf(false);
    if (firstInitialized !== -1 && lastUninitialized !== -1) {
      expect(lastUninitialized).toBeLessThan(firstInitialized);
    }
  });
});
