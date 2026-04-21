# Phase 5a: find-related-code 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** UC / requirement / userstory ノードから既存コードを探索して coderef proposal を生成する `find-related-code` エージェントを、agent registry 基盤 + codebasePath UI とともに投入する。

**Architecture:** ai-engine は `AGENT_REGISTRY` で複数エージェントを扱う構造に刷新。`decompose-to-stories` を registry に移し、`find-related-code` を並列で追加。エージェントごとに `allowedTools` と `cwd` を宣言し、SDK 呼び出し時に反映する。frontend は歯車 → project-settings-dialog で `codebasePath` を保存し、3 detail から共通ボタンで `find-related-code` を起動する。

**Tech Stack:** TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Next.js 15, Zustand, Zod, Vitest, Testing Library.

---

## 前提: 関連 spec と参照

- spec: `docs/superpowers/specs/2026-04-19-phase5a-find-related-code-design.md`
- 前段 Phase: `docs/04-roadmap.md` Phase 4 (完了済み)
- ADR: `docs/adr/0005-proposal-adoption.md` (採用時 additional の扱い)
- 既存資産: `packages/ai-engine/src/agent-runner.ts`, `agents/decompose-to-stories.ts`, `packages/frontend/src/lib/store.ts`

## ファイル構造

### ai-engine
- **新規** `packages/ai-engine/src/agents/registry.ts` — `AgentDefinition` 型、`AGENT_REGISTRY`
- **新規** `packages/ai-engine/src/agents/registry.test.ts`
- **新規** `packages/ai-engine/src/agents/find-related-code.ts` — プロンプト + `findRelatedCodeAgent`
- **新規** `packages/ai-engine/src/agents/find-related-code.test.ts`
- **変更** `packages/ai-engine/src/agents/decompose-to-stories.ts` — `decomposeToStoriesAgent` を追加 export
- **変更** `packages/ai-engine/src/agent-runner.ts` — registry 参照、`cwd`/`settingSources`/`workspaceRoot` 対応
- **変更** `packages/ai-engine/src/agent-runner.test.ts` — cwd / allowedTools の検証を拡張
- **変更** `packages/ai-engine/src/server.ts` — `StartSchema` agent を union、`workspaceRoot` を `runAgent` に渡す
- **変更** `packages/ai-engine/src/server.test.ts` — find-related-code の start 受理を検証

### core
- **変更** `packages/core/src/types.ts` — `AGENT_NAMES` / `AgentName` 追加
- **変更** `packages/core/src/schema.ts` — `ProposalNodeSchema` に `.passthrough()`
- **変更** `packages/core/src/index.ts` — 追加 export
- **変更** `packages/core/src/schema.test.ts` — passthrough の挙動テスト

### frontend
- **変更** `packages/frontend/src/lib/ws.ts` — `StartAgentOptions.agent: AgentName`
- **変更** `packages/frontend/src/lib/api.ts` — `patchProjectMeta`
- **変更** `packages/frontend/src/lib/api.test.ts`
- **変更** `packages/frontend/src/lib/store.ts` — `runAgentWS` 共通化、`startFindRelatedCode`、`patchProjectMeta`
- **変更** `packages/frontend/src/lib/store.test.ts`
- **変更** `packages/frontend/src/app/api/projects/[id]/route.ts` — PATCH 追加
- **新規** `packages/frontend/src/app/api/projects/[id]/route.test.ts`
- **新規** `packages/frontend/src/components/dialog/project-settings-dialog.tsx`
- **新規** `packages/frontend/src/components/dialog/project-settings-dialog.test.tsx`
- **新規** `packages/frontend/src/components/header/project-header-actions.tsx`
- **変更** `packages/frontend/src/app/projects/[id]/page.tsx` — header に `ProjectHeaderActions`
- **新規** `packages/frontend/src/components/ai-actions/find-related-code-button.tsx`
- **新規** `packages/frontend/src/components/ai-actions/find-related-code-button.test.tsx`
- **変更** `packages/frontend/src/components/details/usecase-detail.tsx` — ボタン追加
- **変更** `packages/frontend/src/components/details/requirement-detail.tsx` — ボタン追加
- **変更** `packages/frontend/src/components/details/userstory-detail.tsx` — ボタン追加
- **変更** `packages/frontend/src/components/details/proposal-detail.tsx` — additional 抽出
- **変更** `packages/frontend/src/components/details/proposal-detail.test.tsx`

### examples / docs
- **新規** `examples/taskflow-backend/README.md`
- **新規** `examples/taskflow-backend/src/invite.ts`
- **新規** `examples/taskflow-backend/src/mailer.ts`
- **新規** `docs/phase-5a-manual-e2e.md`
- **変更** `docs/04-roadmap.md` — Phase 5 タスクに進捗チェックを入れる

---

## Task 1: core に AgentName と ProposalNodeSchema passthrough を追加

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/schema.test.ts`

- [ ] **Step 1: passthrough のテストを追加**

`packages/core/src/schema.test.ts` の末尾（既存の describe 内、または新規 describe）に追加:

```typescript
describe('ProposalNodeSchema passthrough', () => {
  it('未知フィールド (filePath 等) を保持する', () => {
    const parsed = ProposalNodeSchema.parse({
      id: 'prop-1',
      type: 'proposal',
      x: 0,
      y: 0,
      title: '[AI] s',
      body: '',
      adoptAs: 'coderef',
      filePath: 'src/foo.ts',
      startLine: 10,
      endLine: 20,
    });
    expect((parsed as Record<string, unknown>).filePath).toBe('src/foo.ts');
    expect((parsed as Record<string, unknown>).startLine).toBe(10);
    expect((parsed as Record<string, unknown>).endLine).toBe(20);
  });
});
```

`ProposalNodeSchema` が既存 test で import できているか確認（必要なら top の import に追加）。

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
pnpm --filter @tally/core test -- schema
```

Expected: `ProposalNodeSchema passthrough` が FAIL（parsed.filePath が undefined）

- [ ] **Step 3: `ProposalNodeSchema` に `.passthrough()` を付ける**

`packages/core/src/schema.ts` の `ProposalNodeSchema`:

```typescript
export const ProposalNodeSchema = z
  .object({
    ...baseNodeShape,
    type: z.literal('proposal'),
    adoptAs: z.enum(NODE_TYPES).optional(),
    sourceAgentId: z.string().optional(),
  })
  .passthrough();
```

- [ ] **Step 4: `AgentName` 型を types.ts に追加**

`packages/core/src/types.ts` の末尾に追加:

```typescript
// AI エージェント名の集合。frontend / ai-engine / storage で共有する。
// 新しいエージェントを足すときは registry (ai-engine/src/agents/registry.ts) と
// ここの両方を更新する。
export const AGENT_NAMES = ['decompose-to-stories', 'find-related-code'] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
```

- [ ] **Step 5: `core/src/index.ts` から再エクスポート**

`packages/core/src/index.ts` の `export * from './types';` は既にあるため AGENT_NAMES / AgentName は自動で export される。確認のみ。

- [ ] **Step 6: core のテストが通ることを確認**

```bash
pnpm --filter @tally/core test
```

Expected: PASS (schema / types 含めすべて緑)

- [ ] **Step 7: コミット**

```bash
git add packages/core/src/types.ts packages/core/src/schema.ts packages/core/src/schema.test.ts
git commit -m "feat(core): AgentName 型と ProposalNodeSchema.passthrough() を追加"
```

---

## Task 2: ai-engine に agent registry を追加 (decompose-to-stories を移行)

**Files:**
- Create: `packages/ai-engine/src/agents/registry.ts`
- Create: `packages/ai-engine/src/agents/registry.test.ts`
- Modify: `packages/ai-engine/src/agents/decompose-to-stories.ts`

- [ ] **Step 1: registry テストを書く**

`packages/ai-engine/src/agents/registry.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { AGENT_REGISTRY } from './registry';

describe('AGENT_REGISTRY', () => {
  it('decompose-to-stories と find-related-code が登録されている', () => {
    expect(AGENT_REGISTRY['decompose-to-stories']).toBeDefined();
    expect(AGENT_REGISTRY['find-related-code']).toBeDefined();
  });

  it('decompose-to-stories の allowedTools に tally の書き込みツールが含まれる', () => {
    const def = AGENT_REGISTRY['decompose-to-stories'];
    expect(def.allowedTools).toContain('mcp__tally__create_node');
    expect(def.allowedTools).toContain('mcp__tally__create_edge');
  });
});
```

*(find-related-code は Task 4 で追加する。この Task では decompose のみテストし、find-related-code 参照行は Task 4 で有効化する。以下コード内で find-related-code 登録を保留する運用にする。)*

このテストの 1 ケース目は Task 2 完了時点では「`find-related-code` が未登録」で一度 FAIL になるが、Task 4 で GREEN に変わる。Task 2 の完了判定では 2 ケース目 (decompose-to-stories 側) のみ PASS で OK とする。

よりクリーンに運用するため、Task 2 では 1 ケース目を `it.skip` でスキップしておき Task 4 で `.skip` を外す指示に変更する。以下が Task 2 で実際に書くコード:

```typescript
import { describe, expect, it } from 'vitest';

import { AGENT_REGISTRY } from './registry';

describe('AGENT_REGISTRY', () => {
  it.skip('decompose-to-stories と find-related-code が登録されている (Task 4 で有効化)', () => {
    expect(AGENT_REGISTRY['decompose-to-stories']).toBeDefined();
    expect(AGENT_REGISTRY['find-related-code']).toBeDefined();
  });

  it('decompose-to-stories の allowedTools に tally の書き込みツールが含まれる', () => {
    const def = AGENT_REGISTRY['decompose-to-stories'];
    expect(def).toBeDefined();
    expect(def.allowedTools).toContain('mcp__tally__create_node');
    expect(def.allowedTools).toContain('mcp__tally__create_edge');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
pnpm --filter @tally/ai-engine test -- registry
```

Expected: FAIL (`./registry` モジュールが見つからない、または AGENT_REGISTRY が未定義)

- [ ] **Step 3: registry.ts を新規作成**

`packages/ai-engine/src/agents/registry.ts`:

