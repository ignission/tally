import { promises as fs } from 'node:fs';
import path from 'node:path';

import { newProjectId } from '@tally/core';

import { resolveTallyPaths } from './paths';
import { FileSystemProjectStore } from './project-store';

export interface InitProjectInput {
  // 初期化先のディレクトリ (絶対パス、既存)。ここに .tally/ を掘る。
  workspaceRoot: string;
  name: string;
  description?: string;
}

export interface InitProjectResult {
  id: string;
  workspaceRoot: string;
}

// UI / CLI から呼ぶプロジェクト初期化。workspaceRoot 配下に .tally/ 一式を作る。
// 失敗条件: workspaceRoot 非存在 / ディレクトリではない / 既に .tally/ がある。
export async function initProject(input: InitProjectInput): Promise<InitProjectResult> {
  const absWorkspaceRoot = path.resolve(input.workspaceRoot);

  // 1. workspaceRoot の存在・ディレクトリ確認
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absWorkspaceRoot);
  } catch {
    throw new Error(`workspaceRoot が存在しない: ${absWorkspaceRoot}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`workspaceRoot がディレクトリではない: ${absWorkspaceRoot}`);
  }

  // 2. 既存 .tally/ 重複ガード
  const paths = resolveTallyPaths(absWorkspaceRoot);
  try {
    await fs.stat(paths.root);
    throw new Error(`既に .tally/ が存在: ${paths.root}`);
  } catch (err) {
    // ENOENT 以外は投げる (権限エラー等)
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw err;
  }

  // 3. 名前バリデーション (空文字禁止)
  const name = input.name.trim();
  if (name.length === 0) {
    throw new Error('name が空');
  }

  // 4. ディレクトリ作成 + ファイル書き込み
  await fs.mkdir(paths.nodesDir, { recursive: true });
  await fs.mkdir(paths.edgesDir, { recursive: true });

  const id = newProjectId();
  const now = new Date().toISOString();
  const store = new FileSystemProjectStore(absWorkspaceRoot);
  await store.saveProjectMeta({
    id,
    name,
    ...(input.description ? { description: input.description } : {}),
    createdAt: now,
    updatedAt: now,
  });
  // edges.yaml は ProjectStore 経由で空配列を書く (listEdges が最初から読める)。
  await fs.writeFile(paths.edgesFile, 'edges: []\n', 'utf8');

  return { id, workspaceRoot: absWorkspaceRoot };
}
