import { initProject } from '@tally/storage';
import { NextResponse } from 'next/server';

import { discoverProjects } from '@/lib/project-resolver';

export async function GET(): Promise<NextResponse> {
  const projects = await discoverProjects();
  return NextResponse.json({
    projects: projects.map(({ id, meta, workspaceRoot }) => ({
      id,
      name: meta.name,
      description: meta.description ?? null,
      workspaceRoot,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    })),
  });
}

// 新規プロジェクト作成: UI のダイアログから呼ばれる。
// body: { workspaceRoot: string (絶対パス), name: string, description?: string }
// 成功時 201 + { id, workspaceRoot }、失敗は 400 + { error }。
export async function POST(req: Request): Promise<NextResponse> {
  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { workspaceRoot, name, description } = raw as {
    workspaceRoot?: unknown;
    name?: unknown;
    description?: unknown;
  };
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
    return NextResponse.json({ error: 'workspaceRoot が不正' }, { status: 400 });
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    return NextResponse.json({ error: 'name が不正' }, { status: 400 });
  }
  try {
    const result = await initProject({
      workspaceRoot,
      name,
      ...(typeof description === 'string' && description.length > 0 ? { description } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String((err as Error).message ?? err) }, { status: 400 });
  }
}
