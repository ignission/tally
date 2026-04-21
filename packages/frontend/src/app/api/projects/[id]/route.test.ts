import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET, PATCH } from './route';

describe('app/api/projects/[id] route', () => {
  let workspace: string;
  const prev = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    process.env.TALLY_WORKSPACE = workspace;
    const store = new FileSystemProjectStore(workspace);
    await fs.mkdir(path.join(workspace, '.tally', 'nodes'), { recursive: true });
    await store.saveProjectMeta({
      id: 'proj-route',
      name: 'route',
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T00:00:00Z',
    });
  });

  afterEach(async () => {
    if (prev === undefined) {
      // biome の noDelete に従い undefined 代入で env var をリセット。
      // beforeEach で毎回 workspace を上書きするため実害なし。
      process.env.TALLY_WORKSPACE = undefined;
    } else {
      process.env.TALLY_WORKSPACE = prev;
    }
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('GET は既存プロジェクトを返す', async () => {
    const res = await GET(new Request('http://t/'), {
      params: Promise.resolve({ id: 'proj-route' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('proj-route');
  });

  it('PATCH で codebasePath を保存できる', async () => {
    const res = await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ codebasePath: '../backend' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'proj-route' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { codebasePath?: string; updatedAt: string };
    expect(body.codebasePath).toBe('../backend');
    expect(body.updatedAt).not.toBe('2026-04-18T00:00:00Z');

    // 往復確認: ストアに書かれているか
    const store = new FileSystemProjectStore(workspace);
    const meta = await store.getProjectMeta();
    expect(meta?.codebasePath).toBe('../backend');
  });

  it('PATCH で codebasePath: null は削除シグナル', async () => {
    const store = new FileSystemProjectStore(workspace);
    await store.saveProjectMeta({
      id: 'proj-route',
      name: 'route',
      codebasePath: '../old',
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T00:00:00Z',
    });
    const res = await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ codebasePath: null }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'proj-route' }) },
    );
    expect(res.status).toBe(200);
    const meta = await store.getProjectMeta();
    expect(meta?.codebasePath).toBeUndefined();
  });

  it('PATCH で不明なフィールドは 400', async () => {
    const res = await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'newname' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'proj-route' }) },
    );
    expect(res.status).toBe(400);
  });

  it('PATCH で存在しないプロジェクトは 404', async () => {
    const res = await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ codebasePath: '../x' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'proj-missing' }) },
    );
    expect(res.status).toBe(404);
  });
});