```typescript
import type { AgentName, Node } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import type { z } from 'zod';

import { decomposeToStoriesAgent } from './decompose-to-stories';

// エージェント個別の input 形状は zod スキーマで検証する。
// registry 側は ZodTypeAny として扱い、ランタイムで safeParse を走らせる。
export interface AgentValidateOk {
  ok: true;
  anchor: Node;
  cwd?: string;
}
export interface AgentValidateError {
  ok: false;
  code: 'bad_request' | 'not_found';
  message: string;
}
export type AgentValidateResult = AgentValidateOk | AgentValidateError;

export interface AgentPromptInput {
  anchor: Node;
  cwd?: string;
}

export interface AgentPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface AgentDefinition<TInput = unknown> {
  name: AgentName;
  inputSchema: z.ZodType<TInput>;
  validateInput(
    deps: { store: ProjectStore; workspaceRoot: string },
    input: TInput,
  ): Promise<AgentValidateResult>;
  buildPrompt(args: AgentPromptInput): AgentPrompt;
  allowedTools: string[];
}

// find-related-code は Task 4 で登録する。
export const AGENT_REGISTRY: Partial<Record<AgentName, AgentDefinition>> = {
  'decompose-to-stories': decomposeToStoriesAgent,
};
```

- [ ] **Step 4: decompose-to-stories を AgentDefinition としても export**

`packages/ai-engine/src/agents/decompose-to-stories.ts` に追記（既存 `buildDecomposePrompt` は残す）:

```typescript
import { z } from 'zod';

import type { UseCaseNode } from '@tally/core';

import type { AgentDefinition } from './registry';

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

const DecomposeInputSchema = z.object({ nodeId: z.string().min(1) });
type DecomposeAgentInput = z.infer<typeof DecomposeInputSchema>;

export const decomposeToStoriesAgent: AgentDefinition<DecomposeAgentInput> = {
  name: 'decompose-to-stories',
  inputSchema: DecomposeInputSchema,
  async validateInput({ store }, input) {
    const uc = await store.getNode(input.nodeId);
    if (!uc) {
      return { ok: false, code: 'not_found', message: `ノードが存在しない: ${input.nodeId}` };
    }
    if (uc.type !== 'usecase') {
      return { ok: false, code: 'bad_request', message: `decompose-to-stories は usecase 限定: ${uc.type}` };
    }
    return { ok: true, anchor: uc };
  },
  buildPrompt: ({ anchor }) => buildDecomposePrompt({ ucNode: anchor as UseCaseNode }),
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
  ],
};
```

- [ ] **Step 5: テストを実行して PASS を確認**

```bash
pnpm --filter @tally/ai-engine test -- registry
pnpm --filter @tally/ai-engine test -- decompose-to-stories
```

Expected: 両方 PASS (registry は 1 件 skip + 1 件 PASS、decompose の既存テスト PASS)

- [ ] **Step 6: コミット**

```bash
git add packages/ai-engine/src/agents/registry.ts packages/ai-engine/src/agents/registry.test.ts packages/ai-engine/src/agents/decompose-to-stories.ts
git commit -m "refactor(ai-engine): agent registry を導入し decompose-to-stories を AgentDefinition 化"
```

---

## Task 3: agent-runner を registry ベースに書き換える

**Files:**
- Modify: `packages/ai-engine/src/agent-runner.ts`
- Modify: `packages/ai-engine/src/agent-runner.test.ts`

- [ ] **Step 1: agent-runner.test.ts を更新 (cwd / workspaceRoot を渡す形に)**

`packages/ai-engine/src/agent-runner.test.ts` の `runAgent` 呼び出し箇所 5 箇所すべてに `workspaceRoot: root` を追加。先頭の mockSdk の型にも `cwd?: string` と `settingSources?: string[]` を追加する:

冒頭付近の `SdkLike` 互換型定義を全 test で使うため、各 `query` 関数・`queryCalls` 型に以下を追加:

```typescript
options?: {
  systemPrompt?: string;
  mcpServers?: Record<string, unknown>;
  allowedTools?: string[];
  cwd?: string;
  settingSources?: string[];
};
```

最初の「SDK モックが thinking と done を流すと〜」テストの `runAgent` 呼び出しを:

```typescript
for await (const e of runAgent({
  sdk: mockSdk as never,
  store,
  workspaceRoot: root,
  req: {
    type: 'start',
    agent: 'decompose-to-stories',
    projectId: 'proj-test',
    input: { nodeId: ucId },
  },
})) {
```

残り 4 つの `runAgent({ ... })` 呼び出しにも `workspaceRoot: root` を追加。

加えて「`settingSources: []` が options に入る」ことを検証する expect を最初の test に追加:

```typescript
expect(call?.options?.settingSources).toEqual([]);
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
pnpm --filter @tally/ai-engine test -- agent-runner
```

Expected: 型エラーで build 失敗、または `runAgent` の `workspaceRoot` 未対応で FAIL

- [ ] **Step 3: agent-runner.ts を registry ベースに書き換え**

`packages/ai-engine/src/agent-runner.ts` を全置換:

```typescript
import type { AgentName, Node } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

import { AGENT_REGISTRY } from './agents/registry';
import type { AgentEvent, SdkMessageLike } from './stream';
import { sdkMessageToAgentEvent } from './stream';
import { buildTallyMcpServer } from './tools';

export interface StartRequest {
  type: 'start';
  agent: AgentName;
  projectId: string;
  input: unknown;
}

// Agent SDK との結合点だけ抽象化する。query は AsyncIterable<SdkMessageLike> を返すこと。
// 実 SDK の厳密な型 (Options, SDKMessage) に合わせず duck typing で受けるのは、
// テスト時に mockSdk を差し込めるようにするため。
// SDK 実体のシグネチャは `query({ prompt, options })` なので、systemPrompt / mcpServers /
// allowedTools / cwd / settingSources はすべて options 内に入れる必要がある。
export interface SdkLike {
  query(opts: {
    prompt: string;
    options?: {
      systemPrompt?: string;
      mcpServers?: Record<string, unknown>;
      allowedTools?: string[];
      cwd?: string;
      settingSources?: string[];
    };
  }): AsyncIterable<SdkMessageLike>;
}

export interface RunAgentDeps {
  sdk: SdkLike;
  store: ProjectStore;
  workspaceRoot: string;
  req: StartRequest;
}

// 指定された StartRequest を実行し、進捗を AgentEvent として順次 yield する。
// 事前バリデーション (agent 名 / 入力 schema / ノード存在 / ノード型 / codebasePath 等) は
// registry のエージェント定義に委ねてから SDK を起動する。
// SDK 呼び出し中に MCP ツールハンドラが emit した side events (node_created など) は
// 次の SDK メッセージを受け取るタイミングで合流して flush する。
export async function* runAgent(deps: RunAgentDeps): AsyncGenerator<AgentEvent> {
  const { sdk, store, workspaceRoot, req } = deps;
  yield { type: 'start', agent: req.agent, input: req.input };

  const def = AGENT_REGISTRY[req.agent];
  if (!def) {
    yield { type: 'error', code: 'bad_request', message: `未知の agent: ${req.agent}` };
    return;
  }

  const parsed = def.inputSchema.safeParse(req.input);
  if (!parsed.success) {
    yield { type: 'error', code: 'bad_request', message: `入力が不正: ${parsed.error.message}` };
    return;
  }

  const vr = await def.validateInput({ store, workspaceRoot }, parsed.data);
  if (!vr.ok) {
    yield { type: 'error', code: vr.code, message: vr.message };
    return;
  }
  const anchor: Node = vr.anchor;
  const cwd: string | undefined = vr.cwd;

  const sideEvents: AgentEvent[] = [];
  const mcp = buildTallyMcpServer({
    store,
    emit: (e) => sideEvents.push(e),
    anchor: { x: anchor.x, y: anchor.y },
  });

  const prompt = def.buildPrompt({ anchor, cwd });
  try {
    const iter = sdk.query({
      prompt: prompt.userPrompt,
      options: {
        systemPrompt: prompt.systemPrompt,
        mcpServers: { tally: mcp as unknown as Record<string, unknown> },
        allowedTools: def.allowedTools,
        // cwd は find-related-code のコード探索スコープ。未指定エージェントは SDK デフォルト。
        ...(cwd ? { cwd } : {}),
        // 外部設定 (~/.claude/settings.json 等) は読み込まず、agent ごとの allowedTools を
        // 厳格な whitelist として運用する。
        settingSources: [],
      },
    });
    for await (const msg of iter) {
      while (sideEvents.length > 0) {
        const e = sideEvents.shift();
        if (e) yield e;
      }
      for (const evt of sdkMessageToAgentEvent(msg)) {
        yield evt;
      }
    }
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

- [ ] **Step 4: テストを再実行して PASS を確認**

```bash
pnpm --filter @tally/ai-engine test -- agent-runner
```

Expected: すべて PASS (`settingSources: []` / `workspaceRoot` 経路が通る)

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/agent-runner.ts packages/ai-engine/src/agent-runner.test.ts
git commit -m "refactor(ai-engine): agent-runner を registry + workspaceRoot 経路に書き換え"
```

---

## Task 4: find-related-code エージェントを実装

**Files:**
- Create: `packages/ai-engine/src/agents/find-related-code.ts`
- Create: `packages/ai-engine/src/agents/find-related-code.test.ts`
- Modify: `packages/ai-engine/src/agents/registry.ts`
- Modify: `packages/ai-engine/src/agents/registry.test.ts`

- [ ] **Step 1: find-related-code.test.ts を書く**

`packages/ai-engine/src/agents/find-related-code.test.ts`:

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildFindRelatedCodePrompt, findRelatedCodeAgent } from './find-related-code';

describe('buildFindRelatedCodePrompt', () => {
  it('system プロンプトに Edit/Write/Bash の禁止と coderef proposal の契約が入っている', () => {
    const p = buildFindRelatedCodePrompt({
      anchor: { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '招待', body: 'メール招待' },
    });
    expect(p.systemPrompt).toContain('coderef');
    expect(p.systemPrompt).toContain('derive');
    expect(p.systemPrompt).toContain('Edit');
    expect(p.systemPrompt).toContain('Write');
    expect(p.systemPrompt).toContain('Bash');
  });

  it('user プロンプトに anchor の id / title / body が含まれる', () => {
    const p = buildFindRelatedCodePrompt({
      anchor: { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '招待', body: 'メール招待' },
    });
    expect(p.userPrompt).toContain('uc-1');
    expect(p.userPrompt).toContain('招待');
    expect(p.userPrompt).toContain('メール招待');
  });
});

