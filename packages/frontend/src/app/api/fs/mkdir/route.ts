import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<NextResponse> {
  const raw = (await req.json().catch(() => null)) as {
    path?: unknown;
    name?: unknown;
  } | null;
  if (!raw || typeof raw.path !== 'string' || typeof raw.name !== 'string') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const parent = raw.path;
  const name = raw.name;

  if (!path.isAbsolute(parent)) {
    return NextResponse.json({ error: 'path は絶対パスのみ' }, { status: 400 });
  }
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    return NextResponse.json({ error: 'name が不正' }, { status: 400 });
  }

  const parentNorm = path.resolve(parent);
  const target = path.resolve(parentNorm, name);
  // 二重防御: 正規化後ターゲットが parent 配下であること
  if (!target.startsWith(`${parentNorm}${path.sep}`) && target !== parentNorm) {
    return NextResponse.json({ error: 'path traversal 検出' }, { status: 400 });
  }

  try {
    const st = await fs.stat(parentNorm);
    if (!st.isDirectory()) {
      return NextResponse.json({ error: 'path がディレクトリではない' }, { status: 400 });
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: '親ディレクトリが存在しない' }, { status: 404 });
    }
    throw err;
  }

  try {
    await fs.mkdir(target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') {
      return NextResponse.json({ error: '既に存在' }, { status: 409 });
    }
    throw err;
  }

  return NextResponse.json({ path: target }, { status: 201 });
}
