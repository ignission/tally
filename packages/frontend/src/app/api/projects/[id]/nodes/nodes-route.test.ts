import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore, registerProject } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DELETE as deleteHandler, PATCH } from './[nodeId]/route';
import { POST } from './route';

describe('POST /api/projects/[id]/nodes', () => {
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

  it('新規ノードを作成し、YAML に反映する', async () => {
    const body = { type: 'requirement', x: 100, y: 200, title: 'T', body: 'B' };
    const req = new Request('http://localhost/api/projects/proj-test/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.type).toBe('requirement');
    expect(created.id).toMatch(/^req-/);

    const store = new FileSystemProjectStore(projectDir);
    const persisted = await store.getNode(created.id);
    expect(persisted).toEqual(created);
  });

  it('不正なボディは 400', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'requirement' }), // 必須欠如
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(400);
  });

  it('未知のプロジェクトは 404', async () => {
    const req = new Request('http://localhost/api/projects/nope/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'requirement', x: 0, y: 0, title: 't', body: '' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/projects/[id]/nodes/[nodeId]', () => {
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(projectDir, 'nodes'), { recursive: true });
    await fs.mkdir(path.join(projectDir, 'edges'), { recursive: true });
    await fs.writeFile(path.join(projectDir, 'edges', 'edges.yaml'), 'edges: []\n');
    await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'orig', body: '' });
    await registerProject({ id: 'proj-test', path: projectDir });
  });

  afterEach(async () => {
    if (prevHome === undefined) delete process.env.TALLY_HOME;
    else process.env.TALLY_HOME = prevHome;
    await fs.rm(home, { recursive: true, force: true });
    await fs.rm(projectDir, { recursive: true, force: true });
  });

  it('title の部分更新が反映される', async () => {
    const store = new FileSystemProjectStore(projectDir);
    const nodes = await store.listNodes();
    const node = nodes[0];
    if (!node) throw new Error('setup failure: node not created');
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${node.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'updated' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: node.id }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe('updated');
    const persisted = await store.getNode(node.id);
    expect(persisted?.title).toBe('updated');
  });

  it('type 変更は拒否する (400)', async () => {
    const store = new FileSystemProjectStore(projectDir);
    const nodes = await store.listNodes();
    const node = nodes[0];
    if (!node) throw new Error('setup failure: node not created');
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${node.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'usecase' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: node.id }),
    });
    expect(res.status).toBe(400);
  });

  it('存在しない id は 404', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/nodes/unknown', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: 'unknown' }),
    });
    expect(res.status).toBe(404);
  });

  it('null を送ると optional フィールドが削除される', async () => {
    const store = new FileSystemProjectStore(projectDir);
    const created = await store.addNode({
      type: 'requirement',
      x: 0,
      y: 0,
      title: 't',
      body: '',
      kind: 'functional',
    });
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${created.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: null }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: created.id }),
    });
    expect(res.status).toBe(200);
    const persisted = await store.getNode(created.id);
    expect(persisted).toBeDefined();
    expect((persisted as { kind?: string }).kind).toBeUndefined();
  });
});

describe('DELETE /api/projects/[id]/nodes/[nodeId]', () => {
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

  it('ノードと付随エッジを削除する', async () => {
    const store = new FileSystemProjectStore(projectDir);
    const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'a', body: '' });
    const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'b', body: '' });
    await store.addEdge({ from: a.id, to: b.id, type: 'satisfy' });
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${a.id}`, {
      method: 'DELETE',
    });
    const res = await deleteHandler(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: a.id }),
    });
    expect(res.status).toBe(204);
    expect(await store.getNode(a.id)).toBeNull();
    expect(await store.listEdges()).toEqual([]);
  });
});
