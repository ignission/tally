import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemChatStore, FileSystemProjectStore, registerProject } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET as getByIdHandler } from './[threadId]/route';
import { GET as listHandler, POST as createHandler } from './route';

describe('/api/projects/[id]/chats', () => {
  let home: string;
  let projectDir: string;
  const prev = process.env.TALLY_HOME;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
    process.env.TALLY_HOME = home;
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-proj-'));
    const store = new FileSystemProjectStore(projectDir);
    await store.saveProjectMeta({
      id: 'proj-1',
      name: 'P',
      codebases: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(projectDir, 'nodes'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'edges'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'edges', 'edges.yaml'), 'edges: []\n');
    await fs.mkdir(path.join(projectDir, 'chats'), { recursive: true });
    await registerProject({ id: 'proj-1', path: projectDir });
  });
  afterEach(async () => {
    process.env.TALLY_HOME = prev;
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('POST で新規スレッド作成、GET で一覧化', async () => {
    const createRes = await createHandler(
      new Request('http://x', {
        method: 'POST',
        body: JSON.stringify({ title: 'Test' }),
      }),
      { params: Promise.resolve({ id: 'proj-1' }) },
    );
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: string; title: string };
    expect(created.id.startsWith('chat-')).toBe(true);
    expect(created.title).toBe('Test');

    const listRes = await listHandler(new Request('http://x'), {
      params: Promise.resolve({ id: 'proj-1' }),
    });
    const listBody = (await listRes.json()) as { threads: Array<{ id: string }> };
    expect(listBody.threads).toHaveLength(1);
    expect(listBody.threads[0]?.id).toBe(created.id);
  });

  it('POST の title が空 or 未指定なら「新規スレッド」にフォールバック', async () => {
    const r1 = await createHandler(
      new Request('http://x', { method: 'POST', body: JSON.stringify({}) }),
      { params: Promise.resolve({ id: 'proj-1' }) },
    );
    const b1 = (await r1.json()) as { title: string };
    expect(b1.title).toBe('新規スレッド');

    const r2 = await createHandler(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ title: '   ' }) }),
      { params: Promise.resolve({ id: 'proj-1' }) },
    );
    const b2 = (await r2.json()) as { title: string };
    expect(b2.title).toBe('新規スレッド');
  });

  it('GET /[threadId] で 1 スレッドの詳細', async () => {
    const chatStore = new FileSystemChatStore(projectDir);
    const t = await chatStore.createChat({ projectId: 'proj-1', title: 'X' });

    const res = await getByIdHandler(new Request('http://x'), {
      params: Promise.resolve({ id: 'proj-1', threadId: t.id }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; messages: unknown[] };
    expect(body.id).toBe(t.id);
    expect(body.messages).toEqual([]);
  });

  it('存在しないプロジェクトの GET は 404', async () => {
    const res = await listHandler(new Request('http://x'), {
      params: Promise.resolve({ id: 'proj-missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('存在しないプロジェクトの POST は 404', async () => {
    const res = await createHandler(
      new Request('http://x', { method: 'POST', body: JSON.stringify({ title: 't' }) }),
      { params: Promise.resolve({ id: 'proj-missing' }) },
    );
    expect(res.status).toBe(404);
  });

  it('存在しないスレッドの GET [threadId] は 404', async () => {
    const res = await getByIdHandler(new Request('http://x'), {
      params: Promise.resolve({ id: 'proj-1', threadId: 'chat-missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('POST の body が壊れてたら 400', async () => {
    const res = await createHandler(
      new Request('http://x', { method: 'POST', body: 'not json' }),
      { params: Promise.resolve({ id: 'proj-1' }) },
    );
    expect(res.status).toBe(400);
  });
});
