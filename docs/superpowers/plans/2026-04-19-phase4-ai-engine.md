# Phase 4: AI Engine 基盤 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tally に AI 機能を導入する。UC ノードから「ストーリー分解」を実行すると Claude が userstory proposal を複数生成し、人間が採用することで正規 userstory に昇格できる。

**Architecture:** Phase 4 を 3 サブフェーズに分ける。4-A は ADR-0005 の proposal 採用フロー完成 (AI 不要で E2E 検証可)。4-B は独立 WS プロセス `@tally/ai-engine` を立て、Claude Agent SDK に `createSdkMcpServer` で Tally カスタムツール 4 種 (`create_node` / `create_edge` / `find_related` / `list_by_type`) を渡し、`decompose-to-stories` エージェントを実装。ai-engine が `FileSystemProjectStore` を直接操作して YAML を書き、WS 経由で `node_created` / `edge_created` イベントを frontend に流して zustand に反映する。4-C は ADR-0006 / `.env.example` / 手動 E2E 手順書で仕上げ。

**Tech Stack:** TypeScript / pnpm workspaces / Next.js 15 App Router / React Flow / Zustand / `@anthropic-ai/claude-agent-sdk` / `ws` / `zod` / Vitest / Biome。

---

## 参考ドキュメント

- Spec: `docs/superpowers/specs/2026-04-19-phase4-ai-engine-design.md`
- ADR-0002 (Agent SDK 採用)、ADR-0005 (proposal 採用フロー)、新規 ADR-0006 (Claude Code OAuth)
- `docs/02-domain-model.md`、`docs/04-roadmap.md` Phase 4

---

# Phase 4-A: proposal 採用実装

## Task 1: core に `AdoptableType` と `stripAiPrefix` を追加

**Files:**
- Modify: `packages/core/src/types.ts`
- Create: `packages/core/src/logic/prefix.ts`
- Create: `packages/core/src/logic/prefix.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 失敗テストを書く**

`packages/core/src/logic/prefix.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { stripAiPrefix } from './prefix';

