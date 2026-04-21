import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { clearProject } from './clear-project';
import { FileSystemChatStore } from './chat-store';
import { initProject } from './init-project';
import { FileSystemProjectStore } from './project-store';

function makeRoot(): string {
  return mkdtempSync(path.join(tmpdir(), 'tally-clear-'));
}

describe('clearProject', () => {
  it('nodes / chats を全削除し edges を空配列に、project.yaml は維持', async () => {
    const root = makeRoot();
    try {
      await initProject({ workspaceRoot: root, name: 'P' });
      const ps = new FileSystemProjectStore(root);
      const cs = new FileSystemChatStore(root);

      await ps.addNode({ type: 'requirement', x: 0, y: 0, title: 'R1', body: '' });
      await ps.addNode({ type: 'usecase', x: 0, y: 0, title: 'UC1', body: '' });
      await cs.createChat({ projectId: 'p', title: 'T1' });
      await cs.createChat({ projectId: 'p', title: 'T2' });

      expect((await ps.listNodes()).length).toBe(2);
      expect((await cs.listChats()).length).toBe(2);

      const metaBefore = await ps.getProjectMeta();
      const result = await clearProject(root);

      expect(result.removedNodes).toBe(2);
      expect(result.removedChats).toBe(2);
      expect((await ps.listNodes()).length).toBe(0);
      expect((await cs.listChats()).length).toBe(0);
      expect((await ps.listEdges()).length).toBe(0);
      expect(await ps.getProjectMeta()).toEqual(metaBefore);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('何も無くても冪等 (ENOENT 許容)', async () => {
    const root = makeRoot();
    try {
      await initProject({ workspaceRoot: root, name: 'P' });
      const result = await clearProject(root);
      expect(result.removedNodes).toBe(0);
      expect(result.removedChats).toBe(0);
      expect(result.keptEdgesFile).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('project.yaml が無くてもディレクトリがあれば動く', async () => {
    const root = makeRoot();
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    try {
      const result = await clearProject(root);
      expect(result.removedNodes).toBe(0);
      expect(result.keptEdgesFile).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
