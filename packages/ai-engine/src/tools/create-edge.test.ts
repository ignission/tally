import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent } from '../stream';
import { createEdgeHandler } from './create-edge';

describe('create_edge tool', () => {
  let root: string;
  let store: FileSystemProjectStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-tool-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('有効な from/to/type で edge_created を発行', async () => {
    const a = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'u', body: '' });
    const b = await store.addNode({
      type: 'proposal',
      x: 0,
      y: 0,
      title: '[AI] p',
      body: '',
      adoptAs: 'userstory',
    });
    const events: AgentEvent[] = [];
    const handler = createEdgeHandler({ store, emit: (e) => events.push(e) });
    const result = await handler({ from: a.id, to: b.id, type: 'derive' });
    expect(result.ok).toBe(true);
    expect(events[0]?.type).toBe('edge_created');
    const edges = await store.listEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe('derive');
  });

  it('不正な type は ok:false', async () => {
    const handler = createEdgeHandler({ store, emit: () => {} });
    const result = await handler({ from: 'a', to: 'b', type: 'bogus' as never });
    expect(result.ok).toBe(false);
  });
});