describe('findRelatedCodeAgent.validateInput', () => {
  let workspaceRoot: string;
  let codebaseDir: string;
  let store: FileSystemProjectStore;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-frc-'));
    codebaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-frc-code-'));
    store = new FileSystemProjectStore(workspaceRoot);
    await fs.mkdir(path.join(workspaceRoot, '.tally', 'nodes'), { recursive: true });
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebasePath: codebaseDir,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await fs.rm(codebaseDir, { recursive: true, force: true });
  });

  it('usecase ノードで ok + cwd が返る', async () => {
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput(
      { store, workspaceRoot },
      { nodeId: uc.id },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor.id).toBe(uc.id);
      expect(r.cwd).toBe(path.resolve(workspaceRoot, codebaseDir));
    }
  });

  it('requirement / userstory も許可される', async () => {
    const req = await store.addNode({ type: 'requirement', x: 0, y: 0, title: 'r', body: '' });
    const story = await store.addNode({ type: 'userstory', x: 0, y: 0, title: 's', body: '' });
    const r1 = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: req.id });
    const r2 = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: story.id });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
  });

  it('対象外 type (question) は bad_request', async () => {
    const q = await store.addNode({ type: 'question', x: 0, y: 0, title: 'q', body: '' });
    const r = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: q.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });

  it('不在 nodeId は not_found', async () => {
    const r = await findRelatedCodeAgent.validateInput(
      { store, workspaceRoot },
      { nodeId: 'uc-missing' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('codebasePath 未設定は bad_request', async () => {
    const current = await store.getProjectMeta();
    if (!current) throw new Error('meta missing');
    const { codebasePath: _drop, ...rest } = current;
    await store.saveProjectMeta(rest);
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: uc.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });

  it('codebasePath 解決先が存在しない場合は not_found', async () => {
    await store.saveProjectMeta({
      id: 'proj-frc',
      name: 'FRC',
      codebasePath: '../nonexistent-xyz',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const uc = await store.addNode({ type: 'usecase', x: 0, y: 0, title: 'uc', body: 'b' });
    const r = await findRelatedCodeAgent.validateInput({ store, workspaceRoot }, { nodeId: uc.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });
});

describe('findRelatedCodeAgent.allowedTools', () => {
  it('Read / Glob / Grep と tally ツールを含み、Bash/Edit/Write は含まない', () => {
    const tools = findRelatedCodeAgent.allowedTools;
    expect(tools).toContain('Read');
    expect(tools).toContain('Glob');
    expect(tools).toContain('Grep');
    expect(tools).toContain('mcp__tally__create_node');
    expect(tools).toContain('mcp__tally__create_edge');
    expect(tools).toContain('mcp__tally__find_related');
    expect(tools).toContain('mcp__tally__list_by_type');
    expect(tools).not.toContain('Bash');
    expect(tools).not.toContain('Edit');
    expect(tools).not.toContain('Write');
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
pnpm --filter @tally/ai-engine test -- find-related-code
```

Expected: FAIL (`./find-related-code` モジュールが見つからない)

- [ ] **Step 3: find-related-code.ts を実装**

`packages/ai-engine/src/agents/find-related-code.ts`:

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Node } from '@tally/core';
import { z } from 'zod';

import type { AgentDefinition } from './registry';

export interface FindRelatedCodePromptInput {
  anchor: Node;
}

// find-related-code のプロンプトを組み立てる。エージェントは allowedTools の whitelist で
// Read / Glob / Grep / tally の read+write のみに制限されている。その上で system プロンプト側でも
// Edit / Write / Bash を使わないことを明示し、coderef proposal として結果を書き込む契約を守らせる。
export function buildFindRelatedCodePrompt(input: FindRelatedCodePromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    'あなたは Tally の関連コード探索アシスタントです。',
    '与えられたノード (usecase / requirement / userstory) の意図に照らして、',
    'codebasePath 配下の既存コードから関連する実装・インタフェース・テストを発見し、',
    'coderef proposal として記録します。',
    '',
    'ルール:',
    '- 探索は Glob / Grep / Read ツールを使うこと。Edit / Write / Bash は使わない。',
    '- 関連コードを見つけたら create_node ツールで type="proposal", adoptAs="coderef" として作成する。',
    '  タイトルは "[AI] <filePath>:<startLine>" の形式、body にはその範囲で該当コードが何をしているかの要約を書く。',
    '  additional に { filePath, startLine, endLine } を入れる (filePath は codebasePath 基準の相対パス)。',
    '- 各 coderef proposal に対して create_edge ツールで from=<元ノード>, to=<coderef>, type="derive" のエッジを張る。',
    '- list_by_type("coderef") で既存の coderef を事前確認し、同じ範囲の重複を避ける。',
    '- 個数は対象ノードの関連性に応じて 1〜8 件を目安とし、薄い関連まで拾いすぎないこと。',
    '- 最後に「何を探し、何を見つけたか」を 2〜3 行で日本語で要約する。',
  ].join('\n');

  const userPrompt = [
    `対象ノード: ${input.anchor.id}`,
    `type: ${input.anchor.type}`,
    `タイトル: ${input.anchor.title}`,
    `本文:\n${input.anchor.body}`,
    '',
    '上記ノードの意図に関連する既存コードを codebasePath 配下から探し、coderef proposal として記録してください。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

const FindRelatedCodeInputSchema = z.object({ nodeId: z.string().min(1) });
type FindRelatedCodeInput = z.infer<typeof FindRelatedCodeInputSchema>;

// 対象ノード type: find-related-code はユーザーの「意図」を起点にコード探索するため、
// UC / requirement / userstory のいずれかに限定する。coderef や proposal から再帰的に
// 更に coderef を生やすのは MVP では許可しない。
const ALLOWED_ANCHOR_TYPES = ['usecase', 'requirement', 'userstory'] as const;
type AllowedAnchorType = (typeof ALLOWED_ANCHOR_TYPES)[number];

function isAllowedAnchor(t: Node['type']): t is AllowedAnchorType {
  return (ALLOWED_ANCHOR_TYPES as readonly string[]).includes(t);
}

export const findRelatedCodeAgent: AgentDefinition<FindRelatedCodeInput> = {
  name: 'find-related-code',
  inputSchema: FindRelatedCodeInputSchema,
  async validateInput({ store, workspaceRoot }, input) {
    const node = await store.getNode(input.nodeId);
    if (!node) {
      return { ok: false, code: 'not_found', message: `ノードが存在しない: ${input.nodeId}` };
    }
    if (!isAllowedAnchor(node.type)) {
      return {
        ok: false,
        code: 'bad_request',
        message: `find-related-code の対象外: ${node.type}`,
      };
    }
    const meta = await store.getProjectMeta();
    if (!meta?.codebasePath) {
      return {
        ok: false,
        code: 'bad_request',
        message: 'プロジェクト設定で codebasePath を指定してください',
      };
    }
    const abs = path.resolve(workspaceRoot, meta.codebasePath);
    try {
      await fs.access(abs);
    } catch {
      return { ok: false, code: 'not_found', message: `codebasePath 解決失敗: ${abs}` };
    }
    return { ok: true, anchor: node, cwd: abs };
  },
  buildPrompt: ({ anchor }) => buildFindRelatedCodePrompt({ anchor }),
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
    'Read',
    'Glob',
    'Grep',
  ],
};
```

- [ ] **Step 4: registry.ts に find-related-code を登録**

`packages/ai-engine/src/agents/registry.ts` の `AGENT_REGISTRY`:

```typescript
import { decomposeToStoriesAgent } from './decompose-to-stories';
import { findRelatedCodeAgent } from './find-related-code';

// ... (型定義はそのまま)

export const AGENT_REGISTRY: Partial<Record<AgentName, AgentDefinition>> = {
  'decompose-to-stories': decomposeToStoriesAgent,
  'find-related-code': findRelatedCodeAgent,
};
```

- [ ] **Step 5: registry.test.ts の `.skip` を外す**

`packages/ai-engine/src/agents/registry.test.ts` の `it.skip` を `it` に戻す。

- [ ] **Step 6: テストを実行して PASS を確認**

```bash
pnpm --filter @tally/ai-engine test -- find-related-code registry
```

Expected: 両方 PASS

- [ ] **Step 7: コミット**

```bash
git add packages/ai-engine/src/agents/find-related-code.ts packages/ai-engine/src/agents/find-related-code.test.ts packages/ai-engine/src/agents/registry.ts packages/ai-engine/src/agents/registry.test.ts
git commit -m "feat(ai-engine): find-related-code エージェントを追加"
```

---

## Task 5: server.ts を agent union に拡張

**Files:**
- Modify: `packages/ai-engine/src/server.ts`
- Modify: `packages/ai-engine/src/server.test.ts`

- [ ] **Step 1: server.test.ts に find-related-code の受理テストを追加**

`packages/ai-engine/src/server.test.ts` に新しいテストを追加（既存テストの直後）:

```typescript
it('find-related-code の start を受理して codebasePath 未設定なら error:bad_request', async () => {
  const store = new FileSystemProjectStore(root);
  // beforeEach で uc は 1 件あるので取得。codebasePath は未設定のまま。
  // biome-ignore lint/style/noNonNullAssertion: beforeEach で必ず作られる
  const ucId = (await store.findNodesByType('usecase'))[0]!.id;
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
    ws.on('open', () => {
      ws.send(
        JSON.stringify({
          type: 'start',
          agent: 'find-related-code',
          projectId: 'proj-ws',
          input: { nodeId: ucId },
        }),
      );
    });
    ws.on('message', (data) => events.push(JSON.parse(data.toString())));
    ws.on('close', () => resolve());
    ws.on('error', reject);
  });
  const errorEvt = events.find((e) => e.type === 'error');
  expect(errorEvt).toBeDefined();
  if (errorEvt?.type === 'error') {
    expect(errorEvt.code).toBe('bad_request');
    expect(errorEvt.message).toContain('codebasePath');
  }
}, 10_000);
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
pnpm --filter @tally/ai-engine test -- server
```

Expected: 新テストが FAIL (`StartSchema` が `find-related-code` を拒否するため bad_request は parse 失敗由来 → メッセージに codebasePath が含まれない)

- [ ] **Step 3: server.ts の StartSchema と runAgent 呼び出しを更新**

`packages/ai-engine/src/server.ts`:

```typescript
import { FileSystemProjectStore, resolveProjectById } from '@tally/storage';
import { AGENT_NAMES } from '@tally/core';
import { WebSocketServer } from 'ws';
import { z } from 'zod';

import { runAgent } from './agent-runner';
import type { SdkLike } from './agent-runner';
import type { AgentEvent } from './stream';

const StartSchema = z.object({
  type: z.literal('start'),
  agent: z.enum(AGENT_NAMES),
  projectId: z.string().min(1),
  input: z.object({ nodeId: z.string().min(1) }).passthrough(),
});
```

（他は変更ないが、`runAgent` 呼び出しに `workspaceRoot: handle.workspaceRoot` を追加）:

```typescript
for await (const evt of runAgent({
  sdk: opts.sdk,
  store,
  workspaceRoot: handle.workspaceRoot,
  req: parsed,
})) {
  send(evt);
}
```

NOTE: `z.enum(AGENT_NAMES)` は `as const` の readonly tuple を受ける。zod は `z.enum([...AGENT_NAMES])` で展開が必要な場合あり。TypeScript が型エラーを出したら `z.enum([...AGENT_NAMES] as [string, ...string[]])` にキャストする。

- [ ] **Step 4: テストを再実行して PASS を確認**

```bash
pnpm --filter @tally/ai-engine test
```

Expected: すべて PASS（既存 + 新規）

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/server.ts packages/ai-engine/src/server.test.ts
git commit -m "feat(ai-engine): WS サーバで find-related-code の start を受理"
```

---

## Task 6: frontend ws.ts を AgentName union に拡張

**Files:**
- Modify: `packages/frontend/src/lib/ws.ts`
- Modify: `packages/frontend/src/lib/ws.test.ts`

- [ ] **Step 1: ws.test.ts を確認して必要なら union のテストを追加**

まず既存テストを読む:

```bash
cat packages/frontend/src/lib/ws.test.ts
```

既存テストで `agent: 'decompose-to-stories'` がハードコードされている箇所が型エラーにならないか、`agent: AgentName` に拡張しても既存テストは通ることを確認する。

もし `StartAgentOptions.agent` の型が狭まっていて既存テストがハードコードしている場合、新規テストとして:

```typescript
it('find-related-code も agent として送信できる', async () => {
  // startAgent({ agent: 'find-related-code', ... }) が型エラーにならないことを
  // TypeScript コンパイル時点で検証するのが目的。ランタイム検証は ai-engine 側に任せる。
});
```

を追加する必要はあまりないが、`agent` prop の直接的な型検証として `startAgent({ agent: 'find-related-code', projectId: 'p', input: { nodeId: 'x' } })` を呼ぶテスト（WS が失敗しても型だけ通れば OK）を書いておく。

**最小対応:** ws.test.ts に追加テストは不要。ws.ts の型変更と、依存側 store.ts が通ることを後続タスクで検証する。このタスクでは型定義のみを更新し、`pnpm typecheck` で回帰確認する。

- [ ] **Step 2: ws.ts の型を AgentName に差し替え**

`packages/frontend/src/lib/ws.ts`:

```typescript
'use client';

import type { AgentEvent } from '@tally/ai-engine';
import type { AgentName } from '@tally/core';

export interface StartAgentOptions {
  url?: string;
  agent: AgentName;
  projectId: string;
  input: { nodeId: string };
}
```

（それ以外はそのまま）

- [ ] **Step 3: 型チェックを実行**

```bash
pnpm --filter frontend typecheck
```

Expected: PASS（store.ts / ws.test.ts とも AgentName 'decompose-to-stories' は union に含まれるので通る）

- [ ] **Step 4: コミット**

```bash
git add packages/frontend/src/lib/ws.ts
git commit -m "refactor(frontend): ws.ts の agent 型を AgentName union に拡張"
```

---

## Task 7: frontend api.ts に patchProjectMeta を追加

**Files:**
- Modify: `packages/frontend/src/lib/api.ts`
- Modify: `packages/frontend/src/lib/api.test.ts`

- [ ] **Step 1: api.test.ts にテストを追加**

`packages/frontend/src/lib/api.test.ts` の末尾（`describe` 内）に追加:

```typescript
it('patchProjectMeta は PATCH /api/projects/:id', async () => {
  const updated = {
    id: PID,
    name: 'P',
    codebasePath: '../backend',
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-19T00:00:00Z',
  };
  okJson(updated);
  const result = await patchProjectMeta(PID, { codebasePath: '../backend' });
  expect(result).toEqual(updated);
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(url).toBe(`/api/projects/${PID}`);
  expect(init.method).toBe('PATCH');
  expect(JSON.parse(init.body as string)).toEqual({ codebasePath: '../backend' });
});

it('patchProjectMeta は null で codebasePath 削除シグナル', async () => {
  okJson({
    id: PID,
    name: 'P',
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-19T00:00:00Z',
  });
  await patchProjectMeta(PID, { codebasePath: null });
  const [, init] = fetchMock.mock.calls[0] as [unknown, RequestInit];
  expect(JSON.parse(init.body as string)).toEqual({ codebasePath: null });
});
```

top の import に `patchProjectMeta` を追加:

```typescript
import { createEdge, createNode, deleteEdge, deleteNode, patchProjectMeta, updateEdge, updateNode } from './api';
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
pnpm --filter frontend test -- api.test
```

Expected: FAIL (`patchProjectMeta` が export されていない)

- [ ] **Step 3: api.ts に patchProjectMeta を追加**

`packages/frontend/src/lib/api.ts` の末尾に追加:

```typescript
import type { ProjectMeta } from '@tally/core';

// ... (既存 export は変更なし)

export function patchProjectMeta(
  projectId: string,
  patch: { codebasePath?: string | null },
): Promise<ProjectMeta> {
  return requestJson<ProjectMeta>(`${base(projectId)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}
```

（`ProjectMeta` の import は top に追加する。既存の `import type { AdoptableType, Edge, EdgeType, Node, NodeType } from '@tally/core';` に `ProjectMeta` を足す。）

- [ ] **Step 4: テストを再実行して PASS を確認**

```bash
pnpm --filter frontend test -- api.test
```

Expected: すべて PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/api.ts packages/frontend/src/lib/api.test.ts
git commit -m "feat(frontend): patchProjectMeta を api.ts に追加"
```

---

## Task 8: PATCH /api/projects/:id ルートハンドラを追加

**Files:**
- Modify: `packages/frontend/src/app/api/projects/[id]/route.ts`
- Create: `packages/frontend/src/app/api/projects/[id]/route.test.ts`

- [ ] **Step 1: route.test.ts を書く**

`packages/frontend/src/app/api/projects/[id]/route.test.ts`:

```typescript
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FileSystemProjectStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GET, PATCH } from './route';

describe('app/api/projects/[id] route', () => {
  let workspace: string;
  const prev = process.env.TALLY_WORKSPACE;

  beforeEach(async () => {
    workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-route-'));
    process.env.TALLY_WORKSPACE = workspace;
    const store = new FileSystemProjectStore(workspace);
    await fs.mkdir(path.join(workspace, '.tally', 'nodes'), { recursive: true });
    await store.saveProjectMeta({
      id: 'proj-route',
      name: 'route',
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T00:00:00Z',
    });
  });
  afterEach(async () => {
    process.env.TALLY_WORKSPACE = prev;
    await fs.rm(workspace, { recursive: true, force: true });
  });

  it('GET は既存プロジェクトを返す', async () => {
    const res = await GET(new Request('http://t/'), { params: Promise.resolve({ id: 'proj-route' }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('proj-route');
  });

  it('PATCH で codebasePath を保存できる', async () => {
    const res = await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ codebasePath: '../backend' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'proj-route' }) },
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { codebasePath?: string; updatedAt: string };
    expect(body.codebasePath).toBe('../backend');
    expect(body.updatedAt).not.toBe('2026-04-18T00:00:00Z');

    // 往復確認: ストアに書かれているか
    const store = new FileSystemProjectStore(workspace);
    const meta = await store.getProjectMeta();
    expect(meta?.codebasePath).toBe('../backend');
  });

  it('PATCH で codebasePath: null は削除シグナル', async () => {
    const store = new FileSystemProjectStore(workspace);
    await store.saveProjectMeta({
      id: 'proj-route',
      name: 'route',
      codebasePath: '../old',
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T00:00:00Z',
    });
    const res = await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ codebasePath: null }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'proj-route' }) },
    );
    expect(res.status).toBe(200);
    const meta = await store.getProjectMeta();
    expect(meta?.codebasePath).toBeUndefined();
  });

  it('PATCH で不明なフィールドは 400', async () => {
    const res = await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'newname' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'proj-route' }) },
    );
    expect(res.status).toBe(400);
  });

  it('PATCH で存在しないプロジェクトは 404', async () => {
    const res = await PATCH(
      new Request('http://t/', {
        method: 'PATCH',
        body: JSON.stringify({ codebasePath: '../x' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: Promise.resolve({ id: 'proj-missing' }) },
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
pnpm --filter frontend test -- projects/\\[id\\]/route
```

Expected: FAIL (`PATCH` が未 export)

- [ ] **Step 3: route.ts に PATCH を追加**

`packages/frontend/src/app/api/projects/[id]/route.ts` を置換:

```typescript
import { FileSystemProjectStore } from '@tally/storage';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { loadProjectById, resolveProjectById } from '@tally/storage';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const project = await loadProjectById(id);
  if (!project) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }
  return NextResponse.json(project);
}

// ProjectMeta の部分更新。現状は codebasePath のみサポート (Phase 5a)。
// strict: true で未知フィールドを 400 にして、将来追加するフィールドは明示的に受け入れる。
const PatchSchema = z
  .object({
    codebasePath: z.union([z.string(), z.null()]).optional(),
  })
  .strict();

export async function PATCH(req: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;
  const handle = await resolveProjectById(id);
  if (!handle) {
    return NextResponse.json({ error: 'project not found', id }, { status: 404 });
  }
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad request', detail: parsed.error.message }, { status: 400 });
  }
  const store = new FileSystemProjectStore(handle.workspaceRoot);
  const current = await store.getProjectMeta();
  if (!current) {
    return NextResponse.json({ error: 'meta not found', id }, { status: 404 });
  }
  const next = { ...current, updatedAt: new Date().toISOString() };
  if (parsed.data.codebasePath === null) {
    // null は明示的な削除シグナル。
    delete (next as { codebasePath?: string }).codebasePath;
  } else if (typeof parsed.data.codebasePath === 'string') {
    (next as { codebasePath?: string }).codebasePath = parsed.data.codebasePath;
  }
  await store.saveProjectMeta(next);
  return NextResponse.json(next);
}
```

- [ ] **Step 4: テストを再実行して PASS を確認**

```bash
pnpm --filter frontend test -- projects/\\[id\\]/route
```

Expected: すべて PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/app/api/projects/[id]/route.ts packages/frontend/src/app/api/projects/[id]/route.test.ts
git commit -m "feat(frontend): PATCH /api/projects/:id で codebasePath を編集可能に"
```

---

## Task 9: store.ts に startFindRelatedCode と patchProjectMeta を追加

**Files:**
- Modify: `packages/frontend/src/lib/store.ts`
- Modify: `packages/frontend/src/lib/store.test.ts`

- [ ] **Step 1: store.test.ts に startFindRelatedCode と patchProjectMeta のテストを追加**

`packages/frontend/src/lib/store.test.ts` の `describe('startDecompose', ...)` の直後に追加:

```typescript
describe('startFindRelatedCode', () => {
  it('find-related-code の AgentEvent 列で nodes/edges を拡張し runningAgent をクリアする', async () => {
    const newNode = {
      id: 'prop-cr',
      type: 'proposal',
      x: 0,
      y: 0,
      title: '[AI] src/invite.ts:10',
      body: '',
      adoptAs: 'coderef',
      filePath: 'src/invite.ts',
      startLine: 10,
      endLine: 20,
    };
    const newEdge = { id: 'e-cr', from: 'uc-1', to: 'prop-cr', type: 'derive' };
    vi.resetModules();
    vi.doMock('./ws', () => ({
      startAgent: (opts: { agent: string }) => ({
        events: (async function* () {
          yield { type: 'start', agent: opts.agent, input: {} };
          yield { type: 'node_created', node: newNode };
          yield { type: 'edge_created', edge: newEdge };
          yield { type: 'done', summary: 'ok' };
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
    await useCanvasStore.getState().startFindRelatedCode('uc-1');
    const state = useCanvasStore.getState();
    expect(state.nodes['prop-cr']).toEqual(newNode);
    expect(state.edges['e-cr']).toEqual(newEdge);
    expect(state.runningAgent).toBeNull();
  });
});

describe('patchProjectMeta', () => {
  it('PATCH 応答で projectMeta を置き換える', async () => {
    useCanvasStore.getState().hydrate({
      id: 'proj-1',
      name: 'P',
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-18T00:00:00Z',
      nodes: [],
      edges: [],
    });
    okJson({
      id: 'proj-1',
      name: 'P',
      codebasePath: '../backend',
      createdAt: '2026-04-18T00:00:00Z',
      updatedAt: '2026-04-19T00:00:00Z',
    });
    await useCanvasStore.getState().patchProjectMeta({ codebasePath: '../backend' });
    expect(useCanvasStore.getState().projectMeta?.codebasePath).toBe('../backend');
    const call = fetchMock.mock.calls[0];
    expect(call?.[1]).toMatchObject({ method: 'PATCH' });
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
pnpm --filter frontend test -- store
```

Expected: FAIL (`startFindRelatedCode` / `patchProjectMeta` が未定義)

- [ ] **Step 3: store.ts に `runAgentWS` / `startFindRelatedCode` / `patchProjectMeta` を追加**

`packages/frontend/src/lib/store.ts` を以下のように修正。

**CanvasState interface を拡張:**

```typescript
import {
  adoptProposal as adoptProposalApi,
  createEdge,
  createNode,
  deleteEdge as deleteEdgeApi,
  deleteNode as deleteNodeApi,
  patchProjectMeta as patchProjectMetaApi,
  updateEdge as updateEdgeApi,
  updateNode as updateNodeApi,
} from './api';
import type { AgentName } from '@tally/core';
```

（既存 import の近くに追加）

```typescript
interface CanvasState {
  // ... 既存
  runningAgent: {
    agent: AgentName;
    inputNodeId: string;
    events: AgentEvent[];
  } | null;
  startDecompose: (ucNodeId: string) => Promise<void>;
  startFindRelatedCode: (nodeId: string) => Promise<void>;
  patchProjectMeta: (patch: { codebasePath?: string | null }) => Promise<void>;
}
```

**実装部分:** `startDecompose` の実装を内部ヘルパ化:

```typescript
// 共通処理: runAgent の WS ラッパ。node_created / edge_created を store に反映しつつ
// runningAgent.events に履歴を積む。done / error / WS 切断いずれでも runningAgent をクリア。
async function runAgentWS(
  get: () => CanvasState,
  set: (partial: Partial<CanvasState>) => void,
  agent: AgentName,
  nodeId: string,
): Promise<void> {
  const pid = get().projectId;
  if (!pid) throw new Error('projectId is not set');
  set({
    runningAgent: { agent, inputNodeId: nodeId, events: [] },
  });
  const handle = startAgent({ agent, projectId: pid, input: { nodeId } });
  try {
    for await (const evt of handle.events) {
      const cur = get().runningAgent;
      if (cur) set({ runningAgent: { ...cur, events: [...cur.events, evt] } });
      if (evt.type === 'node_created') {
        set({ nodes: { ...get().nodes, [evt.node.id]: evt.node } });
      } else if (evt.type === 'edge_created') {
        set({ edges: { ...get().edges, [evt.edge.id]: evt.edge } });
      }
    }
  } finally {
    set({ runningAgent: null });
  }
}
```

これを zustand store の中で使うには `create<CanvasState>((set, get) => ({...}))` の関数内で直接書く方が自然。したがって以下のように `startDecompose` / `startFindRelatedCode` の実装を修正:

```typescript
startDecompose: async (ucNodeId) => {
  await runAgentWS(get, set as (p: Partial<CanvasState>) => void, 'decompose-to-stories', ucNodeId);
},

startFindRelatedCode: async (nodeId) => {
  await runAgentWS(get, set as (p: Partial<CanvasState>) => void, 'find-related-code', nodeId);
},

patchProjectMeta: async (patch) => {
  const pid = get().projectId;
  if (!pid) throw new Error('projectId is not set');
  const updated = await patchProjectMetaApi(pid, patch);
  set({ projectMeta: updated });
},
```

*(runAgentWS はモジュールトップレベルに置くと zustand set の型が ambigous なので、store の create の中に `const runAgentWS = async (...) => ...` として閉じ込める。下記にまとめる。)*

**最終形 (store の create 内):**

```typescript
export const useCanvasStore = create<CanvasState>((set, get) => {
  // 共通: runAgent の WS ラッパ。done / error / WS 切断いずれでも runningAgent をクリア。
  async function runAgentWS(agent: AgentName, nodeId: string): Promise<void> {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    set({ runningAgent: { agent, inputNodeId: nodeId, events: [] } });
    const handle = startAgent({ agent, projectId: pid, input: { nodeId } });
    try {
      for await (const evt of handle.events) {
        const cur = get().runningAgent;
        if (cur) set({ runningAgent: { ...cur, events: [...cur.events, evt] } });
        if (evt.type === 'node_created') {
          set({ nodes: { ...get().nodes, [evt.node.id]: evt.node } });
        } else if (evt.type === 'edge_created') {
          set({ edges: { ...get().edges, [evt.edge.id]: evt.edge } });
        }
      }
    } finally {
      set({ runningAgent: null });
    }
  }

  return {
    // ... 既存の projectId / projectMeta / nodes / edges / selected / runningAgent: null
    // ... hydrate / reset / select / moveNode / patchNode / addNodeFromPalette / removeNode
    // ... connectEdge / changeEdgeType / removeEdge / adoptProposal

    startDecompose: (ucNodeId) => runAgentWS('decompose-to-stories', ucNodeId),
    startFindRelatedCode: (nodeId) => runAgentWS('find-related-code', nodeId),

    patchProjectMeta: async (patch) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const updated = await patchProjectMetaApi(pid, patch);
      set({ projectMeta: updated });
    },
  };
});
```

既存の実装（移動元の `startDecompose`）は削除する。

- [ ] **Step 4: テストを再実行して PASS を確認**

```bash
pnpm --filter frontend test -- store
```

Expected: すべて PASS (既存 + 新規)

- [ ] **Step 5: 型チェック**

```bash
pnpm --filter frontend typecheck
```

Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add packages/frontend/src/lib/store.ts packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): startFindRelatedCode と patchProjectMeta を store に追加"
```

---

## Task 10: ProjectSettingsDialog を実装

**Files:**
- Create: `packages/frontend/src/components/dialog/project-settings-dialog.tsx`
- Create: `packages/frontend/src/components/dialog/project-settings-dialog.test.tsx`

- [ ] **Step 1: project-settings-dialog.test.tsx を書く**

`packages/frontend/src/components/dialog/project-settings-dialog.test.tsx`:

```typescript
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ProjectSettingsDialog } from './project-settings-dialog';

function hydrateStore(codebasePath?: string) {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    ...(codebasePath !== undefined ? { codebasePath } : {}),
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    nodes: [],
    edges: [],
  });
}

describe('ProjectSettingsDialog', () => {
  it('open=false のときは何も描画しない', () => {
    hydrateStore('../old');
    render(<ProjectSettingsDialog open={false} onClose={() => {}} />);
    expect(screen.queryByText(/プロジェクト設定/)).toBeNull();
  });

  it('open=true で codebasePath を初期値として入力欄に表示する', () => {
    hydrateStore('../backend');
    render(<ProjectSettingsDialog open={true} onClose={() => {}} />);
    const input = screen.getByLabelText(/codebasePath/i) as HTMLInputElement;
    expect(input.value).toBe('../backend');
  });

  it('保存ボタンで patchProjectMeta が呼ばれ onClose が実行される', async () => {
    hydrateStore('');
    const patchProjectMeta = vi.fn(async () => {});
    useCanvasStore.setState({ patchProjectMeta } as never);
    const onClose = vi.fn();
    render(<ProjectSettingsDialog open={true} onClose={onClose} />);
    const input = screen.getByLabelText(/codebasePath/i);
    fireEvent.change(input, { target: { value: '../backend' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      expect(patchProjectMeta).toHaveBeenCalledWith({ codebasePath: '../backend' });
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('空入力で保存すると codebasePath: null が送られる (削除)', async () => {
    hydrateStore('../old');
    const patchProjectMeta = vi.fn(async () => {});
    useCanvasStore.setState({ patchProjectMeta } as never);
    render(<ProjectSettingsDialog open={true} onClose={() => {}} />);
    const input = screen.getByLabelText(/codebasePath/i);
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => {
      expect(patchProjectMeta).toHaveBeenCalledWith({ codebasePath: null });
    });
  });

  it('キャンセルボタンで onClose が呼ばれ patchProjectMeta は呼ばれない', () => {
    hydrateStore('../old');
    const patchProjectMeta = vi.fn(async () => {});
    useCanvasStore.setState({ patchProjectMeta } as never);
    const onClose = vi.fn();
    render(<ProjectSettingsDialog open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /キャンセル/ }));
    expect(onClose).toHaveBeenCalled();
    expect(patchProjectMeta).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
pnpm --filter frontend test -- project-settings-dialog
```

Expected: FAIL（モジュール不在）

- [ ] **Step 3: project-settings-dialog.tsx を実装**

`packages/frontend/src/components/dialog/project-settings-dialog.tsx`:

```typescript
'use client';

import { useEffect, useId, useState } from 'react';

import { useCanvasStore } from '@/lib/store';

// プロジェクトの ProjectMeta を編集するモーダルダイアログ。
// 現状は codebasePath のみ扱う (Phase 5a)。将来 description / name を編集対象に追加する可能性あり。
export function ProjectSettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const projectMeta = useCanvasStore((s) => s.projectMeta);
  const patchProjectMeta = useCanvasStore((s) => s.patchProjectMeta);
  const [value, setValue] = useState<string>(projectMeta?.codebasePath ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  // open が true になった瞬間、ストアの最新値でフォームをリセットする。
  useEffect(() => {
    if (open) {
      setValue(projectMeta?.codebasePath ?? '');
      setError(null);
    }
  }, [open, projectMeta?.codebasePath]);

  if (!open) return null;

  const onSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = value.trim();
      await patchProjectMeta({ codebasePath: trimmed === '' ? null : trimmed });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={OVERLAY_STYLE} role="dialog" aria-modal="true" aria-labelledby="project-settings-title">
      <div style={MODAL_STYLE}>
        <h2 id="project-settings-title" style={TITLE_STYLE}>
          プロジェクト設定
        </h2>
        <div style={FIELD_STYLE}>
          <label htmlFor={inputId} style={LABEL_STYLE}>
            codebasePath
          </label>
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="../backend"
            style={INPUT_STYLE}
          />
          <div style={HINT_STYLE}>
            プロジェクトディレクトリ (.tally の親) からの相対パス。空欄で設定解除。
          </div>
        </div>
        {error && <div style={ERROR_STYLE}>{error}</div>}
        <div style={BUTTONS_STYLE}>
          <button type="button" onClick={onClose} disabled={busy} style={CANCEL_BUTTON_STYLE}>
            キャンセル
          </button>
          <button type="button" onClick={onSave} disabled={busy} style={SAVE_BUTTON_STYLE}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

const OVERLAY_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const MODAL_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 20,
  width: 420,
  color: '#e6edf3',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 16,
};
const TITLE_STYLE = { fontSize: 15, margin: 0, fontWeight: 700 };
const FIELD_STYLE = { display: 'flex', flexDirection: 'column' as const, gap: 4 };
const LABEL_STYLE = { fontSize: 11, color: '#8b949e' };
const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
};
const HINT_STYLE = { fontSize: 11, color: '#6e7681' };
const ERROR_STYLE = { color: '#f85149', fontSize: 12 };
const BUTTONS_STYLE = { display: 'flex', justifyContent: 'flex-end' as const, gap: 8 };
const CANCEL_BUTTON_STYLE = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
const SAVE_BUTTON_STYLE = {
  background: '#238636',
  border: '1px solid #2ea043',
  color: '#fff',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
```

- [ ] **Step 4: テストを再実行して PASS を確認**

```bash
pnpm --filter frontend test -- project-settings-dialog
```

Expected: すべて PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/dialog/project-settings-dialog.tsx packages/frontend/src/components/dialog/project-settings-dialog.test.tsx
git commit -m "feat(frontend): ProjectSettingsDialog を追加 (codebasePath 編集)"
```

---

## Task 11: ProjectHeaderActions と page.tsx 統合

**Files:**
- Create: `packages/frontend/src/components/header/project-header-actions.tsx`
- Modify: `packages/frontend/src/app/projects/[id]/page.tsx`

- [ ] **Step 1: project-header-actions.tsx を実装**

`packages/frontend/src/components/header/project-header-actions.tsx`:

```typescript
'use client';

import { useState } from 'react';

import { ProjectSettingsDialog } from '@/components/dialog/project-settings-dialog';

// ヘッダ右側のアクション群。現状は設定歯車ボタンのみ。
// ダイアログ側がストアの projectMeta を読むため、このコンポーネントは open 状態のみ管理。
export function ProjectHeaderActions() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-label="プロジェクト設定"
        title="プロジェクト設定"
        onClick={() => setOpen(true)}
        style={BUTTON_STYLE}
      >
        ⚙
      </button>
      <ProjectSettingsDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

const BUTTON_STYLE = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 14,
  cursor: 'pointer',
  marginLeft: 'auto',
};
```

- [ ] **Step 2: page.tsx に ProjectHeaderActions を組み込む**

`packages/frontend/src/app/projects/[id]/page.tsx`:

```typescript
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { loadProjectById } from '@/lib/project-resolver';
import { ProjectHeaderActions } from '@/components/header/project-header-actions';

import { CanvasClient } from './canvas-client';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ProjectPage({ params }: PageProps) {
  const { id } = await params;
  const project = await loadProjectById(decodeURIComponent(id));
  if (!project) notFound();

  return (
    <main
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        background: '#0d1117',
        color: '#e6edf3',
        fontFamily:
          "system-ui, -apple-system, 'Segoe UI', 'Hiragino Sans', 'Yu Gothic UI', sans-serif",
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '12px 20px',
          borderBottom: '1px solid #30363d',
          background: '#0d1117',
        }}
      >
        <Link href="/" style={{ color: '#8b949e', textDecoration: 'none', fontSize: 13 }}>
          ← プロジェクト一覧
        </Link>
        <h1 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>{project.name}</h1>
        <span style={{ color: '#8b949e', fontSize: 12 }}>
          ノード {project.nodes.length} / エッジ {project.edges.length}
        </span>
        <ProjectHeaderActions />
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>
        <CanvasClient project={project} />
      </div>
    </main>
  );
}
```

（`alignItems` を `baseline` から `center` に変更したのは歯車ボタンを縦中央合わせにするため。見た目変更があるため後の E2E で確認する）

- [ ] **Step 3: 型チェックと store テストを流して regression を確認**

```bash
pnpm --filter frontend typecheck
pnpm --filter frontend test
```

Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add packages/frontend/src/components/header/project-header-actions.tsx packages/frontend/src/app/projects/[id]/page.tsx
git commit -m "feat(frontend): プロジェクトヘッダに設定歯車ボタンを追加"
```

---

## Task 12: FindRelatedCodeButton を実装

**Files:**
- Create: `packages/frontend/src/components/ai-actions/find-related-code-button.tsx`
- Create: `packages/frontend/src/components/ai-actions/find-related-code-button.test.tsx`

- [ ] **Step 1: find-related-code-button.test.tsx を書く**

`packages/frontend/src/components/ai-actions/find-related-code-button.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { FindRelatedCodeButton } from './find-related-code-button';

function hydrate(codebasePath?: string, running = false) {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    ...(codebasePath !== undefined ? { codebasePath } : {}),
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    nodes: [
      { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 'uc', body: '' },
    ],
    edges: [],
  });
  if (running) {
    useCanvasStore.setState({
      runningAgent: { agent: 'decompose-to-stories', inputNodeId: 'uc-1', events: [] },
    } as never);
  }
}

const node = {
  id: 'uc-1',
  type: 'usecase' as const,
  x: 0,
  y: 0,
  title: 'uc',
  body: '',
};

describe('FindRelatedCodeButton', () => {
  it('codebasePath 未設定なら disabled', () => {
    hydrate(undefined, false);
    render(<FindRelatedCodeButton node={node} />);
    expect(screen.getByRole('button', { name: /関連コード/ })).toBeDisabled();
  });

  it('runningAgent が非 null なら disabled', () => {
    hydrate('../backend', true);
    render(<FindRelatedCodeButton node={node} />);
    expect(screen.getByRole('button', { name: /関連コード/ })).toBeDisabled();
  });

  it('click で startFindRelatedCode が呼ばれる', () => {
    hydrate('../backend', false);
    const startFindRelatedCode = vi.fn(async () => {});
    useCanvasStore.setState({ startFindRelatedCode } as never);
    render(<FindRelatedCodeButton node={node} />);
    fireEvent.click(screen.getByRole('button', { name: /関連コード/ }));
    expect(startFindRelatedCode).toHaveBeenCalledWith('uc-1');
  });

  it('codebasePath 未設定時は disabled + tooltip にヒント', () => {
    hydrate(undefined, false);
    render(<FindRelatedCodeButton node={node} />);
    const btn = screen.getByRole('button', { name: /関連コード/ });
    expect(btn.getAttribute('title')).toMatch(/codebasePath/);
  });
});
```

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
pnpm --filter frontend test -- find-related-code-button
```

Expected: FAIL

- [ ] **Step 3: find-related-code-button.tsx を実装**

`packages/frontend/src/components/ai-actions/find-related-code-button.tsx`:

```typescript
'use client';

import type { RequirementNode, UseCaseNode, UserStoryNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

type AnchorNode = UseCaseNode | RequirementNode | UserStoryNode;

// 「関連コードを探す」AI アクションボタン。UC / requirement / userstory の 3 detail から共通利用する。
// codebasePath 未設定 or 他エージェント実行中は disabled にする。
export function FindRelatedCodeButton({ node }: { node: AnchorNode }) {
  const startFindRelatedCode = useCanvasStore((s) => s.startFindRelatedCode);
  const codebasePath = useCanvasStore((s) => s.projectMeta?.codebasePath);
  const running = useCanvasStore((s) => s.runningAgent);

  const hasCodebase = typeof codebasePath === 'string' && codebasePath.trim().length > 0;
  const busy = running !== null;
  const disabled = busy || !hasCodebase;

  const tooltip = !hasCodebase
    ? 'codebasePath 未設定: ヘッダの設定から指定してください'
    : busy
      ? '別のエージェントが実行中です'
      : '既存コードから関連箇所を探索します';

  const onClick = () => {
    if (disabled) return;
    startFindRelatedCode(node.id).catch(console.error);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={tooltip}
      style={{ ...BUTTON_STYLE, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
    >
      {busy ? '実行中…' : '関連コードを探す'}
    </button>
  );
}

const BUTTON_STYLE = {
  background: '#8957e5',
  color: '#fff',
  border: '1px solid #a371f7',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  width: '100%',
} as const;
```

- [ ] **Step 4: テストを再実行して PASS を確認**

```bash
pnpm --filter frontend test -- find-related-code-button
```

Expected: すべて PASS

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/ai-actions/find-related-code-button.tsx packages/frontend/src/components/ai-actions/find-related-code-button.test.tsx
git commit -m "feat(frontend): FindRelatedCodeButton を追加"
```

---

## Task 13: 3 detail (UC / requirement / userstory) に find-related-code ボタンを統合

**Files:**
- Modify: `packages/frontend/src/components/details/usecase-detail.tsx`
- Modify: `packages/frontend/src/components/details/requirement-detail.tsx`
- Modify: `packages/frontend/src/components/details/userstory-detail.tsx`
- Modify: `packages/frontend/src/components/details/usecase-detail.test.tsx`

- [ ] **Step 1: usecase-detail.test.tsx を確認、必要ならテスト追加**

`packages/frontend/src/components/details/usecase-detail.test.tsx` を読んで既存テストを壊さないことを確認し、`関連コードを探す` ボタンが描画されるテストを追加:

```typescript
it('関連コードボタンが描画される', () => {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    codebasePath: '../backend',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' }],
    edges: [],
  });
  render(<UseCaseDetail node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' }} />);
  expect(screen.getByRole('button', { name: /関連コード/ })).toBeInTheDocument();
});
```

- [ ] **Step 2: usecase-detail.tsx にボタン追加**

`packages/frontend/src/components/details/usecase-detail.tsx` を更新:

```typescript
'use client';

import type { UseCaseNode } from '@tally/core';

import { FindRelatedCodeButton } from '@/components/ai-actions/find-related-code-button';
import { useCanvasStore } from '@/lib/store';

// UC ノード専用の詳細ペイン。AI アクションを 2 つ提供: ストーリー分解 / 関連コード探索。
// 同時実行は runningAgent で排他制御する。
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
      <button
        type="button"
        disabled={busy}
        onClick={onDecompose}
        style={{ ...BUTTON_STYLE, cursor: busy ? 'not-allowed' : 'pointer' }}
      >
        {busy ? '実行中…' : 'ストーリー分解'}
      </button>
      <FindRelatedCodeButton node={node} />
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
  width: '100%',
} as const;
```

- [ ] **Step 3: requirement-detail.tsx にボタン追加**

`packages/frontend/src/components/details/requirement-detail.tsx` の末尾 `</div>` の直前に AI アクション節を追加:

```typescript
// import 追加
import { FindRelatedCodeButton } from '@/components/ai-actions/find-related-code-button';

// ... 既存コード（kind / priority / qualityCategory select）

      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 8 }}>AI アクション</div>
      <FindRelatedCodeButton node={node} />
    </div>
```

最終形は以下のように return 内最終 div に追加:

```typescript
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      {/* 既存: kind, priority, qualityCategory */}
      <div style={FIELD_STYLE}>
        <label htmlFor={kindId} style={LABEL_STYLE}>種別</label>
        {/* ... */}
      </div>
      {/* 省略 */}
      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 8 }}>AI アクション</div>
      <FindRelatedCodeButton node={node} />
    </div>
  );
