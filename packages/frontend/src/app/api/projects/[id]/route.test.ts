import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { initProject, listProjects } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET, PATCH } from './route';

let home: string;
let ws: string;
let projectId: string;
const orig = { ...process.env };

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = home;
  const res = await initProject({
    projectDir: path.join(ws, 'p'),
    name: 'P',
    codebases: [],
  });
  projectId = res.id;
});

afterEach(async () => {
  process.env = { ...orig };
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(ws, { recursive: true, force: true });
});

describe('GET /api/projects/:id', () => {
  it('プロジェクトを返し、touchProject を呼ぶ', async () => {
    const before = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: projectId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; codebases: unknown[] };
    expect(body.id).toBe(projectId);
    expect(body.codebases).toEqual([]);
    const list = await listProjects();
    const entry = list.find((p) => p.id === projectId);
    expect(entry).toBeDefined();
    expect(new Date(entry?.lastOpenedAt ?? '').getTime()).toBeGreaterThanOrEqual(before);
  });

  it('未知 id は 404', async () => {
    const res = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/projects/:id', () => {
  it('codebases を全置換', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ codebases: [{ id: 'web', label: 'Web', path: '/w' }] }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { codebases: unknown };
    expect(body.codebases).toEqual([{ id: 'web', label: 'Web', path: '/w' }]);
  });

  it('name を更新', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'newname' }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('newname');
  });

  it('description に null を渡すと削除', async () => {
    // 事前に description を設定
    await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ description: 'initial' }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ description: null }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { description?: string };
    expect(body.description).toBeUndefined();
  });

  it('未知フィールドは strict で 400', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({ codebasePath: '/old' }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });

  it('codebases[].id 重複は 400', async () => {
    const res = await PATCH(
      new Request('http://localhost', {
        method: 'PATCH',
        body: JSON.stringify({
          codebases: [
            { id: 'a', label: 'A', path: '/a' },
            { id: 'a', label: 'A2', path: '/b' },
          ],
        }),
      }),
      { params: Promise.resolve({ id: projectId }) },
    );
    expect(res.status).toBe(400);
  });
});
