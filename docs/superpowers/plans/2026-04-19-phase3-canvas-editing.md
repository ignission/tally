# Phase 3: キャンバス編集機能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 の読み取り専用キャンバスに、ノード・エッジの作成/編集/削除と YAML 永続化を追加し、`docs/04-roadmap.md` Phase 3 の完了条件をすべて満たす。

**Architecture:**
- Next.js Route Handlers で CRUD API（`/api/projects/[id]/{nodes,edges}`）を追加。すべて `FileSystemProjectStore` 経由で `.tally/` に反映。
- Zustand ストアを可変状態（`nodes` / `edges` マップ＋`selected`）に拡張。編集系アクションは楽観的更新＋失敗ロールバック、追加系は非楽観（POST 応答で反映）。
- 左に `NodePalette`、中央に編集可能 `Canvas`、右に `DetailSheet` という 3 カラム構成。削除は `ConfirmDialog`。

**Tech Stack:** Next.js 15 (App Router) / React 19 / `@xyflow/react` 12 / Zustand 5 / Vitest / 既存 `@tally/core` + `@tally/storage`。

**Out of scope（Phase 6 以降）:** マルチタブのリアルタイム同期（各タブ独立動作のみ）／Undo-Redo／モバイル最適化。

---

## Ground rules

- 各タスク完了時に `pnpm --filter frontend typecheck` と関連テストが通ること。
- 新規ファイルは **kebab-case**。import 順は 外部→`@tally/*`→`@/…`→相対、各ブロック間に空行。
- コメントは意図（why）を日本語で簡潔に。自明な what は書かない。
- コミットは Conventional Commits（scope = `frontend` が基本、API スキーマだけ触るときは `core`）。
- UI はまだ整形重視せず、黒背景 + GitHub ダーク系配色で既存キャンバスと統一。

---

## File Structure

### 新規作成

| Path | Responsibility |
|---|---|
| `packages/frontend/src/lib/api.ts` | `fetch` ラッパ。`createNode` / `updateNode` / `deleteNode` / `createEdge` / `updateEdge` / `deleteEdge` を export。プロジェクト ID を引数で受け取る。 |
| `packages/frontend/src/lib/api.test.ts` | `fetch` をモックして各関数の URL・メソッド・ボディを検証。 |
| `packages/frontend/src/lib/store.test.ts` | Zustand 新アクションの挙動（楽観更新・ロールバック・エッジ連鎖削除）を検証。 |
| `packages/frontend/src/app/api/projects/[id]/nodes/route.ts` | `POST` = 新規ノード作成。`NodeSchema` から `id` を抜いたドラフトを検証し `FileSystemProjectStore.addNode` を呼ぶ。 |
| `packages/frontend/src/app/api/projects/[id]/nodes/[nodeId]/route.ts` | `PATCH` = 部分更新。`DELETE` = ノードと付随エッジ削除。 |
| `packages/frontend/src/app/api/projects/[id]/edges/route.ts` | `POST` = 新規エッジ作成。`from`/`to` の存在を store 側で検証。 |
| `packages/frontend/src/app/api/projects/[id]/edges/[edgeId]/route.ts` | `PATCH` = `type` だけ差し替え（`from`/`to` 変更は不可）。`DELETE` = エッジ削除。 |
| `packages/frontend/src/app/api/projects/[id]/nodes/nodes-route.test.ts` | tmpdir をワークスペースに据えてルートハンドラを直接呼ぶ。 |
| `packages/frontend/src/app/api/projects/[id]/edges/edges-route.test.ts` | 同上。 |
| `packages/frontend/src/components/palette/node-palette.tsx` | 左サイドバー。7 種のボタン。クリックでビューポート中央に新規ノード作成。 |
| `packages/frontend/src/components/details/detail-sheet.tsx` | 右サイドバーの枠。選択対象（ノード / エッジ / なし）で中身を切替。 |
| `packages/frontend/src/components/details/common-fields.tsx` | ノード共通の title / body 入力。onBlur で楽観更新。 |
| `packages/frontend/src/components/details/requirement-detail.tsx` | kind / priority / qualityCategory。 |
| `packages/frontend/src/components/details/userstory-detail.tsx` | AC / tasks / points。 |
| `packages/frontend/src/components/details/question-detail.tsx` | options 追加・削除・決定。 |
| `packages/frontend/src/components/details/coderef-detail.tsx` | filePath / startLine / endLine。 |
| `packages/frontend/src/components/details/edge-detail.tsx` | edge type セレクタ。 |
| `packages/frontend/src/components/dialog/confirm-dialog.tsx` | 削除確認モーダル。Esc/背景クリックで閉じる。 |

### 修正

| Path | What changes |
|---|---|
| `packages/frontend/src/lib/store.ts` | **全面書き換え**。`nodes: Record<id, Node>` / `edges: Record<id, Edge>` / `selected: {kind:'node'\|'edge', id} \| null` / `projectId`。編集アクション群を追加。 |
| `packages/frontend/src/components/canvas/canvas.tsx` | `nodesDraggable` を有効化、`onNodeDragStop` / `onConnect` / `onSelectionChange` を配線。`nodes`/`edges` はストア直参照に変更。 |
| `packages/frontend/src/app/projects/[id]/canvas-client.tsx` | 3 カラムレイアウトに拡張。`NodePalette` / `Canvas` / `DetailSheet` を配置。`projectId` をストアに初期設定。 |

---

## Task 1: API クライアント `lib/api.ts`

**Files:**
- Create: `packages/frontend/src/lib/api.ts`
- Create: `packages/frontend/src/lib/api.test.ts`

- [ ] **Step 1: 失敗テストを書く**

