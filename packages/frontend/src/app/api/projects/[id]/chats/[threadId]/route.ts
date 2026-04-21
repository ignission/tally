import { FileSystemChatStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string; threadId: string }>;
}

// GET /api/projects/[id]/chats/[threadId] → スレッド全体 (messages 含む)
export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, threadId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const store = new FileSystemChatStore(handle.workspaceRoot);
  const thread = await store.getChat(threadId);
  if (!thread) return NextResponse.json({ error: 'thread not found' }, { status: 404 });
  return NextResponse.json(thread);
}

// DELETE /api/projects/[id]/chats/[threadId] → スレッド削除 (冪等、存在しなくても 204)
export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, threadId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const store = new FileSystemChatStore(handle.workspaceRoot);
  await store.deleteChat(threadId);
  return new NextResponse(null, { status: 204 });
}