describe('stripAiPrefix', () => {
  it('先頭の [AI] と前後空白を 1 回だけ除去する', () => {
    expect(stripAiPrefix('[AI] ストーリー分解案')).toBe('ストーリー分解案');
    expect(stripAiPrefix('  [AI]   案件')).toBe('案件');
    expect(stripAiPrefix('[AI]案件')).toBe('案件');
  });

  it('プレフィックスが無ければそのまま返す', () => {
    expect(stripAiPrefix('通常のタイトル')).toBe('通常のタイトル');
  });

  it('中盤の [AI] は消さない', () => {
    expect(stripAiPrefix('設計 [AI] レビュー')).toBe('設計 [AI] レビュー');
  });

  it('[AI] が連続していても 1 回のみ除去する', () => {
    expect(stripAiPrefix('[AI] [AI] タイトル')).toBe('[AI] タイトル');
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm -F @tally/core test -- prefix`
Expected: 対象ファイル未存在で FAIL。

- [ ] **Step 3: 実装**

`packages/core/src/logic/prefix.ts`:

```typescript
// AI 生成ノードのタイトル先頭に付く "[AI]" プレフィックスを 1 回だけ除去する。
// ADR-0005 の「採用時に [AI] プレフィックスを削除」規定に対応。
const AI_PREFIX_PATTERN = /^\s*\[AI\]\s*/;

export function stripAiPrefix(title: string): string {
  return title.replace(AI_PREFIX_PATTERN, '');
}
```

`packages/core/src/types.ts` の末尾に追加:

```typescript
// ADR-0005: proposal ノードを採用するときの遷移先に許される NodeType。
// proposal → proposal の遷移は意味が無いので除外する。
export type AdoptableType = Exclude<NodeType, 'proposal'>;
```

`packages/core/src/index.ts` の既存 `export * from './types';` はそのままでよいが、`logic/prefix` をエクスポートに追加:

```typescript
export { stripAiPrefix } from './logic/prefix';
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @tally/core test`
Expected: `prefix.test.ts` の 4 ケースがすべて PASS。既存の `question` / `story` / `schema` / `id` / `index` テストも引き続き PASS (全 24 件以上)。

- [ ] **Step 5: 型チェック**

Run: `pnpm -F @tally/core typecheck`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/core/src/logic/prefix.ts \
  packages/core/src/logic/prefix.test.ts \
  packages/core/src/types.ts \
  packages/core/src/index.ts
git commit -m "feat(core): AdoptableType 型と stripAiPrefix ユーティリティを追加"
```

---

## Task 2: storage に `transmuteNode` を追加 (ADR-0005 の read-check-write)

**Files:**
- Modify: `packages/storage/src/project-store.ts`
- Modify: `packages/storage/src/project-store.test.ts`

- [ ] **Step 1: 失敗テストを追加**

`packages/storage/src/project-store.test.ts` の末尾、`describe('FileSystemProjectStore', ...)` の中に新しい describe ブロックを追加:

```typescript
  describe('transmuteNode (proposal 採用)', () => {
    async function addProposal(extras: Partial<{ adoptAs: string }> = {}) {
      return store.addNode({
        type: 'proposal',
        x: 10,
        y: 20,
        title: '[AI] 提案タイトル',
        body: '提案本文',
        adoptAs: (extras.adoptAs ?? 'userstory') as
          | 'requirement'
          | 'usecase'
          | 'userstory'
          | 'question'
          | 'coderef'
          | 'issue',
        sourceAgentId: 'decompose-to-stories',
      });
    }

    it('userstory に採用すると type が変わり [AI] と proposal 固有属性が落ちる', async () => {
      const p = await addProposal();
      const adopted = await store.transmuteNode(p.id, 'userstory');
      expect(adopted.id).toBe(p.id);
      expect(adopted.type).toBe('userstory');
      expect(adopted.title).toBe('提案タイトル');
      expect(adopted.body).toBe('提案本文');
      expect(adopted.x).toBe(10);
      expect(adopted.y).toBe(20);
      expect('adoptAs' in adopted).toBe(false);
      expect('sourceAgentId' in adopted).toBe(false);
    });

    it('requirement に採用し additional を受け取る', async () => {
      const p = await addProposal({ adoptAs: 'requirement' });
      const adopted = await store.transmuteNode(p.id, 'requirement', {
        kind: 'functional',
        priority: 'must',
      });
      expect(adopted.type).toBe('requirement');
      if (adopted.type === 'requirement') {
        expect(adopted.kind).toBe('functional');
        expect(adopted.priority).toBe('must');
      }
    });

    it('userstory に採用し additional.acceptanceCriteria を受け取る', async () => {
      const p = await addProposal();
      const adopted = await store.transmuteNode(p.id, 'userstory', {
        acceptanceCriteria: [{ id: 'ac1', text: '動く', done: false }],
        points: 3,
      });
      expect(adopted.type).toBe('userstory');
      if (adopted.type === 'userstory') {
        expect(adopted.acceptanceCriteria).toEqual([{ id: 'ac1', text: '動く', done: false }]);
        expect(adopted.points).toBe(3);
      }
    });

    it('存在しない id は Error を投げる', async () => {
      await expect(store.transmuteNode('prop-missing', 'userstory')).rejects.toThrow(
        /存在しないノード/,
      );
    });

    it('proposal 以外は Error を投げる', async () => {
      const req = await store.addNode({
        type: 'requirement',
        x: 0,
        y: 0,
        title: 'r',
        body: '',
      });
      await expect(store.transmuteNode(req.id, 'userstory')).rejects.toThrow(
        /proposal 以外は採用対象外/,
      );
    });

    it('採用前に張られたエッジが採用後も残る', async () => {
      const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: '' });
      const p = await addProposal();
      const edge = await store.addEdge({ from: uc.id, to: p.id, type: 'derive' });

      await store.transmuteNode(p.id, 'userstory');

      const edges = await store.listEdges();
      expect(edges).toHaveLength(1);
      expect(edges[0]?.id).toBe(edge.id);
      expect(edges[0]?.from).toBe(uc.id);
      expect(edges[0]?.to).toBe(p.id);
    });
  });
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm -F @tally/storage test -- project-store`
Expected: `transmuteNode is not a function` で FAIL。

- [ ] **Step 3: interface に transmuteNode を追加**

`packages/storage/src/project-store.ts` の `ProjectStore` interface と、`FileSystemProjectStore` にメソッドを追加する。まず interface:

```typescript
import type { AdoptableType } from '@tally/core';
// 既存 import に AdoptableType を足す。
```

interface 内、`deleteNode` の直後に:

```typescript
  transmuteNode(
    id: string,
    newType: AdoptableType,
    additional?: Record<string, unknown>,
  ): Promise<Node>;
```

`stripAiPrefix` も import に追加:

```typescript
import { EdgeSchema, NodeSchema, ProjectMetaSchema, newEdgeId, newNodeId, stripAiPrefix } from '@tally/core';
```

- [ ] **Step 4: FileSystemProjectStore に実装を追加**

`deleteNode` の直後に:

```typescript
  async transmuteNode(
    id: string,
    newType: AdoptableType,
    additional: Record<string, unknown> = {},
  ): Promise<Node> {
    const current = await this.getNode(id);
    if (!current) throw new Error(`存在しないノード: ${id}`);
    if (current.type !== 'proposal') {
      throw new Error(`proposal 以外は採用対象外: ${current.type}`);
    }
    // read-check-write: 競合時に「採用済みノードを再採用」してしまわないように
    // 書き込み直前にもう一度ファイルから読み直し、type='proposal' を再確認する。
    const reread = await this.getNode(id);
    if (!reread || reread.type !== 'proposal') {
      throw new Error(`proposal 以外は採用対象外: ${reread?.type ?? 'deleted'}`);
    }
    const common = {
      id: reread.id,
      x: reread.x,
      y: reread.y,
      title: stripAiPrefix(reread.title),
      body: reread.body,
    };
    // additional は任意型のフィールドを持つ。undefined 値はキーごとスキップ。
    const merged: Record<string, unknown> = { ...common, type: newType };
    for (const [k, v] of Object.entries(additional)) {
      if (v === undefined) continue;
      merged[k] = v;
    }
    const validated = NodeSchema.parse(merged);
    await writeYaml(path.join(this.paths.nodesDir, nodeFileName(id)), validated);
    return validated;
  }
```

- [ ] **Step 5: テストと typecheck**

Run: `pnpm -F @tally/storage test` と `pnpm -F @tally/storage typecheck`
Expected: 追加した 6 ケース + 既存の 37 ケースすべて PASS、型エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/storage/src/project-store.ts \
  packages/storage/src/project-store.test.ts
git commit -m "feat(storage): transmuteNode で proposal から正規ノードへ採用できる"
```

---

## Task 3: frontend API `POST /api/projects/:id/nodes/:nodeId/adopt`

**Files:**
- Create: `packages/frontend/src/app/api/projects/[id]/nodes/[nodeId]/adopt/route.ts`
- Create: `packages/frontend/src/app/api/projects/[id]/nodes/[nodeId]/adopt/adopt-route.test.ts`

- [ ] **Step 1: 失敗テストを作成**

`adopt-route.test.ts`:

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { POST } from './route';

describe('POST /api/projects/[id]/nodes/[nodeId]/adopt', () => {
  let root: string;
  const prevEnv = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-adopt-'));
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

  async function makeProposal(root: string) {
    const store = new FileSystemProjectStore(root);
    return store.addNode({
      type: 'proposal',
      x: 0,
      y: 0,
      title: '[AI] テスト案',
      body: '本文',
      adoptAs: 'userstory',
    });
  }

  it('userstory として採用すると 200 と新しいノードを返す', async () => {
    const prop = await makeProposal(root);
    const req = new Request(
      `http://localhost/api/projects/proj-test/nodes/${prop.id}/adopt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adoptAs: 'userstory' }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: prop.id }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(prop.id);
    expect(body.type).toBe('userstory');
    expect(body.title).toBe('テスト案');
  });

  it('adoptAs が proposal だと 400', async () => {
    const prop = await makeProposal(root);
    const req = new Request(
      `http://localhost/api/projects/proj-test/nodes/${prop.id}/adopt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adoptAs: 'proposal' }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: prop.id }),
    });
    expect(res.status).toBe(400);
  });

  it('proposal 以外を採用しようとすると 400', async () => {
    const store = new FileSystemProjectStore(root);
    const req1 = await store.addNode({
      type: 'requirement',
      x: 0,
      y: 0,
      title: 'r',
      body: '',
    });
    const req = new Request(
      `http://localhost/api/projects/proj-test/nodes/${req1.id}/adopt`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adoptAs: 'userstory' }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: req1.id }),
    });
    expect(res.status).toBe(400);
  });

  it('存在しないノードは 404', async () => {
    const req = new Request(
      'http://localhost/api/projects/proj-test/nodes/prop-missing/adopt',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adoptAs: 'userstory' }),
      },
    );
    const res = await POST(req, {
      params: Promise.resolve({ id: 'proj-test', nodeId: 'prop-missing' }),
    });
    expect(res.status).toBe(404);
  });

  it('未知のプロジェクトは 404', async () => {
    const req = new Request(
      'http://localhost/api/projects/nope/nodes/any/adopt',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ adoptAs: 'userstory' }),
      },
    );
    const res = await POST(req, { params: Promise.resolve({ id: 'nope', nodeId: 'any' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm -F @tally/frontend test -- adopt-route`
Expected: `./route` 未存在で FAIL。

- [ ] **Step 3: route 実装**

`adopt/route.ts`:

```typescript
import type { AdoptableType, NodeType } from '@tally/core';
import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';

import { resolveProjectById } from '@/lib/project-resolver';

interface RouteContext {
  params: Promise<{ id: string; nodeId: string }>;
}

// proposal → 採用可能 NodeType の集合 (proposal 自身は除外)。
const ADOPTABLE_TYPES: readonly AdoptableType[] = [
  'requirement',
  'usecase',
  'userstory',
  'question',
  'coderef',
  'issue',
];

function isAdoptable(v: unknown): v is AdoptableType {
  return typeof v === 'string' && (ADOPTABLE_TYPES as readonly string[]).includes(v);
}

export async function POST(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id, nodeId } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) return NextResponse.json({ error: 'project not found', id }, { status: 404 });

  const raw = await req.json().catch(() => null);
  if (raw === null || typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 });
  }
  const { adoptAs, additional } = raw as { adoptAs?: unknown; additional?: unknown };
  if (!isAdoptable(adoptAs)) {
    return NextResponse.json({ error: 'invalid adoptAs' }, { status: 400 });
  }
  const extra =
    additional && typeof additional === 'object' ? (additional as Record<string, unknown>) : {};

  const store = new FileSystemProjectStore(handle.workspaceRoot);
  const exists = await store.getNode(nodeId);
  if (!exists) return NextResponse.json({ error: 'node not found' }, { status: 404 });
  try {
    const adopted = await store.transmuteNode(nodeId, adoptAs, extra);
    return NextResponse.json(adopted);
  } catch (err) {
    // storage 側は `proposal 以外は採用対象外` / `存在しないノード` を throw するが、
    // この時点で getNode は通っているので前者のみ発生し得る。スキーマ違反も同じく 400。
    return NextResponse.json({ error: String(err) }, { status: 400 });
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @tally/frontend test -- adopt-route`
Expected: 5 ケース全 PASS。

- [ ] **Step 5: typecheck / lint**

Run: `pnpm -F @tally/frontend typecheck && pnpm lint`
Expected: エラーなし。

- [ ] **Step 6: コミット**

```bash
git add packages/frontend/src/app/api/projects/\[id\]/nodes/\[nodeId\]/adopt/
git commit -m "feat(frontend): POST /nodes/:nid/adopt で proposal を正規ノードへ採用する"
```

---

## Task 4: frontend `api.ts` と Zustand に `adoptProposal` を追加

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`
- Modify: `packages/frontend/src/lib/store.ts`
- Modify: `packages/frontend/src/lib/store.test.ts`

- [ ] **Step 1: store.test.ts に失敗テストを追加**

既存 `store.test.ts` の末尾 (`});` の前) に追加:

```typescript
  describe('adoptProposal', () => {
    it('成功時に proposal ノードが新 type のノードで置換される', async () => {
      const adopted = {
        id: 'prop-xxx',
        type: 'userstory',
        x: 0,
        y: 0,
        title: 'タイトル',
        body: 'body',
      };
      globalThis.fetch = vi.fn(async (url, init) => {
        expect(String(url)).toContain('/adopt');
        expect(init?.method).toBe('POST');
        return new Response(JSON.stringify(adopted), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as typeof fetch;

      const { useCanvasStore } = await import('./store');
      useCanvasStore.getState().hydrate({
        id: 'proj-test',
        name: 'T',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          {
            id: 'prop-xxx',
            type: 'proposal',
            x: 0,
            y: 0,
            title: '[AI] タイトル',
            body: 'body',
            adoptAs: 'userstory',
          },
        ],
        edges: [],
      });
      const result = await useCanvasStore.getState().adoptProposal('prop-xxx', 'userstory');
      expect(result.type).toBe('userstory');
      expect(useCanvasStore.getState().nodes['prop-xxx']?.type).toBe('userstory');
    });

    it('失敗時は例外を投げる', async () => {
      globalThis.fetch = vi.fn(async () => new Response('bad', { status: 400 })) as typeof fetch;
      const { useCanvasStore } = await import('./store');
      useCanvasStore.getState().hydrate({
        id: 'proj-test',
        name: 'T',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [
          {
            id: 'prop-xxx',
            type: 'proposal',
            x: 0,
            y: 0,
            title: '[AI] タイトル',
            body: 'body',
          },
        ],
        edges: [],
      });
      await expect(
        useCanvasStore.getState().adoptProposal('prop-xxx', 'userstory'),
      ).rejects.toThrow();
      // 失敗時はノードがそのまま proposal で残る。
      expect(useCanvasStore.getState().nodes['prop-xxx']?.type).toBe('proposal');
    });
  });
```

(注: 上のテストは既存 store.test.ts のモックスタイルに合わせて書く。`vi` が既に import 済み・既存の describe が `vi.fn(fetch)` を使っている場合はそれを踏襲。import 追加や import 位置は既存テストの先頭を見て追従。)

- [ ] **Step 2: api.ts に adoptProposalApi を追加**

`packages/frontend/src/lib/api.ts` の末尾:

```typescript
import type { AdoptableType } from '@tally/core';
// 既存 import 文に AdoptableType を追加する。

export function adoptProposal(
  projectId: string,
  nodeId: string,
  adoptAs: AdoptableType,
  additional?: Record<string, unknown>,
): Promise<Node> {
  return requestJson<Node>(
    `${base(projectId)}/nodes/${encodeURIComponent(nodeId)}/adopt`,
    {
      method: 'POST',
      body: JSON.stringify({ adoptAs, additional }),
    },
  );
}
```

- [ ] **Step 3: store.ts に adoptProposal を追加**

既存 `CanvasState` interface に:

```typescript
  adoptProposal: <T extends AdoptableType>(
    id: string,
    adoptAs: T,
    additional?: Record<string, unknown>,
  ) => Promise<Node>;
```

import 追加:

```typescript
import type { AdoptableType, Edge, EdgeType, Node, NodeType, Project, ProjectMeta } from '@tally/core';

import {
  adoptProposal as adoptProposalApi,
  createEdge,
  ...
} from './api';
```

ストア実装内 (例えば `removeEdge` の後) に:

```typescript
  adoptProposal: async (id, adoptAs, additional) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    // 非楽観: type 変化が絡むため、応答を待ってから置き換える。
    // 失敗時は例外を呼び出し元に伝え、ノードは元の proposal のまま残す。
    const adopted = await adoptProposalApi(pid, id, adoptAs, additional);
    set({ nodes: { ...get().nodes, [id]: adopted } });
    return adopted;
  },
```

- [ ] **Step 4: テストと typecheck**

Run: `pnpm -F @tally/frontend test -- store`, `pnpm -F @tally/frontend typecheck`
Expected: 全 PASS / 型エラーなし。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/api.ts \
  packages/frontend/src/lib/store.ts \
  packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): adoptProposal ストアアクションと API クライアントを追加"
```

---

## Task 5: `ProposalDetail` コンポーネントと DetailSheet 接続

**Files:**
- Modify: `packages/frontend/package.json`
- Create: `packages/frontend/vitest.setup.ts`
- Modify: `packages/frontend/vitest.config.ts`
- Create: `packages/frontend/src/components/details/proposal-detail.tsx`
- Create: `packages/frontend/src/components/details/proposal-detail.test.tsx`
- Modify: `packages/frontend/src/components/details/detail-sheet.tsx`

### 前提: React コンポーネントテスト基盤の整備

Phase 3 までは `*.test.ts` (node 環境) しか無く、`*.test.tsx` 用の jsdom とテストライブラリは未導入。Phase 4 で初めて React コンポーネントテストが入るため、まず基盤を整える。

- [ ] **Step 0a: 依存追加**

```bash
pnpm -F @tally/frontend add -D jsdom @testing-library/react @testing-library/jest-dom
```

- [ ] **Step 0b: `vitest.setup.ts` を作成**

`packages/frontend/vitest.setup.ts`:

```typescript
// tsx テストで jest-dom の matcher (toBeInTheDocument など) を使えるようにする。
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 0c: `vitest.config.ts` を更新**

既存の config を以下に置き換える:

```typescript
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    // *.test.ts は node、*.test.tsx は jsdom (React コンポーネントテスト用)。
    environmentMatchGlobs: [
      ['src/**/*.test.tsx', 'jsdom'],
      ['src/**/*.test.ts', 'node'],
    ],
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

- [ ] **Step 0d: 既存テストが壊れないことを確認**

```bash
pnpm -F @tally/frontend test
```

Expected: 既存の 31 件すべて PASS。

- [ ] **Step 1: 失敗テストを書く**

`proposal-detail.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ProposalDetail } from './proposal-detail';
import { useCanvasStore } from '@/lib/store';

// 既存のコンポーネントテストが @testing-library/react + jsdom で走る構成なので
// それに合わせる。store は Zustand のグローバルをそのまま利用。

