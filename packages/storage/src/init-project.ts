import { promises as fs } from 'node:fs';
import path from 'node:path';

import { newProjectId } from '@tally/core';

import { resolveProjectPaths } from './project-dir';
import { FileSystemProjectStore } from './project-store';

export interface InitProjectInput {
  // 初期化先のディレクトリ (絶対パス、既存)。ここに node/ chats/ 等を掘る。
  projectDir: string;
  name: string;
  description?: string;
}

export interface InitProjectResult {
  id: string;
  projectDir: string;
}

// UI / CLI から呼ぶプロジェクト初期化。projectDir 配下に node/, chats/ 一式を作る。
// 失敗条件: projectDir 非存在 / ディレクトリではない / 既に project.yaml がある。
export async function initProject(input: InitProjectInput): Promise<InitProjectResult> {
  const absProjectDir = path.resolve(input.projectDir);

  // 1. projectDir の存在・ディレクトリ確認
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(absProjectDir);
  } catch {
    throw new Error(`projectDir が存在しない: ${absProjectDir}`);
  }
  if (!stat.isDirectory()) {
    throw new Error(`projectDir がディレクトリではない: ${absProjectDir}`);
  }

  // 2. 既存 project.yaml 重複ガード
  const paths = resolveProjectPaths(absProjectDir);
  try {
    await fs.stat(paths.projectFile);
    throw new Error(`既に project.yaml が存在: ${paths.projectFile}`);
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
  const store = new FileSystemProjectStore(absProjectDir);
  await store.saveProjectMeta({
    id,
    name,
    codebases: [],
    ...(input.description ? { description: input.description } : {}),
    createdAt: now,
    updatedAt: now,
  });
  // edges.yaml は ProjectStore 経由で空配列を書く (listEdges が最初から読める)。
  await fs.writeFile(paths.edgesFile, 'edges: []\n', 'utf8');

  return { id, projectDir: absProjectDir };
}