```ts
// packages/frontend/src/lib/api.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createEdge,
  createNode,
  deleteEdge,
  deleteNode,
  updateEdge,
  updateNode,
} from './api';

const PID = 'proj-abc';

describe('lib/api', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function okJson<T>(body: T) {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('createNode は POST /api/projects/:id/nodes', async () => {
    const created = {
      id: 'req-xxxxx',
      type: 'requirement',
      x: 10,
      y: 20,
      title: 't',
      body: 'b',
    };
    okJson(created);
    const result = await createNode(PID, { type: 'requirement', x: 10, y: 20, title: 't', body: 'b' });
    expect(result).toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/nodes`);
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'requirement',
      x: 10,
      y: 20,
      title: 't',
      body: 'b',
    });
  });

  it('updateNode は PATCH /api/projects/:id/nodes/:nid', async () => {
    okJson({ ok: true });
    await updateNode(PID, 'req-xxxxx', { title: 'new' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/nodes/req-xxxxx`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'new' });
  });

  it('deleteNode は DELETE /api/projects/:id/nodes/:nid', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteNode(PID, 'req-xxxxx');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/nodes/req-xxxxx`);
    expect(init.method).toBe('DELETE');
  });

  it('createEdge は POST /api/projects/:id/edges', async () => {
    const created = { id: 'e-xxxxx', from: 'req-a', to: 'uc-b', type: 'satisfy' };
    okJson(created);
    const result = await createEdge(PID, { from: 'req-a', to: 'uc-b', type: 'satisfy' });
    expect(result).toEqual(created);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/edges`);
    expect(init.method).toBe('POST');
  });

  it('updateEdge は PATCH /api/projects/:id/edges/:eid (type のみ)', async () => {
    okJson({ ok: true });
    await updateEdge(PID, 'e-xxxxx', 'refine');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/edges/e-xxxxx`);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({ type: 'refine' });
  });

  it('deleteEdge は DELETE /api/projects/:id/edges/:eid', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await deleteEdge(PID, 'e-xxxxx');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/projects/${PID}/edges/e-xxxxx`);
    expect(init.method).toBe('DELETE');
  });

  it('4xx はエラーとして throw する', async () => {
    fetchMock.mockResolvedValueOnce(new Response('bad', { status: 400 }));
    await expect(updateNode(PID, 'req-xxxxx', { title: 'x' })).rejects.toThrow(/400/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter frontend test -- lib/api.test.ts`
Expected: FAIL（`api.ts` 未作成）

- [ ] **Step 3: 最小実装**

```ts
// packages/frontend/src/lib/api.ts
import type { Edge, EdgeType, Node, NodeType } from '@tally/core';

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

export function createNode(projectId: string, draft: NodeDraftInput): Promise<Node> {
  return requestJson<Node>(`${base(projectId)}/nodes`, {
    method: 'POST',
    body: JSON.stringify(draft),
  });
}

export function updateNode(
  projectId: string,
  nodeId: string,
  patch: NodePatchInput,
): Promise<Node> {
  return requestJson<Node>(`${base(projectId)}/nodes/${encodeURIComponent(nodeId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
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
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter frontend test -- lib/api.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/api.ts packages/frontend/src/lib/api.test.ts
git commit -m "feat(frontend): CRUD API 向け fetch ラッパ lib/api.ts を追加"
```

---

## Task 2: Nodes POST ルートハンドラ

**Files:**
- Create: `packages/frontend/src/app/api/projects/[id]/nodes/route.ts`
- Create: `packages/frontend/src/app/api/projects/[id]/nodes/nodes-route.test.ts`

- [ ] **Step 1: テストのヘルパを追加し失敗テストを書く**

`tmpdir` にワークスペースを作り、`project.yaml` を置いた状態でルートを直接呼ぶ。`FileSystemProjectStore` は `.tally/` 配下を期待するので `resolveProjectById` を経由させるため `TALLY_WORKSPACE` 相当の経路をテストでも使う。すでに `project-resolver.ts` は `discoverProjects({ tallyWorkspace })` に対応しているが、ルートハンドラからはその引数を渡せないので `process.env.TALLY_WORKSPACE` を test 内で差し替える。

```ts
// packages/frontend/src/app/api/projects/[id]/nodes/nodes-route.test.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from './route';

describe('POST /api/projects/[id]/nodes', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('新規ノードを作成し、YAML に反映する', async () => {
    const body = { type: 'requirement', x: 100, y: 200, title: 'T', body: 'B' };
    const req = new Request('http://localhost/api/projects/proj-test/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.type).toBe('requirement');
    expect(created.id).toMatch(/^req-/);

    const store = new FileSystemProjectStore(root);
    const persisted = await store.getNode(created.id);
    expect(persisted).toEqual(created);
  });

  it('不正なボディは 400', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'requirement' }), // 必須欠如
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(400);
  });

  it('未知のプロジェクトは 404', async () => {
    const req = new Request('http://localhost/api/projects/nope/nodes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'requirement', x: 0, y: 0, title: 't', body: '' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `pnpm --filter frontend test -- nodes-route.test.ts`
Expected: FAIL（ルート未作成）

- [ ] **Step 3: ルートハンドラを実装**

```ts
// packages/frontend/src/app/api/projects/[id]/nodes/route.ts
import { NodeSchema } from '@tally/core';
import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string }>;
}

// Node ドラフトのスキーマ: NodeSchema から id を外したもの。
// discriminatedUnion の各メンバーで omit するため、ボディ検証は parse した上で
// id のみ付与する形で store 側に任せる。
export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }
  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  // addNode は内部で NodeSchema.parse する。ここでは id を意図的に含めないことだけ保証。
  const draft = { ...(raw as Record<string, unknown>) };
  delete (draft as Record<string, unknown>).id;
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  try {
    const created = await store.addNode(draft as Parameters<typeof store.addNode>[0]);
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter frontend test -- nodes-route.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/app/api/projects/\[id\]/nodes/
git commit -m "feat(frontend): POST /api/projects/:id/nodes を追加"
```

---

## Task 3: Node PATCH / DELETE ルート

**Files:**
- Create: `packages/frontend/src/app/api/projects/[id]/nodes/[nodeId]/route.ts`
- Modify: `packages/frontend/src/app/api/projects/[id]/nodes/nodes-route.test.ts`（PATCH/DELETE テストを追記）

- [ ] **Step 1: 失敗テストを追記**

`nodes-route.test.ts` の末尾に `describe` を追加：

```ts
// （ファイル末尾に追記、import 追加不要。PATCH/DELETE も同じルートから import する）
import { DELETE as deleteHandler, PATCH } from './[nodeId]/route';

describe('PATCH /api/projects/[id]/nodes/[nodeId]', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'orig', body: '' });
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('title の部分更新が反映される', async () => {
    const store = new FileSystemProjectStore(root);
    const [node] = await store.listNodes();
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${node.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'updated' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: node.id }),
    });
    expect(res.status).toBe(200);
    const updated = await res.json();
    expect(updated.title).toBe('updated');
    const persisted = await store.getNode(node.id);
    expect(persisted?.title).toBe('updated');
  });

  it('type 変更は拒否する (400)', async () => {
    const store = new FileSystemProjectStore(root);
    const [node] = await store.listNodes();
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${node.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'usecase' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: node.id }),
    });
    expect(res.status).toBe(400);
  });

  it('存在しない id は 404', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/nodes/unknown', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: 'unknown' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/projects/[id]/nodes/[nodeId]', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('ノードと付随エッジを削除する', async () => {
    const store = new FileSystemProjectStore(root);
    const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'a', body: '' });
    const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'b', body: '' });
    await store.addEdge({ from: a.id, to: b.id, type: 'satisfy' });
    const req = new Request(`http://localhost/api/projects/proj-test/nodes/${a.id}`, {
      method: 'DELETE',
    });
    const res = await deleteHandler(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: a.id }),
    });
    expect(res.status).toBe(204);
    expect(await store.getNode(a.id)).toBeNull();
    expect(await store.listEdges()).toEqual([]);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter frontend test -- nodes-route.test.ts`
Expected: FAIL（`[nodeId]/route.ts` 未作成）

- [ ] **Step 3: ルートハンドラ実装**

```ts
// packages/frontend/src/app/api/projects/[id]/nodes/[nodeId]/route.ts
import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string; nodeId: string }>;
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, nodeId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  // type 変更は UX 上想定していない。保存時に discriminatedUnion の整合が崩れる恐れがあるため拒否。
  if ('type' in (raw as Record<string, unknown>)) {
    return NextResponse.json({ error: 'type is immutable' }, { status: 400 });
  }
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  const exists = await store.getNode(nodeId);
  if (!exists) return NextResponse.json({ error: 'node not found' }, { status: 404 });
  try {
    const updated = await store.updateNode(nodeId, raw as Record<string, unknown>);
    return NextResponse.json(updated);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}

export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, nodeId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  await store.deleteNode(nodeId);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter frontend test -- nodes-route.test.ts`
Expected: PASS（3 describe すべて）

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/app/api/projects/\[id\]/nodes/\[nodeId\]/ packages/frontend/src/app/api/projects/\[id\]/nodes/nodes-route.test.ts
git commit -m "feat(frontend): PATCH/DELETE /api/projects/:id/nodes/:nid を追加"
```

---

## Task 4: Edges POST ルート

**Files:**
- Create: `packages/frontend/src/app/api/projects/[id]/edges/route.ts`
- Create: `packages/frontend/src/app/api/projects/[id]/edges/edges-route.test.ts`

- [ ] **Step 1: 失敗テストを書く**

```ts
// packages/frontend/src/app/api/projects/[id]/edges/edges-route.test.ts
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from './route';

describe('POST /api/projects/[id]/edges', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;
  let aId: string;
  let bId: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'a', body: '' });
    const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'b', body: '' });
    aId = a.id;
    bId = b.id;
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('新規エッジを作成し、YAML に反映する', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/edges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: aId, to: bId, type: 'satisfy' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(201);
    const created = await res.json();
    expect(created.id).toMatch(/^e-/);
    expect(created.from).toBe(aId);
    expect(created.to).toBe(bId);

    const store = new FileSystemProjectStore(root);
    const edges = await store.listEdges();
    expect(edges).toHaveLength(1);
  });

  it('存在しないノード参照は 400', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/edges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: aId, to: 'unknown', type: 'satisfy' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(400);
  });

  it('不正な type は 400', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/edges', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: aId, to: bId, type: 'bogus' }),
    });
    const res = await POST(req, { params: Promise.resolve({ id: 'proj-test' }) });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter frontend test -- edges-route.test.ts`
Expected: FAIL

- [ ] **Step 3: ルート実装**

```ts
// packages/frontend/src/app/api/projects/[id]/edges/route.ts
import { EDGE_TYPES } from '@tally/core';
import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { from, to, type } = raw as Record<string, unknown>;
  if (typeof from !== 'string' || typeof to !== 'string' || typeof type !== 'string') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  if (!(EDGE_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json({ error: 'invalid edge type' }, { status: 400 });
  }
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  // 参照整合性を守るため、両端ノードの実在を確認してから追加する。
  const [src, dst] = await Promise.all([store.getNode(from), store.getNode(to)]);
  if (!src || !dst) {
    return NextResponse.json({ error: 'endpoint node not found' }, { status: 400 });
  }
  const created = await store.addEdge({ from, to, type: type as (typeof EDGE_TYPES)[number] });
  return NextResponse.json(created, { status: 201 });
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter frontend test -- edges-route.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/app/api/projects/\[id\]/edges/
git commit -m "feat(frontend): POST /api/projects/:id/edges を追加"
```

