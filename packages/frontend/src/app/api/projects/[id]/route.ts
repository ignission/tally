import { ProjectMetaPatchSchema } from '@tally/core';
import { FileSystemProjectStore, resolveProjectById } from '@tally/storage';
import { NextResponse } from 'next/server';

import { loadProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const project = await loadProjectById(id);
  if (!project) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }
  return NextResponse.json(project);
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  // ProjectMetaPatchSchema は @tally/core で .strict() 定義されており、
  // 未知フィールド / 型不一致はここで弾かれる (400)。
  const parsed = ProjectMetaPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const patch = parsed.data;
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  const current = await store.getProjectMeta();
  if (!current) {
    return NextResponse.json({ error: 'meta not found', id }, { status: 404 });
  }

  // 各フィールドのパッチ規則:
  //   codebasePath: null = 削除、string = 置換、undefined = 維持。
  //   additionalCodebasePaths: [] = 削除、配列 = 置換、undefined = 維持。
  const { codebasePath: _codebasePath, additionalCodebasePaths: _additional, ...rest } = current;

  const nextCodebasePath =
    patch.codebasePath === null
      ? undefined
      : patch.codebasePath !== undefined
        ? patch.codebasePath
        : current.codebasePath;

  const nextAdditional =
    patch.additionalCodebasePaths !== undefined
      ? patch.additionalCodebasePaths.length > 0
        ? patch.additionalCodebasePaths
        : undefined
      : current.additionalCodebasePaths;

  const next = {
    ...rest,
    ...(nextCodebasePath !== undefined ? { codebasePath: nextCodebasePath } : {}),
    ...(nextAdditional !== undefined ? { additionalCodebasePaths: nextAdditional } : {}),
    updatedAt: new Date().toISOString(),
  };

  await store.saveProjectMeta(next);
  return NextResponse.json(next);
}
