import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PATCH, DELETE as deleteHandler } from './[edgeId]/route';
import { POST } from './route';

describe('POST /api/projects/[id]/edges', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;
  let aId: string;
  let bId: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'a', body: '' });
    const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'b', body: '' });
    aId = a.id;
    bId = b.id;
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('新規エッジを作成し、YAML に反映する', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/edges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: aId, to: bId, type: 'satisfy' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.id).toMatch(/^e-/);
    expect(created.from).toBe(aId);
    expect(created.to).toBe(bId);

    const store = new FileSystemProjectStore(root);
    const edges = await store.listEdges();
    expect(edges).toHaveLength(1);
  });

  it('存在しないノード参照は 400', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/edges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: aId, to: 'unknown', type: 'satisfy' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(400);
  });

  it('不正な type は 400', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/edges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: aId, to: bId, type: 'bogus' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/projects/[id]/edges/[edgeId]', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;
  let edgeId: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'a', body: '' });
    const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'b', body: '' });
    const e = await store.addEdge({ from: a.id, to: b.id, type: 'satisfy' });
    edgeId = e.id;
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('type の変更が反映される (id は不変)', async () => {
    const req = new Request(`http://localhost/api/projects/proj-test/edges/${edgeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'refine' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', edgeId }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    // storage.updateEdge 経由で PATCH が同じ id を返すことを保証する。
    expect(updated.id).toBe(edgeId);
    expect(updated.type).toBe('refine');

    const store = new FileSystemProjectStore(root);
    const edges = await store.listEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.id).toBe(edgeId);
    expect(edges[0]?.type).toBe('refine');
  });

  it('from/to の変更は拒否する (400)', async () => {
    const req = new Request(`http://localhost/api/projects/proj-test/edges/${edgeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'x' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', edgeId }),
    });
    expect(res.status).toBe(400);
  });

  it('存在しない id は 404', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/edges/none', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'refine' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', edgeId: 'none' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE でエッジのみ削除する', async () => {
    const req = new Request(`http://localhost/api/projects/proj-test/edges/${edgeId}`, {
      method: 'DELETE',
    });
    const res = await deleteHandler(req, {
      params: Promise.resolve({ id: 'proj-test', edgeId }),
    });
    expect(res.status).toBe(204);
    const store = new FileSystemProjectStore(root);
    expect(await store.listEdges()).toEqual([]);
    const nodes = await store.listNodes();
    expect(nodes).toHaveLength(2);
  });
});