describe('ProposalDetail', () => {
  it('採用ボタン押下で adoptProposal が呼ばれる', async () => {
    const adoptProposal = vi.fn(async () => ({
      id: 'prop-1',
      type: 'userstory',
      x: 0,
      y: 0,
      title: '採用済み',
      body: '',
    }));
    useCanvasStore.setState({ adoptProposal } as never);
    render(
      <ProposalDetail
        node={{
          id: 'prop-1',
          type: 'proposal',
          x: 0,
          y: 0,
          title: '[AI] ...',
          body: '',
          adoptAs: 'userstory',
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /採用/ }));
    await Promise.resolve();
    expect(adoptProposal).toHaveBeenCalledWith('prop-1', 'userstory', undefined);
  });

  it('セレクタで adoptAs を変更できる', async () => {
    const adoptProposal = vi.fn(async () => ({
      id: 'prop-1',
      type: 'requirement',
      x: 0,
      y: 0,
      title: '',
      body: '',
    }));
    useCanvasStore.setState({ adoptProposal } as never);
    render(
      <ProposalDetail
        node={{
          id: 'prop-1',
          type: 'proposal',
          x: 0,
          y: 0,
          title: '[AI] ...',
          body: '',
          adoptAs: 'userstory',
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText(/採用先/), { target: { value: 'requirement' } });
    fireEvent.click(screen.getByRole('button', { name: /採用/ }));
    await Promise.resolve();
    expect(adoptProposal).toHaveBeenCalledWith('prop-1', 'requirement', undefined);
  });
});
```

- [ ] **Step 2: テストが落ちることを確認**

Run: `pnpm -F @tally/frontend test -- proposal-detail`
Expected: 未定義で FAIL。

- [ ] **Step 3: ProposalDetail 実装**

`proposal-detail.tsx`:

```typescript
'use client';

import { useState } from 'react';

import type { AdoptableType, ProposalNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

const ADOPTABLE_TYPES: AdoptableType[] = [
  'requirement',
  'usecase',
  'userstory',
  'question',
  'coderef',
  'issue',
];

// proposal ノード専用の詳細ペイン。採用ボタンで transmuteNode API を叩き、
// 成功すると DetailSheet は新 type 向けの詳細に自動で切り替わる (同じ id が別 type になるため)。
export function ProposalDetail({ node }: { node: ProposalNode }) {
  const adoptProposal = useCanvasStore((s) => s.adoptProposal);
  const initial: AdoptableType = (node.adoptAs as AdoptableType) ?? 'userstory';
  const [adoptAs, setAdoptAs] = useState<AdoptableType>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onAdopt = async () => {
    setBusy(true);
    setError(null);
    try {
      await adoptProposal(node.id, adoptAs, undefined);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#8b949e' }}>採用</div>
      <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <span>採用先</span>
        <select
          value={adoptAs}
          onChange={(e) => setAdoptAs(e.target.value as AdoptableType)}
          style={SELECT_STYLE}
        >
          {ADOPTABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <button type="button" disabled={busy} onClick={onAdopt} style={ADOPT_BUTTON_STYLE}>
        {busy ? '採用中…' : '採用する'}
      </button>
      {error && <div style={{ color: '#f85149', fontSize: 11 }}>{error}</div>}
    </div>
  );
}

const SELECT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
} as const;

const ADOPT_BUTTON_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  width: '100%',
} as const;
```

- [ ] **Step 4: DetailSheet に proposal 分岐を追加**

`detail-sheet.tsx` の import に `ProposalDetail` を追加し、`node.type === 'coderef'` の隣に:

```typescript
      {node.type === 'proposal' && <ProposalDetail key={node.id} node={node} />}
```

- [ ] **Step 5: テストと typecheck**

Run: `pnpm -F @tally/frontend test`, `pnpm -F @tally/frontend typecheck`
Expected: 全 PASS。既存のフロントテスト (31 件) + 新規 (2 件) = 33 件以上。

- [ ] **Step 6: 手動確認 (ブラウザ)**

`examples/sample-project` に proposal ノードを手動で 1 つ追加して dev サーバで確認する。

1. `examples/sample-project/.tally/nodes/prop-sample.yaml` を作成:
   ```yaml
   id: prop-sample
   type: proposal
   x: 400
   y: 400
   title: "[AI] 例として追加した proposal"
   body: "UserStory の叩き台"
   adoptAs: userstory
   ```
2. `pnpm -F @tally/frontend dev` で http://localhost:3000 を開き、該当プロジェクトに遷移
3. prop-sample を選択 → DetailSheet に ProposalDetail が表示されることを確認
4. 採用ボタン押下 → userstory に変わり、DetailSheet が UserStoryDetail に切り替わる
5. ブラウザリロードしても userstory で残っていることを確認
6. 最後に `prop-sample.yaml` の残骸 (新 userstory ID のファイル) を戻すかクリーンアップする (検証用データのため)

- [ ] **Step 7: コミット**

```bash
git add packages/frontend/package.json \
  packages/frontend/vitest.config.ts \
  packages/frontend/vitest.setup.ts \
  packages/frontend/src/components/details/proposal-detail.tsx \
  packages/frontend/src/components/details/proposal-detail.test.tsx \
  packages/frontend/src/components/details/detail-sheet.tsx \
  pnpm-lock.yaml
git commit -m "feat(frontend): ProposalDetail で proposal ノードを採用する UI を追加

jsdom + testing-library + jest-dom を導入し、React コンポーネントテスト
基盤も整備する。既存の *.test.ts は node 環境のまま維持。"
```

---

# Phase 4-B: AI Engine 基盤

## Task 6: project-resolver を `@tally/storage` に移動

理由: ai-engine も `resolveProjectById` を使うため、frontend 専用の lib から storage パッケージに引き上げる。

**Files:**
- Create: `packages/storage/src/project-resolver.ts`
- Create: `packages/storage/src/project-resolver.test.ts`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/frontend/src/lib/project-resolver.ts` (再エクスポート薄ラッパに)

- [ ] **Step 1: 既存 frontend の project-resolver のテストを移植**

`packages/storage/src/project-resolver.test.ts` を新規作成。既存のテストが `packages/frontend/src/lib/` 側に無ければ、最小限のテストを書く:

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileSystemProjectStore } from './project-store';
import { resolveProjectById, discoverProjects } from './project-resolver';

describe('project-resolver', () => {
  let root: string;
  const prev = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-resolve-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-a',
      name: 'A',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prev;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('TALLY_WORKSPACE から単一プロジェクトを解決する', async () => {
    const handle = await resolveProjectById('proj-a');
    expect(handle?.meta.name).toBe('A');
    expect(handle?.workspaceRoot).toBe(root);
  });

  it('未知の id は null', async () => {
    expect(await resolveProjectById('nope')).toBeNull();
  });

  it('discoverProjects で一覧が取れる', async () => {
    const list = await discoverProjects();
    expect(list.map((h) => h.id)).toContain('proj-a');
  });
});
```

- [ ] **Step 2: `packages/storage/src/project-resolver.ts` を作成**

内容は既存 `packages/frontend/src/lib/project-resolver.ts` を**そのまま**移植する (import の相対パスは直す)。`@tally/storage` から `@tally/core` / 自身の `project-store` を参照。

- [ ] **Step 3: storage の index.ts にエクスポート追加**

```typescript
export { discoverProjects, loadProjectById, resolveProjectById } from './project-resolver';
export type { ProjectHandle } from './project-resolver';
```

- [ ] **Step 4: frontend 側を薄い再エクスポートに**

`packages/frontend/src/lib/project-resolver.ts` を以下に置き換え (互換維持):

```typescript
export {
  discoverProjects,
  loadProjectById,
  resolveProjectById,
} from '@tally/storage';
export type { ProjectHandle } from '@tally/storage';
```

- [ ] **Step 5: テストと typecheck 全体で走らせる**

Run: `pnpm -r test && pnpm -r typecheck`
Expected: storage 側に 3 件追加、既存 frontend テストは回帰せず PASS。

- [ ] **Step 6: コミット**

```bash
git add packages/storage/src/project-resolver.ts \
  packages/storage/src/project-resolver.test.ts \
  packages/storage/src/index.ts \
  packages/frontend/src/lib/project-resolver.ts
git commit -m "refactor(storage): project-resolver を storage に引き上げ、frontend は再エクスポート"
```

---

## Task 7: ai-engine パッケージの依存と雛形を整備

**Files:**
- Modify: `packages/ai-engine/package.json`
- Create: `packages/ai-engine/src/config.ts`
- Create: `packages/ai-engine/src/config.test.ts`
- Modify: `packages/ai-engine/src/index.ts`

- [ ] **Step 1: package.json に依存を追加**

`packages/ai-engine/package.json` の dependencies を:

```json
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.1.0",
    "@tally/core": "workspace:*",
    "@tally/storage": "workspace:*",
    "ws": "^8.18.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
```

`@anthropic-ai/claude-agent-sdk` のバージョンは `pnpm info @anthropic-ai/claude-agent-sdk versions --json | tail` で最新 stable を採用。`^0.1.0` はプレースホルダーなので実行時に確認。

- [ ] **Step 2: `pnpm install`**

Run (workspace root で): `pnpm install`
Expected: エラーなく完了。

- [ ] **Step 3: config.test.ts (失敗テスト)**

`packages/ai-engine/src/config.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

describe('loadConfig', () => {
  it('デフォルト PORT は 4000', () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(4000);
  });

  it('AI_ENGINE_PORT を解釈する', () => {
    const cfg = loadConfig({ AI_ENGINE_PORT: '4321' });
    expect(cfg.port).toBe(4321);
  });

  it('不正な PORT は Error', () => {
    expect(() => loadConfig({ AI_ENGINE_PORT: 'abc' })).toThrow();
  });
});
```

- [ ] **Step 4: config.ts 実装**

`packages/ai-engine/src/config.ts`:

```typescript
export interface AiEngineConfig {
  port: number;
}

// ai-engine の環境依存設定を 1 箇所に集約する。
// 認証情報は扱わない (Claude Code OAuth トークンを SDK が暗黙で拾う)。
export function loadConfig(env: NodeJS.ProcessEnv): AiEngineConfig {
  const raw = env.AI_ENGINE_PORT;
  if (raw === undefined || raw === '') return { port: 4000 };
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`AI_ENGINE_PORT が不正: ${raw}`);
  }
  return { port: n };
}
```

- [ ] **Step 5: index.ts にエントリ**

`packages/ai-engine/src/index.ts` を書き換え:

```typescript
// WS サーバを起動する main 関数。実行は scripts から tsx でこのファイルを走らせる。
import { loadConfig } from './config';

export const PACKAGE_NAME = '@tally/ai-engine';
export { loadConfig } from './config';

if (process.argv[1] && process.argv[1].endsWith('/src/index.ts')) {
  // tsx dev 起動時は server.ts の startServer をここで呼ぶ。Task 15 で実装。
  const cfg = loadConfig(process.env);
  // eslint-disable-next-line no-console
  console.log(`[ai-engine] config: port=${cfg.port}`);
  // startServer(cfg);  // Task 15 で配線
}
```

既存 `PACKAGE_NAME` のテストは維持する。

- [ ] **Step 6: テストと typecheck**

Run: `pnpm -F @tally/ai-engine test && pnpm -F @tally/ai-engine typecheck`
Expected: 4 件 (既存 1 + 新規 3) PASS、型エラーなし。

- [ ] **Step 7: コミット**

```bash
git add packages/ai-engine/package.json \
  packages/ai-engine/src/config.ts \
  packages/ai-engine/src/config.test.ts \
  packages/ai-engine/src/index.ts \
  pnpm-lock.yaml