```

- [ ] **Step 4: userstory-detail.tsx にボタン追加**

`packages/frontend/src/components/details/userstory-detail.tsx` の `return` 最外 `<div>` の末尾に追加:

```typescript
// import 追加
import { FindRelatedCodeButton } from '@/components/ai-actions/find-related-code-button';

// ... 既存コード

      <div style={{ fontSize: 11, color: '#8b949e', marginTop: 8 }}>AI アクション</div>
      <FindRelatedCodeButton node={node} />
    </div>
```

- [ ] **Step 5: テストを実行し PASS を確認**

```bash
pnpm --filter frontend test -- usecase-detail
pnpm --filter frontend typecheck
```

Expected: すべて PASS

- [ ] **Step 6: コミット**

```bash
git add packages/frontend/src/components/details/usecase-detail.tsx packages/frontend/src/components/details/usecase-detail.test.tsx packages/frontend/src/components/details/requirement-detail.tsx packages/frontend/src/components/details/userstory-detail.tsx
git commit -m "feat(frontend): UC/requirement/userstory detail に find-related-code ボタンを追加"
```

---

## Task 14: ProposalDetail で additional を adopt に引き継ぐ

**Files:**
- Modify: `packages/frontend/src/components/details/proposal-detail.tsx`
- Modify: `packages/frontend/src/components/details/proposal-detail.test.tsx`

- [ ] **Step 1: proposal-detail.test.tsx に追加テストを書く**

`packages/frontend/src/components/details/proposal-detail.test.tsx` に追加:

```typescript
it('coderef adopt 時に proposal 固有属性 (filePath 等) が additional として渡る', async () => {
  const adoptProposal = vi.fn(async () => ({
    id: 'prop-1',
    type: 'coderef',
    x: 0,
    y: 0,
    title: 'src/invite.ts:10',
    body: '',
    filePath: 'src/invite.ts',
  }));
  useCanvasStore.setState({ adoptProposal } as never);
  render(
    <ProposalDetail
      node={
        {
          id: 'prop-1',
          type: 'proposal',
          x: 0,
          y: 0,
          title: '[AI] src/invite.ts:10',
          body: '',
          adoptAs: 'coderef',
          filePath: 'src/invite.ts',
          startLine: 10,
          endLine: 20,
        } as never
      }
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /採用/ }));
  await Promise.resolve();
  expect(adoptProposal).toHaveBeenCalledWith(
    'prop-1',
    'coderef',
    { filePath: 'src/invite.ts', startLine: 10, endLine: 20 },
  );
});
```

既存の「採用ボタン押下で〜」テストの期待値 `toHaveBeenCalledWith('prop-1', 'userstory', undefined)` は引き続き通る想定（node に余計なフィールドが無いケース）。

- [ ] **Step 2: テストを実行し失敗を確認**

```bash
pnpm --filter frontend test -- proposal-detail
```

Expected: 新テストが FAIL (`adoptProposal` が 3 引数目 undefined で呼ばれる)

- [ ] **Step 3: proposal-detail.tsx の onAdopt を書き換える**

`packages/frontend/src/components/details/proposal-detail.tsx` の `onAdopt`:

```typescript
const onAdopt = async () => {
  setBusy(true);
  setError(null);
  try {
    // proposal ノードに保持されている type 固有属性を additional として採用時に引き継ぐ。
    // 既知キー (id / type / 座標 / title / body / adoptAs / sourceAgentId) を取り除いた残りを渡す。
    const {
      id: _id,
      type: _type,
      x: _x,
      y: _y,
      title: _title,
      body: _body,
      adoptAs: _adoptAs,
      sourceAgentId: _sourceAgentId,
      ...rest
    } = node as unknown as Record<string, unknown>;
    const additional = Object.keys(rest).length > 0 ? rest : undefined;
    await adoptProposal(node.id, adoptAs, additional);
  } catch (err) {
    setError(String(err));
  } finally {
    setBusy(false);
  }
};
```

- [ ] **Step 4: テストを再実行して PASS を確認**

```bash
pnpm --filter frontend test -- proposal-detail
```

Expected: すべて PASS (既存 + 新規)

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/details/proposal-detail.tsx packages/frontend/src/components/details/proposal-detail.test.tsx
git commit -m "feat(frontend): proposal 採用時に additional (filePath 等) を引き継ぐ"
```

