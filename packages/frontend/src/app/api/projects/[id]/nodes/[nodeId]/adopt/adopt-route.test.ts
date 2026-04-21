import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from './route';

describe('POST /api/projects/[id]/nodes/[nodeId]/adopt', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-adopt-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  async function makeProposal(root: string) {
    const store = new FileSystemProjectStore(root);
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
    const prop = await makeProposal(root);
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
    const prop = await makeProposal(root);
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
    const store = new FileSystemProjectStore(root);
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