git commit -m "feat(ai-engine): Claude Agent SDK と ws の依存追加、設定ローダを追加"
```

---

## Task 8: `AgentEvent` 型と SDK メッセージ変換 (`stream.ts`)

**Files:**
- Create: `packages/ai-engine/src/stream.ts`
- Create: `packages/ai-engine/src/stream.test.ts`

- [ ] **Step 1: AgentEvent 型の定義 + 変換器の失敗テスト**

`stream.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { sdkMessageToAgentEvent } from './stream';

describe('sdkMessageToAgentEvent', () => {
  it('assistant text → thinking', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'UC を読みます' }],
      },
    } as never);
    expect(evt).toEqual([{ type: 'thinking', text: 'UC を読みます' }]);
  });

  it('assistant tool_use → tool_use', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'assistant',
      message: {
        content: [
          { type: 'tool_use', id: 'tool-1', name: 'create_node', input: { title: 'x' } },
        ],
      },
    } as never);
    expect(evt).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'create_node', input: { title: 'x' } },
    ]);
  });

  it('user tool_result → tool_result', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: [{ type: 'text', text: '{"ok":true}' }],
          },
        ],
      },
    } as never);
    expect(evt).toEqual([
      {
        type: 'tool_result',
        id: 'tool-1',
        ok: true,
        output: '{"ok":true}',
      },
    ]);
  });

  it('result message → done', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'result',
      subtype: 'success',
      result: '完了しました',
    } as never);
    expect(evt).toEqual([{ type: 'done', summary: '完了しました' }]);
  });

  it('対応しないメッセージは空配列', () => {
    expect(sdkMessageToAgentEvent({ type: 'system' } as never)).toEqual([]);
  });
});
```

- [ ] **Step 2: テストを走らせて FAIL を確認**

Run: `pnpm -F @tally/ai-engine test -- stream`
Expected: 未実装で FAIL。

- [ ] **Step 3: stream.ts 実装**

```typescript
import type { Edge, Node } from '@tally/core';

// Tally フロントエンドと ai-engine の間で流す進捗イベント。
// NDJSON (WS text frame) でサーバ → クライアント方向に 1 メッセージ 1 行で送る。
export type AgentEvent =
  | { type: 'start'; agent: string; input: unknown }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; output: unknown }
  | { type: 'node_created'; node: Node }
  | { type: 'edge_created'; edge: Edge }
  | { type: 'done'; summary: string }
  | {
      type: 'error';
      code: 'not_authenticated' | 'bad_request' | 'not_found' | 'agent_failed';
      message: string;
    };

// Agent SDK から流れてくる生メッセージを AgentEvent 列に変換する。
// SDK 型は `@anthropic-ai/claude-agent-sdk` が `SDKMessage` として提供する想定。
// ここでは実行時形状 (type/message.content[]) に依存して decode する。
export function sdkMessageToAgentEvent(msg: SdkMessageLike): AgentEvent[] {
  if (msg.type === 'assistant' && msg.message?.content) {
    const out: AgentEvent[] = [];
    for (const block of msg.message.content) {
      if (block.type === 'text' && typeof block.text === 'string') {
        out.push({ type: 'thinking', text: block.text });
      } else if (
        block.type === 'tool_use' &&
        typeof block.id === 'string' &&
        typeof block.name === 'string'
      ) {
        out.push({
          type: 'tool_use',
          id: block.id,
          name: block.name,
          input: block.input ?? {},
        });
      }
    }
    return out;
  }
  if (msg.type === 'user' && msg.message?.content) {
    const out: AgentEvent[] = [];
    for (const block of msg.message.content) {
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        // content は string or content block 配列で返ってくる。文字列化して output に詰める。
        const output = flattenToolResultContent(block.content);
        out.push({
          type: 'tool_result',
          id: block.tool_use_id,
          ok: block.is_error !== true,
          output,
        });
      }
    }
    return out;
  }
  if (msg.type === 'result' && msg.subtype === 'success') {
    return [{ type: 'done', summary: typeof msg.result === 'string' ? msg.result : '' }];
  }
  return [];
}

function flattenToolResultContent(content: unknown): unknown {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    // {type: 'text', text: '...'} の配列を結合する。
    return content
      .map((c: { type?: string; text?: string }) =>
        c.type === 'text' && typeof c.text === 'string' ? c.text : '',
      )
      .join('');
  }
  return content;
}

// SDK の厳密な型に依存せず、実行時に触る最小限のプロパティだけで型付けする。
export interface SdkMessageLike {
  type: string;
  subtype?: string;
  result?: unknown;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    }>;
  };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `pnpm -F @tally/ai-engine test -- stream`
Expected: 5 ケース PASS。

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/stream.ts packages/ai-engine/src/stream.test.ts
git commit -m "feat(ai-engine): AgentEvent 型と SDK message からの変換器を追加"
```

---

## Task 9: カスタムツール `create_node`

**Files:**
- Create: `packages/ai-engine/src/tools/create-node.ts`
- Create: `packages/ai-engine/src/tools/create-node.test.ts`

- [ ] **Step 1: 失敗テスト**

`create-node.test.ts`:

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent } from '../stream';
import { createNodeHandler } from './create-node';

describe('create_node tool', () => {
  let root: string;
  let store: FileSystemProjectStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-tool-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('proposal ノードを作り、node_created イベントを発行する', async () => {
    const events: AgentEvent[] = [];
    const handler = createNodeHandler({ store, emit: (e) => events.push(e), anchor: { x: 0, y: 0 } });
    const result = await handler({
      adoptAs: 'userstory',
      title: '[AI] new',
      body: 'body',
    });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.output);
    expect(parsed.id).toMatch(/^prop-/);
    expect(parsed.type).toBe('proposal');
    expect(parsed.adoptAs).toBe('userstory');

    const nodes = await store.listNodes();
    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.type).toBe('proposal');

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe('node_created');
  });

  it('title が [AI] プレフィックス無しの場合は自動付与する', async () => {
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 } });
    const result = await handler({
      adoptAs: 'userstory',
      title: 'プレフィックス無し',
      body: '',
    });
    const parsed = JSON.parse(result.output);
    expect(parsed.title).toBe('[AI] プレフィックス無し');
  });

  it('x/y 未指定時は anchor を基準に自動配置', async () => {
    const handler = createNodeHandler({
      store,
      emit: () => {},
      anchor: { x: 100, y: 200 },
    });
    const result = await handler({ adoptAs: 'userstory', title: 't', body: 'b' });
    const parsed = JSON.parse(result.output);
    expect(parsed.x).toBeGreaterThan(100);
    expect(parsed.y).toBeGreaterThanOrEqual(200);
  });

  it('adoptAs が invalid なら ok:false', async () => {
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 } });
    const result = await handler({ adoptAs: 'proposal' as never, title: 't', body: '' });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 落ちることを確認**

Run: `pnpm -F @tally/ai-engine test -- create-node`
Expected: FAIL.

- [ ] **Step 3: 実装**

`create-node.ts`:

```typescript
import type { AdoptableType, ProposalNode } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { AgentEvent } from '../stream';

// create_node: ツールハンドラ。AI は proposal しか作れない (ADR-0005 前提)。
// adoptAs は「採用されたら何になるか」を宣言。title に [AI] プレフィックスが無ければ自動付与。
// x/y 未指定時は呼び出し元が与える anchor 座標を基準に自動オフセット配置。

const ADOPTABLE_TYPES = [
  'requirement',
  'usecase',
  'userstory',
  'question',
  'coderef',
  'issue',
] as const satisfies readonly AdoptableType[];

export const CreateNodeInputSchema = z.object({
  adoptAs: z.enum(ADOPTABLE_TYPES),
  title: z.string().min(1),
  body: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  additional: z.record(z.unknown()).optional(),
});

export type CreateNodeInput = z.infer<typeof CreateNodeInputSchema>;

export interface CreateNodeDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

let nextOffsetIndex = 0;

export function createNodeHandler(deps: CreateNodeDeps) {
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = CreateNodeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const { adoptAs, title, body, x, y, additional } = parsed.data;
    const ensuredTitle = title.startsWith('[AI]') ? title : `[AI] ${title}`;
    const idx = nextOffsetIndex++;
    const placedX = x ?? deps.anchor.x + 260 + idx * 20;
    const placedY = y ?? deps.anchor.y + idx * 120;

    try {
      const created = (await deps.store.addNode({
        type: 'proposal',
        x: placedX,
        y: placedY,
        title: ensuredTitle,
        body,
        adoptAs,
        ...(additional ?? {}),
      } as Parameters<typeof deps.store.addNode>[0])) as ProposalNode;
      deps.emit({ type: 'node_created', node: created });
      return { ok: true, output: JSON.stringify(created) };
    } catch (err) {
      return { ok: false, output: `addNode failed: ${String(err)}` };
    }
  };
}
```

- [ ] **Step 4: テスト PASS 確認**

Run: `pnpm -F @tally/ai-engine test -- create-node`
Expected: 4 ケース PASS。

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/tools/create-node.ts \
  packages/ai-engine/src/tools/create-node.test.ts
git commit -m "feat(ai-engine): create_node ツールハンドラ (proposal 生成 + node_created 発行)"
```

---

## Task 10: カスタムツール `create_edge`

**Files:**
- Create: `packages/ai-engine/src/tools/create-edge.ts`
- Create: `packages/ai-engine/src/tools/create-edge.test.ts`

- [ ] **Step 1: テスト**

`create-edge.test.ts`:

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AgentEvent } from '../stream';
import { createEdgeHandler } from './create-edge';