---

## Task 15: examples/taskflow-backend 最小サンプルを用意

**Files:**
- Create: `examples/taskflow-backend/README.md`
- Create: `examples/taskflow-backend/src/invite.ts`
- Create: `examples/taskflow-backend/src/mailer.ts`

このサンプルは実行可能プロジェクトを目指さず、find-related-code が読み込む対象として十分な TS コードをコミットすることが目的。

- [ ] **Step 1: README.md を作成**

`examples/taskflow-backend/README.md`:

```markdown
# examples/taskflow-backend

`examples/sample-project` の `codebasePath: ../taskflow-backend` が指す最小サンプル。
Tally の `find-related-code` エージェントが実際にコードを読み込めることを手動 E2E で確認するための固定コードベース。

## 構成

- `src/invite.ts` — チーム招待 UC 相当の実装骨子
- `src/mailer.ts` — メール送信のダミー実装

これは「動くアプリ」ではなく、Glob / Grep / Read で AI が辿れる最小形。
追加のビルド設定や依存は入れていない。
```

- [ ] **Step 2: src/invite.ts を作成**

`examples/taskflow-backend/src/invite.ts`:

```typescript
import { sendMail } from './mailer';

// チーム招待: プロジェクト管理者が新規メンバーを招待するための最小実装。
// Phase 5a 手動 E2E の「UC → 関連コード探索」対象として Grep / Read で辿れる粒度を提供する。
export interface InviteRequest {
  projectId: string;
  inviterUserId: string;
  email: string;
}

export interface InviteRecord extends InviteRequest {
  id: string;
  token: string;
  createdAt: string;
  acceptedAt?: string;
}

export async function createInvite(req: InviteRequest): Promise<InviteRecord> {
  const token = generateInviteToken();
  const record: InviteRecord = {
    id: `inv-${Date.now()}`,
    token,
    createdAt: new Date().toISOString(),
    ...req,
  };
  await sendMail({
    to: req.email,
    subject: 'TaskFlow への招待',
    body: `以下のリンクから参加してください: https://taskflow.example/invite/${token}`,
  });
  return record;
}

