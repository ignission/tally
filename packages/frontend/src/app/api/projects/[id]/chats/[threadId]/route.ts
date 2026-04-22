import { FileSystemChatStore, listProjects } from '@tally/storage';
import { NextResponse } from 'next/server';

interface RouteContext {
  params: Promise<{ id: string; threadId: string }>;
}

// registry から id に対応するプロジェクトディレクトリを解決する
async function resolveDir(id: string): Promise<string | null> {
  const list = await listProjects();
  return list.find((p) => p.id === id)?.path ?? null;
}

// GET /api/projects/[id]/chats/[threadId] → スレッド全体 (messages 含む)
export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, threadId } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const store = new FileSystemChatStore(dir);
  const thread = await store.getChat(threadId);
  if (!thread) return NextResponse.json({ error: 'thread not found' }, { status: 404 });
  return NextResponse.json(thread);
}

// DELETE /api/projects/[id]/chats/[threadId] → スレッド削除 (冪等、存在しなくても 204)
export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, threadId } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const store = new FileSystemChatStore(dir);
  await store.deleteChat(threadId);
  return new NextResponse(null, { status: 204 });
}
