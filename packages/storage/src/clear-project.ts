import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveProjectPaths } from './project-dir';

export interface ClearProjectResult {
  removedNodes: number;
  removedChats: number;
  keptEdgesFile: boolean;
}

// プロジェクトの内容を初期化する。project.yaml は維持、nodes/*.yaml と chats/*.yaml を全削除、
// edges.yaml は空配列に書き戻す。呼び出し側 (UI/CLI) が確認ダイアログを出す前提。
export async function clearProject(projectDir: string): Promise<ClearProjectResult> {
  const paths = resolveProjectPaths(projectDir);
  const removedNodes = await clearDir(paths.nodesDir);
  const removedChats = await clearDir(paths.chatsDir);
  // edges.yaml を空配列で書き直す (無ければ作成)。
  await fs.mkdir(paths.edgesDir, { recursive: true });
  await fs.writeFile(paths.edgesFile, 'edges: []\n', 'utf8');
  return { removedNodes, removedChats, keptEdgesFile: true };
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
