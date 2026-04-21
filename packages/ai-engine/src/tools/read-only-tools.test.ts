import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findRelatedHandler } from './find-related';
import { listByTypeHandler } from './list-by-type';

describe('find_related + list_by_type', () => {
  let root: string;
  let store: FileSystemProjectStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-readonly-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('find_related はエッジで繋がったノードを返す', async () => {
    const a = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'a', body: '' });
    const b = await store.addNode({ type: 'userstory', x: 0, y: 0, title: 'b', body: '' });
    const c = await store.addNode({ type: 'userstory', x: 0, y: 0, title: 'c', body: '' });
    await store.addEdge({ from: a.id, to: b.id, type: 'contain' });
    await store.addEdge({ from: a.id, to: c.id, type: 'contain' });
    const handler = findRelatedHandler({ store });
    const result = await handler({ nodeId: a.id });
    const related = JSON.parse(result.output) as { id: string }[];
    expect(related.map((n) => n.id).sort()).toEqual([b.id, c.id].sort());
  });

  it('list_by_type は指定 type のノードを返す', async () => {
    await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'u', body: '' });
    await store.addNode({ type: 'userstory', x: 0, y: 0, title: 's1', body: '' });
    await store.addNode({ type: 'userstory', x: 0, y: 0, title: 's2', body: '' });
    const handler = listByTypeHandler({ store });
    const result = await handler({ type: 'userstory' });
    const nodes = JSON.parse(result.output) as { type: string }[];
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.type === 'userstory')).toBe(true);
  });
});
