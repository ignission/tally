# Phase 5c: extract-questions 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 対象ノード (requirement / usecase / userstory) の記述から「まだ決めていない設計判断」を `question` proposal として抽出する `extract-questions` エージェントを投入する。proposal は必ず 2〜4 個の `options` 候補を持ち、`decision` は null。人間が採用・選択して初めて決定済みとなる。

**Architecture:** Phase 5a/5b で確立した agent registry + validateCodebaseAnchor 共通ヘルパを踏襲。helper に `requireCodebasePath` オプションを足して「グラフ文脈のみ」陣営 (codebasePath 不要) を追加。プロンプトは MCP 4 ツール (`create_node` / `create_edge` / `find_related` / `list_by_type`) のみ利用、コード探索系 (`Glob` / `Grep` / `Read`) は付与しない。`create_node` は `adoptAs='question'` 時に options を `{id, text, selected}` に正規化 + `decision: null` を固定、anchor の近傍に同タイトル question (正規 / proposal 問わず) があれば重複 reject。frontend は `CodebaseAgentButton` と並列に `GraphAgentButton` を新設 (codebasePath 依存を外したシンプル版)、`ExtractQuestionsButton` が thin wrapper、store に `startExtractQuestions` を追加して 3 detail に配置。

**Tech Stack:** TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Next.js 15, Zustand, Zod, Vitest, Testing Library.

---

## 前提: 関連 spec と参照

- spec: `docs/superpowers/specs/2026-04-20-phase5c-extract-questions-design.md`
- 直系前例:
  - `docs/superpowers/specs/2026-04-19-phase5b-analyze-impact-design.md`
  - `docs/superpowers/plans/2026-04-19-phase5b-analyze-impact.md`
- ADR: `docs/adr/0005-proposal-adoption.md`, `docs/adr/0007-agent-tool-restriction.md`
- ドメイン: `docs/02-domain-model.md` (question 節)
- 既存資産:
  - `packages/core/src/id.ts` (`newNodeId` / `newEdgeId` パターン)
  - `packages/core/src/logic/prefix.ts` (`stripAiPrefix`)
  - `packages/ai-engine/src/agents/codebase-anchor.ts` (5b で抽出済み)
  - `packages/ai-engine/src/agents/registry.ts`
  - `packages/ai-engine/src/agents/analyze-impact.ts` (最も近い前例)
  - `packages/ai-engine/src/tools/create-node.ts` (5b で重複ガード / 正規化を導入済み)
  - `packages/ai-engine/src/tools/index.ts` (`buildTallyMcpServer`)
  - `packages/ai-engine/src/agent-runner.ts` (validate → MCP → SDK の流れ)
  - `packages/frontend/src/components/ai-actions/codebase-agent-button.tsx` (5b で抽出済み)
  - `packages/frontend/src/components/ai-actions/analyze-impact-button.tsx` (thin wrapper の前例)
  - `packages/frontend/src/lib/store.ts` (`runAgentWS` 共通ヘルパ済み)

## ファイル構造

### core
- **変更** `packages/core/src/types.ts` — `AGENT_NAMES` に `'extract-questions'` 追加
- **変更** `packages/core/src/id.ts` — `newQuestionOptionId` 追加
- **変更** `packages/core/src/id.test.ts` — `newQuestionOptionId` 形式テスト
- **変更** `packages/core/src/index.ts` — `newQuestionOptionId` export

### ai-engine
- **変更** `packages/ai-engine/src/agents/codebase-anchor.ts` — `requireCodebasePath` option 追加
- **変更** `packages/ai-engine/src/agents/codebase-anchor.test.ts` — `requireCodebasePath: false` 経路のテスト追加
- **新規** `packages/ai-engine/src/agents/extract-questions.ts` — プロンプト + `extractQuestionsAgent`
- **新規** `packages/ai-engine/src/agents/extract-questions.test.ts`
- **変更** `packages/ai-engine/src/agents/registry.ts` — `extract-questions` 登録
- **変更** `packages/ai-engine/src/agents/registry.test.ts` — `extract-questions` も登録されている確認
- **変更** `packages/ai-engine/src/agent-runner.test.ts` — `extract-questions` happy-path 追加
- **変更** `packages/ai-engine/src/tools/create-node.ts` — `adoptAs='question'` の options ID 補完 + anchor+タイトル重複ガード
- **変更** `packages/ai-engine/src/tools/create-node.test.ts` — 新機能のテスト追加
- **変更** `packages/ai-engine/src/tools/index.ts` — `TallyToolDeps` に `anchorId` 追加
- **変更** `packages/ai-engine/src/tools/tools-index.test.ts` — `anchorId` 含むシグネチャ確認

### frontend
- **新規** `packages/frontend/src/components/ai-actions/graph-agent-button.tsx`
- **新規** `packages/frontend/src/components/ai-actions/graph-agent-button.test.tsx`
- **新規** `packages/frontend/src/components/ai-actions/extract-questions-button.tsx`
- **新規** `packages/frontend/src/components/ai-actions/extract-questions-button.test.tsx`
- **変更** `packages/frontend/src/lib/store.ts` — `startExtractQuestions` 追加
- **変更** `packages/frontend/src/lib/store.test.ts` — `startExtractQuestions` シナリオ追加
- **変更** `packages/frontend/src/components/details/usecase-detail.tsx` — ExtractQuestionsButton 追加
- **変更** `packages/frontend/src/components/details/usecase-detail.test.tsx` — 配置を assert
- **変更** `packages/frontend/src/components/details/requirement-detail.tsx` — ExtractQuestionsButton 追加
- **変更** `packages/frontend/src/components/details/userstory-detail.tsx` — ExtractQuestionsButton 追加

### docs
- **変更** `docs/02-domain-model.md` — question 節に「extract-questions 由来の proposal」1 行追記
- **変更** `docs/04-roadmap.md` — Phase 5c / Phase 5 完了条件のチェックを進める
- **新規** `docs/phase-5c-manual-e2e.md`
- **新規** `docs/phase-5c-progress.md` (別 PC 引き継ぎ用 memory 代替)

---

## Task 1: core の AGENT_NAMES 拡張 + newQuestionOptionId 追加

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/id.ts`
- Modify: `packages/core/src/id.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: id.test.ts に newQuestionOptionId テストを追加 (failing test)**

`packages/core/src/id.test.ts` の末尾に追加:

```typescript
import { newQuestionOptionId } from './id';

describe('newQuestionOptionId', () => {
  it('opt- プレフィックス + 10 文字 (英数字) を返す', () => {
    const id = newQuestionOptionId();
    expect(id.startsWith('opt-')).toBe(true);
    expect(id.length).toBe(4 + 10);
    expect(id.slice(4)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('連続呼び出しでほぼ衝突しない (10 回生成が全て異なる)', () => {
    const ids = new Set(Array.from({ length: 10 }, () => newQuestionOptionId()));
    expect(ids.size).toBe(10);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
cd ~/dev/github.com/ignission/tally
NODE_ENV=development pnpm --filter @tally/core test -- id
```

Expected: FAIL (`newQuestionOptionId` が未 export)。

- [ ] **Step 3: id.ts に newQuestionOptionId を追加**

`packages/core/src/id.ts` の末尾に:

```typescript
// 論点ノードの選択肢 ID。extract-questions エージェントが生成する options の
// 識別子に使う。衝突耐性と可読性を揃えるためノード ID と同じ 10 文字サフィックス。
export function newQuestionOptionId(): string {
  return `opt-${generateSuffix()}`;
}
```

- [ ] **Step 4: index.ts から export**

`packages/core/src/index.ts` の既存 `export { newNodeId, newEdgeId, newProjectId } from './id';` 風の export 行に追記 (実ファイルの記述スタイルに合わせて):

```typescript
export { newEdgeId, newNodeId, newProjectId, newQuestionOptionId } from './id';
```

