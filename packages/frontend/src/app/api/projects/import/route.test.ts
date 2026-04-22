import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './route';

let home: string;
let ws: string;
const prevHome = process.env.TALLY_HOME;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  ws = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = home;
});
afterEach(async () => {
  if (prevHome === undefined) delete process.env.TALLY_HOME;
  else process.env.TALLY_HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(ws, { recursive: true, force: true });
});

describe('POST /api/projects/import', () => {
  it('project.yaml を含む dir を登録', async () => {
    const dir = path.join(ws, 'imp');
    await fs.mkdir(dir);
    await fs.writeFile(
      path.join(dir, 'project.yaml'),
      'id: proj-imported\nname: imp\ncodebases: []\ncreatedAt: "2026-04-21T00:00:00Z"\nupdatedAt: "2026-04-21T00:00:00Z"\n',
    );
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: dir }),
      }),
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('proj-imported');
  });

  it('project.yaml が無ければ 400', async () => {
    const dir = path.join(ws, 'empty');
    await fs.mkdir(dir);
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: dir }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it('同じ id のプロジェクトが既に登録されていれば 409', async () => {
    const dir1 = path.join(ws, 'a');
    const dir2 = path.join(ws, 'b');
    for (const d of [dir1, dir2]) {
      await fs.mkdir(d);
      await fs.writeFile(
        path.join(d, 'project.yaml'),
        'id: proj-same\nname: s\ncodebases: []\ncreatedAt: "2026-04-21T00:00:00Z"\nupdatedAt: "2026-04-21T00:00:00Z"\n',
      );
    }
    const r1 = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: dir1 }),
      }),
    );
    expect(r1.status).toBe(201);
    const r2 = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: dir2 }),
      }),
    );
    expect(r2.status).toBe(409);
  });
});
