import type { Project, ProjectMeta } from '@tally/core';

import { resolveProjectPaths } from './project-dir';
import { FileSystemProjectStore } from './project-store';

export interface ProjectHandle {
  id: string;
  workspaceRoot: string;
  meta: ProjectMeta;
}

interface ResolveOptions {
  /** 明示指定があれば環境変数を使わず固定 workspace を使う (開発・テスト用)。 */
  tallyWorkspace?: string | undefined;
}

// TALLY_WORKSPACE 配下の .tally/project.yaml を読み込み、指定 id に一致するものを返す。
// 単一 workspace 前提 (MVP)。
export async function resolveProjectById(
  id: string,
  opts?: ResolveOptions,
): Promise<ProjectHandle | null> {
  const workspace = opts?.tallyWorkspace ?? process.env.TALLY_WORKSPACE;
  if (!workspace) return null;

  const store = new FileSystemProjectStore(workspace);
  const meta = await store.getProjectMeta();
  if (!meta || meta.id !== id) return null;

  return { id: meta.id, workspaceRoot: workspace, meta };
}

// workspace 配下の全プロジェクトを列挙する (単一 workspace 前提)。
export async function discoverProjects(opts?: ResolveOptions): Promise<ProjectHandle[]> {
  const workspace = opts?.tallyWorkspace ?? process.env.TALLY_WORKSPACE;
  if (!workspace) return [];

  const store = new FileSystemProjectStore(workspace);
  const meta = await store.getProjectMeta();
  if (!meta) return [];
  return [{ id: meta.id, workspaceRoot: workspace, meta }];
}

// project 全体 (nodes/edges 含む) を返す。
export async function loadProjectById(
  id: string,
  opts?: ResolveOptions,
): Promise<Project | null> {
  const handle = await resolveProjectById(id, opts);
  if (!handle) return null;

  const store = new FileSystemProjectStore(handle.workspaceRoot);
  const nodes = await store.listNodes();
  const edges = await store.listEdges();
  return {
    id: handle.meta.id,
    name: handle.meta.name,
    description: handle.meta.description,
    codebases: handle.meta.codebases,
    createdAt: handle.meta.createdAt,
    updatedAt: handle.meta.updatedAt,
    nodes,
    edges,
  };
}

export interface WorkspaceCandidate {
  path: string;
  hasTally: boolean;
}

// workspace に .tally/ が存在するか確認する候補一覧。
export async function listWorkspaceCandidates(
  opts?: ResolveOptions,
): Promise<WorkspaceCandidate[]> {
  const workspace = opts?.tallyWorkspace ?? process.env.TALLY_WORKSPACE;
  if (!workspace) return [];

  const paths = resolveProjectPaths(workspace);
  const { promises: fs } = await import('node:fs');
  let hasTally = false;
  try {
    await fs.access(paths.projectFile);
    hasTally = true;
  } catch {
    hasTally = false;
  }
  return [{ path: workspace, hasTally }];
}