- [ ] **Step 5: テストを再実行して GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/core test -- id
```

Expected: PASS。

- [ ] **Step 6: AGENT_NAMES に 'extract-questions' を追加**

`packages/core/src/types.ts` の該当箇所:

```typescript
export const AGENT_NAMES = [
  'decompose-to-stories',
  'find-related-code',
  'analyze-impact',
  'extract-questions',
] as const;
```

- [ ] **Step 7: core 全緑確認**

```bash
NODE_ENV=development pnpm --filter @tally/core test
```

Expected: PASS (core は AGENT_NAMES 拡張だけではテスト影響なし、+2 本追加済み)。

この時点で `packages/ai-engine` の build は `AGENT_REGISTRY satisfies Record<AgentName, AgentDefinition>` により extract-questions 未登録で TS エラーになる。Task 4 で解消される。ai-engine のテスト (`vitest run`) は型チェックを通さず実行されるため Task 2〜3 では緑のまま進められる。

- [ ] **Step 8: コミット**

```bash
cd ~/dev/github.com/ignission/tally
git add packages/core/src/types.ts packages/core/src/id.ts packages/core/src/id.test.ts packages/core/src/index.ts
git commit -m "feat(core): AGENT_NAMES に extract-questions 追加 + newQuestionOptionId"
```

---

## Task 2: validateCodebaseAnchor に requireCodebasePath option を追加

**Files:**
- Modify: `packages/ai-engine/src/agents/codebase-anchor.ts`
- Modify: `packages/ai-engine/src/agents/codebase-anchor.test.ts`

- [ ] **Step 1: codebase-anchor.test.ts に requireCodebasePath: false 経路のテストを追加 (failing)**

`packages/ai-engine/src/agents/codebase-anchor.test.ts` の末尾 `describe('validateCodebaseAnchor', () => { ... })` ブロック内に追加:

```typescript
  it('requireCodebasePath: false なら codebasePath 未設定でも ok', async () => {
    const node = { id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' };
    const store = makeStore({
      getNode: vi.fn().mockResolvedValue(node),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({ id: 'p', name: 'x', createdAt: '', updatedAt: '' }),
    });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot },
      'uc',
      allowed,
      'extract-questions',
      { requireCodebasePath: false },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor).toEqual(node);
      expect(r.cwd).toBeUndefined();
    }
  });

  it('requireCodebasePath: false でも nodeId 不存在 / 対象外 type は従来通り弾く', async () => {
    const store = makeStore({ getNode: vi.fn().mockResolvedValue(null) });
    const r = await validateCodebaseAnchor(
      { store, workspaceRoot },
      'missing',
      allowed,
      'extract-questions',
      { requireCodebasePath: false },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });
```

- [ ] **Step 2: テスト実行で失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- codebase-anchor
```

Expected: FAIL (`requireCodebasePath` option を受けるシグネチャではない)。

- [ ] **Step 3: codebase-anchor.ts に option を追加**

`packages/ai-engine/src/agents/codebase-anchor.ts` を以下に置き換え:

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { NodeType } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

import type { AgentValidateResult } from './registry';

export interface ValidateCodebaseAnchorOptions {
  // codebasePath の存在を必須にするか (default: true)。
  // extract-questions のように codebase を読まないエージェントは false を渡す。
  requireCodebasePath?: boolean;
}

// anchor type と (必要なら) codebasePath を検証する共通ヘルパ。
// find-related-code / analyze-impact は requireCodebasePath=true (default) で使う。
// extract-questions は requireCodebasePath=false を渡してグラフ文脈のみで起動する。
export async function validateCodebaseAnchor(
  deps: { store: ProjectStore; workspaceRoot: string },
  nodeId: string,
  allowedTypes: readonly NodeType[],
  agentLabel: string,
  options: ValidateCodebaseAnchorOptions = {},
): Promise<AgentValidateResult> {
  const requireCodebasePath = options.requireCodebasePath ?? true;

  const node = await deps.store.getNode(nodeId);
  if (!node) {
    return { ok: false, code: 'not_found', message: `ノードが存在しない: ${nodeId}` };
  }
  if (!(allowedTypes as readonly string[]).includes(node.type)) {
    return {
      ok: false,
      code: 'bad_request',
      message: `${agentLabel} の対象外: ${node.type}`,
    };
  }

  if (!requireCodebasePath) {
    // codebase を読まないエージェント用: anchor type だけ検証して返す。
    return { ok: true, anchor: node };
  }

  const meta = await deps.store.getProjectMeta();
  if (!meta?.codebasePath) {
    return {
      ok: false,
      code: 'bad_request',
      message: 'プロジェクト設定で codebasePath を指定してください',
    };
  }
  const abs = path.resolve(deps.workspaceRoot, meta.codebasePath);
  try {
    const st = await fs.stat(abs);
    if (!st.isDirectory()) {
      return {
        ok: false,
        code: 'bad_request',
        message: `codebasePath がディレクトリではない: ${abs}`,
      };
    }
  } catch {
    return { ok: false, code: 'not_found', message: `codebasePath 解決失敗: ${abs}` };
  }
  return { ok: true, anchor: node, cwd: abs };
}
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- codebase-anchor
```

Expected: PASS (追加 2 本 + 既存 6 本、計 8 本)。

- [ ] **Step 5: find-related-code / analyze-impact 側の挙動退行が無いことを確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test
```

Expected: 全緑 (`find-related-code` / `analyze-impact` は option を省略し default true を使っているため挙動変化なし)。

- [ ] **Step 6: コミット**

```bash
git add packages/ai-engine/src/agents/codebase-anchor.ts packages/ai-engine/src/agents/codebase-anchor.test.ts
git commit -m "refactor(ai-engine): validateCodebaseAnchor に requireCodebasePath オプションを追加"
```

---

## Task 3: extract-questions.ts (プロンプト + エージェント定義)

**Files:**
- Create: `packages/ai-engine/src/agents/extract-questions.ts`
- Create: `packages/ai-engine/src/agents/extract-questions.test.ts`

> **注:** このタスクでは registry 未登録。`AGENT_REGISTRY satisfies Record<AgentName, AgentDefinition>` により ai-engine の **build** は失敗するが、**test** は通る。Task 4 で build も復活する。

- [ ] **Step 1: extract-questions.test.ts を作成 (failing)**

`packages/ai-engine/src/agents/extract-questions.test.ts`:

```typescript
import type { ProjectStore } from '@tally/storage';
import { describe, expect, it, vi } from 'vitest';

import { buildExtractQuestionsPrompt, extractQuestionsAgent } from './extract-questions';

describe('buildExtractQuestionsPrompt', () => {
  const anchor = {
    id: 'uc-1',
    type: 'usecase' as const,
    x: 0,
    y: 0,
    title: '招待を送る',
    body: 'メンバーがチームに招待メールを送信する',
  };

  it('役割と出力規約を含む system prompt を返す', () => {
    const { systemPrompt } = buildExtractQuestionsPrompt({ anchor });
    expect(systemPrompt).toContain('論点抽出アシスタント');
    expect(systemPrompt).toContain('未決定');
    expect(systemPrompt).toContain('options');
    expect(systemPrompt).toContain('2〜4');
    expect(systemPrompt).toContain('adoptAs="question"');
    expect(systemPrompt).toContain('type="derive"');
  });

  it('対象ノードの id / type / title / body を user prompt に埋め込む', () => {
    const { userPrompt } = buildExtractQuestionsPrompt({ anchor });
    expect(userPrompt).toContain('uc-1');
    expect(userPrompt).toContain('usecase');
    expect(userPrompt).toContain('招待を送る');
    expect(userPrompt).toContain('メンバーがチームに招待');
  });

  it('コード探索系の用語を含まない (Glob/Grep/Read を使わないエージェント)', () => {
    const { systemPrompt } = buildExtractQuestionsPrompt({ anchor });
    expect(systemPrompt).not.toMatch(/Glob/);
    expect(systemPrompt).not.toMatch(/Grep/);
  });
});

describe('extractQuestionsAgent', () => {
  it('名前とツール許可リストが仕様通り', () => {
    expect(extractQuestionsAgent.name).toBe('extract-questions');
    expect(extractQuestionsAgent.allowedTools).toEqual([
      'mcp__tally__create_node',
      'mcp__tally__create_edge',
      'mcp__tally__find_related',
      'mcp__tally__list_by_type',
    ]);
    // built-in (Glob / Grep / Read / Bash / Edit / Write) は含まない
    for (const t of extractQuestionsAgent.allowedTools) {
      expect(t.startsWith('mcp__')).toBe(true);
    }
  });

  it('inputSchema は nodeId: string を要求する', () => {
    expect(extractQuestionsAgent.inputSchema.safeParse({ nodeId: 'uc-1' }).success).toBe(true);
    expect(extractQuestionsAgent.inputSchema.safeParse({ nodeId: '' }).success).toBe(false);
    expect(extractQuestionsAgent.inputSchema.safeParse({}).success).toBe(false);
  });

  it('validateInput は requireCodebasePath=false で codebasePath 無しでも通す', async () => {
    const node = { id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' };
    const store = {
      getNode: vi.fn().mockResolvedValue(node),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({ id: 'p', name: 'x', createdAt: '', updatedAt: '' }),
    } as unknown as ProjectStore;
    const r = await extractQuestionsAgent.validateInput(
      { store, workspaceRoot: '/ws' },
      { nodeId: 'uc-1' },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor).toEqual(node);
      expect(r.cwd).toBeUndefined();
    }
  });

  it('issue / coderef anchor は弾く (3 型以外)', async () => {
    const node = { id: 'i-1', type: 'issue', x: 0, y: 0, title: '', body: '' };
    const store = {
      getNode: vi.fn().mockResolvedValue(node),
      getProjectMeta: vi.fn().mockResolvedValue(null),
    } as unknown as ProjectStore;
    const r = await extractQuestionsAgent.validateInput(
      { store, workspaceRoot: '/ws' },
      { nodeId: 'i-1' },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
  });
});
```

- [ ] **Step 2: テスト実行で失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- extract-questions
```

Expected: FAIL (`extract-questions` モジュール未存在)。

- [ ] **Step 3: extract-questions.ts を新規作成**

`packages/ai-engine/src/agents/extract-questions.ts`:

```typescript
import type { Node } from '@tally/core';
import { z } from 'zod';

import { validateCodebaseAnchor } from './codebase-anchor';
import type { AgentDefinition } from './registry';

export interface ExtractQuestionsPromptInput {
  anchor: Node;
}

// extract-questions のプロンプト。対象ノードと近傍ノードの記述だけを見て、
// まだ決めていない設計判断を question proposal として出す。コード探索はしない。
export function buildExtractQuestionsPrompt(input: ExtractQuestionsPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    'あなたは Tally の論点抽出アシスタントです。',
    '対象ノード (usecase / requirement / userstory) を眺めて、',
    'この要求を実装するにあたって「まだ決めていない設計判断」を question proposal として洗い出します。',
    '',
    'あなたの主役は question proposal (未決定の判断の表面化) です。',
    '実装詳細や既存コードへの影響は別エージェント (analyze-impact / find-related-code) の担当なので、',
    'ここでは「そもそも決まっていない判断」にフォーカスしてください。',
    '',
    '手順:',
    '1. mcp__tally__find_related(nodeId=対象ノード) で anchor に繋がる近傍ノードを取得する。',
    '   既存 question の title を確認し、同じ論点は再作成しない。',
    '2. mcp__tally__list_by_type("question") で他 anchor に紐づく既存を確認し、',
    '   同一 anchor+同タイトルの question は作らない。',
    '3. anchor の title / body と近傍ノードの記述から、',
    '   「まだ決めていない判断」を 0〜5 件抽出する。',
    '   例: スコープの切り方、処理タイミング、データ保存方針、認証方式、',
    '   エラー時の振る舞い、競合時の挙動、既定値、権限境界、API 粒度、など。',
    '4. 各 question には必ず 2〜4 個の options 候補を添える。',
    '   options は互いに排他的で、それぞれが 1 行で意味が分かる簡潔な表現にする。',
    '',
    '出力規約:',
    '- create_node で type="proposal", adoptAs="question"',
    '  タイトル: "[AI] <短く具体的な問い>" (疑問形または "〜を〜にするか" の形)',
    '  body: 問いの背景 / 決めるべき理由 / 検討の観点 (2〜4 行)',
    '  additional: { options: [{ text: "..." }, ...], decision: null }',
    '    options の id / selected はサーバ側で補完される (AI が指定する必要なし)',
    '- エッジ: create_edge(type="derive", from=<対象ノード>, to=<新 question>)',
    '',
    '個数目安:',
    '- question proposal: 0〜5 件',
    '- 論点が見えなければ 0 件でも可。無理に作らないこと。',
    '- 最後に「何を見て、何が未決定と判断したか」を 3〜4 行で日本語で要約する。',
    '',
    'ツール使用方針: mcp__tally__* のみ使用 (build に含まれていない探索系は呼ばない)。',
  ].join('\n');

  const userPrompt = [
    `対象ノード: ${input.anchor.id}`,
    `type: ${input.anchor.type}`,
    `タイトル: ${input.anchor.title}`,
    `本文:\n${input.anchor.body}`,
    '',
    '上記ノードを実装するうえで、まだ決めていない設計判断を抽出し、',
    'question proposal として記録してください。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

const ExtractQuestionsInputSchema = z.object({ nodeId: z.string().min(1) });
type ExtractQuestionsInput = z.infer<typeof ExtractQuestionsInputSchema>;

const ALLOWED_ANCHOR_TYPES = ['usecase', 'requirement', 'userstory'] as const;

export const extractQuestionsAgent: AgentDefinition<ExtractQuestionsInput> = {
  name: 'extract-questions',
  inputSchema: ExtractQuestionsInputSchema,
  async validateInput({ store, workspaceRoot }, input) {
    return validateCodebaseAnchor(
      { store, workspaceRoot },
      input.nodeId,
      ALLOWED_ANCHOR_TYPES,
      'extract-questions',
      { requireCodebasePath: false },
    );
  },
  buildPrompt: ({ anchor }) => buildExtractQuestionsPrompt({ anchor }),
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
  ],
};
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- extract-questions
```

Expected: PASS (追加 5 本)。

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/agents/extract-questions.ts packages/ai-engine/src/agents/extract-questions.test.ts
git commit -m "feat(ai-engine): extract-questions エージェント (プロンプト + 定義)"
```

---

## Task 4: registry に extract-questions 登録 + agent-runner happy-path テスト

**Files:**
- Modify: `packages/ai-engine/src/agents/registry.ts`
- Modify: `packages/ai-engine/src/agents/registry.test.ts`
- Modify: `packages/ai-engine/src/agent-runner.test.ts`

- [ ] **Step 1: registry.test.ts に extract-questions 登録確認を追加 (failing)**

`packages/ai-engine/src/agents/registry.test.ts` の既存 describe 内に追加 (既存テストが一覧全部を assert しているなら配列に追記する。なければ個別に):

```typescript
  it('extract-questions が登録されている', () => {
    expect(AGENT_REGISTRY['extract-questions'].name).toBe('extract-questions');
    expect(AGENT_REGISTRY['extract-questions'].allowedTools).toContain(
      'mcp__tally__create_node',
    );
  });
```

既存テストが `['decompose-to-stories', 'find-related-code', 'analyze-impact']` の keys 一致を要求している場合は、同じ配列に `'extract-questions'` を追加する。

- [ ] **Step 2: registry.ts に extract-questions を登録**

`packages/ai-engine/src/agents/registry.ts`:

```typescript
import { analyzeImpactAgent } from './analyze-impact';
import { decomposeToStoriesAgent } from './decompose-to-stories';
import { extractQuestionsAgent } from './extract-questions';
import { findRelatedCodeAgent } from './find-related-code';

// ...既存の型定義はそのまま...

export const AGENT_REGISTRY = {
  'decompose-to-stories': decomposeToStoriesAgent,
  'find-related-code': findRelatedCodeAgent,
  'analyze-impact': analyzeImpactAgent,
  'extract-questions': extractQuestionsAgent,
} satisfies Record<AgentName, AgentDefinition>;
```

- [ ] **Step 3: ai-engine の build と test 両方で緑確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine build
NODE_ENV=development pnpm --filter @tally/ai-engine test -- registry
```

Expected: 両方 PASS (Task 1 以降断線していた build が復活)。

- [ ] **Step 4: agent-runner.test.ts に extract-questions happy-path テストを追加 (failing)**

`packages/ai-engine/src/agent-runner.test.ts` の末尾 describe 内に以下を追加 (既存 analyze-impact の happy-path の直後):

```typescript
  it('extract-questions: codebasePath 無しで起動し、MCP 経由で question proposal を生成する', async () => {
    const workspaceRoot = '/ws';
    const anchor = {
      id: 'uc-1',
      type: 'usecase' as const,
      x: 0,
      y: 0,
      title: '招待',
      body: '',
    };
    const created: Node[] = [];
    const store = {
      getNode: vi.fn().mockResolvedValue(anchor),
      getProjectMeta: vi
        .fn()
        .mockResolvedValue({ id: 'p', name: 'x', createdAt: '', updatedAt: '' }),
      addNode: vi.fn().mockImplementation(async (n: Node) => {
        const withId = { ...n, id: `q-${created.length + 1}` } as Node;
        created.push(withId);
        return withId;
      }),
      listNodes: vi.fn().mockResolvedValue([anchor]),
      findRelatedNodes: vi.fn().mockResolvedValue([]),
      addEdge: vi.fn().mockImplementation(async (e) => ({ id: 'e-1', ...e })),
    } as unknown as ProjectStore;

    // Mock SDK が create_node / create_edge を実際に 1 回ずつ呼ぶように振る舞う
    const sdk: SdkLike = {
      query: () =>
        (async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [
                {
                  type: 'tool_use',
                  name: 'mcp__tally__create_node',
                  input: {
                    adoptAs: 'question',
                    title: '認証方式を何にするか',
                    body: '...',
                    additional: {
                      options: [{ text: 'OAuth' }, { text: 'Email+Pass' }],
                      decision: null,
                    },
                  },
                },
              ],
            },
          } as unknown as SdkMessageLike;
        })(),
    };

    const events: AgentEvent[] = [];
    for await (const e of runAgent({
      sdk,
      store,
      workspaceRoot,
      req: { type: 'start', agent: 'extract-questions', projectId: 'p', input: { nodeId: 'uc-1' } },
    })) {
      events.push(e);
    }

    const nodeCreated = events.find((e) => e.type === 'node_created');
    expect(nodeCreated).toBeDefined();
    expect(created.length).toBe(1);
    expect(created[0].type).toBe('proposal');
    // options は create_node 内で id / selected が補完され、decision=null が入る (Task 5 で実装、
    // ここでは store.addNode に渡った内容を検証)
    const storedOptions = (created[0] as unknown as { options: { id: string; text: string; selected: boolean }[] }).options;
    expect(Array.isArray(storedOptions)).toBe(true);
    expect(storedOptions).toHaveLength(2);
    for (const opt of storedOptions) {
      expect(opt.id.startsWith('opt-')).toBe(true);
      expect(opt.selected).toBe(false);
    }
  });