---

## Task 5: Edge PATCH / DELETE ルート

**Files:**
- Create: `packages/frontend/src/app/api/projects/[id]/edges/[edgeId]/route.ts`
- Modify: `packages/frontend/src/app/api/projects/[id]/edges/edges-route.test.ts`

- [ ] **Step 1: 失敗テストを追記**

ファイル末尾に追記：

```ts
import { DELETE as deleteHandler, PATCH } from './[edgeId]/route';

describe('PATCH /api/projects/[id]/edges/[edgeId]', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;
  let edgeId: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-test',
      name: 'Test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    const a = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'a', body: '' });
    const b = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'b', body: '' });
    const e = await store.addEdge({ from: a.id, to: b.id, type: 'satisfy' });
    edgeId = e.id;
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prevEnv;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('type の変更が反映される', async () => {
    const req = new Request(`http://localhost/api/projects/proj-test/edges/${edgeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'refine' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', edgeId }),
    });
    expect(res.status).toBe(200);
    const store = new FileSystemProjectStore(root);
    const [edge] = await store.listEdges();
    expect(edge.type).toBe('refine');
  });

  it('from/to の変更は拒否する (400)', async () => {
    const req = new Request(`http://localhost/api/projects/proj-test/edges/${edgeId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'x' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', edgeId }),
    });
    expect(res.status).toBe(400);
  });

  it('存在しない id は 404', async () => {
    const req = new Request('http://localhost/api/projects/proj-test/edges/none', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'refine' }),
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: 'proj-test', edgeId: 'none' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE でエッジのみ削除する', async () => {
    const req = new Request(`http://localhost/api/projects/proj-test/edges/${edgeId}`, {
      method: 'DELETE',
    });
    const res = await deleteHandler(req, {
      params: Promise.resolve({ id: 'proj-test', edgeId }),
    });
    expect(res.status).toBe(204);
    const store = new FileSystemProjectStore(root);
    expect(await store.listEdges()).toEqual([]);
    // ノードは残る
    const nodes = await store.listNodes();
    expect(nodes).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter frontend test -- edges-route.test.ts`
Expected: FAIL

- [ ] **Step 3: ルート実装**

```ts
// packages/frontend/src/app/api/projects/[id]/edges/[edgeId]/route.ts
import { EDGE_TYPES } from '@tally/core';
import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string; edgeId: string }>;
}

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, edgeId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const body = raw as Record<string, unknown>;
  // 現状のエッジ編集 UX は type 変更のみ許容する (接続の付け替えは UI で「削除→再作成」で行う)。
  if ('from' in body || 'to' in body) {
    return NextResponse.json({ error: 'endpoints are immutable' }, { status: 400 });
  }
  if (typeof body.type !== 'string' || !(EDGE_TYPES as readonly string[]).includes(body.type)) {
    return NextResponse.json({ error: 'invalid type' }, { status: 400 });
  }
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  const existing = (await store.listEdges()).find((e) => e.id === edgeId);
  if (!existing) return NextResponse.json({ error: 'edge not found' }, { status: 404 });
  await store.deleteEdge(edgeId);
  const recreated = await store.addEdge({
    from: existing.from,
    to: existing.to,
    type: body.type as (typeof EDGE_TYPES)[number],
  });
  // ID は変わるが現状の UI はエッジ ID を直接保持しないため許容。
  // 保持したい場合は storage 側に updateEdge を追加する。
  return NextResponse.json(recreated);
}

export async function DELETE(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, edgeId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  await store.deleteEdge(edgeId);
  return new NextResponse(null, { status: 204 });
}
```

- [ ] **Step 4: テストを通す**

Run: `pnpm --filter frontend test -- edges-route.test.ts`
Expected: PASS

- [ ] **Step 5: Edge ID 変動に備えてクライアント側の想定を更新**

（実装メモ）Edge PATCH は内部的に delete→add で ID が変わる。Task 7 以降のストア設計ではエッジ ID を key とする Record を使うので、PATCH レスポンスで旧 ID を新 ID に差し替える実装が必要。このメモは Task 6 で消化する。

- [ ] **Step 6: コミット**

```bash
git add packages/frontend/src/app/api/projects/\[id\]/edges/
git commit -m "feat(frontend): PATCH/DELETE /api/projects/:id/edges/:eid を追加"
```

---

## Task 6: Zustand ストア全面書き換え

**Files:**
- Modify: `packages/frontend/src/lib/store.ts`
- Create: `packages/frontend/src/lib/store.test.ts`

Phase 2 の `setProject` だけの素朴な store から、以下を持つ可変ストアへ移行する：

- `projectId: string | null` — API 呼び出し先
- `projectMeta` — 旧 `currentProject` から `nodes`/`edges` を抜いた部分（一覧ヘッダ用）
- `nodes: Record<string, Node>` / `edges: Record<string, Edge>`
- `selected: { kind: 'node' | 'edge'; id: string } | null`
- Actions: `hydrate(project, projectId)` / `select(target)` / `moveNode(id, x, y)` / `patchNode(id, patch)` / `addNodeFromPalette(type, x, y)` / `removeNode(id)` / `connectEdge(from, to, type)` / `changeEdgeType(id, type)` / `removeEdge(id)`

楽観的更新の方針：
- 位置・編集・削除系は即時反映 → API 呼び出し → 失敗時に以前の値で復元。
- 追加系（`addNodeFromPalette` / `connectEdge`）は API 応答を待って反映（ID を服務員より受領）。

- [ ] **Step 1: 失敗テストを書く（store 単体テスト）**

`fetch` をモックして楽観更新／ロールバックを検証する。

```ts
// packages/frontend/src/lib/store.test.ts
import type { Edge, Project, RequirementNode } from '@tally/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from './store';

function baseProject(): Project {
  const now = new Date().toISOString();
  const n1: RequirementNode = {
    id: 'req-a',
    type: 'requirement',
    x: 0,
    y: 0,
    title: 'A',
    body: '',
  };
  return {
    id: 'proj-1',
    name: 'P',
    createdAt: now,
    updatedAt: now,
    nodes: [n1],
    edges: [],
  };
}

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  useCanvasStore.getState().hydrate(baseProject());
});
afterEach(() => {
  vi.restoreAllMocks();
});

function okJson<T>(body: T, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('useCanvasStore', () => {
  it('hydrate はノード/エッジを Record に展開する', () => {
    const state = useCanvasStore.getState();
    expect(state.projectId).toBe('proj-1');
    expect(Object.keys(state.nodes)).toEqual(['req-a']);
  });

  it('moveNode は楽観更新 + PATCH', async () => {
    okJson({ id: 'req-a', type: 'requirement', x: 10, y: 20, title: 'A', body: '' });
    await useCanvasStore.getState().moveNode('req-a', 10, 20);
    expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 10, y: 20 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'PATCH' });
  });

  it('moveNode 失敗時は元の座標に戻る', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
    await expect(useCanvasStore.getState().moveNode('req-a', 99, 99)).rejects.toThrow();
    expect(useCanvasStore.getState().nodes['req-a']).toMatchObject({ x: 0, y: 0 });
  });

  it('removeNode は楽観削除 + 付随エッジも消す、失敗で復元', async () => {
    // セットアップ: エッジを1本入れる
    const e: Edge = { id: 'e-1', from: 'req-a', to: 'req-a', type: 'trace' };
    useCanvasStore.setState({ edges: { 'e-1': e } });
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
    await expect(useCanvasStore.getState().removeNode('req-a')).rejects.toThrow();
    expect(useCanvasStore.getState().nodes['req-a']).toBeDefined();
    expect(useCanvasStore.getState().edges['e-1']).toEqual(e);
  });

  it('addNodeFromPalette は POST 応答を待って追加', async () => {
    const created = {
      id: 'req-new',
      type: 'requirement',
      x: 100,
      y: 100,
      title: '',
      body: '',
    };
    okJson(created, 201);
    const result = await useCanvasStore.getState().addNodeFromPalette('requirement', 100, 100);
    expect(result.id).toBe('req-new');
    expect(useCanvasStore.getState().nodes['req-new']).toMatchObject(created);
  });

  it('connectEdge は 500 で何も増やさない', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 500 }));
    await expect(
      useCanvasStore.getState().connectEdge('req-a', 'req-a', 'trace'),
    ).rejects.toThrow();
    expect(useCanvasStore.getState().edges).toEqual({});
  });

  it('changeEdgeType は旧 ID を破棄して新 ID で置き換える', async () => {
    const e: Edge = { id: 'e-1', from: 'req-a', to: 'req-a', type: 'trace' };
    useCanvasStore.setState({ edges: { 'e-1': e } });
    okJson({ id: 'e-2', from: 'req-a', to: 'req-a', type: 'refine' });
    await useCanvasStore.getState().changeEdgeType('e-1', 'refine');
    expect(useCanvasStore.getState().edges['e-1']).toBeUndefined();
    expect(useCanvasStore.getState().edges['e-2']).toMatchObject({ type: 'refine' });
  });
});
```

- [ ] **Step 2: 失敗を確認**

Run: `pnpm --filter frontend test -- lib/store.test.ts`
Expected: FAIL

- [ ] **Step 3: store.ts 全面書き換え**

```ts
// packages/frontend/src/lib/store.ts
'use client';