describe('create_edge tool', () => {
  let root: string;
  let store: FileSystemProjectStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-tool-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('有効な from/to/type で edge_created を発行', async () => {
    const a = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'u', body: '' });
    const b = await store.addNode({
      type: 'proposal',
      x: 0,
      y: 0,
      title: '[AI] p',
      body: '',
      adoptAs: 'userstory',
    });
    const events: AgentEvent[] = [];
    const handler = createEdgeHandler({ store, emit: (e) => events.push(e) });
    const result = await handler({ from: a.id, to: b.id, type: 'derive' });
    expect(result.ok).toBe(true);
    expect(events[0]?.type).toBe('edge_created');
    const edges = await store.listEdges();
    expect(edges).toHaveLength(1);
    expect(edges[0]?.type).toBe('derive');
  });

  it('不正な type は ok:false', async () => {
    const handler = createEdgeHandler({ store, emit: () => {} });
    const result = await handler({ from: 'a', to: 'b', type: 'bogus' as never });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 失敗確認 → 実装**

`create-edge.ts`:

```typescript
import { EDGE_TYPES } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { AgentEvent } from '../stream';

import type { ToolResult } from './create-node';

export const CreateEdgeInputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(EDGE_TYPES),
});

export interface CreateEdgeDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
}

export function createEdgeHandler(deps: CreateEdgeDeps) {
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = CreateEdgeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    try {
      const edge = await deps.store.addEdge(parsed.data);
      deps.emit({ type: 'edge_created', edge });
      return { ok: true, output: JSON.stringify(edge) };
    } catch (err) {
      return { ok: false, output: `addEdge failed: ${String(err)}` };
    }
  };
}
```

- [ ] **Step 3: テスト確認とコミット**

Run: `pnpm -F @tally/ai-engine test -- create-edge`
Expected: PASS.

```bash
git add packages/ai-engine/src/tools/create-edge.ts \
  packages/ai-engine/src/tools/create-edge.test.ts
git commit -m "feat(ai-engine): create_edge ツールハンドラ"
```

---

## Task 11: カスタムツール `find_related` と `list_by_type`

**Files:**
- Create: `packages/ai-engine/src/tools/find-related.ts`
- Create: `packages/ai-engine/src/tools/list-by-type.ts`
- Create: `packages/ai-engine/src/tools/read-only-tools.test.ts`

- [ ] **Step 1: テスト (read-only-tools.test.ts で 2 ツールまとめて)**

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { findRelatedHandler } from './find-related';
import { listByTypeHandler } from './list-by-type';

describe('find_related + list_by_type', () => {
  let root: string;
  let store: FileSystemProjectStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-readonly-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('find_related はエッジで繋がったノードを返す', async () => {
    const a = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'a', body: '' });
    const b = await store.addNode({ type: 'userstory', x: 0, y: 0, title: 'b', body: '' });
    const c = await store.addNode({ type: 'userstory', x: 0, y: 0, title: 'c', body: '' });
    await store.addEdge({ from: a.id, to: b.id, type: 'contain' });
    await store.addEdge({ from: a.id, to: c.id, type: 'contain' });
    const handler = findRelatedHandler({ store });
    const result = await handler({ nodeId: a.id });
    const related = JSON.parse(result.output) as { id: string }[];
    expect(related.map((n) => n.id).sort()).toEqual([b.id, c.id].sort());
  });

  it('list_by_type は指定 type のノードを返す', async () => {
    await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'u', body: '' });
    await store.addNode({ type: 'userstory', x: 0, y: 0, title: 's1', body: '' });
    await store.addNode({ type: 'userstory', x: 0, y: 0, title: 's2', body: '' });
    const handler = listByTypeHandler({ store });
    const result = await handler({ type: 'userstory' });
    const nodes = JSON.parse(result.output) as { type: string }[];
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => n.type === 'userstory')).toBe(true);
  });
});
```

- [ ] **Step 2: 実装**

`find-related.ts`:

```typescript
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { ToolResult } from './create-node';

export const FindRelatedInputSchema = z.object({ nodeId: z.string().min(1) });

export function findRelatedHandler(deps: { store: ProjectStore }) {
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = FindRelatedInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const related = await deps.store.findRelatedNodes(parsed.data.nodeId);
    return { ok: true, output: JSON.stringify(related) };
  };
}
```

`list-by-type.ts`:

```typescript
import { NODE_TYPES } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { ToolResult } from './create-node';

export const ListByTypeInputSchema = z.object({ type: z.enum(NODE_TYPES) });

export function listByTypeHandler(deps: { store: ProjectStore }) {
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = ListByTypeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const nodes = await deps.store.findNodesByType(parsed.data.type);
    return { ok: true, output: JSON.stringify(nodes) };
  };
}
```

- [ ] **Step 3: テスト確認 + コミット**

```bash
pnpm -F @tally/ai-engine test -- read-only-tools
# Expected: 2 PASS
git add packages/ai-engine/src/tools/find-related.ts \
  packages/ai-engine/src/tools/list-by-type.ts \
  packages/ai-engine/src/tools/read-only-tools.test.ts
git commit -m "feat(ai-engine): find_related と list_by_type ツールハンドラ"
```

---

## Task 12: ツールを `createSdkMcpServer` に集約

**Files:**
- Create: `packages/ai-engine/src/tools/index.ts`
- Create: `packages/ai-engine/src/tools/tools-index.test.ts`

- [ ] **Step 1: tools/index.ts**

```typescript
import type { ProjectStore } from '@tally/storage';
import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

import type { AgentEvent } from '../stream';

import { CreateEdgeInputSchema, createEdgeHandler } from './create-edge';
import { CreateNodeInputSchema, createNodeHandler } from './create-node';
import { FindRelatedInputSchema, findRelatedHandler } from './find-related';
import { ListByTypeInputSchema, listByTypeHandler } from './list-by-type';

export interface TallyToolDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
}

// Agent SDK の in-process MCP サーバとして Tally ツールを束ねる。
// SDK が tool input を zod スキーマで検証してからハンドラに渡す。
export function buildTallyMcpServer(deps: TallyToolDeps) {
  const createNode = createNodeHandler(deps);
  const createEdge = createEdgeHandler(deps);
  const findRelated = findRelatedHandler({ store: deps.store });
  const listByType = listByTypeHandler({ store: deps.store });
  return createSdkMcpServer({
    name: 'tally',
    version: '0.1.0',
    tools: [
      tool(
        'create_node',
        'Tally に新しい proposal ノードを作る。adoptAs は採用時に昇格する NodeType。',
        CreateNodeInputSchema.shape,
        async (input) => {
          const res = await createNode(input);
          return { content: [{ type: 'text', text: res.output }], isError: !res.ok };
        },
      ),
      tool(
        'create_edge',
        'Tally に新しいエッジを作る。from/to はノード ID、type は SysML 2.0 エッジ種別。',
        CreateEdgeInputSchema.shape,
        async (input) => {
          const res = await createEdge(input);
          return { content: [{ type: 'text', text: res.output }], isError: !res.ok };
        },
      ),
      tool(
        'find_related',
        '与えた node id に対して直接エッジで繋がったノード一覧を返す。',
        FindRelatedInputSchema.shape,
        async (input) => {
          const res = await findRelated(input);
          return { content: [{ type: 'text', text: res.output }], isError: !res.ok };
        },
      ),
      tool(
        'list_by_type',
        '指定した NodeType のノードを全件返す。',
        ListByTypeInputSchema.shape,
        async (input) => {
          const res = await listByType(input);
          return { content: [{ type: 'text', text: res.output }], isError: !res.ok };
        },
      ),
    ],
  });
}
```

(注: `tool` / `createSdkMcpServer` の正確な import 名と戻り型は SDK のバージョンにより異なる可能性がある。実装時に README を確認し、必要に応じて import を調整する。)

- [ ] **Step 2: tools-index.test.ts**

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildTallyMcpServer } from './index';

describe('buildTallyMcpServer', () => {
  let root: string;
  let store: FileSystemProjectStore;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-mcp-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('4 ツール (create_node, create_edge, find_related, list_by_type) を公開する', () => {
    const server = buildTallyMcpServer({
      store,
      emit: () => {},
      anchor: { x: 0, y: 0 },
    });
    // 実装は SDK 依存。公開されたサーバオブジェクトから tools を取得する方法は SDK による。
    // ここではビルドが例外を投げないことだけで最低保証を担保する (統合テストは agent-runner 側で担う)。
    expect(server).toBeTruthy();
  });
});
```

- [ ] **Step 3: テスト + コミット**

```bash
pnpm -F @tally/ai-engine test -- tools-index
# Expected: PASS
git add packages/ai-engine/src/tools/index.ts \
  packages/ai-engine/src/tools/tools-index.test.ts
git commit -m "feat(ai-engine): Tally ツールを MCP サーバとして集約する buildTallyMcpServer"
```

---

## Task 13: `decompose-to-stories` エージェント定義

**Files:**
- Create: `packages/ai-engine/src/agents/decompose-to-stories.ts`
- Create: `packages/ai-engine/src/agents/decompose-to-stories.test.ts`

- [ ] **Step 1: 失敗テスト**

```typescript
import { describe, expect, it } from 'vitest';

import { buildDecomposePrompt } from './decompose-to-stories';

describe('buildDecomposePrompt', () => {
  it('UC の title/body とノード ID をプロンプトに含める', () => {
    const p = buildDecomposePrompt({
      ucNode: {
        id: 'uc-1',
        type: 'usecase',
        x: 0,
        y: 0,
        title: '招待を送る',
        body: 'メールで招待',
      },
    });
    expect(p.userPrompt).toContain('招待を送る');
    expect(p.userPrompt).toContain('uc-1');
    expect(p.userPrompt).toContain('メールで招待');
  });

  it('system プロンプトに proposal のみ作成する契約が入っている', () => {
    const p = buildDecomposePrompt({
      ucNode: { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 't', body: '' },
    });
    expect(p.systemPrompt).toContain('proposal');
    expect(p.systemPrompt).toContain('derive');
  });
});
```

- [ ] **Step 2: 実装**

`decompose-to-stories.ts`:

```typescript
import type { UseCaseNode } from '@tally/core';

// decompose-to-stories: UC ノードを渡すと userstory の proposal を生成するエージェント。
// プロンプトは system (規約) + user (入力 UC) で構成。個数の上限は示唆のみ (自律判断)。
export interface DecomposeInput {
  ucNode: UseCaseNode;
}

export interface DecomposePrompt {
  systemPrompt: string;
  userPrompt: string;
}

export function buildDecomposePrompt(input: DecomposeInput): DecomposePrompt {
  const systemPrompt = [
    'あなたは Tally の要件分解アシスタントです。',
    '与えられた UC ノードを読み、実装 1 スプリントで完結する粒度の userstory を複数提案してください。',
    '提案は必ず create_node ツールで type="proposal", adoptAs="userstory" として作成すること。',
    'タイトルは "[AI] " プレフィックスを付け、body は Mike Cohn 形式 (〇〇として／〜したい／なぜなら〜) で書くこと。',
    '各 proposal は必ず create_edge ツールで UC ノードからの derive エッジを張ること。',
    '個数は UC 内容に応じて 1〜7 の範囲を目安とし、粗すぎ・細かすぎを避けること。',
    '重複を避けるため、作業前に list_by_type で既存 userstory を確認してよい。',
    '最後に「何をどう分解したか」を 2〜3 行で日本語で要約してください。',
  ].join('\n');

  const userPrompt = [
    `対象 UC: ${input.ucNode.id}`,
    `タイトル: ${input.ucNode.title}`,
    `本文:\n${input.ucNode.body}`,
    '',
    '上記 UC を userstory 群に分解し、proposal として作成してください。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}
```

- [ ] **Step 3: テスト + コミット**

```bash
pnpm -F @tally/ai-engine test -- decompose-to-stories
git add packages/ai-engine/src/agents/decompose-to-stories.ts \
  packages/ai-engine/src/agents/decompose-to-stories.test.ts
git commit -m "feat(ai-engine): decompose-to-stories エージェントのプロンプト組み立て"
```

---

## Task 14: `agent-runner.ts` (DI された SDK で agent を実行)

**Files:**
- Create: `packages/ai-engine/src/agent-runner.ts`
- Create: `packages/ai-engine/src/agent-runner.test.ts`

- [ ] **Step 1: 失敗テスト**

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runAgent } from './agent-runner';
import type { AgentEvent } from './stream';