```

必要な import を test ファイル冒頭に追加 (既存 analyze-impact テストに合わせて調整)。

- [ ] **Step 5: テスト実行 — Task 5 未実装なら options ID 補完の assert で FAIL する**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- agent-runner
```

Expected: `storedOptions[0].id.startsWith('opt-')` で FAIL (現状 create_node は additional.options をそのまま通すため id が undefined)。`nodeCreated` の発火 / `created.length === 1` までは通る想定。

> **意図**: この RED を Task 5 で GREEN にする。Task 4 の commit 時点ではこの test を skip (`it.skip`) にしておき、Task 5 で `.skip` を外すか、またはこの test を丸ごと Task 5 に移す。どちらでも良いが、**本 plan では `.skip` にしてここでコミットし、Task 5 で skip を外す**運用を採る。

- [ ] **Step 6: 該当 test を it.skip に変更**

`it('extract-questions: codebasePath 無しで起動し...' → `it.skip('extract-questions: codebasePath 無しで起動し...`

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test
```

Expected: 全緑 (新規テストが skip されているため)。

- [ ] **Step 7: コミット**

```bash
git add packages/ai-engine/src/agents/registry.ts packages/ai-engine/src/agents/registry.test.ts packages/ai-engine/src/agent-runner.test.ts
git commit -m "feat(ai-engine): extract-questions を registry に登録"
```

---

## Task 5: create_node ツール — adoptAs='question' の options ID 補完 + decision=null 固定

**Files:**
- Modify: `packages/ai-engine/src/tools/create-node.ts`
- Modify: `packages/ai-engine/src/tools/create-node.test.ts`

- [ ] **Step 1: create-node.test.ts に options 補完テストを追加 (failing)**

`packages/ai-engine/src/tools/create-node.test.ts` の末尾 describe 内 (または新規 describe ブロック) に追加:

```typescript
  describe('adoptAs=question の options 補完', () => {
    it('options 配列の各要素に opt- 接頭辞 ID + selected:false を付ける', async () => {
      const stored: Record<string, unknown>[] = [];
      const store = {
        listNodes: vi.fn().mockResolvedValue([]),
        findRelatedNodes: vi.fn().mockResolvedValue([]),
        addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
          stored.push(n);
          return { ...n, id: 'q-1' };
        }),
      } as unknown as ProjectStore;
      const handler = createNodeHandler({
        store,
        emit: () => {},
        anchor: { x: 0, y: 0 },
        anchorId: 'uc-1',
        agentName: 'extract-questions',
      });
      const res = await handler({
        adoptAs: 'question',
        title: 'X を Y にするか',
        body: '',
        additional: { options: [{ text: 'A' }, { text: 'B' }] },
      });
      expect(res.ok).toBe(true);
      expect(stored.length).toBe(1);
      const opts = stored[0].options as { id: string; text: string; selected: boolean }[];
      expect(opts).toHaveLength(2);
      expect(opts[0].id.startsWith('opt-')).toBe(true);
      expect(opts[0].text).toBe('A');
      expect(opts[0].selected).toBe(false);
      expect(opts[1].id.startsWith('opt-')).toBe(true);
      expect(opts[1].text).toBe('B');
      expect(stored[0].decision).toBeNull();
    });

    it('options 未指定でも decision:null + options:[] を補完する', async () => {
      const stored: Record<string, unknown>[] = [];
      const store = {
        listNodes: vi.fn().mockResolvedValue([]),
        findRelatedNodes: vi.fn().mockResolvedValue([]),
        addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
          stored.push(n);
          return { ...n, id: 'q-2' };
        }),
      } as unknown as ProjectStore;
      const handler = createNodeHandler({
        store,
        emit: () => {},
        anchor: { x: 0, y: 0 },
        anchorId: 'uc-1',
        agentName: 'extract-questions',
      });
      const res = await handler({
        adoptAs: 'question',
        title: '問い',
        body: '',
      });
      expect(res.ok).toBe(true);
      expect(stored[0].options).toEqual([]);
      expect(stored[0].decision).toBeNull();
    });
  });