import type { Edge, EdgeType, Node, NodeType, Project, ProjectMeta } from '@tally/core';
import { create } from 'zustand';

import {
  createEdge,
  createNode,
  deleteEdge as deleteEdgeApi,
  deleteNode as deleteNodeApi,
  updateEdge as updateEdgeApi,
  updateNode as updateNodeApi,
} from './api';

export type Selected =
  | { kind: 'node'; id: string }
  | { kind: 'edge'; id: string }
  | null;

interface CanvasState {
  projectId: string | null;
  projectMeta: ProjectMeta | null;
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
  selected: Selected;

  hydrate: (project: Project) => void;
  reset: () => void;
  select: (target: Selected) => void;

  moveNode: (id: string, x: number, y: number) => Promise<void>;
  patchNode: <T extends NodeType>(
    id: string,
    patch: Partial<Omit<Extract<Node, { type: T }>, 'id' | 'type'>>,
  ) => Promise<void>;
  addNodeFromPalette: (type: NodeType, x: number, y: number) => Promise<Node>;
  removeNode: (id: string) => Promise<void>;

  connectEdge: (from: string, to: string, type: EdgeType) => Promise<Edge>;
  changeEdgeType: (id: string, type: EdgeType) => Promise<void>;
  removeEdge: (id: string) => Promise<void>;
}

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.id] = item;
  return out;
}

// Phase 3: 可変ストア。楽観的更新 + 失敗時ロールバックで YAML と同期する。
export const useCanvasStore = create<CanvasState>((set, get) => ({
  projectId: null,
  projectMeta: null,
  nodes: {},
  edges: {},
  selected: null,

  hydrate: (project) => {
    const { nodes, edges, ...meta } = project;
    set({
      projectId: project.id,
      projectMeta: meta,
      nodes: byId(nodes),
      edges: byId(edges),
      selected: null,
    });
  },

  reset: () => set({ projectId: null, projectMeta: null, nodes: {}, edges: {}, selected: null }),

  select: (target) => set({ selected: target }),

  moveNode: async (id, x, y) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    const prev = get().nodes[id];
    if (!prev) throw new Error(`unknown node: ${id}`);
    set({ nodes: { ...get().nodes, [id]: { ...prev, x, y } } });
    try {
      await updateNodeApi(pid, id, { x, y });
    } catch (err) {
      set({ nodes: { ...get().nodes, [id]: prev } });
      throw err;
    }
  },

  patchNode: async (id, patch) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    const prev = get().nodes[id];
    if (!prev) throw new Error(`unknown node: ${id}`);
    set({ nodes: { ...get().nodes, [id]: { ...prev, ...patch } as Node } });
    try {
      const updated = await updateNodeApi(pid, id, patch);
      set({ nodes: { ...get().nodes, [id]: updated } });
    } catch (err) {
      set({ nodes: { ...get().nodes, [id]: prev } });
      throw err;
    }
  },

  addNodeFromPalette: async (type, x, y) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    // タイトル・ボディは空で作り、詳細シートから編集させる。
    const created = await createNode(pid, { type, x, y, title: '', body: '' } as Omit<Node, 'id'>);
    set({ nodes: { ...get().nodes, [created.id]: created } });
    return created;
  },

  removeNode: async (id) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    const prevNode = get().nodes[id];
    if (!prevNode) return;
    // 付随エッジも同時に消す (サーバ側の deleteNode も参照整合性で消す)。
    const prevEdges = get().edges;
    const remainingEdges: Record<string, Edge> = {};
    const removedEdges: Record<string, Edge> = {};
    for (const [eid, e] of Object.entries(prevEdges)) {
      if (e.from === id || e.to === id) removedEdges[eid] = e;
      else remainingEdges[eid] = e;
    }
    const remainingNodes = { ...get().nodes };
    delete remainingNodes[id];
    set({ nodes: remainingNodes, edges: remainingEdges, selected: null });
    try {
      await deleteNodeApi(pid, id);
    } catch (err) {
      // ロールバック: ノードもエッジも戻す。
      set({
        nodes: { ...get().nodes, [id]: prevNode },
        edges: { ...get().edges, ...removedEdges },
      });
      throw err;
    }
  },

  connectEdge: async (from, to, type) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    const created = await createEdge(pid, { from, to, type });
    set({ edges: { ...get().edges, [created.id]: created } });
    return created;
  },

  changeEdgeType: async (id, type) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    const prev = get().edges[id];
    if (!prev) throw new Error(`unknown edge: ${id}`);
    // 楽観更新は ID 置換が絡むため、いったんフラグ更新のみ。エラー時は復元する。
    set({ edges: { ...get().edges, [id]: { ...prev, type } } });
    try {
      const updated = await updateEdgeApi(pid, id, type);
      const edges = { ...get().edges };
      delete edges[id];
      edges[updated.id] = updated;
      // 選択中エッジだった場合は ID を追従させる。
      const sel = get().selected;
      const nextSelected: Selected =
        sel && sel.kind === 'edge' && sel.id === id ? { kind: 'edge', id: updated.id } : sel;
      set({ edges, selected: nextSelected });
    } catch (err) {
      set({ edges: { ...get().edges, [id]: prev } });
      throw err;
    }
  },

  removeEdge: async (id) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    const prev = get().edges[id];
    if (!prev) return;
    const edges = { ...get().edges };
    delete edges[id];
    set({ edges, selected: get().selected?.id === id ? null : get().selected });
    try {
      await deleteEdgeApi(pid, id);
    } catch (err) {
      set({ edges: { ...get().edges, [id]: prev } });
      throw err;
    }
  },
}));
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm --filter frontend test -- lib/store.test.ts`
Expected: PASS（7 件）

- [ ] **Step 5: 旧 `setProject` 参照を一掃**

Run: `pnpm --filter frontend typecheck`
Expected: FAIL（Canvas.tsx が旧 API を使う）。Canvas 側は Task 7 で置き換えるので、ここでは typecheck のエラーを許容し、`// TODO(phase3): Canvas を新ストアに移行する` コメントを一時的に入れるか、またはこの Step をスキップして Task 7 内で typecheck を通す。どちらでも OK だが後者推奨。

- [ ] **Step 6: コミット**

```bash
git add packages/frontend/src/lib/store.ts packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): Canvas ストアを可変状態へ拡張 (楽観更新+ロールバック)"
```

---

## Task 7: Canvas をストア直参照＆ドラッグ対応に切替

**Files:**
- Modify: `packages/frontend/src/components/canvas/canvas.tsx`
- Modify: `packages/frontend/src/app/projects/[id]/canvas-client.tsx`

- [ ] **Step 1: Canvas を新ストアで読むよう書き換え**

