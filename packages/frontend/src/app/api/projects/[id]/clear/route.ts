import { clearProject } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/projects/[id]/clear
// プロジェクトのノード / エッジ / チャットを全削除する。project.yaml は維持。
// フロント側で確認ダイアログを経てから叩く前提。
export async function POST(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const result = await clearProject(handle.workspaceRoot);
  return NextResponse.json(result);
}
