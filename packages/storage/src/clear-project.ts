import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveProjectPaths } from './project-dir';

export interface ClearProjectResult {
  removedNodes: number;
  removedChats: number;
  removedOAuthTokens: number;
  keptEdgesFile: boolean;
}

// プロジェクトの内容を初期化する。project.yaml は維持、nodes/*.yaml と chats/*.yaml と
// oauth/*.yaml を全削除、edges.yaml は空配列に書き戻す。呼び出し側 (UI/CLI) が確認ダイアログを
// 出す前提。
//
// ADR-0011: oauth/ には access token / refresh token が平文で保存されているため、
// プロジェクトリセット時に確実に削除しないと次の利用者に漏洩しうる (codex P1 指摘)。
export async function clearProject(projectDir: string): Promise<ClearProjectResult> {
  const paths = resolveProjectPaths(projectDir);
  const removedNodes = await clearDir(paths.nodesDir);
  const removedChats = await clearDir(paths.chatsDir);
  const removedOAuthTokens = await clearOAuthDir(paths.oauthDir);
  // edges.yaml を空配列で書き直す (無ければ作成)。
  await fs.mkdir(paths.edgesDir, { recursive: true });
  await fs.writeFile(paths.edgesFile, 'edges: []\n', 'utf8');
  return { removedNodes, removedChats, removedOAuthTokens, keptEdgesFile: true };
}

// 指定ディレクトリ直下の *.yaml / *.yml を削除する。ディレクトリ自体は残す。
// 存在しなければ 0 を返す。
async function clearDir(dir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  let count = 0;
  for (const name of entries) {
    if (!name.endsWith('.yaml') && !name.endsWith('.yml')) continue;
    await fs.unlink(path.join(dir, name));
    count++;
  }
  return count;
}

// oauth/ 専用クリーナ。token YAML だけでなく `*.tmp.<pid>.<uuid>` 等の中間ファイル
// (oauth-store.ts の write 中断で残骸化しうる) も拡張子問わず削除する (CR Major)。
// 戻り値は token YAML の件数 (= ユーザーが意識する「削除された token 数」)。
async function clearOAuthDir(dir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  const tokenCount = entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml')).length;
  for (const name of entries) {
    await fs.unlink(path.join(dir, name));
  }
  return tokenCount;
}
