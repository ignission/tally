import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { FileSystemChatStore } from './chat-store';
import { clearProject } from './clear-project';
import { initProject } from './init-project';
import { FileSystemProjectStore } from './project-store';

function makeProjectDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'tally-clear-'));
}

describe('clearProject', () => {
  it('nodes / chats を全削除し edges を空配列に、project.yaml は維持', async () => {
    const projectDir = makeProjectDir();
    try {
      await initProject({ projectDir, name: 'P', codebases: [] });
      const ps = new FileSystemProjectStore(projectDir);
      const cs = new FileSystemChatStore(projectDir);

      await ps.addNode({ type: 'requirement', x: 0, y: 0, title: 'R1', body: '' });
      await ps.addNode({ type: 'usecase', x: 0, y: 0, title: 'UC1', body: '' });
      await cs.createChat({ projectId: 'p', title: 'T1' });
      await cs.createChat({ projectId: 'p', title: 'T2' });

      expect((await ps.listNodes()).length).toBe(2);
      expect((await cs.listChats()).length).toBe(2);

      const metaBefore = await ps.getProjectMeta();
      const result = await clearProject(projectDir);

      expect(result.removedNodes).toBe(2);
      expect(result.removedChats).toBe(2);
      expect((await ps.listNodes()).length).toBe(0);
      expect((await cs.listChats()).length).toBe(0);
      expect((await ps.listEdges()).length).toBe(0);
      expect(await ps.getProjectMeta()).toEqual(metaBefore);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('何も無くても冪等 (ENOENT 許容)', async () => {
    const projectDir = makeProjectDir();
    try {
      await initProject({ projectDir, name: 'P', codebases: [] });
      const result = await clearProject(projectDir);
      expect(result.removedNodes).toBe(0);
      expect(result.removedChats).toBe(0);
      expect(result.keptEdgesFile).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('project.yaml が無くてもディレクトリがあれば動く', async () => {
    const projectDir = makeProjectDir();
    await fs.mkdir(path.join(projectDir, 'nodes'), { recursive: true });
    try {
      const result = await clearProject(projectDir);
      expect(result.removedNodes).toBe(0);
      expect(result.keptEdgesFile).toBe(true);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
