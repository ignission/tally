import path from 'node:path';
import {
  FileSystemProjectStore,
  listProjects,
  registerProject,
} from '@tally/storage';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const Body = z.object({ projectDir: z.string().min(1) });

export async function POST(req: Request): Promise<NextResponse> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const absDir = path.resolve(parsed.data.projectDir);
  const store = new FileSystemProjectStore(absDir);
  const meta = await store.getProjectMeta();
  if (!meta) {
    return NextResponse.json(
      { error: 'project.yaml が見つからない' },
      { status: 400 },
    );
  }
  const existing = await listProjects();
  if (existing.some((p) => p.id === meta.id && p.path !== absDir)) {
    return NextResponse.json(
      { error: `id 衝突: ${meta.id} は別のパスで既に登録されている` },
      { status: 409 },
    );
  }
  await registerProject({ id: meta.id, path: absDir });
  return NextResponse.json({ id: meta.id, projectDir: absDir }, { status: 201 });
}