```tsx
// packages/frontend/src/components/canvas/canvas.tsx
'use client';

import { useMemo } from 'react';

import {
  Background,
  Controls,
  MiniMap,
  type Edge as RFEdge,
  type Node as RFNode,
  type NodeChange,
  type OnConnect,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
} from '@xyflow/react';

import '@xyflow/react/dist/style.css';

import { useCanvasStore } from '@/lib/store';

import { edgeTypes } from '../edges/typed-edge';
import { nodeTypes } from '../nodes';

// Phase 3: ドラッグで位置変更、ハンドルドラッグで接続、選択でストア同期。
export function Canvas() {
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);
  const moveNode = useCanvasStore((s) => s.moveNode);
  const connectEdge = useCanvasStore((s) => s.connectEdge);
  const select = useCanvasStore((s) => s.select);

  const rfNodes = useMemo<RFNode[]>(
    () =>
      Object.values(nodes).map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: node.x, y: node.y },
        data: { node },
        draggable: true,
        selectable: true,
      })),
    [nodes],
  );

  const rfEdges = useMemo<RFEdge[]>(
    () =>
      Object.values(edges).map((edge) => ({
        id: edge.id,
        source: edge.from,
        target: edge.to,
        type: 'typed',
        data: { edgeType: edge.type },
      })),
    [edges],
  );

  const onConnect: OnConnect = (conn) => {
    if (!conn.source || !conn.target) return;
    // デフォルト種別は `trace` (未定義の関連)。詳細シートで変更可能。
    connectEdge(conn.source, conn.target, 'trace').catch((err) => {
      console.error('edge connect failed', err);
    });
  };

  // position 以外の変更 (select 等) は React Flow 内部状態に任せる。
  // drag 終了時のみ onNodeDragStop でストアに保存する。
  const onNodesChange = (_changes: NodeChange[]) => {
    // no-op: drag 中の座標は描画には applyNodeChanges で反映したいが、
    // ストア直結でリレンダーが走るため、ここでは何もしない。ドラッグ感の滑らかさは onNodeDragStop で妥協。
  };

  return (
    <ReactFlowProvider>
      <div style={{ width: '100%', height: '100%', background: '#0d1117' }}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          nodesDraggable
          nodesConnectable
          elementsSelectable
          proOptions={{ hideAttribution: true }}
          onNodesChange={onNodesChange}
          onNodeDragStop={(_evt, node) => {
            moveNode(node.id, node.position.x, node.position.y).catch((err) =>
              console.error('moveNode failed', err),
            );
          }}
          onConnect={onConnect}
          onNodeClick={(_evt, node) => select({ kind: 'node', id: node.id })}
          onEdgeClick={(_evt, edge) => select({ kind: 'edge', id: edge.id })}
          onPaneClick={() => select(null)}
        >
          <Background color="#30363d" gap={24} />
          <Controls
            style={{ background: '#161b22', border: '1px solid #30363d' }}
            showInteractive={false}
          />
          <MiniMap
            pannable
            zoomable
            nodeColor={(n) => {
              const node = (n.data as { node?: { type: string } }).node;
              return node ? (MINIMAP_COLORS[node.type] ?? '#8b949e') : '#8b949e';
            }}
            maskColor="rgba(13,17,23,0.7)"
            style={{ background: '#161b22', border: '1px solid #30363d' }}
          />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}

const MINIMAP_COLORS: Record<string, string> = {
  requirement: '#5b8def',
  usecase: '#4caf7a',
  userstory: '#3fb8c9',
  question: '#e07a4a',
  coderef: '#8b8b8b',
  issue: '#d9a441',
  proposal: '#a070c8',
};
```

ドラッグの滑らかさについて注記：この実装では drag 中は React Flow 内部状態で描画し、drag 終了時のみストアに書き戻す。ドラッグ中の表示が一瞬戻る現象があれば Task 17 で改善する。

- [ ] **Step 2: canvas-client.tsx でストアを初期化**

```tsx
// packages/frontend/src/app/projects/[id]/canvas-client.tsx
'use client';

import { useEffect } from 'react';

import type { Project } from '@tally/core';

import { Canvas } from '@/components/canvas/canvas';
import { useCanvasStore } from '@/lib/store';

export function CanvasClient({ project }: { project: Project }) {
  const hydrate = useCanvasStore((s) => s.hydrate);
  const reset = useCanvasStore((s) => s.reset);
  useEffect(() => {
    hydrate(project);
    return reset;
  }, [project, hydrate, reset]);
  return <Canvas />;
}
```

- [ ] **Step 3: typecheck + 既存テストが壊れていないか確認**

Run: `pnpm --filter frontend typecheck && pnpm --filter frontend test`
Expected: PASS

- [ ] **Step 4: dev サーバで手動確認**

```bash
TALLY_WORKSPACE=./examples pnpm --filter frontend dev
```
別タームから `open http://localhost:3000/projects/sample-feature`（sample の projectId に合わせる）。
ノードをドラッグして離すと位置が永続化されること、ハンドルから別ノードへドラッグすると `trace` エッジが追加されることを目視確認。ページリロードで状態が保たれる。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/canvas/canvas.tsx packages/frontend/src/app/projects/\[id\]/canvas-client.tsx
git commit -m "feat(frontend): キャンバスをドラッグ/接続可能にしストア駆動へ移行"
```

---

## Task 8: DetailSheet の枠と共通フィールド

**Files:**
- Create: `packages/frontend/src/components/details/detail-sheet.tsx`
- Create: `packages/frontend/src/components/details/common-fields.tsx`
- Modify: `packages/frontend/src/app/projects/[id]/canvas-client.tsx`

- [ ] **Step 1: CommonFields を実装**

共通 title/body の入力。`onBlur` で `patchNode` を呼ぶ。未保存の編集中文字列は内部 state に持つ。

```tsx
// packages/frontend/src/components/details/common-fields.tsx
'use client';

import { useEffect, useState } from 'react';

import type { Node } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function CommonFields({ node }: { node: Node }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const [title, setTitle] = useState(node.title);
  const [body, setBody] = useState(node.body);

  useEffect(() => {
    setTitle(node.title);
    setBody(node.body);
  }, [node.id, node.title, node.body]);

  const commitTitle = () => {
    if (title !== node.title) patchNode(node.id, { title }).catch(console.error);
  };
  const commitBody = () => {
    if (body !== node.body) patchNode(node.id, { body }).catch(console.error);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <label style={LABEL_STYLE}>タイトル</label>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commitTitle}
        style={INPUT_STYLE}
      />
      <label style={LABEL_STYLE}>本文</label>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={commitBody}
        rows={6}
        style={{ ...INPUT_STYLE, resize: 'vertical' }}
      />
    </div>
  );
}

const LABEL_STYLE = { fontSize: 11, color: '#8b949e', letterSpacing: 0.5 } as const;
const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
  fontFamily: 'inherit',
} as const;
```

- [ ] **Step 2: DetailSheet 枠を実装**

まだタイプ別 detail は未実装なので、`CommonFields` のみ表示するプレースホルダを入れる（後続タスクで差し替え）。

```tsx
// packages/frontend/src/components/details/detail-sheet.tsx
'use client';

import { useCanvasStore } from '@/lib/store';

import { CommonFields } from './common-fields';

export function DetailSheet() {
  const selected = useCanvasStore((s) => s.selected);
  const nodes = useCanvasStore((s) => s.nodes);
  const edges = useCanvasStore((s) => s.edges);

  if (!selected) {
    return (
      <aside style={SHEET_STYLE}>
        <Empty />
      </aside>
    );
  }
  if (selected.kind === 'node') {
    const node = nodes[selected.id];
    if (!node) return <aside style={SHEET_STYLE}><Empty /></aside>;
    return (
      <aside style={SHEET_STYLE}>
        <Header label={`ノード: ${node.type}`} />
        <CommonFields node={node} />
      </aside>
    );
  }
  const edge = edges[selected.id];
  return (
    <aside style={SHEET_STYLE}>
      <Header label="エッジ" />
      {edge ? (
        <pre style={{ fontSize: 11, color: '#8b949e' }}>{JSON.stringify(edge, null, 2)}</pre>
      ) : (
        <Empty />
      )}
    </aside>
  );
}

function Header({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 11, color: '#8b949e', letterSpacing: 1, marginBottom: 12 }}>
      {label.toUpperCase()}
    </div>
  );
}

function Empty() {
  return (
    <div style={{ color: '#6e7681', fontSize: 12, marginTop: 16 }}>
      ノードまたはエッジを選択してください。
    </div>
  );
}

const SHEET_STYLE = {
  width: 320,
  height: '100%',
  padding: 16,
  borderLeft: '1px solid #30363d',
  background: '#0d1117',
  color: '#e6edf3',
  overflowY: 'auto' as const,
};
```

- [ ] **Step 3: canvas-client を 2 カラム化（Canvas + DetailSheet）**

Palette は Task 11 で追加するので、現時点では右 detail のみ配置。

```tsx
// packages/frontend/src/app/projects/[id]/canvas-client.tsx
'use client';

import { useEffect } from 'react';

import type { Project } from '@tally/core';