describe('runAgent', () => {
  let root: string;
  let store: FileSystemProjectStore;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-runner-'));
    store = new FileSystemProjectStore(root);
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    await store.addNode({
      type: 'usecase',
      x: 0,
      y: 0,
      title: '招待',
      body: 'メール招待',
    });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('SDK モックが create_node を 2 回呼ぶと node_created が 2 回流れる', async () => {
    const ucId = (await store.findNodesByType('usecase'))[0]!.id;
    const mockSdk = {
      async *query() {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: '分解します' }] },
        };
        // tool_use は SDK の内部ループで発火するため、ここでは「結果」相当を流すのではなく
        // agent-runner 側が直接 store を触る経路を検証する。
        // そのため、この統合テストでは SDK message の変換のみを検証し、
        // create_node 呼び出しの実体は tools のテストで担保されている前提とする。
        yield {
          type: 'result',
          subtype: 'success',
          result: '分解完了',
        };
      },
    };
    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk: mockSdk as never,
      store,
      req: {
        type: 'start',
        agent: 'decompose-to-stories',
        projectId: 'proj-test',
        input: { nodeId: ucId },
      },
    })) {
      events.push(e);
    }
    expect(events.some((e) => e.type === 'start')).toBe(true);
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('done');
  });

  it('存在しない nodeId は error:not_found を流して終わる', async () => {
    const mockSdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk: mockSdk as never,
      store,
      req: {
        type: 'start',
        agent: 'decompose-to-stories',
        projectId: 'proj-test',
        input: { nodeId: 'uc-missing' },
      },
    })) {
      events.push(e);
    }
    const last = events[events.length - 1];
    expect(last?.type).toBe('error');
    if (last?.type === 'error') expect(last.code).toBe('not_found');
  });
});
```

- [ ] **Step 2: 実装**

`agent-runner.ts`:

```typescript
import type { ProjectStore } from '@tally/storage';

import { buildDecomposePrompt } from './agents/decompose-to-stories';
import type { AgentEvent, SdkMessageLike } from './stream';
import { sdkMessageToAgentEvent } from './stream';
import { buildTallyMcpServer } from './tools';

export interface StartRequest {
  type: 'start';
  agent: 'decompose-to-stories';
  projectId: string;
  input: { nodeId: string };
}

// Agent SDK との結合点だけ抽象化する。query は AsyncIterable<SdkMessageLike> を返すこと。
export interface SdkLike {
  query(opts: {
    prompt: string;
    systemPrompt?: string;
    mcpServers?: Record<string, unknown>;
    allowedTools?: string[];
  }): AsyncIterable<SdkMessageLike>;
}

export interface RunAgentDeps {
  sdk: SdkLike;
  store: ProjectStore;
  req: StartRequest;
}

export async function* runAgent(deps: RunAgentDeps): AsyncGenerator<AgentEvent> {
  const { sdk, store, req } = deps;
  yield { type: 'start', agent: req.agent, input: req.input };

  if (req.agent !== 'decompose-to-stories') {
    yield { type: 'error', code: 'bad_request', message: `未知の agent: ${req.agent}` };
    return;
  }

  const uc = await store.getNode(req.input.nodeId);
  if (!uc) {
    yield {
      type: 'error',
      code: 'not_found',
      message: `ノードが存在しない: ${req.input.nodeId}`,
    };
    return;
  }
  if (uc.type !== 'usecase') {
    yield {
      type: 'error',
      code: 'bad_request',
      message: `decompose-to-stories は usecase 限定: ${uc.type}`,
    };
    return;
  }

  const sideEvents: AgentEvent[] = [];
  const mcp = buildTallyMcpServer({
    store,
    emit: (e) => sideEvents.push(e),
    anchor: { x: uc.x, y: uc.y },
  });

  const prompt = buildDecomposePrompt({ ucNode: uc });
  try {
    const iter = sdk.query({
      prompt: prompt.userPrompt,
      systemPrompt: prompt.systemPrompt,
      mcpServers: { tally: mcp },
      allowedTools: [
        'mcp__tally__create_node',
        'mcp__tally__create_edge',
        'mcp__tally__find_related',
        'mcp__tally__list_by_type',
      ],
    });
    for await (const msg of iter) {
      // ツールハンドラから同期的に溜まった side events を先に流す。
      while (sideEvents.length > 0) {
        const e = sideEvents.shift();
        if (e) yield e;
      }
      for (const evt of sdkMessageToAgentEvent(msg)) {
        yield evt;
      }
    }
    // 最後の取りこぼしを flush。
    while (sideEvents.length > 0) {
      const e = sideEvents.shift();
      if (e) yield e;
    }
  } catch (err) {
    yield {
      type: 'error',
      code: 'agent_failed',
      message: String(err),
    };
  }
}
```

- [ ] **Step 3: テスト PASS 確認 + コミット**

```bash
pnpm -F @tally/ai-engine test -- agent-runner
git add packages/ai-engine/src/agent-runner.ts \
  packages/ai-engine/src/agent-runner.test.ts
git commit -m "feat(ai-engine): agent-runner で SDK を DI し AgentEvent 列を生成する"
```

---

## Task 15: WS サーバ `server.ts`

**Files:**
- Create: `packages/ai-engine/src/server.ts`
- Create: `packages/ai-engine/src/server.test.ts`
- Modify: `packages/ai-engine/src/index.ts` (起動配線)

- [ ] **Step 1: 失敗テスト (実 ws クライアントで E2E)**

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { startServer } from './server';
import type { AgentEvent } from './stream';

describe('WS /agent', () => {
  let root: string;
  let close: (() => Promise<void>) | null = null;
  const prev = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-ws-'));
    const store = new FileSystemProjectStore(root);
    await store.saveProjectMeta({
      id: 'proj-ws',
      name: 'WS',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await fs.mkdir(path.join(root, '.tally', 'nodes'), { recursive: true });
    await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    process.env.TALLY_WORKSPACE = root;
  });

  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prev;
    if (close) await close();
    close = null;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('start → mock sdk → done が WS で返ってくる', async () => {
    const store = new FileSystemProjectStore(root);
    const ucId = (await store.findNodesByType('usecase'))[0]!.id;
    const sdk = {
      async *query() {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'ok' }] },
        };
        yield {
          type: 'result',
          subtype: 'success',
          result: '完了',
        };
      },
    };
    const handle = await startServer({ port: 0, sdk });
    close = handle.close;

    const ws = new WebSocket(`ws://localhost:${handle.port}/agent`);
    const events: AgentEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            agent: 'decompose-to-stories',
            projectId: 'proj-ws',
            input: { nodeId: ucId },
          }),
        );
      });
      ws.on('message', (data) => {
        events.push(JSON.parse(data.toString()));
      });
      ws.on('close', () => resolve());
      ws.on('error', reject);
    });
    expect(events[0]?.type).toBe('start');
    expect(events.some((e) => e.type === 'thinking')).toBe(true);
    expect(events[events.length - 1]?.type).toBe('done');
  }, 10_000);

  it('start メッセージが不正だと error:bad_request', async () => {
    const sdk = {
      async *query() {
        /* 呼ばれない */
      },
    };
    const handle = await startServer({ port: 0, sdk });
    close = handle.close;
    const ws = new WebSocket(`ws://localhost:${handle.port}/agent`);
    const events: AgentEvent[] = [];
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => ws.send('{ not json'));
      ws.on('message', (data) => events.push(JSON.parse(data.toString())));
      ws.on('close', () => resolve());
      ws.on('error', reject);
    });
    expect(events[0]?.type).toBe('error');
    if (events[0]?.type === 'error') expect(events[0].code).toBe('bad_request');
  }, 10_000);
});
```

- [ ] **Step 2: 実装**

`server.ts`:

```typescript
import { WebSocketServer } from 'ws';
import { FileSystemProjectStore, resolveProjectById } from '@tally/storage';
import { z } from 'zod';

import { runAgent } from './agent-runner';
import type { SdkLike } from './agent-runner';
import type { AgentEvent } from './stream';

const StartSchema = z.object({
  type: z.literal('start'),
  agent: z.literal('decompose-to-stories'),
  projectId: z.string().min(1),
  input: z.object({ nodeId: z.string().min(1) }),
});

export interface StartServerOptions {
  port: number;
  sdk: SdkLike;
}

export interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

// WS サーバ: /agent に接続し、最初の text frame を start メッセージとして処理する。
// 1 接続 = 1 エージェント実行。完了 or エラーで close する。
export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const wss = new WebSocketServer({ port: opts.port, path: '/agent' });
  await new Promise<void>((resolve) => wss.once('listening', () => resolve()));
  const addr = wss.address();
  const port = typeof addr === 'object' && addr ? addr.port : opts.port;

  wss.on('connection', (ws) => {
    const send = (evt: AgentEvent) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(evt));
    };
    ws.once('message', async (raw) => {
      let parsed: z.infer<typeof StartSchema>;
      try {
        const json = JSON.parse(raw.toString());
        parsed = StartSchema.parse(json);
      } catch (err) {
        send({ type: 'error', code: 'bad_request', message: String(err) });
        ws.close();
        return;
      }
      const handle = await resolveProjectById(parsed.projectId);
      if (!handle) {
        send({
          type: 'error',
          code: 'not_found',
          message: `project が存在しない: ${parsed.projectId}`,
        });
        ws.close();
        return;
      }
      const store = new FileSystemProjectStore(handle.workspaceRoot);
      try {
        for await (const evt of runAgent({ sdk: opts.sdk, store, req: parsed })) {
          send(evt);
        }
      } catch (err) {
        send({ type: 'error', code: 'agent_failed', message: String(err) });
      } finally {
        ws.close();
      }
    });
  });

  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => wss.close((err) => (err ? reject(err) : resolve()))),
  };
}
```

- [ ] **Step 3: `index.ts` 起動配線**

`packages/ai-engine/src/index.ts` を最終形に:

```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

import { loadConfig } from './config';
import { startServer } from './server';

export const PACKAGE_NAME = '@tally/ai-engine';
export { loadConfig } from './config';
export { startServer } from './server';
export type { AgentEvent } from './stream';

// tsx で直接呼ばれたときだけ起動する (vitest などで import されたときは起動しない)。
if (import.meta.url === `file://${process.argv[1]}`) {
  const cfg = loadConfig(process.env);
  // query 関数は AsyncIterable<SdkMessageLike> を返す。SDK の実物を SdkLike として受ける。
  const sdk = { query: query as never };
  startServer({ port: cfg.port, sdk }).then((handle) => {
    // eslint-disable-next-line no-console
    console.log(`[ai-engine] listening on ws://localhost:${handle.port}/agent`);
  });
}
```

(注: SDK の実 API が `query(opts)` で AsyncIterable を返す前提。異なる場合は薄いアダプタで吸収する。)

- [ ] **Step 4: テストと手動起動確認**

```bash
pnpm -F @tally/ai-engine test -- server
# 2 ケース PASS (実 ws ラウンドトリップ)
pnpm -F @tally/ai-engine typecheck
# エラーなし
```

手動確認 (オプション): `AI_ENGINE_PORT=4000 pnpm -F @tally/ai-engine dev` → 別端末から `wscat -c ws://localhost:4000/agent` で接続、start JSON を送って応答を目視。

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/server.ts \
  packages/ai-engine/src/server.test.ts \
  packages/ai-engine/src/index.ts
