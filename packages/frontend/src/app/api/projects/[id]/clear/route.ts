import { clearProject, listProjects } from '@tally/storage';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// POST /api/projects/[id]/clear
// プロジェクトのノード / エッジ / チャットを全削除する。project.yaml は維持。
// フロント側で確認ダイアログを経てから叩く前提。
export async function POST(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const list = await listProjects();
  const entry = list.find((p) => p.id === id);
  if (!entry) return NextResponse.json({ error: 'project not found' }, { status: 404 });
  const result = await clearProject(entry.path);
  return NextResponse.json(result);
}