function generateInviteToken(): string {
  // MVP: 衝突確率は現実的に十分低い。乱数源は将来 crypto.randomBytes に差し替える想定。
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export async function acceptInvite(token: string): Promise<{ ok: boolean }> {
  // TODO: トークンから招待レコードを引き、ユーザーをプロジェクトに追加する。
  void token;
  return { ok: true };
}
```

- [ ] **Step 3: src/mailer.ts を作成**

`examples/taskflow-backend/src/mailer.ts`:

```typescript
// メール送信のダミー。実運用では SES / SendGrid 等に差し替える。
export interface MailPayload {
  to: string;
  subject: string;
  body: string;
}

export async function sendMail(payload: MailPayload): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[mailer] sending mail to', payload.to, 'subject:', payload.subject);
}
```

- [ ] **Step 4: ディレクトリ構造を確認**

```bash
ls examples/taskflow-backend/src/
```

Expected: `invite.ts  mailer.ts`

- [ ] **Step 5: コミット**

```bash
git add examples/taskflow-backend/README.md examples/taskflow-backend/src/invite.ts examples/taskflow-backend/src/mailer.ts
git commit -m "docs(examples): Phase 5a 手動 E2E 用の taskflow-backend 最小サンプルを追加"
```

---

## Task 16: docs/phase-5a-manual-e2e.md とロードマップ更新

**Files:**
- Create: `docs/phase-5a-manual-e2e.md`
- Modify: `docs/04-roadmap.md`

- [ ] **Step 1: docs/phase-5a-manual-e2e.md を作成**

`docs/phase-5a-manual-e2e.md`:

```markdown
# Phase 5a 手動 E2E テスト手順