import { Canvas } from '@/components/canvas/canvas';
import { DetailSheet } from '@/components/details/detail-sheet';
import { useCanvasStore } from '@/lib/store';

export function CanvasClient({ project }: { project: Project }) {
  const hydrate = useCanvasStore((s) => s.hydrate);
  const reset = useCanvasStore((s) => s.reset);
  useEffect(() => {
    hydrate(project);
    return reset;
  }, [project, hydrate, reset]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <Canvas />
      </div>
      <DetailSheet />
    </div>
  );
}
```

- [ ] **Step 4: typecheck + dev で目視**

Run: `pnpm --filter frontend typecheck`
Expected: PASS

dev サーバを起動し、ノードを選択すると右パネルにタイトル・本文が表示され、編集して blur で YAML に反映されることを確認。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/details/ packages/frontend/src/app/projects/\[id\]/canvas-client.tsx
git commit -m "feat(frontend): DetailSheet と共通 title/body エディタを追加"
```

---

## Task 9: ノード型別 Detail（requirement / userstory / question / coderef）

**Files:**
- Create: `packages/frontend/src/components/details/requirement-detail.tsx`
- Create: `packages/frontend/src/components/details/userstory-detail.tsx`
- Create: `packages/frontend/src/components/details/question-detail.tsx`
- Create: `packages/frontend/src/components/details/coderef-detail.tsx`
- Modify: `packages/frontend/src/components/details/detail-sheet.tsx`

- [ ] **Step 1: RequirementDetail**

```tsx
// packages/frontend/src/components/details/requirement-detail.tsx
'use client';

import {
  QUALITY_CATEGORIES,
  REQUIREMENT_KINDS,
  REQUIREMENT_PRIORITIES,
} from '@tally/core';
import type {
  QualityCategory,
  RequirementKind,
  RequirementNode,
  RequirementPriority,
} from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function RequirementDetail({ node }: { node: RequirementNode }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const set = (patch: Parameters<typeof patchNode>[1]) =>
    patchNode(node.id, patch).catch(console.error);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <Field label="種別">
        <select
          value={node.kind ?? ''}
          onChange={(e) =>
            set({ kind: (e.target.value || undefined) as RequirementKind | undefined })
          }
          style={SELECT_STYLE}
        >
          <option value="">未指定</option>
          {REQUIREMENT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </Field>
      <Field label="優先度">
        <select
          value={node.priority ?? ''}
          onChange={(e) =>
            set({ priority: (e.target.value || undefined) as RequirementPriority | undefined })
          }
          style={SELECT_STYLE}
        >
          <option value="">未指定</option>
          {REQUIREMENT_PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </Field>
      <Field label="品質カテゴリ (ISO 25010)">
        <select
          value={node.qualityCategory ?? ''}
          onChange={(e) =>
            set({
              qualityCategory: (e.target.value || undefined) as QualityCategory | undefined,
            })
          }
          style={SELECT_STYLE}
        >
          <option value="">未指定</option>
          {QUALITY_CATEGORIES.map((q) => (
            <option key={q} value={q}>
              {q}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, color: '#8b949e' }}>{label}</span>
      {children}
    </label>
  );
}

const SELECT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
} as const;
```

- [ ] **Step 2: UserStoryDetail**

```tsx
// packages/frontend/src/components/details/userstory-detail.tsx
'use client';

import { nanoid } from 'nanoid';
import { useState } from 'react';

import type { UserStoryNode, UserStoryTask } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function UserStoryDetail({ node }: { node: UserStoryNode }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const set = (patch: Parameters<typeof patchNode>[1]) =>
    patchNode(node.id, patch).catch(console.error);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16 }}>
      <div>
        <Heading>受け入れ基準</Heading>
        <CheckList
          items={node.acceptanceCriteria ?? []}
          onChange={(items) => set({ acceptanceCriteria: items })}
        />
      </div>
      <div>
        <Heading>タスク</Heading>
        <CheckList
          items={node.tasks ?? []}
          onChange={(items) => set({ tasks: items })}
        />
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: '#8b949e' }}>ストーリーポイント</span>
        <input
          type="number"
          min={1}
          step={1}
          defaultValue={node.points ?? ''}
          onBlur={(e) => {
            const v = e.target.value;
            set({ points: v === '' ? undefined : Number(v) });
          }}
          style={INPUT_STYLE}
        />
      </label>
    </div>
  );
}

interface CheckItem extends UserStoryTask {}

function CheckList({
  items,
  onChange,
}: {
  items: CheckItem[];
  onChange: (items: CheckItem[]) => void;
}) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { id: `ci-${nanoid(8)}`, text, done: false }]);
    setDraft('');
  };
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
      {items.map((it, idx) => (
        <li key={it.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={it.done}
            onChange={(e) => {
              const next = items.slice();
              next[idx] = { ...it, done: e.target.checked };
              onChange(next);
            }}
          />
          <input
            defaultValue={it.text}
            onBlur={(e) => {
              const next = items.slice();
              next[idx] = { ...it, text: e.target.value };
              onChange(next);
            }}
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button
            type="button"
            onClick={() => onChange(items.filter((x) => x.id !== it.id))}
            style={DELETE_BUTTON_STYLE}
            aria-label="削除"
          >
            ×
          </button>
        </li>
      ))}
      <li style={{ display: 'flex', gap: 6, marginTop: 6 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          placeholder="新しい項目..."
          style={{ ...INPUT_STYLE, flex: 1 }}
        />
        <button type="button" onClick={add} style={ADD_BUTTON_STYLE}>追加</button>
      </li>
    </ul>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: '#8b949e', letterSpacing: 0.5, marginBottom: 6 }}>
      {children}
    </div>
  );
}

const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
} as const;

const ADD_BUTTON_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
} as const;

const DELETE_BUTTON_STYLE = {
  background: 'transparent',
  color: '#8b949e',
  border: 'none',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
} as const;
```

`nanoid` は既に `@tally/core` が依存しているので、frontend パッケージでも使える。import で失敗した場合は `pnpm --filter frontend add nanoid` する。

- [ ] **Step 3: QuestionDetail**

```tsx
// packages/frontend/src/components/details/question-detail.tsx
'use client';

import { nanoid } from 'nanoid';
import { useState } from 'react';

import type { QuestionNode, QuestionOption } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function QuestionDetail({ node }: { node: QuestionNode }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const set = (patch: Parameters<typeof patchNode>[1]) =>
    patchNode(node.id, patch).catch(console.error);
  const [draft, setDraft] = useState('');

  const options = node.options ?? [];

  const addOption = () => {
    const text = draft.trim();
    if (!text) return;
    set({ options: [...options, { id: `opt-${nanoid(8)}`, text, selected: false }] });
    setDraft('');
  };
  const decide = (id: string) => {
    // 1 つの options[] に対して selected フラグと decision フィールドを同期する。
    const nextOptions = options.map((o) => ({ ...o, selected: o.id === id }));
    set({ options: nextOptions, decision: id });
  };
  const undecide = () => {
    const nextOptions = options.map((o) => ({ ...o, selected: false }));
    set({ options: nextOptions, decision: null });
  };
  const remove = (id: string) => {
    const nextOptions = options.filter((o) => o.id !== id);
    set({
      options: nextOptions,
      decision: node.decision === id ? null : node.decision,
    });
  };
  const editText = (id: string, text: string) => {
    set({ options: options.map((o) => (o.id === id ? { ...o, text } : o)) });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#8b949e' }}>選択肢</div>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {options.map((opt: QuestionOption) => {
          const isDecided = node.decision === opt.id;
          return (
            <li key={opt.id} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => (isDecided ? undecide() : decide(opt.id))}
                title={isDecided ? '決定を解除' : 'この選択肢に決定'}
                style={{
                  ...PICK_STYLE,
                  background: isDecided ? '#238636' : '#21262d',
                  color: isDecided ? '#fff' : '#8b949e',
                }}
              >
                {isDecided ? '✓' : '○'}
              </button>
              <input
                defaultValue={opt.text}
                onBlur={(e) => editText(opt.id, e.target.value)}
                style={{ ...INPUT_STYLE, flex: 1 }}
              />
              <button
                type="button"
                onClick={() => remove(opt.id)}
                aria-label="削除"
                style={DELETE_BUTTON_STYLE}
              >
                ×
              </button>
            </li>
          );
        })}
        <li style={{ display: 'flex', gap: 6, marginTop: 6 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addOption()}
            placeholder="新しい選択肢..."
            style={{ ...INPUT_STYLE, flex: 1 }}
          />
          <button type="button" onClick={addOption} style={ADD_BUTTON_STYLE}>追加</button>
        </li>
      </ul>
    </div>
  );
}

const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
} as const;
const PICK_STYLE = {
  border: '1px solid #30363d',
  borderRadius: 999,
  width: 24,
  height: 24,
  fontSize: 12,
  cursor: 'pointer',
} as const;
const ADD_BUTTON_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
} as const;
const DELETE_BUTTON_STYLE = {
  background: 'transparent',
  color: '#8b949e',
  border: 'none',
  fontSize: 16,
  cursor: 'pointer',
  padding: '0 4px',
} as const;
```

