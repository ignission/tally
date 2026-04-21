import { promises as fs } from 'node:fs';
import path from 'node:path';

import { newProjectId } from '@tally/core';
import type { Codebase } from '@tally/core';

import { FileSystemProjectStore } from './project-store';
import { registerProject } from './registry';
import { resolveProjectPaths } from './project-dir';

export interface InitProjectInput {
  projectDir: string;
  name: string;
  description?: string;
  codebases: Codebase[];
}

export interface InitProjectResult {
  id: string;
  projectDir: string;
}

export async function initProject(input: InitProjectInput): Promise<InitProjectResult> {
  const absDir = path.resolve(input.projectDir);

  const name = input.name.trim();
  if (name.length === 0) throw new Error('name が空');

  // 親ディレクトリが存在するか
  const parent = path.dirname(absDir);
  try {
    const st = await fs.stat(parent);
    if (!st.isDirectory()) throw new Error(`親ディレクトリがディレクトリではない: ${parent}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new Error(`親ディレクトリが存在しない: ${parent}`);
    throw err;
  }

  // projectDir 自身の状態判定
  let exists = false;
  try {
    const st = await fs.stat(absDir);
    if (!st.isDirectory()) throw new Error(`projectDir がディレクトリではない: ${absDir}`);
    exists = true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (exists) {
    const entries = await fs.readdir(absDir);
    if (entries.includes('project.yaml')) {
      throw new Error(`既存の project.yaml が存在: ${absDir}`);
    }
    if (entries.length > 0) {
      throw new Error(`ディレクトリが空ではありません: ${absDir}`);
    }
  } else {
    await fs.mkdir(absDir);
  }

  const paths = resolveProjectPaths(absDir);
  await fs.mkdir(paths.nodesDir, { recursive: true });
  await fs.mkdir(paths.edgesDir, { recursive: true });
  await fs.writeFile(paths.edgesFile, 'edges: []\n', 'utf8');

  const id = newProjectId();
  const now = new Date().toISOString();
  const store = new FileSystemProjectStore(absDir);
  await store.saveProjectMeta({
    id,
    name,
    ...(input.description ? { description: input.description } : {}),
    codebases: input.codebases,
    createdAt: now,
    updatedAt: now,
  });

  await registerProject({ id, path: absDir });

  return { id, projectDir: absDir };
}
