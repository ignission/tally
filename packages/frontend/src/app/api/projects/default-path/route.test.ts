import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './route';

let home: string;
const orig = { ...process.env };

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-dp-'));
  process.env.TALLY_HOME = home;
});
afterEach(async () => {
  process.env = { ...orig };
  await fs.rm(home, { recursive: true, force: true });
});

function req(name: string): Request {
  const url = new URL('http://localhost/api/projects/default-path');
  url.searchParams.set('name', name);
  return new Request(url);
}

describe('GET /api/projects/default-path', () => {
  it('name を slug 化して <TALLY_HOME>/projects/<slug>/ を返す', async () => {
    const res = await GET(req('My Proj!'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(body.path).toBe(path.join(home, 'projects', 'my-proj'));
  });

  it('衝突時にサフィックス -2, -3 を付与', async () => {
    await fs.mkdir(path.join(home, 'projects', 'dup'), { recursive: true });
    const res1 = await GET(req('dup'));
    const body1 = (await res1.json()) as { path: string };
    expect(body1.path).toBe(path.join(home, 'projects', 'dup-2'));

    await fs.mkdir(path.join(home, 'projects', 'dup-2'));
    const res2 = await GET(req('dup'));
    const body2 = (await res2.json()) as { path: string };
    expect(body2.path).toBe(path.join(home, 'projects', 'dup-3'));
  });

  it('name 空は 400', async () => {
    const res = await GET(req(''));
    expect(res.status).toBe(400);
  });

  it('slug が英数字になるものが無ければ default-project', async () => {
    const res = await GET(req('  日本語のみ  '));
    const body = (await res.json()) as { path: string };
    expect(body.path).toMatch(/default-project$/);
  });
});