- [ ] **Step 4: CodeRefDetail**

```tsx
// packages/frontend/src/components/details/coderef-detail.tsx
'use client';

import type { CodeRefNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function CodeRefDetail({ node }: { node: CodeRefNode }) {
  const patchNode = useCanvasStore((s) => s.patchNode);
  const set = (patch: Parameters<typeof patchNode>[1]) =>
    patchNode(node.id, patch).catch(console.error);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <label style={LABEL_COL}>
        <span style={LABEL}>ファイルパス</span>
        <input
          defaultValue={node.filePath ?? ''}
          onBlur={(e) => set({ filePath: e.target.value || undefined })}
          placeholder="src/foo.ts"
          style={INPUT_STYLE}
        />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <label style={{ ...LABEL_COL, flex: 1 }}>
          <span style={LABEL}>開始行</span>
          <input
            type="number"
            min={0}
            defaultValue={node.startLine ?? ''}
            onBlur={(e) => {
              const v = e.target.value;
              set({ startLine: v === '' ? undefined : Number(v) });
            }}
            style={INPUT_STYLE}
          />
        </label>
        <label style={{ ...LABEL_COL, flex: 1 }}>
          <span style={LABEL}>終了行</span>
          <input
            type="number"
            min={0}
            defaultValue={node.endLine ?? ''}
            onBlur={(e) => {
              const v = e.target.value;
              set({ endLine: v === '' ? undefined : Number(v) });
            }}
            style={INPUT_STYLE}
          />
        </label>
      </div>
    </div>
  );
}

const LABEL = { fontSize: 11, color: '#8b949e' } as const;
const LABEL_COL = { display: 'flex', flexDirection: 'column', gap: 4 } as const;
const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
} as const;
```

- [ ] **Step 5: DetailSheet で分岐**

```tsx
// packages/frontend/src/components/details/detail-sheet.tsx の ノード表示部分を差し替え
// import を追加
import { CodeRefDetail } from './coderef-detail';
import { QuestionDetail } from './question-detail';
import { RequirementDetail } from './requirement-detail';
import { UserStoryDetail } from './userstory-detail';

// if (selected.kind === 'node') { ... } ブロックを以下で置換:
if (selected.kind === 'node') {
  const node = nodes[selected.id];
  if (!node) return <aside style={SHEET_STYLE}><Empty /></aside>;
  return (
    <aside style={SHEET_STYLE}>
      <Header label={`ノード: ${node.type}`} />
      <CommonFields node={node} />
      {node.type === 'requirement' && <RequirementDetail node={node} />}
      {node.type === 'userstory' && <UserStoryDetail node={node} />}
      {node.type === 'question' && <QuestionDetail node={node} />}
      {node.type === 'coderef' && <CodeRefDetail node={node} />}
    </aside>
  );
}
```

- [ ] **Step 6: dev で目視確認**

- `requirement` ノード選択 → kind/priority/quality を変更 → YAML 確認
- `userstory` ノード → AC 追加/チェック/削除、タスク同様、points 変更
- `question` ノード → 選択肢追加、決定を切り替え、破線⇄実線の切替をキャンバスで確認
- `coderef` ノード → filePath 編集

- [ ] **Step 7: コミット**

```bash
git add packages/frontend/src/components/details/
git commit -m "feat(frontend): ノード型別の詳細シート (requirement/story/question/coderef) を追加"
```

---

## Task 10: Edge Detail（種別変更 + 削除）

**Files:**
- Create: `packages/frontend/src/components/details/edge-detail.tsx`
- Modify: `packages/frontend/src/components/details/detail-sheet.tsx`

- [ ] **Step 1: EdgeDetail 実装**

```tsx
// packages/frontend/src/components/details/edge-detail.tsx
'use client';

import { EDGE_META, EDGE_TYPES } from '@tally/core';
import type { Edge, EdgeType } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function EdgeDetail({ edge }: { edge: Edge }) {
  const changeEdgeType = useCanvasStore((s) => s.changeEdgeType);
  const removeEdge = useCanvasStore((s) => s.removeEdge);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#8b949e' }}>
        {edge.from} → {edge.to}
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span style={{ fontSize: 11, color: '#8b949e' }}>種別</span>
        <select
          value={edge.type}
          onChange={(e) => changeEdgeType(edge.id, e.target.value as EdgeType).catch(console.error)}
          style={SELECT_STYLE}
        >
          {EDGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {EDGE_META[t].label} ({t})
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => removeEdge(edge.id).catch(console.error)}
        style={DANGER_BUTTON_STYLE}
      >
        エッジを削除
      </button>
    </div>
  );
}

const SELECT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 13,
} as const;

const DANGER_BUTTON_STYLE = {
  background: '#2f1720',
  color: '#f85149',
  border: '1px solid #5c1e28',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  marginTop: 20,
} as const;
```

エッジ削除は誤操作リスクが相対的に低い（復元も接続し直せばよい）ため、確認ダイアログは今回付けない。Task 11 のノード削除のみ確認必須とする。

- [ ] **Step 2: DetailSheet に組み込み**

`detail-sheet.tsx` の edge 分岐を差し替え：

```tsx
import { EdgeDetail } from './edge-detail';

// ...
return (
  <aside style={SHEET_STYLE}>
    <Header label="エッジ" />
    {edge ? <EdgeDetail edge={edge} /> : <Empty />}
  </aside>
);
```

- [ ] **Step 3: dev で目視確認 + エッジの種別変更後に線種が切り替わる**

- [ ] **Step 4: コミット**

```bash
git add packages/frontend/src/components/details/edge-detail.tsx packages/frontend/src/components/details/detail-sheet.tsx
git commit -m "feat(frontend): エッジ詳細シート (種別変更/削除) を追加"
```

---

## Task 11: NodePalette（左サイドバー、新規追加）

**Files:**
- Create: `packages/frontend/src/components/palette/node-palette.tsx`
- Modify: `packages/frontend/src/app/projects/[id]/canvas-client.tsx`

- [ ] **Step 1: Palette コンポーネント**

```tsx
// packages/frontend/src/components/palette/node-palette.tsx
'use client';

import { NODE_META, NODE_TYPES } from '@tally/core';
import type { NodeType } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

// 新規ノードの配置位置は既存ノード群の右横に並べる簡易ロジックとする。
// ビューポート中央に置くには useReactFlow が必要だが、
// Phase 3 の目的は編集操作の成立であり、見た目最適化は Phase 8 以降でよい。
function computeNextPosition(nodes: Record<string, { x: number; y: number }>): {
  x: number;
  y: number;
} {
  const values = Object.values(nodes);
  if (values.length === 0) return { x: 120, y: 120 };
  const maxX = Math.max(...values.map((n) => n.x));
  const avgY = values.reduce((sum, n) => sum + n.y, 0) / values.length;
  return { x: maxX + 320, y: avgY };
}

export function NodePalette() {
  const addNodeFromPalette = useCanvasStore((s) => s.addNodeFromPalette);
  const nodes = useCanvasStore((s) => s.nodes);

  const add = async (type: NodeType) => {
    const { x, y } = computeNextPosition(nodes);
    try {
      await addNodeFromPalette(type, x, y);
    } catch (err) {
      console.error('addNodeFromPalette failed', err);
    }
  };

  return (
    <aside style={PALETTE_STYLE}>
      <div style={{ fontSize: 11, color: '#8b949e', letterSpacing: 1, marginBottom: 12 }}>
        NEW
      </div>
      {NODE_TYPES.map((t) => {
        const meta = NODE_META[t];
        return (
          <button
            key={t}
            type="button"
            onClick={() => add(t)}
            style={{
              ...BUTTON_STYLE,
              borderColor: meta.color,
              color: meta.color,
            }}
          >
            <span style={{ marginRight: 6 }}>{meta.icon}</span>
            {meta.label}
          </button>
        );
      })}
    </aside>
  );
}

const PALETTE_STYLE = {
  width: 140,
  height: '100%',
  padding: 12,
  borderRight: '1px solid #30363d',
  background: '#0d1117',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 8,
};

const BUTTON_STYLE = {
  background: '#161b22',
  border: '1px solid',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 12,
  textAlign: 'left' as const,
  cursor: 'pointer',
};
```

