import { EDGE_TYPES } from '@tally/core';
import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { from, to, type } = raw as Record<string, unknown>;
  if (typeof from !== 'string' || typeof to !== 'string' || typeof type !== 'string') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!(EDGE_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: 'invalid edge type' }, { status: 400 });
  }
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  // 参照整合性を守るため、両端ノードの実在を確認してから追加する。
  const [src, dst] = await Promise.all([store.getNode(from), store.getNode(to)]);
  if (!src || !dst) {
    return NextResponse.json({ error: 'endpoint node not found' }, { status: 400 });
  }
  const created = await store.addEdge({ from, to, type: type as (typeof EDGE_TYPES)[number] });
  return NextResponse.json(created, { status: 201 });
}
