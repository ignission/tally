import type { ProjectMeta } from '@tally/core';
import { ProjectMetaPatchSchema } from '@tally/core';
import { FileSystemProjectStore, listProjects, touchProject } from '@tally/storage';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// registry から id に対応するプロジェクトディレクトリを解決する
async function resolveDir(id: string): Promise<string | null> {
  const list = await listProjects();
  return list.find((p) => p.id === id)?.path ?? null;
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  const store = new FileSystemProjectStore(dir);
  const project = await store.loadProject();
  if (!project) return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  // registry の id と project.yaml の id が不一致の場合は 409 を返す
  if (project.id !== id) {
    return NextResponse.json(
      { error: 'registry id と project.yaml id が不一致', registryId: id, fileId: project.id },
      { status: 409 },
    );
  }
  await touchProject(id);
  return NextResponse.json(project);
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const dir = await resolveDir(id);
  if (!dir) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  // ProjectMetaPatchSchema は .strict() 定義のため未知フィールドは 400 で弾かれる
  const parsed = ProjectMetaPatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const store = new FileSystemProjectStore(dir);
  const current = await store.getProjectMeta();
  if (!current) return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  // registry の id と project.yaml の id が不一致の場合は 409 を返す
  if (current.id !== id) {
    return NextResponse.json(
      { error: 'registry id と project.yaml id が不一致', registryId: id, fileId: current.id },
      { status: 409 },
    );
  }

  // codebase 削除によって coderef ノードが orphan にならないか確認する
  if (parsed.data.codebases !== undefined) {
    const newCodebaseIds = new Set(parsed.data.codebases.map((c) => c.id));
    const nodes = await store.listNodes();
    const orphanedNodeIds = nodes
      .filter((n) => n.type === 'coderef' && !newCodebaseIds.has(n.codebaseId))
      .map((n) => n.id);
    if (orphanedNodeIds.length > 0) {
      return NextResponse.json(
        {
          error: 'codebase を削除すると参照している coderef ノードが orphan になる',
          nodeIds: orphanedNodeIds,
        },
        { status: 409 },
      );
    }
  }

  const next: ProjectMeta = {
    ...current,
    ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
    ...(parsed.data.codebases !== undefined ? { codebases: parsed.data.codebases } : {}),
    updatedAt: new Date().toISOString(),
  };

  // description: null = 削除、string = 置換、undefined = 維持
  if (parsed.data.description === null) {
    delete (next as { description?: string }).description;
  } else if (typeof parsed.data.description === 'string') {
    next.description = parsed.data.description;
  }

  await store.saveProjectMeta(next);
  return NextResponse.json(next);
}