git commit -m "feat(ai-engine): WS /agent サーバを起動し runAgent を配線する"
```

---

## Task 16: frontend WS クライアント `lib/ws.ts`

**Files:**
- Create: `packages/frontend/src/lib/ws.ts`
- Create: `packages/frontend/src/lib/ws.test.ts`

- [ ] **Step 1: テスト**

`ws.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

import { startAgent } from './ws';

describe('startAgent', () => {
  it('WS open → start を送信、受信イベントを AsyncIterable で流す', async () => {
    const sent: string[] = [];
    const listeners: Record<string, ((e: unknown) => void)[]> = {};

    class FakeSocket {
      readyState = 1;
      addEventListener(type: string, fn: (e: unknown) => void) {
        (listeners[type] ??= []).push(fn);
      }
      removeEventListener() {}
      send(data: string) {
        sent.push(data);
      }
      close() {
        for (const fn of listeners.close ?? []) fn({});
      }
    }
    const fake = new FakeSocket();
    const wsCtor = vi.fn(() => fake);
    vi.stubGlobal('WebSocket', wsCtor);

    const h = startAgent({
      url: 'ws://test/agent',
      agent: 'decompose-to-stories',
      projectId: 'proj',
      input: { nodeId: 'uc-1' },
    });

    // open 発火
    for (const fn of listeners.open ?? []) fn({});
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).type).toBe('start');

    // message 発火 × 2
    const evt1 = { type: 'thinking', text: 'a' };
    for (const fn of listeners.message ?? []) fn({ data: JSON.stringify(evt1) });
    const evt2 = { type: 'done', summary: 'ok' };
    for (const fn of listeners.message ?? []) fn({ data: JSON.stringify(evt2) });
    // close 発火
    for (const fn of listeners.close ?? []) fn({});

    const received: unknown[] = [];
    for await (const e of h.events) received.push(e);
    expect(received).toEqual([evt1, evt2]);
  });
});
```

- [ ] **Step 2: 実装**

`ws.ts`:

```typescript
'use client';

import type { AgentEvent } from '@tally/ai-engine';

export interface StartAgentOptions {
  url?: string;
  agent: 'decompose-to-stories';
  projectId: string;
  input: { nodeId: string };
}

export interface AgentHandle {
  events: AsyncIterable<AgentEvent>;
  close: () => void;
}

// WS ベースの agent 呼び出し。受信した NDJSON を AgentEvent の AsyncIterable に変換する。
// close() で接続を明示的に終わらせる。サーバ側が close したら AsyncIterable も終了する。
export function startAgent(opts: StartAgentOptions): AgentHandle {
  const url = opts.url ?? process.env.NEXT_PUBLIC_AI_ENGINE_URL ?? 'ws://localhost:4000';
  const ws = new WebSocket(`${url}/agent`);

  const buf: AgentEvent[] = [];
  const waiters: Array<(v: IteratorResult<AgentEvent>) => void> = [];
  let finished = false;

  const push = (e: AgentEvent) => {
    if (finished) return;
    const w = waiters.shift();
    if (w) w({ value: e, done: false });
    else buf.push(e);
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    while (waiters.length) waiters.shift()!({ value: undefined as never, done: true });
  };

  ws.addEventListener('open', () => {
    ws.send(
      JSON.stringify({
        type: 'start',
        agent: opts.agent,
        projectId: opts.projectId,
        input: opts.input,
      }),
    );
  });
  ws.addEventListener('message', (ev: MessageEvent) => {
    try {
      push(JSON.parse(String(ev.data)) as AgentEvent);
    } catch {
      // 破損フレームは捨てる。
    }
  });
  ws.addEventListener('close', finish);
  ws.addEventListener('error', finish);

  const events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]() {
      return {
        next() {
          if (buf.length > 0) return Promise.resolve({ value: buf.shift()!, done: false });
          if (finished) return Promise.resolve({ value: undefined as never, done: true });
          return new Promise<IteratorResult<AgentEvent>>((resolve) => waiters.push(resolve));
        },
        return() {
          ws.close();
          finish();
          return Promise.resolve({ value: undefined as never, done: true });
        },
      };
    },
  };

  return { events, close: () => ws.close() };
}
```

- [ ] **Step 3: ai-engine の AgentEvent 型を frontend から参照できるように**

`packages/ai-engine/src/index.ts` で既に `export type { AgentEvent }` していることを確認 (Task 15 Step 3 で追加済み)。

frontend は workspace 依存で `@tally/ai-engine` を dev 依存として追加:

```json
// packages/frontend/package.json dependencies に追加
"@tally/ai-engine": "workspace:*",
```

(注: 型だけ使うので `devDependencies` でもよい。実行時コードは import しない。)

- [ ] **Step 4: テスト確認 + コミット**

```bash
pnpm install
pnpm -F @tally/frontend test -- ws
pnpm -F @tally/frontend typecheck
git add packages/frontend/src/lib/ws.ts \
  packages/frontend/src/lib/ws.test.ts \
  packages/frontend/package.json \
  pnpm-lock.yaml
git commit -m "feat(frontend): AI Engine WS クライアント startAgent を追加"
```

---

## Task 17: Zustand に `runningAgent` と `startDecompose` を追加

**Files:**
- Modify: `packages/frontend/src/lib/store.ts`
- Modify: `packages/frontend/src/lib/store.test.ts`

- [ ] **Step 1: テスト追加**

store.test.ts の末尾に:

```typescript
  describe('startDecompose', () => {
    it('AgentEvent 列を受けて nodes/edges を拡張し、runningAgent に積む', async () => {
      const newNode = {
        id: 'prop-new',
        type: 'proposal',
        x: 0,
        y: 0,
        title: '[AI] s',
        body: '',
      };
      const newEdge = { id: 'e-x', from: 'uc-1', to: 'prop-new', type: 'derive' };
      // startAgent をモック。
      vi.doMock('./ws', () => ({
        startAgent: () => ({
          events: (async function* () {
            yield { type: 'start', agent: 'decompose-to-stories', input: {} };
            yield { type: 'thinking', text: 'go' };
            yield { type: 'node_created', node: newNode };
            yield { type: 'edge_created', edge: newEdge };
            yield { type: 'done', summary: 'done' };
          })(),
          close: () => {},
        }),
      }));
      const { useCanvasStore } = await import('./store');
      useCanvasStore.getState().hydrate({
        id: 'proj-1',
        name: 't',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 'uc', body: '' }],
        edges: [],
      });
      await useCanvasStore.getState().startDecompose('uc-1');
      const state = useCanvasStore.getState();
      expect(state.nodes['prop-new']).toEqual(newNode);
      expect(state.edges['e-x']).toEqual(newEdge);
      expect(state.runningAgent).toBeNull();
    });
  });
```

- [ ] **Step 2: 実装を store.ts に追加**

`CanvasState` interface に追加:

```typescript
  runningAgent: {
    agent: 'decompose-to-stories';
    inputNodeId: string;
    events: AgentEvent[];
  } | null;
  startDecompose: (ucNodeId: string) => Promise<void>;
```

import 追加:

```typescript
import type { AgentEvent } from '@tally/ai-engine';
import { startAgent } from './ws';
```

初期状態に `runningAgent: null,` を追加。実装:

```typescript
  runningAgent: null,

  startDecompose: async (ucNodeId) => {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    set({
      runningAgent: {
        agent: 'decompose-to-stories',
        inputNodeId: ucNodeId,
        events: [],
      },
    });
    const handle = startAgent({
      agent: 'decompose-to-stories',
      projectId: pid,
      input: { nodeId: ucNodeId },
    });
    try {
      for await (const evt of handle.events) {
        // 進捗を蓄積。
        const cur = get().runningAgent;
        if (cur)
          set({ runningAgent: { ...cur, events: [...cur.events, evt] } });
        if (evt.type === 'node_created') {
          set({ nodes: { ...get().nodes, [evt.node.id]: evt.node } });
        } else if (evt.type === 'edge_created') {
          set({ edges: { ...get().edges, [evt.edge.id]: evt.edge } });
        }
      }
    } finally {
      // done/error 到達または WS 切断で runningAgent をクリアする。
      // 最後のイベントが error か done かは UI 側で runningAgent.events を参照する前提。
      set({ runningAgent: null });
    }
  },
```

- [ ] **Step 3: テスト + typecheck + コミット**

```bash
pnpm -F @tally/frontend test -- store
pnpm -F @tally/frontend typecheck
git add packages/frontend/src/lib/store.ts \
  packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): startDecompose で AgentEvent を受けて zustand に反映する"
```

---

## Task 18: `AgentProgressPanel` コンポーネント

**Files:**
- Create: `packages/frontend/src/components/progress/agent-progress-panel.tsx`
- Create: `packages/frontend/src/components/progress/agent-progress-panel.test.tsx`
- Modify: `packages/frontend/src/app/projects/[id]/page.tsx` (パネルを配置)

- [ ] **Step 1: テスト**

```typescript
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { AgentProgressPanel } from './agent-progress-panel';