```

> **注**: このテストは `deps` に `anchorId: 'uc-1'` を渡している。現状の `CreateNodeDeps` には `anchorId` がないので Step 3 で追加する。型エラーは Step 2 の RED で拾う。

- [ ] **Step 2: テスト実行で失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- create-node
```

Expected: FAIL (options に id が付かず、また `anchorId` が型エラー)。

- [ ] **Step 3: create-node.ts を更新**

`packages/ai-engine/src/tools/create-node.ts` の `CreateNodeDeps` と handler に以下を追加:

1. 先頭の import に `newQuestionOptionId` を追加:

```typescript
import { newQuestionOptionId } from '@tally/core';
```

2. `CreateNodeDeps` に `anchorId` を追加:

```typescript
export interface CreateNodeDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  // anchor ノードの id。question 重複ガードで近傍を引くために使う。
  anchorId: string;
  agentName: AgentName;
}
```

3. ハンドラ内、`ensuredTitle` 算出の直前 (coderef 正規化ブロックの直後) に以下を挿入:

```typescript
    // adoptAs=question: options に id / selected を補完し、decision を null で固定する。
    // AI は { text } だけ渡す (仕様)。id / selected 指定があっても上書きする (信頼境界)。
    if (adoptAs === 'question') {
      const rawOptions = additional?.options;
      const normalizedOptions = Array.isArray(rawOptions)
        ? rawOptions.map((opt) => {
            const text =
              typeof opt === 'object' && opt !== null && 'text' in opt
                ? String((opt as { text: unknown }).text ?? '')
                : String(opt ?? '');
            return { id: newQuestionOptionId(), text, selected: false };
          })
        : [];
      normalizedAdditional = {
        ...(additional ?? {}),
        options: normalizedOptions,
        decision: null,
      };
    }
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- create-node
```

Expected: PASS (追加 2 本)。

