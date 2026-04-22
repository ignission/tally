import { CodebaseSchema } from '@tally/core';
import { FileSystemProjectStore, initProject, listProjects } from '@tally/storage';
import { NextResponse } from 'next/server';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const entries = await listProjects();
  const projects = await Promise.all(
    entries.map(async (e) => {
      try {
        const store = new FileSystemProjectStore(e.path);
        const meta = await store.getProjectMeta();
        if (!meta) return null;
        return {
          id: meta.id,
          name: meta.name,
          description: meta.description ?? null,
          codebases: meta.codebases,
          projectDir: e.path,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
          lastOpenedAt: e.lastOpenedAt,
        };
      } catch {
        return null;
      }
    }),
  );
  return NextResponse.json({
    projects: projects.filter((p): p is NonNullable<typeof p> => p !== null),
  });
}

const CreateBodySchema = z.object({
  projectDir: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  codebases: z.array(CodebaseSchema),
});

export async function POST(req: Request): Promise<NextResponse> {
  const raw = await req.json().catch(() => null);
  const parsed = CreateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  try {
    const { description, ...rest } = parsed.data;
    const result = await initProject({
      ...rest,
      ...(description !== undefined ? { description } : {}),
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String((err as Error).message ?? err) }, { status: 400 });
  }
}