Phase 5a (`find-related-code` エージェント + codebasePath UI + 読み取り専用モード基盤) の動作を
Claude Code 実行環境で確認する手順。CI では実行できないため、このドキュメントに従って手動検証する。

## 前提

- macOS / Linux、Node.js 20+、pnpm 9+
- `claude` CLI (Claude Code) がインストールされ `claude login` 済み
- 本リポジトリがチェックアウトされている
- `examples/sample-project/.tally/project.yaml` が `codebasePath: ../taskflow-backend` を持つ
- `examples/taskflow-backend/` に `src/invite.ts`, `src/mailer.ts` が存在する

## 起動

```bash
pnpm install
pnpm dev
```

- frontend: http://localhost:3000
- ai-engine: ws://localhost:4000/agent

## 正常系: UC → 関連コード探索 → 採用

1. ブラウザで http://localhost:3000 を開き、TaskFlow 招待機能追加プロジェクトに入る
2. ヘッダ右上の歯車ボタン (⚙) を押し、ProjectSettingsDialog を開く
3. codebasePath 欄が `../taskflow-backend` になっていることを確認 (サンプル初期値)。
   空になっていたら `../taskflow-backend` と入力して「保存」
4. 招待関連の UC ノード (`uc-send-invite` など) をクリック
5. 右側 DetailSheet 下部の「AI アクション」節に「関連コードを探す」ボタンが出ていることを確認
6. 「関連コードを探す」ボタンを押下
7. 画面右下の AgentProgressPanel に以下が順に現れることを確認
   - `▶ start find-related-code`
   - thinking テキスト (codebase 探索の思考)
   - `🛠  Glob ...` / `🛠  Grep ...` / `🛠  Read ...` (ビルトインツール)
   - `🛠  mcp__tally__list_by_type ...` (既存 coderef 確認)
   - `🛠  mcp__tally__create_node ...` (proposal 作成)
   - `🛠  mcp__tally__create_edge ...` (derive エッジ作成)
   - `✓ node prop-xxx` と `✓ edge e-xxx` が proposal 数だけ繰り返される
   - `✅ done: ...` で要約