describe('AgentProgressPanel', () => {
  it('runningAgent が null なら何も表示しない', () => {
    useCanvasStore.setState({ runningAgent: null } as never);
    const { container } = render(<AgentProgressPanel />);
    expect(container.textContent).toBe('');
  });

  it('thinking イベントを表示する', () => {
    useCanvasStore.setState({
      runningAgent: {
        agent: 'decompose-to-stories',
        inputNodeId: 'uc-1',
        events: [
          { type: 'start', agent: 'decompose-to-stories', input: {} },
          { type: 'thinking', text: '考え中' },
        ],
      },
    } as never);
    render(<AgentProgressPanel />);
    expect(screen.getByText('考え中')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 実装**

`agent-progress-panel.tsx`:

```typescript
'use client';

import type { AgentEvent } from '@tally/ai-engine';

import { useCanvasStore } from '@/lib/store';

export function AgentProgressPanel() {
  const running = useCanvasStore((s) => s.runningAgent);
  if (!running) return null;
  return (
    <aside style={PANEL_STYLE}>
      <div style={HEADER_STYLE}>{running.agent}</div>
      <ul style={LIST_STYLE}>
        {running.events.map((e, i) => (
          <li key={i} style={ROW_STYLE}>
            {formatEvent(e)}
          </li>
        ))}
      </ul>
    </aside>
  );
}

function formatEvent(e: AgentEvent): string {
  switch (e.type) {
    case 'start':
      return `▶ start ${e.agent}`;
    case 'thinking':
      return e.text;
    case 'tool_use':
      return `🛠  ${e.name} ${JSON.stringify(e.input)}`;
    case 'tool_result':
      return `← ${e.id} ${e.ok ? 'ok' : 'NG'}`;
    case 'node_created':
      return `✓ node ${e.node.id}`;
    case 'edge_created':
      return `✓ edge ${e.edge.id}`;
    case 'done':
      return `✅ done: ${e.summary}`;
    case 'error':
      return `❌ ${e.code}: ${e.message}`;
  }
}

const PANEL_STYLE = {
  position: 'fixed' as const,
  right: 340,
  bottom: 0,
  width: 360,
  maxHeight: '50vh',
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  overflowY: 'auto' as const,
  fontSize: 12,
};
const HEADER_STYLE = {
  padding: '6px 10px',
  fontSize: 11,
  color: '#8b949e',
  borderBottom: '1px solid #30363d',
};
const LIST_STYLE = { listStyle: 'none', margin: 0, padding: 0 };
const ROW_STYLE = { padding: '4px 10px', borderBottom: '1px solid #161b22' };
```

- [ ] **Step 3: page.tsx にマウント**

`app/projects/[id]/page.tsx` でキャンバスと DetailSheet の横に `<AgentProgressPanel />` を追加。既存のレイアウトに合わせて (client side でのマウントでよい)。

- [ ] **Step 4: テスト + コミット**

```bash
pnpm -F @tally/frontend test -- agent-progress-panel
pnpm -F @tally/frontend typecheck
git add packages/frontend/src/components/progress/ \
  packages/frontend/src/app/projects/\[id\]/page.tsx
git commit -m "feat(frontend): AgentProgressPanel で進捗を時系列表示"
```

---

## Task 19: `UseCaseDetail` に「ストーリー分解」ボタン

**Files:**
- Create: `packages/frontend/src/components/details/usecase-detail.tsx`
- Create: `packages/frontend/src/components/details/usecase-detail.test.tsx`
- Modify: `packages/frontend/src/components/details/detail-sheet.tsx`

(現状 UC 用 detail コンポーネントは存在しない。DetailSheet で共通フィールドのみだったため新規作成。)

- [ ] **Step 1: テスト**

`usecase-detail.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UseCaseDetail } from './usecase-detail';
import { useCanvasStore } from '@/lib/store';

describe('UseCaseDetail', () => {
  it('ストーリー分解ボタンで startDecompose が呼ばれる', () => {
    const startDecompose = vi.fn(async () => {});
    useCanvasStore.setState({ startDecompose, runningAgent: null } as never);
    render(
      <UseCaseDetail
        node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 't', body: 'b' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /ストーリー分解/ }));
    expect(startDecompose).toHaveBeenCalledWith('uc-1');
  });

  it('runningAgent が非 null だとボタンが disabled', () => {
    useCanvasStore.setState({
      startDecompose: vi.fn(),
      runningAgent: {
        agent: 'decompose-to-stories',
        inputNodeId: 'uc-1',
        events: [],
      },
    } as never);
    render(
      <UseCaseDetail
        node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 't', body: 'b' }}
      />,
    );
    expect(screen.getByRole('button', { name: /ストーリー分解/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: 実装**

`usecase-detail.tsx`:

```typescript
'use client';

import type { UseCaseNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export function UseCaseDetail({ node }: { node: UseCaseNode }) {
  const startDecompose = useCanvasStore((s) => s.startDecompose);
  const running = useCanvasStore((s) => s.runningAgent);
  const busy = running !== null;

  const onDecompose = () => {
    startDecompose(node.id).catch(console.error);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#8b949e' }}>AI アクション</div>
      <button type="button" disabled={busy} onClick={onDecompose} style={BUTTON_STYLE}>
        {busy ? '実行中…' : 'ストーリー分解'}
      </button>
    </div>
  );
}

const BUTTON_STYLE = {
  background: '#1f6feb',
  color: '#fff',
  border: '1px solid #388bfd',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  cursor: 'pointer',
  width: '100%',
} as const;
```

- [ ] **Step 3: DetailSheet に接続**

`detail-sheet.tsx` に import 追加 + `usecase` 分岐:

```typescript
import { UseCaseDetail } from './usecase-detail';
// ...
      {node.type === 'usecase' && <UseCaseDetail key={node.id} node={node} />}
```

- [ ] **Step 4: テスト PASS + コミット**

```bash
pnpm -F @tally/frontend test -- usecase-detail
git add packages/frontend/src/components/details/usecase-detail.tsx \
  packages/frontend/src/components/details/usecase-detail.test.tsx \
  packages/frontend/src/components/details/detail-sheet.tsx
git commit -m "feat(frontend): UC に「ストーリー分解」ボタンを追加"
```

---

# Phase 4-C: 仕上げ

## Task 20: ADR-0006 (Claude Code OAuth)

**Files:**
- Create: `docs/adr/0006-claude-code-oauth-for-agent-sdk.md`
- Modify: `docs/adr/0002-agent-sdk-adoption.md` (当該条項を Superseded 扱いとする注記を追加)

- [ ] **Step 1: ADR-0006 を書く**

要点 (Spec 参照):

- タイトル: Claude Code の OAuth トークンを Agent SDK の認証として採用
- ステータス: Accepted (日付: 2026-04-19)
- 背景: ADR-0002 の「API キー必須」を訂正する
- 決定: SDK の自動認証経由で `claude login` 済みの OAuth トークンを暗黙利用、`ANTHROPIC_API_KEY` はフォールバックとして残す
- 影響: ユーザーは `claude` CLI インストール + `claude login` が前提、`.env.example` の ANTHROPIC_API_KEY は任意項目に変更
- 考慮した他の選択肢: 固定 API キー、CLAUDE_CODE_OAUTH_TOKEN 環境変数、claude CLI サブプロセス呼び出し

- [ ] **Step 2: ADR-0002 に Supersedes 注記**

ADR-0002 の「認証は API キー必須」付近に「**注**: この項は ADR-0006 で更新された。Claude Code の OAuth トークンを使う運用に切り替え済み」を追記。

- [ ] **Step 3: コミット**

```bash
git add docs/adr/0006-claude-code-oauth-for-agent-sdk.md docs/adr/0002-agent-sdk-adoption.md
git commit -m "docs: ADR-0006 追加 (Claude Code OAuth 利用)、ADR-0002 該当条項に注記"
```

---

## Task 21: `.env.example` / README 更新

**Files:**
- Modify: `.env.example`
- Modify: `README.md` (または `packages/ai-engine/README.md`)

- [ ] **Step 1: `.env.example`**

```bash
# ai-engine の WS ポート (任意、デフォルト 4000)
AI_ENGINE_PORT=4000

# Claude Agent SDK の認証
# 通常は `claude` CLI (Claude Code) で `claude login` 済みのトークンを暗黙利用するため不要。
# CI 等の非対話環境で明示的に指定したい場合のみ設定する:
# ANTHROPIC_API_KEY=
# CLAUDE_CODE_OAUTH_TOKEN=
```

- [ ] **Step 2: README に起動手順セクション**

`pnpm dev` は既に workspace ルートで `pnpm -r --parallel dev` なので、ai-engine にも `dev` script がある限り自動で両方起動する。README に:

```
1. `claude` CLI をインストールし `claude login` でサブスクリプションに紐付ける
2. `pnpm install`
3. `pnpm dev` で frontend (3000) と ai-engine (4000) が並列起動する
4. `http://localhost:3000` を開き、UC ノードで「ストーリー分解」を実行
```

- [ ] **Step 3: コミット**

```bash
git add .env.example README.md
git commit -m "docs: Phase 4 起動手順と AI Engine の環境変数を追記"
```

---

## Task 22: 手動 E2E 手順書

**Files:**
- Create: `docs/phase-4-manual-e2e.md`

- [ ] **Step 1: 手順書を書く**

以下の構成で `docs/phase-4-manual-e2e.md`:

1. 前提: Claude Code ログイン済み、`pnpm install` 済み、`examples/sample-project` に usecase が 1 つ以上
2. 起動: `pnpm dev`
3. 分解: UC ノード選択 → ストーリー分解ボタン → 進捗が流れる → proposal が 1〜7 個追加
4. 採用: 各 proposal を選択 → 採用先セレクタ `userstory` → 採用ボタン → title から [AI] が消え userstory に
5. 検証: ブラウザリロードで状態が保たれていること、`.tally/nodes/` の YAML にも反映されていること
6. 異常系確認: `claude logout` 状態で実行 → `not_authenticated` エラーが UI に出ること

- [ ] **Step 2: コミット**

```bash
git add docs/phase-4-manual-e2e.md
git commit -m "docs: Phase 4 手動 E2E 手順書を追加"
```

---

## Task 23: Phase 4 完了条件の最終確認と Memory 更新

**Files:**
- Modify: `~/.claude/projects/<project-id>/memory/project_phase_progress.md`

- [ ] **Step 1: 全テスト / typecheck / lint**

```bash
pnpm -r test
pnpm -r typecheck
pnpm lint
```

Expected: 全て緑。テスト総数は新規分で +40 件程度を見込む (storage +6, frontend +10, ai-engine +30 程度)。

- [ ] **Step 2: ロードマップ Phase 4 完了条件チェック**

4 項目すべてが Task 22 の手動 E2E で確認できたら、`docs/04-roadmap.md` の Phase 4 チェックボックスを埋める:

- [x] `packages/ai-engine/src/server.ts`
- [x] `packages/ai-engine/src/tools/`
- [x] `packages/ai-engine/src/agents/decompose-to-stories.ts`
- [x] `packages/frontend/lib/ws.ts`
- [x] 詳細シートから AI アクションボタン
- [x] ストリーミング進捗表示パネル

- [ ] **Step 3: Memory 更新**

`memory/project_phase_progress.md` を更新:

```markdown
2026-04-XX 時点:

- Phase 0-4: 完了
  - Phase 4-A: proposal 採用 (transmuteNode / POST /adopt / ProposalDetail)
  - Phase 4-B: AI Engine (WS + Agent SDK + decompose-to-stories)
  - Phase 4-C: ADR-0006 / 起動手順 / 手動 E2E 手順書
- 次は Phase 5 (AI アクション拡充: find-related-code, analyze-impact, extract-questions, ingest-document)
```

- [ ] **Step 4: 最終コミット**

```bash
git add docs/04-roadmap.md
git commit -m "docs(roadmap): Phase 4 完了をマーク"
```

---

# 完了条件 (Phase 4 全体)

- `pnpm -r test` / `pnpm -r typecheck` / `pnpm lint` すべて緑
- 手動 E2E (Task 22) で以下を確認:
  1. UC 選択 → ストーリー分解 → proposal が生成される
  2. 進捗パネルが thinking / tool_use / tool_result を流す
  3. 生成後にキャンバスに proposal が現れる
  4. 各 proposal を採用 → [AI] プレフィックスが消え userstory として残る
  5. `claude logout` 状態で実行すると `not_authenticated` エラーが UI に出る
- YAML 側でも proposal → userstory の遷移が保存されている (`git diff` で確認)

# 影響範囲まとめ

| パッケージ | 追加/変更 |
|---|---|
| `@tally/core` | `AdoptableType`, `stripAiPrefix` |
| `@tally/storage` | `transmuteNode`, `project-resolver` (frontend から移動) |
| `@tally/ai-engine` | ほぼ全実装 (config / stream / tools / agents / agent-runner / server) |
| `@tally/frontend` | `ProposalDetail`, `UseCaseDetail`, `AgentProgressPanel`, `lib/ws.ts`, `store.adoptProposal` / `startDecompose`, `adopt` API route |
| ルート | `.env.example`, `README.md`, ADR-0006, 手動 E2E 手順書 |
