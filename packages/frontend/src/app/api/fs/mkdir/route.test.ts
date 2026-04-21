import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-mkdir-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function req(body: unknown): Request {
  return new Request('http://localhost/api/fs/mkdir', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/fs/mkdir', () => {
  it('新規ディレクトリを作成して 201 を返す', async () => {
    const res = await POST(req({ path: dir, name: 'new-sub' }));
    expect(res.status).toBe(201);
    expect(
      (await fs.stat(path.join(dir, 'new-sub'))).isDirectory(),
    ).toBe(true);
  });

  it('既存は 409', async () => {
    await fs.mkdir(path.join(dir, 'exists'));
    const res = await POST(req({ path: dir, name: 'exists' }));
    expect(res.status).toBe(409);
  });

  it('name に / を含むと 400', async () => {
    const res = await POST(req({ path: dir, name: 'a/b' }));
    expect(res.status).toBe(400);
  });

  it('name が .. は 400', async () => {
    const res = await POST(req({ path: dir, name: '..' }));
    expect(res.status).toBe(400);
  });

  it('name が空は 400', async () => {
    const res = await POST(req({ path: dir, name: '' }));
    expect(res.status).toBe(400);
  });

  it('path が相対パスは 400', async () => {
    const res = await POST(req({ path: 'rel', name: 'a' }));
    expect(res.status).toBe(400);
  });

  it('親 path が不在は 404', async () => {
    const res = await POST(req({ path: path.join(dir, 'nope'), name: 'x' }));
    expect(res.status).toBe(404);
  });
});
