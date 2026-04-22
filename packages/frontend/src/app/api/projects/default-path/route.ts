import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveDefaultProjectsRoot } from '@tally/storage';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

function slugify(raw: string): string {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized.slice(0, 60) : 'default-project';
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const name = url.searchParams.get('name') ?? '';
  if (name.trim().length === 0) {
    return NextResponse.json({ error: 'name 必須' }, { status: 400 });
  }
  const root = resolveDefaultProjectsRoot();
  const slug = slugify(name);
  let candidate = path.join(root, slug);
  let i = 2;
  while (await exists(candidate)) {
    candidate = path.join(root, `${slug}-${i}`);
    i += 1;
  }
  return NextResponse.json({ path: candidate });
}
