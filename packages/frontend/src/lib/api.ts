import type { AdoptableType, Edge, EdgeType, Node, NodeType, ProjectMeta } from '@tally/core';

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

export interface WorkspaceCandidate {
  path: string;
  hasTally: boolean;
}

// GET /api/workspace-candidates: 新規プロジェクトダイアログの選択肢。
export async function fetchWorkspaceCandidates(): Promise<WorkspaceCandidate[]> {
  const res = await fetch('/api/workspace-candidates');
  if (!res.ok) throw new Error(`API GET /api/workspace-candidates ${res.status}`);
  const body = (await res.json()) as { candidates: WorkspaceCandidate[] };
  return body.candidates;
}

export interface CreateProjectInput {
  workspaceRoot: string;
  name: string;
  description?: string;
}

export interface CreateProjectResult {
  id: string;
  workspaceRoot: string;
}

// POST /api/projects: エラーメッセージをハンドルできるよう requestJson を使わず生 fetch。
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

export async function createProject(input: CreateProjectInput): Promise<CreateProjectResult> {
  const res = await fetch('/api/projects', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    workspaceRoot?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? `API POST /api/projects ${res.status}`);
  }
  if (!body.id || !body.workspaceRoot) {
    throw new Error(`API POST /api/projects: 不正なレスポンス`);
  }
  return { id: body.id, workspaceRoot: body.workspaceRoot };
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

// ProjectMeta の部分更新。
// codebasePath: null = 削除、string = 置換、undefined = 維持。
// additionalCodebasePaths: [] = 削除、配列 = 置換、undefined = 維持。
export function patchProjectMeta(
  projectId: string,
  patch: { codebasePath?: string | null; additionalCodebasePaths?: string[] },
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