- [ ] **Step 5: 既存 coderef テストが退行していないことを確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test
```

Expected: 全緑 (`anchorId` 追加で既存テストが壊れたら、それらの `createNodeHandler({...})` 呼び出しに `anchorId: 'uc-1'` (anchor 側と揃える) を付ける。既存 coderef テストは `find-related-code` 等の context を模した store なので、任意の anchorId を渡せば通る)。

修正対象の既存テストは `packages/ai-engine/src/tools/create-node.test.ts` / `packages/ai-engine/src/agents/find-related-code.test.ts` / `packages/ai-engine/src/agents/analyze-impact.test.ts` 内の `createNodeHandler({...})` や `buildTallyMcpServer({...})` 呼び出し。anchor の id を採用する (例: `anchorId: anchor.id ?? 'uc-1'`)。

- [ ] **Step 6: Task 4 で skip した agent-runner テストの skip を外す**

`packages/ai-engine/src/agent-runner.test.ts` の `it.skip('extract-questions: ...'` → `it('extract-questions: ...'`。

このテストは `storedOptions[0].id.startsWith('opt-')` を assert するため、Task 5 の補完ロジック完了で通る。

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test
```

Expected: 全緑 (Task 4 で仕込んだ happy-path が今回 GREEN)。

- [ ] **Step 7: コミット**

```bash
git add packages/ai-engine/src/tools/create-node.ts packages/ai-engine/src/tools/create-node.test.ts packages/ai-engine/src/agent-runner.test.ts
git commit -m "feat(ai-engine): create_node で adoptAs=question の options を id/selected/decision=null に正規化"
```

---

## Task 6: create_node ツール — anchorId 配線 + question の anchor+同タイトル重複ガード

**Files:**
- Modify: `packages/ai-engine/src/tools/index.ts`
- Modify: `packages/ai-engine/src/tools/tools-index.test.ts`
- Modify: `packages/ai-engine/src/tools/create-node.ts`
- Modify: `packages/ai-engine/src/tools/create-node.test.ts`
- Modify: `packages/ai-engine/src/agent-runner.ts`

- [ ] **Step 1: create-node.test.ts に重複ガードテストを追加 (failing)**

`describe('adoptAs=question の options 補完', ...)` の近くに新規 describe を追加:

```typescript
  describe('adoptAs=question の anchor+同タイトル重複ガード', () => {
    it('anchor に繋がる正規 question に同タイトルがあれば reject', async () => {
      const anchorId = 'uc-1';
      const existing = {
        id: 'q-0',
        type: 'question',
        x: 0,
        y: 0,
        title: 'X を Y にするか',
        body: '',
      };
      const store = {
        listNodes: vi.fn().mockResolvedValue([]),
        findRelatedNodes: vi.fn().mockResolvedValue([existing]),
        addNode: vi.fn(),
      } as unknown as ProjectStore;
      const handler = createNodeHandler({
        store,
        emit: () => {},
        anchor: { x: 0, y: 0 },
        anchorId,
        agentName: 'extract-questions',
      });
      const res = await handler({
        adoptAs: 'question',
        title: '[AI] X を Y にするか',
        body: '',
        additional: { options: [{ text: 'A' }, { text: 'B' }] },
      });
      expect(res.ok).toBe(false);
      expect(res.output).toContain('重複');
      expect(store.addNode).not.toHaveBeenCalled();
    });

    it('anchor に繋がる proposal (adoptAs=question) に同タイトルがあっても reject', async () => {
      const anchorId = 'uc-1';
      const existingProposal = {
        id: 'q-prop-0',
        type: 'proposal',
        adoptAs: 'question',
        x: 0,
        y: 0,
        title: '[AI] X を Y にするか',
        body: '',
      };
      const store = {
        listNodes: vi.fn().mockResolvedValue([]),
        findRelatedNodes: vi.fn().mockResolvedValue([existingProposal]),
        addNode: vi.fn(),
      } as unknown as ProjectStore;
      const handler = createNodeHandler({
        store,
        emit: () => {},
        anchor: { x: 0, y: 0 },
        anchorId,
        agentName: 'extract-questions',
      });
      const res = await handler({
        adoptAs: 'question',
        title: 'X を Y にするか',
        body: '',
      });
      expect(res.ok).toBe(false);
      expect(res.output).toContain('重複');
    });

    it('異なる anchor の同タイトル question は通す', async () => {
      const store = {
        listNodes: vi.fn().mockResolvedValue([]),
        findRelatedNodes: vi.fn().mockResolvedValue([]),
        addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => ({
          ...n,
          id: 'q-x',
        })),
      } as unknown as ProjectStore;
      const handler = createNodeHandler({
        store,
        emit: () => {},
        anchor: { x: 0, y: 0 },
        anchorId: 'uc-2',
        agentName: 'extract-questions',
      });
      const res = await handler({
        adoptAs: 'question',
        title: 'X を Y にするか',
        body: '',
      });
      expect(res.ok).toBe(true);
      expect(store.findRelatedNodes).toHaveBeenCalledWith('uc-2');
    });
  });
```

- [ ] **Step 2: テスト実行で失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- create-node
```

Expected: FAIL (重複ガード未実装、`ok: true` になる)。

- [ ] **Step 3: create-node.ts に重複ガードを追加**

1. 先頭 import に `stripAiPrefix` を追加:

```typescript
import { newQuestionOptionId, stripAiPrefix } from '@tally/core';
```

2. ハンドラ内、question の options 正規化ブロックの**後** (= `ensuredTitle` 算出前) に以下を挿入:

```typescript
    // adoptAs=question: anchor の近傍に同タイトル question (正規 or proposal) があれば重複として弾く。
    // タイトル比較は stripAiPrefix 済みで揃える ("[AI] X" と "X" を同一視)。
    if (adoptAs === 'question') {
      const neighbors = await deps.store.findRelatedNodes(deps.anchorId);
      const normalizedTitle = stripAiPrefix(title);
      const dup = neighbors.find((n) => {
        const rec = n as unknown as { type: string; adoptAs?: string; title: string };
        const isQuestion =
          rec.type === 'question' || (rec.type === 'proposal' && rec.adoptAs === 'question');
        return isQuestion && stripAiPrefix(rec.title) === normalizedTitle;
      });
      if (dup) {
        return {
          ok: false,
          output: `重複: anchor ${deps.anchorId} に既に同タイトル question 候補 ${(dup as { id: string }).id} が存在`,
        };
      }
    }
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test -- create-node
```

Expected: PASS (追加 3 本)。

- [ ] **Step 5: tools/index.ts の TallyToolDeps に anchorId を追加**

`packages/ai-engine/src/tools/index.ts`:

```typescript
export interface TallyToolDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  // anchor ノードの id。create_node の question 重複ガードで必要。
  anchorId: string;
  agentName: AgentName;
}
```

- [ ] **Step 6: agent-runner.ts で anchorId を渡す**

`packages/ai-engine/src/agent-runner.ts` の `buildTallyMcpServer` 呼び出し箇所を修正:

```typescript
  const mcp = buildTallyMcpServer({
    store,
    emit: (e) => sideEvents.push(e),
    anchor: { x: anchor.x, y: anchor.y },
    anchorId: anchor.id,
    agentName: req.agent,
  });
```

- [ ] **Step 7: tools-index.test.ts の既存テストを更新**

`packages/ai-engine/src/tools/tools-index.test.ts` 内の `buildTallyMcpServer({...})` 呼び出しに `anchorId: 'uc-test'` (既存 anchor に揃える) を追加。読み取り専用ツールのテストなので anchor に紐づく質問重複ガードは発火しない。

- [ ] **Step 8: ai-engine 全緑確認**

```bash
NODE_ENV=development pnpm --filter @tally/ai-engine test
NODE_ENV=development pnpm --filter @tally/ai-engine build
```

Expected: 全緑 + build 通る。

- [ ] **Step 9: コミット**

```bash
git add packages/ai-engine/src/tools/create-node.ts packages/ai-engine/src/tools/create-node.test.ts packages/ai-engine/src/tools/index.ts packages/ai-engine/src/tools/tools-index.test.ts packages/ai-engine/src/agent-runner.ts
git commit -m "feat(ai-engine): create_node で anchor+同タイトル question 重複をサーバ側ガード"
```

---

## Task 7: frontend の GraphAgentButton 共通抽出

**Files:**
- Create: `packages/frontend/src/components/ai-actions/graph-agent-button.tsx`
- Create: `packages/frontend/src/components/ai-actions/graph-agent-button.test.tsx`

- [ ] **Step 1: graph-agent-button.test.tsx を新規作成 (failing)**

`packages/frontend/src/components/ai-actions/graph-agent-button.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { GraphAgentButton, type AnchorNode } from './graph-agent-button';

const anchor: AnchorNode = {
  id: 'uc-1',
  type: 'usecase',
  x: 0,
  y: 0,
  title: '',
  body: '',
};

describe('GraphAgentButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('何も実行中でなければラベルを出し、クリックで onRun が呼ばれる', () => {
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(
      <GraphAgentButton
        node={anchor}
        agentName="extract-questions"
        label="論点を抽出"
        busyLabel="抽出中…"
        tooltip="hint"
        onRun={onRun}
      />,
    );
    const btn = screen.getByRole('button', { name: /論点を抽出/ });
    expect(btn).not.toBeDisabled();
    fireEvent.click(btn);
    expect(onRun).toHaveBeenCalledWith('uc-1');
  });

  it('同じ agent が実行中なら busyLabel + disabled', () => {
    useCanvasStore.setState({
      runningAgent: { agent: 'extract-questions', inputNodeId: 'uc-1', events: [] },
    } as never);
    const onRun = vi.fn();
    render(
      <GraphAgentButton
        node={anchor}
        agentName="extract-questions"
        label="論点を抽出"
        busyLabel="抽出中…"
        tooltip="hint"
        onRun={onRun}
      />,
    );
    const btn = screen.getByRole('button', { name: /抽出中…/ });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onRun).not.toHaveBeenCalled();
  });

  it('別 agent が実行中ならラベル表示のまま disabled + 別エージェント tooltip', () => {
    useCanvasStore.setState({
      runningAgent: { agent: 'analyze-impact', inputNodeId: 'uc-1', events: [] },
    } as never);
    const onRun = vi.fn();
    render(
      <GraphAgentButton
        node={anchor}
        agentName="extract-questions"
        label="論点を抽出"
        busyLabel="抽出中…"
        tooltip="hint"
        onRun={onRun}
      />,
    );
    const btn = screen.getByRole('button', { name: /論点を抽出/ });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toContain('別のエージェント');
  });
});
```

- [ ] **Step 2: テスト実行で失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- graph-agent-button
```

Expected: FAIL (`graph-agent-button` モジュール未存在)。

- [ ] **Step 3: graph-agent-button.tsx を新規作成**

`packages/frontend/src/components/ai-actions/graph-agent-button.tsx`:

