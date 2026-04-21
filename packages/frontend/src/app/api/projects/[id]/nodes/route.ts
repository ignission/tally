import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// ボディは NodeDraft 相当だが discriminated union のため型で受けず unknown で
// 受ける。実際の検証は addNode 内の NodeSchema.parse に委ねる (単一の真実)。
export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }
  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  // クライアントが id を送ってきても無視する (id は store 側で採番)。
  const { id: _ignoredId, ...draft } = raw as Record<string, unknown>;
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  try {
    const created = await store.addNode(draft as Parameters<typeof store.addNode>[0]);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
