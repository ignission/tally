import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const raw = url.searchParams.get('path');
  const target = raw ?? os.homedir();
  if (!path.isAbsolute(target)) {
    return NextResponse.json({ error: 'path は絶対パスのみ' }, { status: 400 });
  }
  const normalized = path.resolve(target);

  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(normalized);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return NextResponse.json({ error: 'ディレクトリが存在しない' }, { status: 404 });
    }
    if (code === 'EACCES') {
      return NextResponse.json({ error: '権限がない' }, { status: 403 });
    }
    throw err;
  }
  if (!stat.isDirectory()) {
    return NextResponse.json({ error: 'ディレクトリではない' }, { status: 400 });
  }

  const parent = path.dirname(normalized);
  const parentResolved = parent === normalized ? null : parent;

  let rawEntries: import('node:fs').Dirent[];
  try {
    rawEntries = await fs.readdir(normalized, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EACCES') {
      return NextResponse.json(
        {
          path: normalized,
          parent: parentResolved,
          entries: [],
          containsProjectYaml: false,
        },
        { status: 200 },
      );
    }
    throw err;
  }

  // シンボリックリンクも含めてディレクトリエントリを解決する
  const dirEntries = await Promise.all(
    rawEntries
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map(async (e) => {
        const childPath = path.join(normalized, e.name);
        try {
          // stat でリンク先を辿り、実体がディレクトリか確認する
          const s = await fs.stat(childPath);
          if (!s.isDirectory()) return null;
        } catch {
          // リンク切れ等はスキップ
          return null;
        }
        let hasProjectYaml = false;
        try {
          // project.yaml がファイルであることを検証する
          const yamlStat = await fs.stat(path.join(childPath, 'project.yaml'));
          if (yamlStat.isFile()) hasProjectYaml = true;
        } catch {
          /* なし */
        }
        return {
          name: e.name,
          path: childPath,
          isHidden: e.name.startsWith('.'),
          hasProjectYaml,
        };
      }),
  );
  const entries = dirEntries.filter((e): e is NonNullable<typeof e> => e !== null);

  let containsProjectYaml = false;
  try {
    // project.yaml がファイルであることを検証する
    const yamlStat = await fs.stat(path.join(normalized, 'project.yaml'));
    if (yamlStat.isFile()) containsProjectYaml = true;
  } catch {
    /* なし */
  }

  return NextResponse.json(
    {
      path: normalized,
      parent: parentResolved,
      entries: entries.sort((a, b) => a.name.localeCompare(b.name, 'ja')),
      containsProjectYaml,
    },
    { status: 200 },
  );
}