```typescript
'use client';

import type { AgentName, RequirementNode, UseCaseNode, UserStoryNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export type AnchorNode = UseCaseNode | RequirementNode | UserStoryNode;

interface GraphAgentButtonProps {
  node: AnchorNode;
  agentName: AgentName;
  label: string;
  busyLabel: string;
  tooltip: string;
  onRun: (nodeId: string) => Promise<void>;
}

// codebase を読まず、グラフ文脈 (node + neighbors) だけで動くエージェント用の共通ボタン。
// codebasePath 要件は持たないので disabled は他エージェント実行中 (busy) のみで判定する。
export function GraphAgentButton({
  node,
  agentName,
  label,
  busyLabel,
  tooltip,
  onRun,
}: GraphAgentButtonProps) {
  const running = useCanvasStore((s) => s.runningAgent);
  const busy = running !== null;
  const mine = running?.agent === agentName;
  const disabled = busy;

  const resolvedTooltip = busy ? (mine ? tooltip : '別のエージェントが実行中です') : tooltip;

  const onClick = () => {
    if (disabled) return;
    onRun(node.id).catch(console.error);
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={resolvedTooltip}
      style={{
        ...BUTTON_STYLE,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {mine ? busyLabel : label}
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

- [ ] **Step 4: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- graph-agent-button
```

Expected: PASS (追加 3 本)。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/ai-actions/graph-agent-button.tsx packages/frontend/src/components/ai-actions/graph-agent-button.test.tsx
git commit -m "feat(frontend): GraphAgentButton を追加 (codebasePath 不要エージェント用共通)"
```

---

## Task 8: store に startExtractQuestions を追加

**Files:**
- Modify: `packages/frontend/src/lib/store.ts`
- Modify: `packages/frontend/src/lib/store.test.ts`

- [ ] **Step 1: store.test.ts に startExtractQuestions のテストを追加 (failing)**

`packages/frontend/src/lib/store.test.ts` の末尾 (既存の startAnalyzeImpact テストの近く) に追加:

```typescript
  it('startExtractQuestions は runAgentWS に agent=extract-questions を渡す', async () => {
    const store = useCanvasStore.getState();
    store.hydrate({
      id: 'p1',
      name: 'x',
      nodes: [],
      edges: [],
      createdAt: '',
      updatedAt: '',
    });
    // startAgent (WS) をスタブ化
    const mockStartAgent = vi.mocked(startAgent);
    mockStartAgent.mockReturnValue({
      messages: (async function* () {
        // 何も yield せず即終了
      })(),
      close: vi.fn(),
    });

    await useCanvasStore.getState().startExtractQuestions('uc-1');
    expect(mockStartAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start',
        agent: 'extract-questions',
        projectId: 'p1',
        input: { nodeId: 'uc-1' },
      }),
    );
  });
```

> **注**: 既存 startAnalyzeImpact のテストパターンをコピー可能。`vi.mock('./ws')` が先頭でされている前提。

- [ ] **Step 2: テスト実行で失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- store
```

Expected: FAIL (`startExtractQuestions` 未定義)。

- [ ] **Step 3: store.ts に startExtractQuestions を追加**

`packages/frontend/src/lib/store.ts`:

1. `CanvasState` interface に追加:

```typescript
  startExtractQuestions: (nodeId: string) => Promise<void>;
```

2. store 実装の `startAnalyzeImpact` の直下に追加:

```typescript
    // extract-questions エージェントを起動する。codebasePath 不要。
    startExtractQuestions: (nodeId) => runAgentWS('extract-questions', nodeId),
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- store
```

Expected: PASS (追加 1 本)。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/store.ts packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): store に startExtractQuestions を追加"
```

---

## Task 9: ExtractQuestionsButton 新規

**Files:**
- Create: `packages/frontend/src/components/ai-actions/extract-questions-button.tsx`
- Create: `packages/frontend/src/components/ai-actions/extract-questions-button.test.tsx`

- [ ] **Step 1: extract-questions-button.test.tsx を新規作成 (failing)**

`packages/frontend/src/components/ai-actions/extract-questions-button.test.tsx`:

```typescript
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ExtractQuestionsButton } from './extract-questions-button';

const anchor = {
  id: 'uc-1',
  type: 'usecase' as const,
  x: 0,
  y: 0,
  title: '',
  body: '',
};

describe('ExtractQuestionsButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('「論点を抽出」ラベルを表示する', () => {
    render(<ExtractQuestionsButton node={anchor} />);
    expect(screen.getByRole('button', { name: /論点を抽出/ })).toBeDefined();
  });

  it('クリックで store.startExtractQuestions を呼ぶ', () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ startExtractQuestions: spy } as never);
    render(<ExtractQuestionsButton node={anchor} />);
    fireEvent.click(screen.getByRole('button', { name: /論点を抽出/ }));
    expect(spy).toHaveBeenCalledWith('uc-1');
  });
});
```

- [ ] **Step 2: テスト実行で失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- extract-questions-button
```

Expected: FAIL (`extract-questions-button` モジュール未存在)。

- [ ] **Step 3: extract-questions-button.tsx を新規作成**

`packages/frontend/src/components/ai-actions/extract-questions-button.tsx`:

```typescript
'use client';

import { useCanvasStore } from '@/lib/store';

import { type AnchorNode, GraphAgentButton } from './graph-agent-button';

// 「論点を抽出」AI アクションボタン。UC / requirement / userstory の 3 detail から共通利用する。
// codebasePath を要求しないエージェント (extract-questions) 用の thin wrapper。
export function ExtractQuestionsButton({ node }: { node: AnchorNode }) {
  const start = useCanvasStore((s) => s.startExtractQuestions);
  return (
    <GraphAgentButton
      node={node}
      agentName="extract-questions"
      label="論点を抽出"
      busyLabel="論点抽出: 実行中…"
      tooltip="未決定の設計判断を質問として洗い出す"
      onRun={start}
    />
  );
}
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- extract-questions-button
```

Expected: PASS (追加 2 本)。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/ai-actions/extract-questions-button.tsx packages/frontend/src/components/ai-actions/extract-questions-button.test.tsx
git commit -m "feat(frontend): ExtractQuestionsButton を追加 (GraphAgentButton の thin wrapper)"
```

---

## Task 10: 3 detail に ExtractQuestionsButton を配置

**Files:**
- Modify: `packages/frontend/src/components/details/usecase-detail.tsx`
- Modify: `packages/frontend/src/components/details/usecase-detail.test.tsx`
- Modify: `packages/frontend/src/components/details/requirement-detail.tsx`
- Modify: `packages/frontend/src/components/details/userstory-detail.tsx`

- [ ] **Step 1: usecase-detail.test.tsx に配置テストを追加 (failing)**

`packages/frontend/src/components/details/usecase-detail.test.tsx` の末尾 describe に追加:

```typescript
  it('ExtractQuestionsButton を表示する (3 つ目の AI アクション)', () => {
    useCanvasStore.getState().reset();
    render(<UseCaseDetail node={uc} />);
    expect(screen.getByRole('button', { name: /論点を抽出/ })).toBeDefined();
  });
```

> **注**: 既存 AnalyzeImpactButton 配置テストのパターンを踏襲。`uc` は既存のテスト fixture を流用。

- [ ] **Step 2: テスト実行で失敗確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- usecase-detail
```

Expected: FAIL (`/論点を抽出/` ボタンが無い)。

- [ ] **Step 3: usecase-detail.tsx に ExtractQuestionsButton を追加**

`packages/frontend/src/components/details/usecase-detail.tsx`:

1. import に追加:

```typescript
import { ExtractQuestionsButton } from '@/components/ai-actions/extract-questions-button';
```

2. JSX の AI アクション領域、`<AnalyzeImpactButton node={node} />` の直後に追加:

```tsx
      <FindRelatedCodeButton node={node} />
      <AnalyzeImpactButton node={node} />
      <ExtractQuestionsButton node={node} />
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test -- usecase-detail
```

Expected: PASS。

- [ ] **Step 5: requirement-detail.tsx にも同じ配置を追加**

`packages/frontend/src/components/details/requirement-detail.tsx`:

1. import 追加:

```typescript
import { ExtractQuestionsButton } from '@/components/ai-actions/extract-questions-button';
```

2. AI アクション領域の AnalyzeImpactButton の直後に `<ExtractQuestionsButton node={node} />` を追加。

- [ ] **Step 6: userstory-detail.tsx にも同じ配置を追加**

`packages/frontend/src/components/details/userstory-detail.tsx`:

1. import 追加:

```typescript
import { ExtractQuestionsButton } from '@/components/ai-actions/extract-questions-button';
```

2. AI アクション領域の AnalyzeImpactButton の直後に `<ExtractQuestionsButton node={node} />` を追加。

- [ ] **Step 7: frontend 全緑確認**

