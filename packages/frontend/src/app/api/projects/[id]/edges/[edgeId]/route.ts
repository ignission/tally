import { EDGE_TYPES } from '@tally/core';
import { FileSystemProjectStore, listProjects } from '@tally/storage';
import { NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string; edgeId: string }>;
}

// registry から id に対応するプロジェクトディレクトリを解決する
async function resolveDir(id: string): Promise<string | null> {
  const list = await listProjects();
  return list.find((p) => p.id === id)?.path ?? null;
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, edgeId } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  // 現状のエッジ編集 UX は type 変更のみ許容する (接続の付け替えは UI で「削除→再作成」で行う)。
  if ('from' in body || 'to' in body) {
    return NextResponse.json({ error: 'endpoints are immutable' }, { status: 400 });
  }
  if (typeof body.type !== 'string' || !(EDGE_TYPES as readonly string[]).includes(body.type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  const store = new FileSystemProjectStore(dir);
  try {
    const updated = await store.updateEdge(edgeId, {
      type: body.type as (typeof EDGE_TYPES)[number],
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (String(err).includes('存在しないエッジ')) {
      return NextResponse.json({ error: 'edge not found' }, { status: 404 });
    }
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, edgeId } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  const store = new FileSystemProjectStore(dir);
  await store.deleteEdge(edgeId);
  return new NextResponse(null, { status: 204 });
}