- [ ] **Step 2: canvas-client を 3 カラム化**

```tsx
// packages/frontend/src/app/projects/[id]/canvas-client.tsx
'use client';

import { useEffect } from 'react';

import type { Project } from '@tally/core';

import { Canvas } from '@/components/canvas/canvas';
import { DetailSheet } from '@/components/details/detail-sheet';
import { NodePalette } from '@/components/palette/node-palette';
import { useCanvasStore } from '@/lib/store';

export function CanvasClient({ project }: { project: Project }) {
  const hydrate = useCanvasStore((s) => s.hydrate);
  const reset = useCanvasStore((s) => s.reset);
  useEffect(() => {
    hydrate(project);
    return reset;
  }, [project, hydrate, reset]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <NodePalette />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Canvas />
      </div>
      <DetailSheet />
    </div>
  );
}
```

- [ ] **Step 3: dev で目視確認**

各種ボタンをクリックすると既存ノード群の右隣にカードが生成され、YAML が増えること。選択して CommonFields にタイトル/本文を打つとファイルが更新されること。

- [ ] **Step 4: コミット**

```bash
git add packages/frontend/src/components/palette/ packages/frontend/src/app/projects/\[id\]/canvas-client.tsx
git commit -m "feat(frontend): NodePalette を追加して 7 種ノードをキャンバスに追加可能にする"
```

---

## Task 12: ConfirmDialog と ノード削除ボタン

**Files:**
- Create: `packages/frontend/src/components/dialog/confirm-dialog.tsx`
- Modify: `packages/frontend/src/components/details/detail-sheet.tsx`

- [ ] **Step 1: ConfirmDialog コンポーネント**

```tsx
// packages/frontend/src/components/dialog/confirm-dialog.tsx
'use client';

import { useEffect } from 'react';

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = '削除',
  onConfirm,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Enter' && onConfirm()}
      role="presentation"
      style={BACKDROP_STYLE}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        style={DIALOG_STYLE}
      >
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        {body && <div style={{ fontSize: 12, color: '#c8d1da' }}>{body}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={CANCEL_STYLE}>
            キャンセル
          </button>
          <button type="button" onClick={onConfirm} style={CONFIRM_STYLE}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const BACKDROP_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const DIALOG_STYLE = {
  width: 360,
  background: '#161b22',
  color: '#e6edf3',
  borderRadius: 10,
  border: '1px solid #30363d',
  padding: 20,
  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
};

const CANCEL_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
};

const CONFIRM_STYLE = {
  background: '#b62324',
  color: '#fff',
  border: '1px solid #8c1b1b',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
};
```

- [ ] **Step 2: DetailSheet のノード表示に削除ボタン＋確認ダイアログを追加**

```tsx
// detail-sheet.tsx のノード分岐を拡張
import { useState } from 'react';

import { ConfirmDialog } from '../dialog/confirm-dialog';

// ノード分岐のボディを以下で差し替え:
if (selected.kind === 'node') {
  const node = nodes[selected.id];
  if (!node) return <aside style={SHEET_STYLE}><Empty /></aside>;
  return <NodeDetailPanel node={node} />;
}
```

新設関数を同ファイル末尾に：

```tsx
function NodeDetailPanel({ node }: { node: import('@tally/core').Node }) {
  const removeNode = useCanvasStore((s) => s.removeNode);
  const [confirming, setConfirming] = useState(false);

  return (
    <aside style={SHEET_STYLE}>
      <Header label={`ノード: ${node.type}`} />
      <CommonFields node={node} />
      {node.type === 'requirement' && <RequirementDetail node={node} />}
      {node.type === 'userstory' && <UserStoryDetail node={node} />}
      {node.type === 'question' && <QuestionDetail node={node} />}
      {node.type === 'coderef' && <CodeRefDetail node={node} />}
      <button
        type="button"
        onClick={() => setConfirming(true)}
        style={DANGER_BUTTON_STYLE}
      >
        ノードを削除
      </button>
      <ConfirmDialog
        open={confirming}
        title="このノードを削除しますか？"
        body="接続されているエッジも同時に削除されます。"
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          removeNode(node.id).catch(console.error);
        }}
      />
    </aside>
  );
}

const DANGER_BUTTON_STYLE = {
  background: '#2f1720',
  color: '#f85149',
  border: '1px solid #5c1e28',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  marginTop: 24,
  width: '100%',
};
```

- [ ] **Step 3: dev で目視確認**

ノード削除ボタン → ダイアログ → 確認で YAML からノードと付随エッジが消える。キャンセルすると何も起きない。

- [ ] **Step 4: コミット**

```bash
git add packages/frontend/src/components/dialog/ packages/frontend/src/components/details/detail-sheet.tsx
git commit -m "feat(frontend): ノード削除時に確認ダイアログを表示する"
```

---

## Task 13: 最終確認と型/テスト/lint

**Files:** (touch only on fix)
- `packages/frontend/**/*`

- [ ] **Step 1: フルテスト**

```bash
pnpm -r test
```
Expected: PASS（追加した API route テストと store テストを含む）

- [ ] **Step 2: Typecheck 一式**

```bash
pnpm -r --if-present typecheck
```
Expected: PASS

- [ ] **Step 3: Biome (lint+format)**

```bash
pnpm exec biome check packages/frontend/src
```
Expected: 0 error。自動修正可能なものは `pnpm exec biome check --write packages/frontend/src`。

- [ ] **Step 4: 完了条件の手動確認**

`TALLY_WORKSPACE=./examples pnpm --filter frontend dev` を起動し、以下を目視：
- ノードをドラッグして位置が永続化される（リロードで復元）
- パレットから 7 種のノードが追加できる
- 詳細シートで各種属性が編集でき YAML に反映される
- 論点ノードで選択肢の追加・削除・決定→破線⇄実線の切替が動く
- ストーリーノードで AC/タスクの追加・チェック・削除が動く
- エッジをハンドルからドラッグして作成できる（種別は trace）
- エッジを選んで種別を変更できる（線種が切り替わる）
- ノード削除で付随エッジも消える、ダイアログでキャンセル可能
- 複数タブで同一プロジェクトを開いて独立に編集できる（片方の保存は他方を上書きしない。タブを再読込すれば相手の変更が見える）

- [ ] **Step 5: codex によるセカンドオピニオン**

```text
/codex-review uncommitted — Phase 3 (canvas editing) 全体を一括でレビュー
```
指摘を Critical/Major/Minor ごとに確認し、必要な修正を別コミットで行う。

- [ ] **Step 6: Phase 3 完了コミット（必要に応じて）**

```bash
git status
# 未コミット修正があればまとめる
git commit -am "chore(frontend): Phase 3 完了条件の手動確認と微修正"
```

---

## Self-Review チェックリスト（この計画自体）

- **スペックとの対応**:
  - ノードドラッグ → Task 7 ✓
  - 詳細シート → Task 8-10 ✓
  - ノードパレット → Task 11 ✓
  - エッジ接続 UI → Task 7 (onConnect) ✓
  - エッジ種別変更 → Task 10 ✓
  - 論点ノード選択肢管理 → Task 9 (QuestionDetail) ✓
  - ストーリー AC/タスク → Task 9 (UserStoryDetail) ✓
  - 削除確認ダイアログ → Task 12 ✓
  - API POST/PATCH/DELETE nodes/edges → Task 2-5 ✓
  - Zustand 楽観更新 + ロールバック → Task 6 ✓
- **Placeholder scan**: 残留なし。全ステップに code/commands を記載。
- **Type consistency**:
  - `useCanvasStore` のアクション名は Task 6 で定義したものを全 Task で同一参照（`moveNode` / `patchNode` / `addNodeFromPalette` / `removeNode` / `connectEdge` / `changeEdgeType` / `removeEdge` / `select` / `hydrate` / `reset`）。
  - API 関数は `createNode` / `updateNode` / `deleteNode` / `createEdge` / `updateEdge` / `deleteEdge` で統一。
  - Edge PATCH が delete→add で ID を変更する制約を Task 6 の `changeEdgeType` で吸収済み。

完了条件を全て満たす計画になっている。
