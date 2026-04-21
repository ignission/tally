import type { AdoptableType, Codebase, Edge, EdgeType, Node, NodeType, ProjectMeta } from '@tally/core';

export type NodeDraftInput = Omit<Node, 'id'>;
export type NodePatchInput<T extends NodeType = NodeType> = Partial<
  Omit<Extract<Node, { type: T }>, 'id' | 'type'>
>;
export type EdgeDraftInput = Omit<Edge, 'id'>;

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    throw new Error(`API ${init.method ?? 'GET'} ${url} ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function base(projectId: string): string {
  return `/api/projects/${encodeURIComponent(projectId)}`;
}

export interface CodebaseDto {
  id: string;
  label: string;
  path: string;
}

export interface RegistryProjectDto {
  id: string;
  name: string;
  description: string | null;
  codebases: CodebaseDto[];
  projectDir: string;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string;
}

// GET /api/projects: レジストリ登録済みプロジェクト一覧。
export async function fetchRegistryProjects(): Promise<RegistryProjectDto[]> {
  const res = await fetch('/api/projects');
  if (!res.ok) throw new Error(`API GET /api/projects ${res.status}`);
  const body = (await res.json()) as { projects: RegistryProjectDto[] };
  return body.projects;
}

export interface CreateProjectInput {
  projectDir: string;
  name: string;
  description?: string;
  codebases: CodebaseDto[];
}

// POST /api/projects/import: 既存 .tally ディレクトリからプロジェクトをインポート。
export async function importProject(projectDir: string): Promise<{ id: string; projectDir: string }> {
  const res = await fetch('/api/projects/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectDir }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/projects/import ${res.status}`);
  }
  return (await res.json()) as { id: string; projectDir: string };
}

// POST /api/projects/:id/unregister: レジストリからプロジェクトの登録解除 (ファイルは削除しない)。
export async function unregisterProjectApi(id: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(id)}/unregister`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`POST /unregister ${res.status}`);
}

export interface FsEntry {
  name: string;
  path: string;
  isHidden: boolean;
  hasProjectYaml: boolean;
}

export interface FsListResult {
  path: string;
  parent: string | null;
  entries: FsEntry[];
  containsProjectYaml: boolean;
}

// GET /api/fs/ls: ディレクトリ一覧取得。path 省略時はデフォルトパス。
export async function listDirectory(targetPath?: string): Promise<FsListResult> {
  const params = targetPath !== undefined ? `?path=${encodeURIComponent(targetPath)}` : '';
  const res = await fetch(`/api/fs/ls${params}`);
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `GET /api/fs/ls ${res.status}`);
  }
  return (await res.json()) as FsListResult;
}

// POST /api/fs/mkdir: ディレクトリ作成。
export async function mkdir(parentPath: string, name: string): Promise<{ path: string }> {
  const res = await fetch('/api/fs/mkdir', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path: parentPath, name }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/fs/mkdir ${res.status}`);
  }
  return (await res.json()) as { path: string };
}

// POST /api/projects/[id]/clear: プロジェクトのノード/エッジ/チャットを全削除。
export async function clearProjectBoard(projectId: string): Promise<void> {
  const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/clear`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`API POST /clear ${res.status}`);
}

// DELETE /api/projects/[id]/chats/[threadId]: チャットスレッド削除 (冪等)。
export async function deleteChatThread(projectId: string, threadId: string): Promise<void> {
  const res = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/chats/${encodeURIComponent(threadId)}`,
    { method: 'DELETE' },
  );
  if (!res.ok && res.status !== 404) {
    throw new Error(`API DELETE /chats/${threadId} ${res.status}`);
  }
}

export async function createProject(input: CreateProjectInput): Promise<{ id: string; projectDir: string }> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `POST /api/projects ${res.status}`);
  }
  return (await res.json()) as { id: string; projectDir: string };
}

export function createNode(projectId: string, draft: NodeDraftInput): Promise<Node> {
  return requestJson<Node>(`${base(projectId)}/nodes`, {
    method: 'POST',
    body: JSON.stringify(draft),
  });
}

// optional フィールドを UI で「未指定」に戻したとき、patch に undefined で入ってくる。
// JSON.stringify は undefined キーを落としてしまい、サーバ側で「未指定への変更」を
// 検出できない。そのため undefined は null に変換してサーバに送り、
// サーバ側で「そのキーを削除する」シグナルとして扱う (storage/project-store の updateNode 参照)。
function undefinedToNull(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v === undefined ? null : v;
  }
  return out;
}

export function updateNode<T extends NodeType = NodeType>(
  projectId: string,
  nodeId: string,
  patch: NodePatchInput<T>,
): Promise<Node> {
  return requestJson<Node>(`${base(projectId)}/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(undefinedToNull(patch as Record<string, unknown>)),
  });
}

export function deleteNode(projectId: string, nodeId: string): Promise<void> {
  return requestJson<void>(`${base(projectId)}/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'DELETE',
  });
}

export function createEdge(projectId: string, draft: EdgeDraftInput): Promise<Edge> {
  return requestJson<Edge>(`${base(projectId)}/edges`, {
    method: 'POST',
    body: JSON.stringify(draft),
  });
}

export function updateEdge(projectId: string, edgeId: string, type: EdgeType): Promise<Edge> {
  return requestJson<Edge>(`${base(projectId)}/edges/${encodeURIComponent(edgeId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ type }),
  });
}

export function deleteEdge(projectId: string, edgeId: string): Promise<void> {
  return requestJson<void>(`${base(projectId)}/edges/${encodeURIComponent(edgeId)}`, {
    method: 'DELETE',
  });
}

// ProjectMeta の部分更新。codebases は全置換（部分更新なし）。
export function patchProjectMeta(
  projectId: string,
  patch: { name?: string; description?: string | null; codebases?: Codebase[] },
): Promise<ProjectMeta> {
  return requestJson<ProjectMeta>(`${base(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function adoptProposal(
  projectId: string,
  nodeId: string,
  adoptAs: AdoptableType,
  additional?: Record<string, unknown>,
): Promise<Node> {
  return requestJson<Node>(`${base(projectId)}/nodes/${encodeURIComponent(nodeId)}/adopt`, {
    method: 'POST',
    body: JSON.stringify({ adoptAs, additional }),
  });
}

// GET /api/projects/default-path: プロジェクト名から保存先を提案。
export async function fetchDefaultProjectPath(name: string): Promise<string> {
  const res = await fetch(
    `/api/projects/default-path?name=${encodeURIComponent(name)}`,
  );
  if (!res.ok) {
    throw new Error(`GET /api/projects/default-path ${res.status}`);
  }
  const body = (await res.json()) as { path: string };
  return body.path;
}
