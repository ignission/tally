import { FileSystemProjectStore, listProjects } from '@tally/storage';
import { NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string; nodeId: string }>;
}

// registry から id に対応するプロジェクトディレクトリを解決する
async function resolveDir(id: string): Promise<string | null> {
  const list = await listProjects();
  return list.find((p) => p.id === id)?.path ?? null;
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, nodeId } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  // type 変更は UX 上想定していない。保存時に discriminatedUnion の整合が崩れる恐れがあるため拒否。
  if ('type' in (raw as Record<string, unknown>)) {
    return NextResponse.json({ error: 'type is immutable' }, { status: 400 });
  }
  const store = new FileSystemProjectStore(dir);
  const exists = await store.getNode(nodeId);
  if (!exists) return NextResponse.json({ error: 'node not found' }, { status: 404 });
  try {
    const updated = await store.updateNode(nodeId, raw as Record<string, unknown>);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, nodeId } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  const store = new FileSystemProjectStore(dir);
  await store.deleteNode(nodeId);
  return new NextResponse(null, { status: 204 });
}