```bash
NODE_ENV=development pnpm --filter @tally/frontend test
```

Expected: 全緑。

- [ ] **Step 8: 全 package 全緑確認**

```bash
NODE_ENV=development pnpm -r test
```

Expected: 全緑、合計 **約 257 テスト** (232 + 追加分)。

- [ ] **Step 9: typecheck**

```bash
NODE_ENV=development pnpm -r typecheck 2>&1 | tail -20
```

Expected: エラーなし。

- [ ] **Step 10: コミット**

```bash
git add packages/frontend/src/components/details/usecase-detail.tsx packages/frontend/src/components/details/usecase-detail.test.tsx packages/frontend/src/components/details/requirement-detail.tsx packages/frontend/src/components/details/userstory-detail.tsx
git commit -m "feat(frontend): 3 detail に ExtractQuestionsButton を配置"
```

---

## Task 11: docs 更新 + Phase 5c 進捗ドキュメント + 手動 E2E 手順

**Files:**
- Modify: `docs/02-domain-model.md`
- Modify: `docs/04-roadmap.md`
- Create: `docs/phase-5c-manual-e2e.md`
- Create: `docs/phase-5c-progress.md`

- [ ] **Step 1: 02-domain-model.md の question 節に 1 行追記**

`docs/02-domain-model.md` の `#### question（論点）` セクション、`decision === null なら未決定〜` の段落の直後に追加:

```markdown
`extract-questions` エージェント (Phase 5c) が proposal として生成する。proposal 時点で `options` 候補 (2〜4 個) を含み、`decision` は null。人間が採用後に決定する。
```

- [ ] **Step 2: 04-roadmap.md Phase 5 節の Phase 5c を更新**

`docs/04-roadmap.md` の `### Phase 5c-d (未実装)` セクションを以下に置き換え:

```markdown
### Phase 5c (完了)

- [x] `extract-questions.ts`：論点抽出 (anchor グラフ文脈のみ、codebasePath 不要)
- [x] `create_node` で adoptAs='question' の options ID 補完 + anchor+同タイトル重複ガード
- [x] `GraphAgentButton` 共通抽出 + `ExtractQuestionsButton` thin wrapper
- [x] 3 detail (UC / requirement / userstory) に配置

手動 E2E 手順は `docs/phase-5c-manual-e2e.md` 参照。

### Phase 5d (未実装)

- [ ] `ingest-document.ts`：要求書取り込み
```

`### 完了条件` セクションの `論点ノードが選択肢候補付きで正しく生成される（Phase 5c）` は既にチェックされていなければ残す (✓ マーク追加が spec で必須視されるわけではないが、Phase 5 全体のマーカーとして残しておく)。

- [ ] **Step 3: docs/phase-5c-manual-e2e.md を新規作成**

`docs/phase-5c-manual-e2e.md`:

````markdown
# Phase 5c 手動 E2E 手順: extract-questions

Phase 5c で追加した `extract-questions` エージェントを実通信で確認する手順。Phase 5b (`docs/phase-5b-manual-e2e.md`) と同形式。

## 前提

- `claude login` 済み (ADR-0006 の Claude Code OAuth) もしくは `ANTHROPIC_API_KEY` を `.env` に設定
- `pnpm install && pnpm -r test` が緑 (Phase 5c 完了時点 ≈ 257 テスト)
- サンプルプロジェクト: `examples/taskflow-backend` を一旦使わず、**codebasePath 未設定**でも動くことを示すためプロジェクト設定をクリアした状態から開始する

## シナリオ 1: codebasePath 未設定でも動く

1. `pnpm --filter frontend dev` で開発サーバ起動
2. サンプルプロジェクト (例: `examples/sample-project` にある既存の UC) を開く。必要ならヘッダの歯車設定で codebasePath を **空にクリア** する (未設定状態を作る)
3. 任意の UC ノードをクリック → 詳細ペインに 3 つの AI アクションボタンが並ぶこと
   - 「関連コードを探す」= **disabled**、tooltip に「codebasePath 未設定」
   - 「影響を分析する」= **disabled**、tooltip に「codebasePath 未設定」
   - 「論点を抽出」= **有効** (押せる)
4. 「論点を抽出」をクリック → 進捗パネルに thinking / tool_use (create_node / create_edge) が流れる
5. 完了後、対象 UC の近くに紫色の破線 proposal ノードが 0〜5 個生える (生えない場合もあり得るが、0 件でも正常)

## シナリオ 2: 生成された question proposal の構造

1. 生えた proposal ノードを選択 → ProposalDetail が開く
2. タイトルは `[AI] <問い>` 形式
3. body に問いの背景 / 検討観点が書かれている
4. 採用 select が `question` (adoptAs) になっている
5. 「採用する」ボタンを押す → proposal が正規 question ノード (オレンジ色の破線) に昇格
6. 昇格後の詳細で `options` が 2〜4 個、それぞれ `id` (opt-xxxxxxxxxx 形式) + text + selected:false
7. `decision` は null (未決定表示)

## シナリオ 3: option を選択して決定、取り消し

1. 昇格後の question ノードで option を 1 つ選択 → 実線 + 「決定」バッジに切り替わる
2. 別の option を選び直す / 決定を取り消す → 破線に戻る (既存動作の回帰がないこと)

## シナリオ 4: 重複ガード

1. 同じ UC でもう一度「論点を抽出」をクリック
2. 1 回目で生成された質問と **同タイトル** の proposal が出来ない (サーバ側で reject、ストリームログに "重複" と出る)
3. **異なる UC** で実行した場合は同タイトルでも通ること

## シナリオ 5: 他エージェントとの排他

1. `extract-questions` 実行中に他の AI アクションボタン (「関連コードを探す」等) が disabled になる
2. 完了後にボタン disabled が解除される

## 失敗時のトラブルシュート

- `not_authenticated`: `claude login` を再実行
- `未知の agent: extract-questions`: registry 登録が抜けている、Task 4 確認
- `codebasePath を指定してください`: ADR-0007 の `requireCodebasePath` が `false` で呼ばれていない、Task 3 確認
- proposal が生えない: Anthropic 側のレート制限 or プロンプト指示で 0 件返されただけの可能性 (生成サマリ行で「論点が見えない」と書かれていれば後者)
````

- [ ] **Step 4: docs/phase-5c-progress.md を新規作成**

`docs/phase-5c-progress.md`:

