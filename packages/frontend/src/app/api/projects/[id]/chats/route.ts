import { FileSystemChatStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// GET /api/projects/[id]/chats → スレッドメタ一覧 (updatedAt 降順)
export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const store = new FileSystemChatStore(handle.workspaceRoot);
  const threads = await store.listChats();
  return NextResponse.json({ threads });
}

// POST /api/projects/[id]/chats → 新規スレッド作成
// body: { title?: string } (空なら「新規スレッド」)
export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { title } = raw as { title?: unknown };
  const titleStr =
    typeof title === 'string' && title.trim().length > 0 ? title.trim() : '新規スレッド';
  const store = new FileSystemChatStore(handle.workspaceRoot);
  const thread = await store.createChat({ projectId: id, title: titleStr });
  return NextResponse.json(thread, { status: 201 });
}
