import { FileSystemProjectStore, listProjects } from '@tally/storage';
import { NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// registry から id に対応するプロジェクトディレクトリを解決する
async function resolveDir(id: string): Promise<string | null> {
  const list = await listProjects();
  return list.find((p) => p.id === id)?.path ?? null;
}

// ボディは NodeDraft 相当だが discriminated union のため型で受けず unknown で
// 受ける。実際の検証は addNode 内の NodeSchema.parse に委ねる (単一の真実)。
export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }
  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  // クライアントが id を送ってきても無視する (id は store 側で採番)。
  const { id: _ignoredId, ...draft } = raw as Record<string, unknown>;
  const store = new FileSystemProjectStore(dir);
  try {
    const created = await store.addNode(draft as Parameters<typeof store.addNode>[0]);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
