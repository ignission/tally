import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore, registerProject } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from './route';

describe('POST /api/projects/[id]/nodes/[nodeId]/adopt', () => {
  let home: string;
  let projectDir: string;
  const prevHome = process.env.TALLY_HOME;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-home-'));
    process.env.TALLY_HOME = home;
    projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-proj-'));
    const store = new FileSystemProjectStore(projectDir);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      codebases: [],
      mcpServers: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(projectDir, 'nodes'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'edges'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'edges', 'edges.yaml'), 'edges: []\n');
    await registerProject({ id: 'proj-test', path: projectDir });
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.TALLY_HOME;
    else process.env.TALLY_HOME = prevHome;
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  async function makeProposal(dir: string) {
    const store = new FileSystemProjectStore(dir);
    return store.addNode({
      type: 'proposal',
      x: 0,
      y: 0,
      title: '[AI] テスト案',
      body: '本文',
      adoptAs: 'userstory',
    });
  }

  it('userstory として採用すると 200 と新しいノードを返す', async () => {
    const prop = await makeProposal(projectDir);
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${prop.id}/adopt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adoptAs: 'userstory' }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: prop.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(prop.id);
    expect(body.type).toBe('userstory');
    expect(body.title).toBe('テスト案');
  });

  it('adoptAs が proposal だと 400', async () => {
    const prop = await makeProposal(projectDir);
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${prop.id}/adopt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adoptAs: 'proposal' }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: prop.id }),
    });
    expect(res.status).toBe(400);
  });

  it('proposal 以外を採用しようとすると 400', async () => {
    const store = new FileSystemProjectStore(projectDir);
    const req1 = await store.addNode({
      type: 'requirement',
      x: 0,
      y: 0,
      title: 'r',
      body: '',
    });
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${req1.id}/adopt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adoptAs: 'userstory' }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: req1.id }),
    });
    expect(res.status).toBe(400);
  });

  it('存在しないノードは 404', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/nodes/prop-missing/adopt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adoptAs: 'userstory' }),
    });
    const res = await POST(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: 'prop-missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('未知のプロジェクトは 404', async () => {
    const req = new Request('http://localhost/api/projects/nope/nodes/any/adopt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ adoptAs: 'userstory' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'nope', nodeId: 'any' }) });
    expect(res.status).toBe(404);
  });
});
