import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listProjects, registerProject } from '@tally/storage';
import { POST } from './route';

let home: string;
const orig = { ...process.env };
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
  process.env.TALLY_HOME = home;
});
afterEach(async () => {
  process.env = { ...orig };
  await fs.rm(home, { recursive: true, force: true });
});

describe('POST /api/projects/:id/unregister', () => {
  it('registry から外す（ディレクトリは消さない）', async () => {
    await registerProject({ id: 'proj-a', path: '/some/dir' });
    const res = await POST(new Request('http://localhost'), {
      params: Promise.resolve({ id: 'proj-a' }),
    });
    expect(res.status).toBe(204);
    expect(await listProjects()).toEqual([]);
  });
});