8. Canvas 上に UC から derive エッジで繋がった紫色 proposal ノード (1〜8 件) が
   生成されていることを確認
9. 生成された proposal ノードの 1 つをクリック → DetailSheet を確認:
   - タイトルが `[AI] src/invite.ts:NN` のような形式
   - body にコード要約が書かれている
   - 採用先が `coderef` で選ばれている
10. 「採用する」ボタンを押下
11. ノードの色が coderef (灰) に切り替わり、タイトルから `[AI] ` が消えることを確認
12. ブラウザをリロード → proposal / coderef が YAML に保存されていることを確認
13. ターミナルで `git diff examples/sample-project/.tally/nodes/` を実行 → 採用後の
    ノードに `filePath: src/invite.ts` / `startLine: N` / `endLine: M` が入っていることを確認

## 異常系: codebasePath 未設定

1. ヘッダ歯車 → codebasePath 欄を空にして「保存」
2. UC ノードを選択 → 「関連コードを探す」ボタンを確認
3. ボタンが disabled になっており、hover すると「codebasePath 未設定」のツールチップが出ることを確認

## 異常系: codebasePath 解決失敗

1. ヘッダ歯車 → codebasePath 欄を `../nonexistent-xyz` に変更 → 「保存」
2. UC ノードを選択 → 「関連コードを探す」ボタン押下
3. AgentProgressPanel に `❌ not_found: codebasePath 解決失敗: ...` が表示されることを確認

## 異常系: 対象外 type

Phase 5a の find-related-code は UC / requirement / userstory のみを anchor にする。
coderef / question / issue の detail には「関連コードを探す」ボタンは存在しない (UI レベルで非表示)。

手動確認は不要（UI で出ていなければ OK）。

## 境界確認: 書き込みツールが使われないこと

AgentProgressPanel のログに `Edit` / `Write` / `Bash` ツールの使用が現れないこと。
`mcp__tally__create_node` / `mcp__tally__create_edge` のみが書き込みツールとして現れる。
SDK の `allowedTools` ホワイトリストで弾かれているため、モデルが試みても 'tool not available' エラーになる。

## 後片付け

- 生成した proposal / coderef を破棄したい場合:
  ```
  git checkout -- examples/sample-project/.tally/
  ```
- または Canvas 上で選択 → 「ノードを削除」ボタン

## 完了条件 (ロードマップ Phase 5 部分)

- [x] `find-related-code.ts`: 既存コード探索 (Glob/Grep/Read 使用)
- [x] プロジェクト設定で `codebasePath` を指定する UI
- [x] ツール使用の権限制御 (読み取り専用モード基盤)
- 残り (`analyze-impact` / `extract-questions` / `ingest-document`) は Phase 5b-d で別途実装

以上の 3 項目が手動で動作することが Phase 5a 完了の条件。
```

- [ ] **Step 2: docs/04-roadmap.md の Phase 5 セクションを更新**

`docs/04-roadmap.md` の Phase 5 タスクリスト部分を更新:

```markdown
## Phase 5: AI アクション拡充

### ゴール

すべての AI アクションが動く。

### Phase 5a (先行実装、完了)

- [x] `find-related-code.ts`：既存コード探索（Glob/Grep/Read 使用）
- [x] プロジェクト設定で `codebasePath` を指定する UI (ヘッダ歯車ボタン)
- [x] ツール使用の権限制御（読み取り専用モード基盤 — エージェントごとの allowedTools ホワイトリスト）
- [x] ProposalDetail の additional 引き継ぎ (coderef 採用時に filePath を保持)
- [x] agent registry 化 (decompose-to-stories も移行)

手動 E2E 手順は `docs/phase-5a-manual-e2e.md` 参照。

### Phase 5b-d (未実装)

- [ ] `analyze-impact.ts`：影響分析
- [ ] `extract-questions.ts`：論点抽出
- [ ] `ingest-document.ts`：要求書取り込み

### 完了条件

- 既存コードを指定したプロジェクトで「関連コード」アクションがコードベースを実際に読む (Phase 5a)
- 生成された coderef ノードが実ファイルパスを指している (Phase 5a)
- 論点ノードが選択肢候補付きで正しく生成される (Phase 5c)
```

（既存の「### タスク」と「### 完了条件」ブロックを上記構造に置換）

- [ ] **Step 3: すべてのテストを最終実行**

```bash
pnpm -r test
pnpm -r typecheck
```

Expected: すべて PASS。

- [ ] **Step 4: lint/format**

```bash
pnpm -r biome:check 2>/dev/null || pnpm exec biome check .
```

（コマンド名はルートの package.json による。typecheck とテストが通り biome に問題がなければ OK）

- [ ] **Step 5: コミット**

```bash
git add docs/phase-5a-manual-e2e.md docs/04-roadmap.md
git commit -m "docs: Phase 5a 手動 E2E 手順書とロードマップを更新"
```

---

## 最終確認チェックリスト

Phase 5a が完了したら以下を確認する:

- [ ] `pnpm -r test` がすべて緑
- [ ] `pnpm -r typecheck` がすべて緑
- [ ] `docs/phase-5a-manual-e2e.md` の正常系シナリオを手動で通す（AI Engine との通信が必要）
- [ ] コミットが小さく分割されている（16 コミット前後）
- [ ] `docs/04-roadmap.md` Phase 5 の進捗が 5a 分チェックされている
- [ ] MEMORY.md 相当の進捗メモは本 plan ではなくユーザーに報告する（work summary として）