```markdown
# Phase 5c 実装進捗

**本ドキュメントは Claude Code のメモリ代替。別 PC へ引き継いでも最新状態を復元できるよう、タスク完了の都度ここを更新する。**

関連ドキュメント:
- 設計書 (spec): [`docs/superpowers/specs/2026-04-20-phase5c-extract-questions-design.md`](superpowers/specs/2026-04-20-phase5c-extract-questions-design.md)
- 実装計画 (plan): [`docs/superpowers/plans/2026-04-20-phase5c-extract-questions.md`](superpowers/plans/2026-04-20-phase5c-extract-questions.md)
- 前 Phase 進捗: [`docs/phase-5b-progress.md`](phase-5b-progress.md) (Phase 5b 完了)
- ADR-0007 (エージェントツール制約): [`docs/adr/0007-agent-tool-restriction.md`](adr/0007-agent-tool-restriction.md) **実装前に必読**

## 全体状況 (2026-04-20 時点)

| Phase | 状態 |
|---|---|
| 0-4 | 完了 |
| 5a | 完了 (find-related-code) |
| 5b | 完了 (analyze-impact) |
| **5c** | **着手中 (extract-questions)** |
| 5d | 未着手 (`ingest-document`) |
| 6+ | 未着手 |

## Phase 5c タスク進捗

| # | タスク | 状態 | 担当 commit |
|---|---|---|---|
| 1 | core: AGENT_NAMES 拡張 + newQuestionOptionId 追加 | ⏳ 未着手 | — |
| 2 | ai-engine: validateCodebaseAnchor に requireCodebasePath オプション追加 | ⏳ 未着手 | — |
| 3 | ai-engine: extract-questions エージェント (プロンプト + 定義) | ⏳ 未着手 | — |
| 4 | ai-engine: registry 登録 + agent-runner happy-path 追加 | ⏳ 未着手 | — |
| 5 | ai-engine: create_node で adoptAs=question の options 正規化 | ⏳ 未着手 | — |
| 6 | ai-engine: create_node で anchor+同タイトル重複ガード + anchorId 配線 | ⏳ 未着手 | — |
| 7 | frontend: GraphAgentButton 共通抽出 | ⏳ 未着手 | — |
| 8 | frontend: store に startExtractQuestions 追加 | ⏳ 未着手 | — |
| 9 | frontend: ExtractQuestionsButton 追加 | ⏳ 未着手 | — |
| 10 | frontend: 3 detail に ExtractQuestionsButton 配置 | ⏳ 未着手 | — |
| 11 | docs: phase-5c-manual-e2e.md + 04-roadmap.md + 02-domain-model.md 更新 + 全緑確認 | ⏳ 未着手 | — |

**次のタスク**: Task 1 (core)

## HEAD 情報 (引き継ぎ時に git log で確認すべき)

- ブランチ: `main` (worktree なし、ユーザー明示同意のもと直接 main に commit する運用)
- Phase 5c 開始直前の最新 commit: `e8e6047 docs: Phase 5c extract-questions 設計書を追加`

## テスト本数 (Phase 5c 着手時点)

- `@tally/core`: 36 tests
- `@tally/ai-engine`: 74 tests
- `@tally/storage`: 46 tests
- `@tally/frontend`: 76 tests
- 合計 **232 テスト全緑**

完了目安 (各 Task 完了時):
- Task 1 完了時: core +2 → 38
- Task 2 完了時: ai-engine +2 → 76
- Task 3 完了時: ai-engine +5 → 81
- Task 4 完了時: ai-engine +1 (registry) + agent-runner テスト復活 ±0 → 82
- Task 5 完了時: ai-engine +2 → 84
- Task 6 完了時: ai-engine +3 → 87
- Task 7 完了時: frontend +3 → 79
- Task 8 完了時: frontend +1 → 80
- Task 9 完了時: frontend +2 → 82
- Task 10 完了時: frontend +1 → 83
- Task 11 完了時: (全緑確認のみ) → **合計 ≈ 257**

## Phase 5c 完了後の follow-up (別 PR で対応推奨)

### 実装 / UX
- **analyze-impact の issue 重複ガード**: 現状プロンプト任せ。extract-questions で確立した anchor+同タイトル ガードを issue proposal にも適用する follow-up PR。
- **QuestionNodeSchema の options 制約**: extract-questions 経由では必ず 2〜4 個だが、UI の手動編集では 0 個から始まる。スキーマ側で min/max を強制するかは別論点として残す

### UI 統合
- **CodebaseAgentButton / GraphAgentButton の統合**: 差分は codebasePath 分岐のみ。さらに他のグラフ系エージェントが増えたら 1 コンポーネント化を検討

### 将来拡張
- **question の sourceAgentId 保持**: 現状 transmuteNode で proposal → 正規 question になると sourceAgentId が落ちる (5a/5b 共通の未決定論点)

## 実装ルール (必ず守る)

1. **Plan に書かれた順で実装**。Task 1→2→3→...、飛ばさない。Task 4 の registry 登録は Task 3 の完了が前提。
2. **TDD を厳守**。plan の各タスクは「failing test 書く → RED 確認 → 実装 → GREEN 確認 → commit」のステップに分かれている。
3. **1 タスク = 1 コミット** が基本。plan 指定のコミットメッセージをそのまま使う。
4. **Biome / typecheck** を通してから commit。
5. **ADR-0007 準拠**。新エージェントの `allowedTools` は registry 宣言に「MCP と built-in を全列挙」するだけ。`agent-runner` が自動で `tools` / `allowedTools` に振り分けて SDK に渡す。
6. **AI は proposal しか作らない** (ADR-0005)。
7. **コミット規約**: Conventional Commits 日本語件名、scope は `core|ai-engine|storage|frontend|docs|chore|test|fix|refactor|style`。**`Co-Authored-By` と `Generated with Claude Code` フッタは絶対に付けない**。
8. **確認は `AskUserQuestion` ツール** で選択式。
9. **`NODE_ENV=development` で test / install を実行する** (本 PC 固有の罠。shell の `NODE_ENV=production` 設定が react-dom/testing-library に影響し、`React.act` が剥ぎ取られて 26 本 fail する)。

## 設計の非自明ポイント (実装者が見落としがち)

- **question は codebasePath 不要**: find-related-code / analyze-impact と違い、`validateCodebaseAnchor` に `{ requireCodebasePath: false }` を渡す。
- **allowedTools に built-in を含めない**: MCP 4 個のみ。ADR-0007 により `agent-runner` が `tools: []` を SDK に渡し、built-in ツールは自動遮断される。
- **proposal の options は passthrough で保持**: `ProposalNodeSchema.passthrough()` なので `options` / `decision` がスキーマ検証を通過。採用時に `ProposalDetail` が additional として渡し、`transmuteNode` 内 `NodeSchema.parse` で QuestionNodeSchema が options を正しくバリデートする。スキーマ変更不要。
- **options の ID 生成はサーバ側**: AI は `{ text }` だけ渡す。`create_node` で `opt-xxxxxxxxxx` を付与し `selected: false` / `decision: null` を固定。
- **anchor+同タイトル重複ガード**: anchor の近傍に同タイトル question (正規 or proposal) があれば reject。比較は `stripAiPrefix` で揃える。

## 復元手順 (別 PC で続きをやる場合)

1. 本ドキュメントと設計書 / plan を読む
2. ADR-0007 を読む
3. `git log --oneline -10` で HEAD と一致するか確認
4. `NODE_ENV=development pnpm -r test` で全緑を確認
5. 本ファイルの「次のタスク」から着手
6. タスク完了ごとに本ファイルの進捗表を更新してコミット

## 更新ルール

Task N を完了 (commit + push 済み) したら、以下を本ファイルで更新:
- 進捗表の状態を「⏳ 未着手」→「✅ 完了」
- `担当 commit` 列に commit SHA 先頭 7 桁
- 「次のタスク」を 1 つ進める
- 「HEAD 情報」を最新 commit に差し替え
- 「テスト本数」合計を更新
```

- [ ] **Step 5: 全 package 全緑 + typecheck 最終確認**

```bash
NODE_ENV=development pnpm -r test 2>&1 | grep -E 'Tests.*passed|Test Files.*passed'
NODE_ENV=development pnpm -r typecheck
```

Expected: 全緑 (合計 ≈ 257)。typecheck エラーなし。

- [ ] **Step 6: phase-5c-progress.md の進捗表を「本 commit で全 task 完了」に更新**

実装完了時に `docs/phase-5c-progress.md` の進捗表を以下に書き換え:

- 全行の状態を `✅ 完了` に
- `担当 commit` 列を実際の SHA に
- `## Phase 5c タスク進捗` の下の「**次のタスク**: Task 1 (core)」を `**次のタスク**: Phase 5d extract-questions は完了、次は ingest-document (別 spec で設計から)` に
- 「全体状況」表の 5c を `完了` に、HEAD 情報を本 commit に

- [ ] **Step 7: コミット**

```bash
git add docs/02-domain-model.md docs/04-roadmap.md docs/phase-5c-manual-e2e.md docs/phase-5c-progress.md
git commit -m "docs: Phase 5c 完了マーク + 手動 E2E 手順書追加"
```

---

## 完了条件 (plan 全体)

- [ ] Task 1〜11 が全て完了 commit されている
- [ ] `NODE_ENV=development pnpm -r test` が全緑 (合計 ≈ 257)
- [ ] `NODE_ENV=development pnpm -r typecheck` が緑
- [ ] `docs/phase-5c-progress.md` が最新 HEAD SHA / 完了 commit SHA と一致
- [ ] (手動 E2E は別時間で別セッション。本 plan のスコープ外だが `docs/phase-5c-manual-e2e.md` が存在する)

---

## Self-Review (plan 作成時チェック済)

**Spec coverage:**
- § 2 (core): Task 1 ✓
- § 3.1 (validateCodebaseAnchor 一般化): Task 2 ✓
- § 3.2 (extract-questions agent): Task 3 ✓
- § 3.3 (プロンプト): Task 3 ✓
- § 3.4.1 (options ID 補完): Task 5 ✓
- § 3.4.2 (anchor+同タイトル重複ガード): Task 6 ✓
- § 3.5 (anchorId 配線): Task 6 ✓
- § 4.1 (GraphAgentButton 抽出): Task 7 ✓
- § 4.2 (ExtractQuestionsButton): Task 9 ✓
- § 4.3 (store startExtractQuestions): Task 8 ✓
- § 4.4 (3 detail 配置): Task 10 ✓
- § 5.1 (ユニットテスト): 各 Task の RED-GREEN で網羅
- § 5.2 (手動 E2E): Task 11 ✓
- § 5.3 (ロードマップ): Task 11 ✓
- § 5.4 (進捗ドキュメント): Task 11 ✓

**Placeholder scan:** なし。全ステップに実コード / 実コマンドを記載。

**Type consistency:**
- `CreateNodeDeps.anchorId: string` は Task 5 / 6 / 7 / 8 で一貫
- `newQuestionOptionId` Task 1 で定義、Task 5 で使用
- `validateCodebaseAnchor(..., options?)` Task 2 で拡張、Task 3 で呼び出し
- `startExtractQuestions: (nodeId: string) => Promise<void>` Task 8 で宣言、Task 9 で消費
