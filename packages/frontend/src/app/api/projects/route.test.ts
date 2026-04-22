import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './route';

let home: string;
let workspace: string;
const prevHome = process.env.TALLY_HOME;

beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
  process.env.TALLY_HOME = home;
});
afterEach(async () => {
  if (prevHome === undefined) delete process.env.TALLY_HOME;
  else process.env.TALLY_HOME = prevHome;
  await fs.rm(home, { recursive: true, force: true });
  await fs.rm(workspace, { recursive: true, force: true });
});

describe('GET /api/projects', () => {
  it('registry が空なら空配列', async () => {
    const res = await GET();
    const body = (await res.json()) as { projects: unknown[] };
    expect(body.projects).toEqual([]);
  });

  it('POST で作ると GET に現れ、lastOpenedAt 降順で並ぶ', async () => {
    await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          projectDir: path.join(workspace, 'a'),
          name: 'A',
          codebases: [],
        }),
      }),
    );
    await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          projectDir: path.join(workspace, 'b'),
          name: 'B',
          codebases: [],
        }),
      }),
    );
    const res = await GET();
    const body = (await res.json()) as {
      projects: { id: string; name: string; projectDir: string }[];
    };
    expect(body.projects.map((p) => p.name)).toEqual(['B', 'A']);
  });
});

describe('POST /api/projects', () => {
  it('codebases を受け付けて registry に登録', async () => {
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          projectDir: path.join(workspace, 'x'),
          name: 'X',
          codebases: [{ id: 'web', label: 'Web', path: '/w' }],
        }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it('codebases 欠落は 400', async () => {
    const res = await POST(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ projectDir: path.join(workspace, 'y'), name: 'Y' }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
