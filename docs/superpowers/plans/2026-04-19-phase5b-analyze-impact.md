# Phase 5b: analyze-impact 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「この要求/UC/ストーリーを実装したら既存コードのどこを変える必要があり、どんな課題が生じるか」を洗い出す `analyze-impact` エージェントを、重複ガード / filePath 正規化 / sourceAgentId 配線 / CodeRef スキーマ拡張 / UI 共通化 とともに投入する。

**Architecture:** Phase 5a の agent registry + validateCodebaseAnchor 共通ヘルパ (新規抽出) を基盤に、`analyze-impact` エージェントを issue 主役 + coderef 副次で追加。`create_node` ツールに 3 点の補強 (重複ガード / filePath 正規化 / sourceAgentId 注入) を入れ、同じ filePath+startLine ±10 行の coderef をサーバ側で弾く。frontend は `FindRelatedCodeButton` の共通ロジックを `CodebaseAgentButton` に抽出し、`FindRelatedCodeButton` / `AnalyzeImpactButton` の 2 つの thin wrapper に整理。3 detail (UC / requirement / userstory) に並べて配置。

**Tech Stack:** TypeScript, Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`), Next.js 15, Zustand, Zod, Vitest, Testing Library.

---

## 前提: 関連 spec と参照

- spec: `docs/superpowers/specs/2026-04-19-phase5b-analyze-impact-design.md`
- 直系前例: `docs/superpowers/specs/2026-04-19-phase5a-find-related-code-design.md` + `docs/superpowers/plans/2026-04-19-phase5a-find-related-code.md`
- ADR: `docs/adr/0005-proposal-adoption.md`, `docs/adr/0007-agent-tool-restriction.md`
- ドメイン: `docs/02-domain-model.md`
- 既存資産:
  - `packages/ai-engine/src/agents/registry.ts` (Phase 5a で導入済み)
  - `packages/ai-engine/src/agents/find-related-code.ts`
  - `packages/ai-engine/src/agent-runner.ts`
  - `packages/ai-engine/src/tools/{create-node,find-related,list-by-type,index}.ts`
  - `packages/frontend/src/components/ai-actions/find-related-code-button.tsx`
  - `packages/frontend/src/lib/store.ts` (`runAgentWS` 共通ヘルパ済み)

## ファイル構造

### core
- **変更** `packages/core/src/types.ts` — `AGENT_NAMES` に `'analyze-impact'` 追加
- **変更** `packages/core/src/schema.ts` — `CodeRefNodeSchema` に `summary` / `impact` 追加
- **変更** `packages/core/src/schema.test.ts` — 新フィールドの保持テスト

### ai-engine
- **新規** `packages/ai-engine/src/agents/codebase-anchor.ts` — `validateCodebaseAnchor` ヘルパ
- **新規** `packages/ai-engine/src/agents/codebase-anchor.test.ts`
- **変更** `packages/ai-engine/src/agents/find-related-code.ts` — 共通ヘルパ経由に置換
- **新規** `packages/ai-engine/src/agents/analyze-impact.ts` — プロンプト + `analyzeImpactAgent`
- **新規** `packages/ai-engine/src/agents/analyze-impact.test.ts`
- **変更** `packages/ai-engine/src/agents/registry.ts` — `analyze-impact` 登録
- **変更** `packages/ai-engine/src/agent-runner.ts` — `buildTallyMcpServer` に `agentName` を渡す
- **変更** `packages/ai-engine/src/agent-runner.test.ts` — `analyze-impact` happy-path 追加
- **変更** `packages/ai-engine/src/tools/index.ts` — `buildTallyMcpServer` シグネチャに `agentName`
- **変更** `packages/ai-engine/src/tools/create-node.ts` — 重複ガード / filePath 正規化 / sourceAgentId
- **変更** `packages/ai-engine/src/tools/create-node.test.ts` — 新機能のテスト追加
- **変更** `packages/ai-engine/src/tools/tools-index.test.ts` — agentName 追加シグネチャ

### frontend
- **新規** `packages/frontend/src/components/ai-actions/codebase-agent-button.tsx`
- **新規** `packages/frontend/src/components/ai-actions/codebase-agent-button.test.tsx`
- **変更** `packages/frontend/src/components/ai-actions/find-related-code-button.tsx` — thin wrapper に置換
- **変更** `packages/frontend/src/components/ai-actions/find-related-code-button.test.tsx` — 薄い配線テストに縮小
- **新規** `packages/frontend/src/components/ai-actions/analyze-impact-button.tsx`
- **新規** `packages/frontend/src/components/ai-actions/analyze-impact-button.test.tsx`
- **変更** `packages/frontend/src/lib/store.ts` — `startAnalyzeImpact` 追加
- **変更** `packages/frontend/src/lib/store.test.ts` — `startAnalyzeImpact` シナリオ追加
- **変更** `packages/frontend/src/components/details/usecase-detail.tsx` — AnalyzeImpactButton 追加
- **変更** `packages/frontend/src/components/details/usecase-detail.test.tsx` — 配置を assert
- **変更** `packages/frontend/src/components/details/requirement-detail.tsx` — AnalyzeImpactButton 追加
- **変更** `packages/frontend/src/components/details/userstory-detail.tsx` — AnalyzeImpactButton 追加

### docs
- **変更** `docs/02-domain-model.md` — CodeRef に summary / impact を記載
- **新規** `docs/phase-5b-manual-e2e.md`
- **変更** `docs/04-roadmap.md` — Phase 5b のチェックを進める

---

## Task 1: core の AGENT_NAMES 拡張 + CodeRefNodeSchema 拡張

**Files:**
- Modify: `packages/core/src/types.ts`
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/schema.test.ts`
- Modify: `docs/02-domain-model.md`

- [ ] **Step 1: CodeRefNodeSchema の summary / impact 保持テストを追加**

`packages/core/src/schema.test.ts` の末尾に追加:

```typescript
describe('CodeRefNodeSchema summary/impact', () => {
  it('summary と impact を持つ coderef をパースできる', () => {
    const parsed = CodeRefNodeSchema.parse({
      id: 'cref-1',
      type: 'coderef',
      x: 0,
      y: 0,
      title: 'src/a.ts:10',
      body: '何かの説明',
      filePath: 'src/a.ts',
      startLine: 10,
      endLine: 20,
      summary: '招待の送信ロジック',
      impact: 'テンプレ差し替えが必要',
    });
    expect(parsed.summary).toBe('招待の送信ロジック');
    expect(parsed.impact).toBe('テンプレ差し替えが必要');
  });

  it('summary と impact は optional (従来の coderef も読める)', () => {
    const parsed = CodeRefNodeSchema.parse({
      id: 'cref-2',
      type: 'coderef',
      x: 0,
      y: 0,
      title: 's',
      body: '',
    });
    expect(parsed.summary).toBeUndefined();
    expect(parsed.impact).toBeUndefined();
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
pnpm --filter @tally/core test -- schema
```

Expected: `CodeRefNodeSchema summary/impact` の先頭テストが FAIL (`summary` / `impact` がパース対象外で脱落)。

- [ ] **Step 3: CodeRefNodeSchema に summary / impact を追加**

`packages/core/src/schema.ts` の該当箇所:

```typescript
export const CodeRefNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('coderef'),
  filePath: z.string().optional(),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
  impact: z.string().optional(),
});
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
pnpm --filter @tally/core test -- schema
```

Expected: PASS。

- [ ] **Step 5: AGENT_NAMES に `'analyze-impact'` を追加**

`packages/core/src/types.ts`:

```typescript
export const AGENT_NAMES = ['decompose-to-stories', 'find-related-code', 'analyze-impact'] as const;
```

- [ ] **Step 6: core の型チェック**

```bash
pnpm --filter @tally/core build
pnpm --filter @tally/core test
```

Expected: 緑。core は AgentName に analyze-impact が増えるだけで他に影響なし。

- [ ] **Step 7: docs/02-domain-model.md の CodeRefExtensions を更新**

`docs/02-domain-model.md` の `#### coderef（コード参照）` の型宣言ブロックを以下に書き換え:

```typescript
interface CodeRefExtensions {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  summary?: string;  // 現状要約 (AI 生成時の初期値)
  impact?: string;   // 実装で変わる方向性 (analyze-impact 由来)
}
```

- [ ] **Step 8: コミット**

```bash
git add packages/core/src/types.ts packages/core/src/schema.ts packages/core/src/schema.test.ts docs/02-domain-model.md
git commit -m "feat(core): AGENT_NAMES に analyze-impact 追加 + CodeRefNodeSchema に summary/impact"
```

---

## Task 2: validateCodebaseAnchor 共通ヘルパ抽出 + find-related-code 移行

**Files:**
- Create: `packages/ai-engine/src/agents/codebase-anchor.ts`
- Create: `packages/ai-engine/src/agents/codebase-anchor.test.ts`
- Modify: `packages/ai-engine/src/agents/find-related-code.ts`

- [ ] **Step 1: codebase-anchor.test.ts を新規作成 (失敗テスト)**

`packages/ai-engine/src/agents/codebase-anchor.test.ts`:

```typescript
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ProjectStore } from '@tally/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateCodebaseAnchor } from './codebase-anchor';

function makeStore(overrides: Partial<ProjectStore>): ProjectStore {
  return {
    getNode: vi.fn().mockResolvedValue(null),
    getProjectMeta: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as unknown as ProjectStore;
}

describe('validateCodebaseAnchor', () => {
  const workspaceRoot = '/workspace';
  const allowed = ['usecase', 'requirement', 'userstory'] as const;

  it('nodeId が存在しなければ not_found', async () => {
    const store = makeStore({ getNode: vi.fn().mockResolvedValue(null) });
    const r = await validateCodebaseAnchor({ store, workspaceRoot }, 'x', allowed, 'analyze-impact');
    expect(r).toEqual({ ok: false, code: 'not_found', message: expect.stringContaining('x') });
  });

  it('対象外 type なら bad_request', async () => {
    const store = makeStore({
      getNode: vi.fn().mockResolvedValue({ id: 'n', type: 'issue', x: 0, y: 0, title: '', body: '' }),
    });
    const r = await validateCodebaseAnchor({ store, workspaceRoot }, 'n', allowed, 'analyze-impact');
    expect(r).toEqual({ ok: false, code: 'bad_request', message: expect.stringContaining('analyze-impact') });
  });

  it('codebasePath 未設定なら bad_request', async () => {
    const store = makeStore({
      getNode: vi.fn().mockResolvedValue({ id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' }),
      getProjectMeta: vi.fn().mockResolvedValue({ id: 'p', name: 'x', createdAt: '', updatedAt: '' }),
    });
    const r = await validateCodebaseAnchor({ store, workspaceRoot }, 'uc', allowed, 'analyze-impact');
    expect(r).toEqual({ ok: false, code: 'bad_request', message: expect.stringContaining('codebasePath') });
  });

  it('codebasePath 解決先が存在しなければ not_found', async () => {
    const store = makeStore({
      getNode: vi.fn().mockResolvedValue({ id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' }),
      getProjectMeta: vi.fn().mockResolvedValue({
        id: 'p', name: 'x', codebasePath: '/nonexistent/path/xyz', createdAt: '', updatedAt: '',
      }),
    });
    const r = await validateCodebaseAnchor({ store, workspaceRoot: '/' }, 'uc', allowed, 'analyze-impact');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_found');
  });

  it('codebasePath がファイルなら bad_request', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cba-'));
    const file = path.join(dir, 'a.txt');
    await fs.writeFile(file, 'x');
    const store = makeStore({
      getNode: vi.fn().mockResolvedValue({ id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' }),
      getProjectMeta: vi.fn().mockResolvedValue({ id: 'p', name: 'x', codebasePath: 'a.txt', createdAt: '', updatedAt: '' }),
    });
    const r = await validateCodebaseAnchor({ store, workspaceRoot: dir }, 'uc', allowed, 'analyze-impact');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('bad_request');
    rmSync(dir, { recursive: true, force: true });
  });

  it('成功時は anchor と cwd を返す', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cba-'));
    const node = { id: 'uc', type: 'usecase', x: 0, y: 0, title: '', body: '' };
    const store = makeStore({
      getNode: vi.fn().mockResolvedValue(node),
      getProjectMeta: vi.fn().mockResolvedValue({ id: 'p', name: 'x', codebasePath: '.', createdAt: '', updatedAt: '' }),
    });
    const r = await validateCodebaseAnchor({ store, workspaceRoot: dir }, 'uc', allowed, 'analyze-impact');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.anchor).toEqual(node);
      expect(r.cwd).toBe(path.resolve(dir, '.'));
    }
    rmSync(dir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
pnpm --filter @tally/ai-engine test -- codebase-anchor
```

Expected: FAIL (`codebase-anchor` module not found)。

- [ ] **Step 3: validateCodebaseAnchor を実装**

`packages/ai-engine/src/agents/codebase-anchor.ts`:

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { NodeType } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

import type { AgentValidateResult } from './registry';

// UC / requirement / userstory のいずれかで、かつ codebasePath が有効ディレクトリであることを
// 検証する共通ヘルパ。find-related-code と analyze-impact で共用する。
export async function validateCodebaseAnchor(
  deps: { store: ProjectStore; workspaceRoot: string },
  nodeId: string,
  allowedTypes: readonly NodeType[],
  agentLabel: string,
): Promise<AgentValidateResult> {
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

- [ ] **Step 4: テスト再実行 で GREEN**

```bash
pnpm --filter @tally/ai-engine test -- codebase-anchor
```

Expected: PASS (6 ケース全緑)。

- [ ] **Step 5: find-related-code.ts を共通ヘルパ経由に置換**

`packages/ai-engine/src/agents/find-related-code.ts` の `validateInput` ブロックを以下に書き換え (既存 import の `fs` / `path` / インライン実装を削除):

```typescript
import type { Node } from '@tally/core';
import { z } from 'zod';

import { validateCodebaseAnchor } from './codebase-anchor';
import type { AgentDefinition } from './registry';

// (buildFindRelatedCodePrompt はそのまま残す)

const FindRelatedCodeInputSchema = z.object({ nodeId: z.string().min(1) });
type FindRelatedCodeInput = z.infer<typeof FindRelatedCodeInputSchema>;

const ALLOWED_ANCHOR_TYPES = ['usecase', 'requirement', 'userstory'] as const;

export const findRelatedCodeAgent: AgentDefinition<FindRelatedCodeInput> = {
  name: 'find-related-code',
  inputSchema: FindRelatedCodeInputSchema,
  async validateInput({ store, workspaceRoot }, input) {
    return validateCodebaseAnchor(
      { store, workspaceRoot },
      input.nodeId,
      ALLOWED_ANCHOR_TYPES,
      'find-related-code',
    );
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

- [ ] **Step 6: find-related-code の回帰テストを実行**

```bash
pnpm --filter @tally/ai-engine test -- find-related-code
```

Expected: 既存ケースすべて PASS (6-7 ケース全緑)。

- [ ] **Step 7: ai-engine 全テスト通過確認**

```bash
pnpm --filter @tally/ai-engine test
```

Expected: 既存 47 テスト + 新規 6 (codebase-anchor) = 53 前後が全緑。

- [ ] **Step 8: コミット**

```bash
git add packages/ai-engine/src/agents/codebase-anchor.ts packages/ai-engine/src/agents/codebase-anchor.test.ts packages/ai-engine/src/agents/find-related-code.ts
git commit -m "refactor(ai-engine): validateCodebaseAnchor 共通ヘルパ抽出 + find-related-code 移行"
```

---

## Task 3: analyze-impact プロンプトを実装

**Files:**
- Create: `packages/ai-engine/src/agents/analyze-impact.ts`
- Create: `packages/ai-engine/src/agents/analyze-impact.test.ts`

- [ ] **Step 1: prompt containment テストを先に書く**

`packages/ai-engine/src/agents/analyze-impact.test.ts`:

```typescript
import type { Node } from '@tally/core';
import { describe, expect, it } from 'vitest';

import { buildAnalyzeImpactPrompt } from './analyze-impact';

const anchor: Node = {
  id: 'uc-1',
  type: 'usecase',
  x: 0,
  y: 0,
  title: '招待メール送信',
  body: 'ユーザーが仲間を招待する UC',
};

describe('buildAnalyzeImpactPrompt', () => {
  it('issue が主役であることを明示する', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('主役');
    expect(systemPrompt).toContain('issue proposal');
  });

  it('coderef 重複禁止の指示を含む', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('find_related');
    expect(systemPrompt).toContain('再作成しない');
  });

  it('出力規約として coderef / issue 両方を記述', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('adoptAs="coderef"');
    expect(systemPrompt).toContain('adoptAs="issue"');
    expect(systemPrompt).toContain('summary');
    expect(systemPrompt).toContain('impact');
  });

  it('Edit / Write / Bash を禁止する', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('Edit / Write / Bash は使わない');
  });

  it('個数目安 0〜5 件と 0 件許容を明示', () => {
    const { systemPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(systemPrompt).toContain('0〜5 件');
    expect(systemPrompt).toContain('0 件でも可');
  });

  it('user プロンプトに anchor の id / type / title / body を含む', () => {
    const { userPrompt } = buildAnalyzeImpactPrompt({ anchor });
    expect(userPrompt).toContain('uc-1');
    expect(userPrompt).toContain('usecase');
    expect(userPrompt).toContain('招待メール送信');
    expect(userPrompt).toContain('ユーザーが仲間を招待する UC');
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

```bash
pnpm --filter @tally/ai-engine test -- analyze-impact
```

Expected: FAIL (module not found)。

- [ ] **Step 3: buildAnalyzeImpactPrompt を実装**

`packages/ai-engine/src/agents/analyze-impact.ts`:

```typescript
import type { Node } from '@tally/core';
import { z } from 'zod';

import { validateCodebaseAnchor } from './codebase-anchor';
import type { AgentDefinition } from './registry';

export interface AnalyzeImpactPromptInput {
  anchor: Node;
}

// analyze-impact のプロンプト。issue proposal が主役、coderef は補助 (find-related-code が
// 拾い切れていない変更点のみ)。既存 coderef と重複する filePath/startLine は作らせない。
export function buildAnalyzeImpactPrompt(input: AnalyzeImpactPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    'あなたは Tally の影響分析アシスタントです。',
    '対象ノード (usecase / requirement / userstory) を実装した場合に、',
    'codebasePath 配下の既存コードへ与える影響を洗い出し、',
    '「変更が必要な箇所 (coderef proposal)」と「変更に伴う課題・リスク (issue proposal)」を記録します。',
    '',
    'あなたの主役は issue proposal (変更の意味付け・リスク洗い出し) です。',
    'coderef proposal は find-related-code が拾い切れていなかった新規の変更点のみを補うため、',
    '「主役ではない」ことを強く意識すること。',
    '',
    '手順:',
    '1. mcp__tally__find_related(nodeId=対象ノード) で対象ノードにエッジ接続済みのノードを取得する。',
    '   既存 coderef / issue の filePath / タイトルを必ず確認し、同じものは再作成しない。',
    '2. mcp__tally__list_by_type("coderef") / list_by_type("issue") で他 anchor に紐づく既存を確認し、',
    '   同一 filePath+startLine の coderef、同一 anchor+同タイトルの issue は作らない。',
    '3. Glob / Grep / Read で codebase を探索し、実装時に変更が必要そうなファイル・関数を特定する。',
    '4. 変更点が find-related-code 由来の既存 coderef で既にカバーされているなら coderef proposal は',
    '   作成せず、issue proposal の body 中で「<既存 coderef のタイトル> を変更する必要あり」と言及する。',
    '   既存 coderef に未カバーの新規変更点がある場合のみ coderef proposal を追加作成する。',
    '5. 「テスト未整備」「データ移行が必要」「後方互換性の懸念」「パフォーマンス影響」などの懸念は',
    '   issue proposal として作成する。issue は anchor ごとに同じタイトルで重複させない。',
    '',
    '出力規約:',
    '- coderef proposal (副次的, 0〜5 件): create_node で type="proposal", adoptAs="coderef"',
    '  タイトル: "[AI] <filePath>:<startLine>"',
    '  body: "<現状要約> / 影響: <実装したらどう変更する必要があるか>" (人間可読)',
    '  additional: { filePath, startLine, endLine, summary, impact }',
    '    filePath は codebasePath 基準の相対パス ("./" は付けない)',
    '    summary = 現状要約、impact = 実装で変わる方向性 (UI の将来拡張用、body と内容を一致させる)',
    '- issue proposal (主役, 0〜5 件): create_node で type="proposal", adoptAs="issue"',
    '  タイトル: "[AI] <短く具体的な課題名>" (同一 anchor に同タイトルの issue を既に持たないこと)',
    '  body: 課題の説明 / 影響範囲 (参照 coderef があればそのタイトルを列挙) / 検討ポイント (2〜4 行)',
    '',
    'エッジ規約:',
    '- 対象ノード → 新規 coderef proposal: create_edge で type="derive"',
    '- 対象ノード → issue proposal: create_edge で type="derive"',
    '',
    '個数目安:',
    '- coderef proposal: 0〜5 件 (find-related-code が拾っていない新規影響箇所のみ)',
    '- issue proposal: 0〜5 件',
    '- 影響が薄ければ 0 件でも可。無理に作らないこと。',
    '- 最後に「何を分析し、何を見つけたか」を 3〜4 行で日本語で要約する。',
    '',
    'ツール使用方針: 探索は Glob / Grep / Read のみ。Edit / Write / Bash は使わない。',
  ].join('\n');

  const userPrompt = [
    `対象ノード: ${input.anchor.id}`,
    `type: ${input.anchor.type}`,
    `タイトル: ${input.anchor.title}`,
    `本文:\n${input.anchor.body}`,
    '',
    '上記ノードを実装した場合の既存コードへの影響を分析し、',
    'coderef proposal と issue proposal として記録してください。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}
```

- [ ] **Step 4: テストを再実行して GREEN**

```bash
pnpm --filter @tally/ai-engine test -- analyze-impact
```

Expected: PASS (6 ケース)。

- [ ] **Step 5: コミット**

```bash
git add packages/ai-engine/src/agents/analyze-impact.ts packages/ai-engine/src/agents/analyze-impact.test.ts
git commit -m "feat(ai-engine): analyze-impact エージェントのプロンプト実装"
```

---

## Task 4: analyzeImpactAgent 定義 + registry 登録

**Files:**
- Modify: `packages/ai-engine/src/agents/analyze-impact.ts`
- Modify: `packages/ai-engine/src/agents/analyze-impact.test.ts`
- Modify: `packages/ai-engine/src/agents/registry.ts`
- Modify: `packages/ai-engine/src/agents/registry.test.ts`

- [ ] **Step 1: analyzeImpactAgent の契約テストを追加**

`packages/ai-engine/src/agents/analyze-impact.test.ts` の末尾に追加:

```typescript
import { analyzeImpactAgent } from './analyze-impact';

describe('analyzeImpactAgent definition', () => {
  it('name = analyze-impact', () => {
    expect(analyzeImpactAgent.name).toBe('analyze-impact');
  });

  it('inputSchema が nodeId 必須', () => {
    const r = analyzeImpactAgent.inputSchema.safeParse({});
    expect(r.success).toBe(false);
  });

  it('allowedTools が find-related-code と同一 (Read/Glob/Grep + 4 tally MCP)', () => {
    expect(analyzeImpactAgent.allowedTools).toEqual(
      expect.arrayContaining([
        'mcp__tally__create_node',
        'mcp__tally__create_edge',
        'mcp__tally__find_related',
        'mcp__tally__list_by_type',
        'Read',
        'Glob',
        'Grep',
      ]),
    );
    expect(analyzeImpactAgent.allowedTools).toHaveLength(7);
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
pnpm --filter @tally/ai-engine test -- analyze-impact
```

Expected: FAIL (`analyzeImpactAgent` export なし)。

- [ ] **Step 3: analyzeImpactAgent を analyze-impact.ts に追加**

`packages/ai-engine/src/agents/analyze-impact.ts` の末尾に追加:

```typescript
const AnalyzeImpactInputSchema = z.object({ nodeId: z.string().min(1) });
type AnalyzeImpactInput = z.infer<typeof AnalyzeImpactInputSchema>;

const ALLOWED_ANCHOR_TYPES = ['usecase', 'requirement', 'userstory'] as const;

export const analyzeImpactAgent: AgentDefinition<AnalyzeImpactInput> = {
  name: 'analyze-impact',
  inputSchema: AnalyzeImpactInputSchema,
  async validateInput({ store, workspaceRoot }, input) {
    return validateCodebaseAnchor(
      { store, workspaceRoot },
      input.nodeId,
      ALLOWED_ANCHOR_TYPES,
      'analyze-impact',
    );
  },
  buildPrompt: ({ anchor }) => buildAnalyzeImpactPrompt({ anchor }),
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

- [ ] **Step 4: テスト再実行で GREEN**

```bash
pnpm --filter @tally/ai-engine test -- analyze-impact
```

Expected: PASS (9 ケース)。

- [ ] **Step 5: registry.test.ts に analyze-impact の登録確認テストを追加**

`packages/ai-engine/src/agents/registry.test.ts` の既存 describe ブロックに追加:

```typescript
it("'analyze-impact' で analyzeImpactAgent が取れる", () => {
  expect(AGENT_REGISTRY['analyze-impact']).toBe(analyzeImpactAgent);
});
```

import 行に `import { analyzeImpactAgent } from './analyze-impact';` を追加。

- [ ] **Step 6: テスト失敗を確認**

```bash
pnpm --filter @tally/ai-engine test -- registry
```

Expected: FAIL (`AGENT_REGISTRY['analyze-impact']` が undefined、かつ `satisfies Record<AgentName, AgentDefinition>` により TS コンパイル時点で失敗する可能性あり — その場合は Step 7 を先に実施)。

- [ ] **Step 7: registry に analyze-impact を登録**

`packages/ai-engine/src/agents/registry.ts`:

```typescript
import { analyzeImpactAgent } from './analyze-impact';
import { decomposeToStoriesAgent } from './decompose-to-stories';
import { findRelatedCodeAgent } from './find-related-code';

// (AgentValidate*** 等の既存 export は変更なし)

export const AGENT_REGISTRY = {
  'decompose-to-stories': decomposeToStoriesAgent,
  'find-related-code': findRelatedCodeAgent,
  'analyze-impact': analyzeImpactAgent,
} satisfies Record<AgentName, AgentDefinition>;
```

- [ ] **Step 8: テスト通過確認**

```bash
pnpm --filter @tally/ai-engine test -- registry
pnpm --filter @tally/ai-engine test
```

Expected: registry 3 ケース + 全体緑。

- [ ] **Step 9: コミット**

```bash
git add packages/ai-engine/src/agents/analyze-impact.ts packages/ai-engine/src/agents/analyze-impact.test.ts packages/ai-engine/src/agents/registry.ts packages/ai-engine/src/agents/registry.test.ts
git commit -m "feat(ai-engine): analyze-impact エージェントを registry に登録"
```

---

## Task 5: agent-runner happy-path テスト (analyze-impact)

**Files:**
- Modify: `packages/ai-engine/src/agent-runner.test.ts`

- [ ] **Step 1: analyze-impact 用 happy-path テストを追加**

`packages/ai-engine/src/agent-runner.test.ts` の既存 describe 内 (FileSystemProjectStore を beforeEach で作る既存パターン) に追加:

```typescript
it('analyze-impact の start → validateInput → sdk.query を cwd / tools / allowedTools / permissionMode 付きで呼ぶ', async () => {
  // codebasePath 用のダミーディレクトリを追加で用意
  const codebaseDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tally-codebase-'));
  // projectMeta を FileSystemProjectStore 経由で保存
  await store.saveProjectMeta({
    id: 'proj-test',
    name: 'P',
    codebasePath: codebaseDir,
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
  });

  const queryCalls: Array<{
    prompt: string;
    options?: {
      systemPrompt?: string;
      mcpServers?: Record<string, unknown>;
      tools?: string[];
      allowedTools?: string[];
      cwd?: string;
      settingSources?: string[];
      permissionMode?: string;
    };
  }> = [];
  const mockSdk = {
    async *query(opts: unknown) {
      queryCalls.push(opts as never);
      yield { type: 'result', subtype: 'success', result: 'done' };
    },
  };

  const events: AgentEvent[] = [];
  for await (const e of runAgent({
    sdk: mockSdk as never,
    store,
    workspaceRoot: root,
    req: {
      type: 'start',
      agent: 'analyze-impact',
      projectId: 'proj-test',
      input: { nodeId: ucNode.id },
    },
  })) {
    events.push(e);
  }

  expect(events[0]).toEqual({ type: 'start', agent: 'analyze-impact', input: { nodeId: ucNode.id } });
  expect(queryCalls).toHaveLength(1);
  const call = queryCalls[0];
  expect(call?.options?.tools).toEqual(['Read', 'Glob', 'Grep']);
  expect(call?.options?.allowedTools).toEqual(
    expect.arrayContaining([
      'mcp__tally__create_node',
      'mcp__tally__create_edge',
      'mcp__tally__find_related',
      'mcp__tally__list_by_type',
      'Read',
      'Glob',
      'Grep',
    ]),
  );
  expect(call?.options?.permissionMode).toBe('dontAsk');
  expect(call?.options?.settingSources).toEqual([]);
  expect(call?.options?.cwd).toBe(codebaseDir);
  expect(call?.options?.systemPrompt).toContain('影響');

  await fs.rm(codebaseDir, { recursive: true, force: true });
});
```

既存の `FileSystemProjectStore.saveProjectMeta` / `addNode` インフラと `beforeEach` で用意される `root` / `store` / `ucNode` を再利用。分解テストと同じスタイルを維持する。

- [ ] **Step 2: テスト実行**

```bash
pnpm --filter @tally/ai-engine test -- agent-runner
```

Expected: 新規テスト含め全緑 (analyze-impact が registry 登録済みのため即パスする想定)。

- [ ] **Step 3: コミット**

```bash
git add packages/ai-engine/src/agent-runner.test.ts
git commit -m "test(ai-engine): analyze-impact の agent-runner happy-path テスト追加"
```

---

## Task 6: create_node に coderef 重複ガード + filePath 正規化

**Files:**
- Modify: `packages/ai-engine/src/tools/create-node.ts`
- Modify: `packages/ai-engine/src/tools/create-node.test.ts`

- [ ] **Step 1: 重複ガード + filePath 正規化のテストを追加**

`packages/ai-engine/src/tools/create-node.test.ts` の既存テストに追加 (`describe('create_node tool', ...)` 内):

```typescript
describe('coderef duplicate guard', () => {
  function setupWithExisting(existingNodes: Array<Record<string, unknown>>) {
    const added: Array<Record<string, unknown>> = [];
    const store = {
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
        const created = { ...n, id: `n-${added.length + 1}` };
        added.push(created);
        return created;
      }),
      listNodes: vi.fn().mockResolvedValue(existingNodes),
    } as unknown as ProjectStore;
    return { store, added };
  }

  it('同一 filePath + 同一 startLine の既存 coderef と重複する場合は ok:false', async () => {
    const existing = [
      { id: 'cref-old', type: 'coderef', x: 0, y: 0, title: '', body: '', filePath: 'src/a.ts', startLine: 10 },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 10, endLine: 12 },
    });
    expect(r.ok).toBe(false);
    expect(r.output).toContain('重複');
    expect(added).toHaveLength(0);
  });

  it('startLine 差 ±10 行以内は重複扱い', async () => {
    const existing = [
      { id: 'cref-old', type: 'coderef', x: 0, y: 0, title: '', body: '', filePath: 'src/a.ts', startLine: 10 },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 15 },
    });
    expect(r.ok).toBe(false);
    expect(added).toHaveLength(0);
  });

  it('startLine 差 11 以上は新規作成を許可', async () => {
    const existing = [
      { id: 'cref-old', type: 'coderef', x: 0, y: 0, title: '', body: '', filePath: 'src/a.ts', startLine: 10 },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 22 },
    });
    expect(r.ok).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('filePath 違いは新規作成を許可', async () => {
    const existing = [
      { id: 'cref-old', type: 'coderef', x: 0, y: 0, title: '', body: '', filePath: 'src/a.ts', startLine: 10 },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/b.ts', startLine: 10 },
    });
    expect(r.ok).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('adoptAs !== coderef ではガード発動しない', async () => {
    const existing = [
      { id: 'cref-old', type: 'coderef', x: 0, y: 0, title: '', body: '', filePath: 'src/a.ts', startLine: 10 },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    const r = await handler({
      adoptAs: 'issue',
      title: 'テスト未整備',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 10 },
    });
    expect(r.ok).toBe(true);
    expect(added).toHaveLength(1);
  });

  it('既存 proposal (adoptAs=coderef) とも重複判定する', async () => {
    const existing = [
      { id: 'prop-old', type: 'proposal', adoptAs: 'coderef', x: 0, y: 0, title: '', body: '', filePath: 'src/a.ts', startLine: 10 },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/a.ts', startLine: 10 },
    });
    expect(r.ok).toBe(false);
    expect(added).toHaveLength(0);
  });

  it('filePath を正規化して保存する (./src/a.ts → src/a.ts)', async () => {
    const { store, added } = setupWithExisting([]);
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: './src/a.ts', startLine: 10 },
    });
    expect(added[0].filePath).toBe('src/a.ts');
  });

  it('正規化後の filePath で重複判定する (./src/a.ts と src/a.ts を同一視)', async () => {
    const existing = [
      { id: 'cref-old', type: 'coderef', x: 0, y: 0, title: '', body: '', filePath: 'src/a.ts', startLine: 10 },
    ];
    const { store, added } = setupWithExisting(existing);
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    const r = await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: './src/a.ts', startLine: 10 },
    });
    expect(r.ok).toBe(false);
    expect(added).toHaveLength(0);
  });
});

describe('sourceAgentId 注入', () => {
  it('作成された proposal ノードに sourceAgentId=agentName が刻まれる', async () => {
    const added: Array<Record<string, unknown>> = [];
    const store = {
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
        const created = { ...n, id: `n-${added.length + 1}` };
        added.push(created);
        return created;
      }),
      listNodes: vi.fn().mockResolvedValue([]),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'analyze-impact' });
    await handler({ adoptAs: 'issue', title: 'テスト', body: '' });
    expect(added[0].sourceAgentId).toBe('analyze-impact');
  });

  it('agentName=find-related-code で呼ばれた場合もその名前が刻まれる', async () => {
    const added: Array<Record<string, unknown>> = [];
    const store = {
      addNode: vi.fn().mockImplementation(async (n: Record<string, unknown>) => {
        const created = { ...n, id: `n-${added.length + 1}` };
        added.push(created);
        return created;
      }),
      listNodes: vi.fn().mockResolvedValue([]),
    } as unknown as ProjectStore;
    const handler = createNodeHandler({ store, emit: () => {}, anchor: { x: 0, y: 0 }, agentName: 'find-related-code' });
    await handler({
      adoptAs: 'coderef',
      title: 's',
      body: '',
      additional: { filePath: 'src/x.ts', startLine: 1, endLine: 3 },
    });
    expect(added[0].sourceAgentId).toBe('find-related-code');
  });
});
```

**重要**: ProjectStore の node 一覧 API は `listNodes(): Promise<Node[]>` (確認済み)。テストとハンドラ実装はこの名前を使う。

- [ ] **Step 2: setupWithExisting で `listNodes` を使うことを確認 (コードレビュー用)**

上記の setupWithExisting で `listNodes: vi.fn().mockResolvedValue(nodes)` を `addNode` と並べて定義する形に統一。テストコード内の `listNodes` の綴りだけ確認。

- [ ] **Step 3: create-node.ts の handler を拡張**

`packages/ai-engine/src/tools/create-node.ts`:

```typescript
import path from 'node:path';

import type { AdoptableType, AgentName, ProposalNode } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { AgentEvent } from '../stream';

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
  agentName: AgentName;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

const CODEREF_LINE_TOLERANCE = 10;

function normalizeFilePath(fp: string): string {
  // 先頭の ./ を剥ぎ、path.posix.normalize で // や内部 ./ を除去
  const stripped = fp.startsWith('./') ? fp.slice(2) : fp;
  return path.posix.normalize(stripped);
}

// 既存 coderef (type='coderef' or type='proposal' + adoptAs='coderef') を取得して
// filePath が等しく startLine が ±10 行以内のものを返す。
async function findDuplicateCoderef(
  store: ProjectStore,
  filePath: string,
  startLine: number,
): Promise<{ id: string; startLine: number } | null> {
  const all = await store.listNodes();
  for (const n of all) {
    const rec = n as Record<string, unknown>;
    const type = rec.type as string | undefined;
    const adoptAs = rec.adoptAs as string | undefined;
    const isCoderef = type === 'coderef' || (type === 'proposal' && adoptAs === 'coderef');
    if (!isCoderef) continue;
    const fp = rec.filePath as string | undefined;
    const sl = rec.startLine as number | undefined;
    if (!fp || typeof sl !== 'number') continue;
    if (normalizeFilePath(fp) !== filePath) continue;
    if (Math.abs(sl - startLine) <= CODEREF_LINE_TOLERANCE) {
      return { id: rec.id as string, startLine: sl };
    }
  }
  return null;
}

export function createNodeHandler(deps: CreateNodeDeps) {
  let nextOffsetIndex = 0;
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = CreateNodeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const { adoptAs, title, body, x, y, additional } = parsed.data;

    // filePath 正規化 + coderef 重複ガード (adoptAs='coderef' のときのみ)
    let normalizedAdditional = additional;
    if (adoptAs === 'coderef' && additional) {
      const fp = additional.filePath;
      if (typeof fp === 'string' && fp.length > 0) {
        const normalized = normalizeFilePath(fp);
        normalizedAdditional = { ...additional, filePath: normalized };
        const sl = additional.startLine;
        if (typeof sl === 'number') {
          const dup = await findDuplicateCoderef(deps.store, normalized, sl);
          if (dup) {
            return {
              ok: false,
              output: `重複: ${dup.id} と近接 (filePath=${normalized}, startLine 差=${Math.abs(dup.startLine - sl)})`,
            };
          }
        }
      }
    }

    const ensuredTitle = title.startsWith('[AI]') ? title : `[AI] ${title}`;
    const idx = nextOffsetIndex++;
    const placedX = x ?? deps.anchor.x + 260 + idx * 20;
    const placedY = y ?? deps.anchor.y + idx * 120;

    try {
      const created = (await deps.store.addNode({
        ...(normalizedAdditional ?? {}),
        type: 'proposal',
        x: placedX,
        y: placedY,
        title: ensuredTitle,
        body,
        adoptAs,
        sourceAgentId: deps.agentName,
      } as Parameters<typeof deps.store.addNode>[0])) as ProposalNode;
      deps.emit({ type: 'node_created', node: created });
      return { ok: true, output: JSON.stringify(created) };
    } catch (err) {
      return { ok: false, output: `addNode failed: ${String(err)}` };
    }
  };
}
```

- [ ] **Step 4: 既存 create_node テストの呼び出しに agentName を足す**

既存 `create-node.test.ts` の全 `createNodeHandler({ ... })` 呼び出しに `agentName: 'find-related-code'` (もしくは対応する値) を追加。対象箇所は以下を確認:

```bash
grep -n 'createNodeHandler(' packages/ai-engine/src/tools/create-node.test.ts
```

既存の呼び出しすべてに `agentName: 'find-related-code'` を追加する。

- [ ] **Step 5: テスト実行**

```bash
pnpm --filter @tally/ai-engine test -- create-node
```

Expected: 既存テスト + 新規重複ガード 8 ケースすべて緑。

- [ ] **Step 6: コミット**

```bash
git add packages/ai-engine/src/tools/create-node.ts packages/ai-engine/src/tools/create-node.test.ts
git commit -m "feat(ai-engine): create_node に coderef 重複ガード + filePath 正規化 + sourceAgentId 配線"
```

---

## Task 7: tools/index.ts の buildTallyMcpServer に agentName を受ける

**Files:**
- Modify: `packages/ai-engine/src/tools/index.ts`
- Modify: `packages/ai-engine/src/tools/tools-index.test.ts`
- Modify: `packages/ai-engine/src/agent-runner.ts`
- Modify: `packages/ai-engine/src/agent-runner.test.ts`

- [ ] **Step 1: tools-index.test.ts を更新 (agentName を渡す)**

`packages/ai-engine/src/tools/tools-index.test.ts` の既存 describe 冒頭 mock 作成箇所を探し、以下のように agentName を渡す:

```bash
grep -n 'buildTallyMcpServer' packages/ai-engine/src/tools/tools-index.test.ts
```

既存の `buildTallyMcpServer({ store, emit, anchor })` 呼び出しすべてに `, agentName: 'decompose-to-stories'` を追加。追加で「agentName が buildTallyMcpServer のシグネチャに現れる」ことを軽く検証するテストを 1 件追加する (下記 Step 4 の sourceAgentId テストで実質カバーされる想定なら省略可)。

- [ ] **Step 2: index.ts のシグネチャ更新**

`packages/ai-engine/src/tools/index.ts`:

```typescript
import type { AgentName } from '@tally/core';

export function buildTallyMcpServer(deps: {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  agentName: AgentName;
}) {
  // create-node handler に agentName を渡す
  const createNode = createNodeHandler({
    store: deps.store,
    emit: deps.emit,
    anchor: deps.anchor,
    agentName: deps.agentName,
  });
  // 他のハンドラは変更なし
  // ...
}
```

実ファイルの既存実装に合わせて、`createNodeHandler` 呼び出しに `agentName: deps.agentName` を追加する箇所だけ編集。

- [ ] **Step 3: agent-runner.ts の buildTallyMcpServer 呼び出しを更新**

`packages/ai-engine/src/agent-runner.ts`:

```typescript
const mcp = buildTallyMcpServer({
  store,
  emit: (e) => sideEvents.push(e),
  anchor: { x: anchor.x, y: anchor.y },
  agentName: req.agent,
});
```

- [ ] **Step 4: sourceAgentId の end-to-end 検証は Task 6 の create-node.test.ts で既にカバー済み**

Task 6 で追加した `sourceAgentId 注入` describe が create_node ハンドラ単体で agentName=analyze-impact / find-related-code の両方を検証する。agent-runner → buildTallyMcpServer → create_node handler の配線が Step 2/3 で正しく繋がっていれば、ランタイムで agentName が渡る。配線テストは不要 (TypeScript の型チェックで agentName: AgentName 必須化が保証される)。

- [ ] **Step 5: テスト実行**

```bash
pnpm --filter @tally/ai-engine test
```

Expected: ai-engine 全体緑。

- [ ] **Step 6: コミット**

```bash
git add packages/ai-engine/src/tools/index.ts packages/ai-engine/src/tools/tools-index.test.ts packages/ai-engine/src/agent-runner.ts packages/ai-engine/src/agent-runner.test.ts
git commit -m "feat(ai-engine): buildTallyMcpServer と agent-runner に agentName を配線"
```

---

## Task 8: CodebaseAgentButton 共通抽出

**Files:**
- Create: `packages/frontend/src/components/ai-actions/codebase-agent-button.tsx`
- Create: `packages/frontend/src/components/ai-actions/codebase-agent-button.test.tsx`

- [ ] **Step 1: codebase-agent-button のテストを先に書く (既存 find-related-code-button.test の論理を移植)**

`packages/frontend/src/components/ai-actions/codebase-agent-button.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';
import { CodebaseAgentButton } from './codebase-agent-button';

const anchor = { id: 'uc-1', type: 'usecase' as const, x: 0, y: 0, title: 't', body: 'b' };

function hydrate(codebasePath?: string, running = false) {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    ...(codebasePath !== undefined ? { codebasePath } : {}),
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    nodes: [anchor],
    edges: [],
  });
  if (running) {
    useCanvasStore.setState({
      runningAgent: { agent: 'find-related-code', inputNodeId: 'uc-1', events: [] },
    } as never);
  }
}

describe('CodebaseAgentButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('codebasePath 未設定なら disabled で警告 tooltip', () => {
    hydrate(undefined, false);
    render(
      <CodebaseAgentButton node={anchor} label="テスト" busyLabel="実行中" tooltip="ふつう" onRun={vi.fn()} />,
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toContain('codebasePath');
  });

  it('runningAgent が非 null なら disabled', () => {
    hydrate('../backend', true);
    render(
      <CodebaseAgentButton node={anchor} label="テスト" busyLabel="実行中" tooltip="x" onRun={vi.fn()} />,
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('click で onRun(nodeId) が呼ばれる', () => {
    hydrate('../backend', false);
    const onRun = vi.fn().mockResolvedValue(undefined);
    render(
      <CodebaseAgentButton node={anchor} label="テスト" busyLabel="実行中" tooltip="x" onRun={onRun} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onRun).toHaveBeenCalledWith('uc-1');
  });

  it('通常時は tooltip が渡された値', () => {
    hydrate('../backend', false);
    render(
      <CodebaseAgentButton node={anchor} label="テスト" busyLabel="実行中" tooltip="カスタム文言" onRun={vi.fn()} />,
    );
    expect(screen.getByRole('button').getAttribute('title')).toBe('カスタム文言');
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
pnpm --filter @tally/frontend test -- codebase-agent-button
```

Expected: FAIL (module not found)。

- [ ] **Step 3: CodebaseAgentButton を実装**

`packages/frontend/src/components/ai-actions/codebase-agent-button.tsx`:

```tsx
'use client';

import type { RequirementNode, UseCaseNode, UserStoryNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export type AnchorNode = UseCaseNode | RequirementNode | UserStoryNode;

interface CodebaseAgentButtonProps {
  node: AnchorNode;
  label: string;
  busyLabel: string;
  tooltip: string;
  onRun: (nodeId: string) => Promise<void>;
}

export function CodebaseAgentButton({ node, label, busyLabel, tooltip, onRun }: CodebaseAgentButtonProps) {
  const codebasePath = useCanvasStore((s) => s.projectMeta?.codebasePath);
  const running = useCanvasStore((s) => s.runningAgent);

  const hasCodebase = typeof codebasePath === 'string' && codebasePath.trim().length > 0;
  const busy = running !== null;
  const disabled = busy || !hasCodebase;

  const resolvedTooltip = !hasCodebase
    ? 'codebasePath 未設定: ヘッダの設定から指定してください'
    : busy
      ? '別のエージェントが実行中です'
      : tooltip;

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
      {busy ? busyLabel : label}
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
pnpm --filter @tally/frontend test -- codebase-agent-button
```

Expected: 4 ケース全緑。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/ai-actions/codebase-agent-button.tsx packages/frontend/src/components/ai-actions/codebase-agent-button.test.tsx
git commit -m "feat(frontend): CodebaseAgentButton を共通抽出"
```

---

## Task 9: FindRelatedCodeButton を thin wrapper 化

**Files:**
- Modify: `packages/frontend/src/components/ai-actions/find-related-code-button.tsx`
- Modify: `packages/frontend/src/components/ai-actions/find-related-code-button.test.tsx`

- [ ] **Step 1: find-related-code-button.test.tsx を薄い配線テストに縮小**

`packages/frontend/src/components/ai-actions/find-related-code-button.test.tsx` を以下に書き換え:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';
import { FindRelatedCodeButton } from './find-related-code-button';

const node = { id: 'uc-1', type: 'usecase' as const, x: 0, y: 0, title: 't', body: 'b' };

function hydrate(codebasePath?: string) {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    ...(codebasePath !== undefined ? { codebasePath } : {}),
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    nodes: [node],
    edges: [],
  });
}

describe('FindRelatedCodeButton wiring', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('click で startFindRelatedCode(nodeId) が呼ばれる', () => {
    hydrate('../backend');
    const start = vi.fn(async () => {});
    useCanvasStore.setState({ startFindRelatedCode: start } as never);
    render(<FindRelatedCodeButton node={node} />);
    fireEvent.click(screen.getByRole('button', { name: /関連コード/ }));
    expect(start).toHaveBeenCalledWith('uc-1');
  });

  it('label が「関連コードを探す」 (codebase 設定済み時)', () => {
    hydrate('../backend');
    render(<FindRelatedCodeButton node={node} />);
    expect(screen.getByRole('button').textContent).toBe('関連コードを探す');
  });
});
```

- [ ] **Step 2: テスト実行 (既存実装では busy 判定などで若干ラベル差があり、ここは縮小する)**

```bash
pnpm --filter @tally/frontend test -- find-related-code-button
```

Expected: 既存の詳細ロジックテスト (codebasePath 未設定 disabled など) は `codebase-agent-button.test.tsx` に移行済みのため、ここは 2 ケースのみで PASS。

- [ ] **Step 3: FindRelatedCodeButton 本体を thin wrapper に書き換え**

`packages/frontend/src/components/ai-actions/find-related-code-button.tsx`:

```tsx
'use client';

import { useCanvasStore } from '@/lib/store';
import { type AnchorNode, CodebaseAgentButton } from './codebase-agent-button';

export function FindRelatedCodeButton({ node }: { node: AnchorNode }) {
  const start = useCanvasStore((s) => s.startFindRelatedCode);
  return (
    <CodebaseAgentButton
      node={node}
      label="関連コードを探す"
      busyLabel="関連コード: 実行中…"
      tooltip="既存コードから関連箇所を探索します"
      onRun={start}
    />
  );
}
```

- [ ] **Step 4: テスト再実行 + 3 detail 側のテストが通ることを確認**

```bash
pnpm --filter @tally/frontend test
```

Expected: 全体緑。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/ai-actions/find-related-code-button.tsx packages/frontend/src/components/ai-actions/find-related-code-button.test.tsx
git commit -m "refactor(frontend): FindRelatedCodeButton を CodebaseAgentButton の thin wrapper に"
```

---

## Task 10: store.startAnalyzeImpact 追加

**Files:**
- Modify: `packages/frontend/src/lib/store.ts`
- Modify: `packages/frontend/src/lib/store.test.ts`

- [ ] **Step 1: store.test.ts に startAnalyzeImpact のシナリオを追加**

`packages/frontend/src/lib/store.test.ts` の既存 startFindRelatedCode テスト近傍に追加 (既存のモック構造を踏襲):

```typescript
describe('startAnalyzeImpact', () => {
  it('analyze-impact の AgentEvent 列で coderef + issue + derive エッジを反映し runningAgent をクリア', async () => {
    // 既存テストと同じ構造: openAgentWS モック、wsEvents 生成、startAnalyzeImpact 実行、state 検証
    const events = [
      { type: 'start', agent: 'analyze-impact', input: { nodeId: 'uc-1' } },
      {
        type: 'node_created',
        node: {
          id: 'cref-ai-1',
          type: 'proposal',
          adoptAs: 'coderef',
          x: 200,
          y: 100,
          title: '[AI] src/b.ts:30',
          body: '現状 / 影響',
          filePath: 'src/b.ts',
          startLine: 30,
          endLine: 35,
          summary: '現状',
          impact: '影響',
          sourceAgentId: 'analyze-impact',
        },
      },
      {
        type: 'node_created',
        node: {
          id: 'iss-ai-1',
          type: 'proposal',
          adoptAs: 'issue',
          x: 240,
          y: 220,
          title: '[AI] テスト未整備',
          body: '詳細',
          sourceAgentId: 'analyze-impact',
        },
      },
      { type: 'edge_created', edge: { id: 'e-1', from: 'uc-1', to: 'cref-ai-1', type: 'derive' } },
      { type: 'edge_created', edge: { id: 'e-2', from: 'uc-1', to: 'iss-ai-1', type: 'derive' } },
      { type: 'result', subtype: 'success', result: 'ok' },
    ];
    // mock は既存 startFindRelatedCode (`store.test.ts:150-192`) と同じ方式:
    // vi.resetModules() + vi.doMock('./ws', () => ({ startAgent: () => ({ events, close }) }))
    vi.resetModules();
    vi.doMock('./ws', () => ({
      startAgent: (opts: { agent: string }) => ({
        events: (async function* () {
          for (const e of events) yield e;
        })(),
        close: () => {},
      }),
    }));
    const { useCanvasStore: store } = await import('./store');
    store.getState().hydrate({
      id: 'proj-1',
      name: 't',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: 'uc', body: '' }],
      edges: [],
    });
    await store.getState().startAnalyzeImpact('uc-1');
    const state = store.getState();
    // store では nodes / edges は Record<string, ...>
    expect(state.nodes['cref-ai-1']).toBeDefined();
    expect(state.nodes['iss-ai-1']).toBeDefined();
    expect(state.edges['e-1']?.type).toBe('derive');
    expect(state.edges['e-2']?.type).toBe('derive');
    expect(state.runningAgent).toBeNull();
  });
});
```

**重要**: store 内部では nodes / edges は `Record<string, Node/Edge>`。`hydrate` 時は配列で渡し、store 内部で `byId` により Record 化される。

- [ ] **Step 2: テスト失敗を確認**

```bash
pnpm --filter @tally/frontend test -- store
```

Expected: FAIL (`startAnalyzeImpact` が `undefined`)。

- [ ] **Step 3: store.ts に startAnalyzeImpact を追加**

`packages/frontend/src/lib/store.ts` の interface 定義とアクション実装箇所に追加:

```typescript
// interface
interface CanvasStore {
  // ...
  startAnalyzeImpact: (nodeId: string) => Promise<void>;
}

// 実装 (既存の startDecompose / startFindRelatedCode と並べる)
startAnalyzeImpact: (nodeId) => runAgentWS('analyze-impact', nodeId),
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
pnpm --filter @tally/frontend test -- store
```

Expected: PASS。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/lib/store.ts packages/frontend/src/lib/store.test.ts
git commit -m "feat(frontend): store に startAnalyzeImpact を追加"
```

---

## Task 11: AnalyzeImpactButton 新規 (UX 誘導 tooltip)

**Files:**
- Create: `packages/frontend/src/components/ai-actions/analyze-impact-button.tsx`
- Create: `packages/frontend/src/components/ai-actions/analyze-impact-button.test.tsx`

- [ ] **Step 1: analyze-impact-button のテストを先に書く**

`packages/frontend/src/components/ai-actions/analyze-impact-button.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';
import { AnalyzeImpactButton } from './analyze-impact-button';

const node = { id: 'uc-1', type: 'usecase' as const, x: 0, y: 0, title: 't', body: 'b' };

function hydrateWithLinks(linkedNodes: Array<Record<string, unknown>>, edges: Array<Record<string, unknown>>) {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    codebasePath: '../backend',
    createdAt: '2026-04-18T00:00:00Z',
    updatedAt: '2026-04-18T00:00:00Z',
    nodes: [node, ...linkedNodes] as never,
    edges: edges as never,
  });
}

describe('AnalyzeImpactButton', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('click で startAnalyzeImpact(nodeId) が呼ばれる', () => {
    hydrateWithLinks([], []);
    const start = vi.fn(async () => {});
    useCanvasStore.setState({ startAnalyzeImpact: start } as never);
    render(<AnalyzeImpactButton node={node} />);
    fireEvent.click(screen.getByRole('button', { name: /影響を分析する/ }));
    expect(start).toHaveBeenCalledWith('uc-1');
  });

  it('anchor に紐づく coderef が 0 件なら tooltip に「まず『関連コードを探す』」を含む', () => {
    hydrateWithLinks([], []);
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button').getAttribute('title')).toContain('関連コードを探す');
  });

  it('anchor に紐づく proposal(adoptAs=coderef) があれば通常 tooltip', () => {
    hydrateWithLinks(
      [{ id: 'cref-1', type: 'proposal', adoptAs: 'coderef', x: 0, y: 0, title: 't', body: '' }],
      [{ id: 'e-1', from: 'uc-1', to: 'cref-1', type: 'derive' }],
    );
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button').getAttribute('title')).toContain('変更が必要');
  });

  it('anchor に紐づく coderef ノード (正規) があれば通常 tooltip', () => {
    hydrateWithLinks(
      [{ id: 'cref-2', type: 'coderef', x: 0, y: 0, title: '', body: '' }],
      [{ id: 'e-2', from: 'uc-1', to: 'cref-2', type: 'derive' }],
    );
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button').getAttribute('title')).toContain('変更が必要');
  });

  it('label が「影響を分析する」 (codebase 設定済み時)', () => {
    hydrateWithLinks([], []);
    render(<AnalyzeImpactButton node={node} />);
    expect(screen.getByRole('button').textContent).toBe('影響を分析する');
  });
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
pnpm --filter @tally/frontend test -- analyze-impact-button
```

Expected: FAIL (module not found)。

- [ ] **Step 3: AnalyzeImpactButton を実装**

`packages/frontend/src/components/ai-actions/analyze-impact-button.tsx`:

```tsx
'use client';

import type { Node } from '@tally/core';

import { useCanvasStore } from '@/lib/store';
import { type AnchorNode, CodebaseAgentButton } from './codebase-agent-button';

export function AnalyzeImpactButton({ node }: { node: AnchorNode }) {
  const start = useCanvasStore((s) => s.startAnalyzeImpact);
  // store.nodes / edges は Record<string, ...>。Object.values で走査する。
  const hasLinkedCoderef = useCanvasStore((s) => {
    const derivedTos = Object.values(s.edges)
      .filter((e) => e.from === node.id && e.type === 'derive')
      .map((e) => e.to);
    return Object.values(s.nodes).some((n) => {
      if (!derivedTos.includes(n.id)) return false;
      if (n.type === 'coderef') return true;
      const proposal = n as unknown as { adoptAs?: string };
      return n.type === 'proposal' && proposal.adoptAs === 'coderef';
    });
  });

  const tooltip = hasLinkedCoderef
    ? '実装時に変更が必要な既存コードと課題を洗い出します'
    : 'まず「関連コードを探す」で既存コードを紐づけると精度が上がります';

  return (
    <CodebaseAgentButton
      node={node}
      label="影響を分析する"
      busyLabel="影響分析: 実行中…"
      tooltip={tooltip}
      onRun={start}
    />
  );
}
```

- [ ] **Step 4: テスト再実行で GREEN**

```bash
pnpm --filter @tally/frontend test -- analyze-impact-button
```

Expected: 5 ケース全緑。

- [ ] **Step 5: コミット**

```bash
git add packages/frontend/src/components/ai-actions/analyze-impact-button.tsx packages/frontend/src/components/ai-actions/analyze-impact-button.test.tsx
git commit -m "feat(frontend): AnalyzeImpactButton を追加 (UX 誘導 tooltip つき)"
```

---

## Task 12: 3 detail に AnalyzeImpactButton を配置

**Files:**
- Modify: `packages/frontend/src/components/details/usecase-detail.tsx`
- Modify: `packages/frontend/src/components/details/usecase-detail.test.tsx`
- Modify: `packages/frontend/src/components/details/requirement-detail.tsx`
- Modify: `packages/frontend/src/components/details/userstory-detail.tsx`

- [ ] **Step 1: usecase-detail.test.tsx に AnalyzeImpactButton の配置 assert を追加**

`packages/frontend/src/components/details/usecase-detail.test.tsx` の describe 内、既存の「関連コードボタンが描画される」に倣って追加:

```typescript
it('影響分析ボタンが描画される', () => {
  useCanvasStore.getState().hydrate({
    id: 'proj-1',
    name: 'P',
    codebasePath: '../backend',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    nodes: [{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' }],
    edges: [],
  });
  render(
    <UseCaseDetail node={{ id: 'uc-1', type: 'usecase', x: 0, y: 0, title: '', body: '' }} />,
  );
  const btn = screen.getByRole('button', { name: /影響を分析する/ }) as HTMLButtonElement;
  expect(btn).toBeTruthy();
});
```

- [ ] **Step 2: テスト失敗を確認**

```bash
pnpm --filter @tally/frontend test -- usecase-detail
```

Expected: FAIL (ボタンが無い)。

- [ ] **Step 3: usecase-detail.tsx に AnalyzeImpactButton を追加**

`packages/frontend/src/components/details/usecase-detail.tsx` の AI アクション節 (既存 FindRelatedCodeButton の直下、ストーリー分解の上か下) に追加:

```tsx
import { AnalyzeImpactButton } from '@/components/ai-actions/analyze-impact-button';

// JSX 内の既存「AI アクション」節を以下のように:
<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
  <FindRelatedCodeButton node={node} />
  <AnalyzeImpactButton node={node} />
  {/* 既存のストーリー分解ボタン */}
</div>
```

- [ ] **Step 4: usecase-detail テスト再実行で GREEN**

```bash
pnpm --filter @tally/frontend test -- usecase-detail
```

- [ ] **Step 5: requirement-detail.tsx に AnalyzeImpactButton を追加**

`packages/frontend/src/components/details/requirement-detail.tsx` に同じく追加:

```tsx
import { AnalyzeImpactButton } from '@/components/ai-actions/analyze-impact-button';
// ...
<FindRelatedCodeButton node={node} />
<AnalyzeImpactButton node={node} />
```

- [ ] **Step 6: userstory-detail.tsx に AnalyzeImpactButton を追加**

同じパターンで userstory-detail.tsx にも追加。

- [ ] **Step 7: frontend 全体テスト**

```bash
pnpm --filter @tally/frontend test
```

Expected: 全体緑。

- [ ] **Step 8: コミット**

```bash
git add packages/frontend/src/components/details/usecase-detail.tsx packages/frontend/src/components/details/usecase-detail.test.tsx packages/frontend/src/components/details/requirement-detail.tsx packages/frontend/src/components/details/userstory-detail.tsx
git commit -m "feat(frontend): 3 detail に AnalyzeImpactButton を配置"
```

---

## Task 13: ドキュメント・ロードマップ・Memory 更新 + 最終緑確認

**Files:**
- Create: `docs/phase-5b-manual-e2e.md`
- Modify: `docs/04-roadmap.md`
- Modify: `~/.claude/projects/<project-id>/memory/project_phase_progress.md`

- [ ] **Step 1: phase-5b-manual-e2e.md を書く**

`docs/phase-5b-manual-e2e.md`:

```markdown
# Phase 5b: analyze-impact 手動 E2E 手順

Phase 5b の手動検証手順。CI ではなく、Claude Agent SDK との実通信を含むため人手で実行する。

## 前提

- Phase 5a の手動 E2E (`docs/phase-5a-manual-e2e.md`) を実施済み
- `examples/taskflow-backend/` が存在 (Phase 5a で用意済み)
- Claude Code OAuth 認証済み

## 手順

1. `pnpm --filter ai-engine dev` と `pnpm --filter frontend dev` を並行起動
2. ブラウザで sample-project を開く
3. ヘッダ歯車 → codebasePath が `../taskflow-backend` に設定済みであることを確認
4. UC `uc-send-invite` を選択
5. まず「関連コードを探す」を実行 → coderef proposal が 2-3 件生成された状態にする
6. 同 UC で「影響を分析する」ボタンを押す

## 期待結果

AgentProgressPanel に以下のストリームが流れる:

- `thinking`
- `tool_use(mcp__tally__find_related)` で既存 coderef を取得
- `tool_use(mcp__tally__list_by_type)` で重複確認
- `tool_use(Glob / Grep / Read)` でコード探索
- `node_created` coderef proposal × 0-5 (重複は create_node のサーバ側ガードで弾かれる)
- `node_created` issue proposal × 0-5
- `edge_created` anchor → proposal の derive × N
- `result` で 3-4 行の日本語要約

Canvas には以下が反映される:

- 新規 coderef proposal (既存 filePath と重複しないもの) が破線で配置
- issue proposal が破線で配置
- anchor から各 proposal に derive エッジ

proposal のデータ検証:

- coderef proposal の body 冒頭に「影響: 〜」が含まれる
- coderef proposal の additional に `summary` / `impact` / `filePath` / `startLine` / `endLine` が含まれる
- `sourceAgentId: analyze-impact` が YAML (`.tally/nodes/*.yaml`) に刻まれる
- issue proposal を 1 件採用 → 黄色の issue ノードに昇格

## 境界テスト

影響の薄い孤立 requirement に analyze-impact を実行 → 0 件で正常終了、result 要約に「特に影響なし」相当のメッセージ。

## 重複ガードの検証

テスト用に、同じ filePath + 近い startLine (±10 行以内) を指す AI 生成をわざと誘発する状況 (関連コード → 影響分析を連続実行) を再現。create_node が `{ok: false, output: '重複: ...'}` を返し、同一箇所の coderef が 2 つ以上作られないことを確認する。

## 完了条件

- 上記手順が手動で動作する
- `pnpm -r test` 全緑
- `pnpm -r typecheck` 全緑
- `pnpm -r biome` 緑

以上が Phase 5b 完了の条件。
```

- [ ] **Step 2: docs/04-roadmap.md の Phase 5b を完了マーク**

`docs/04-roadmap.md` の Phase 5b 節:

```markdown
### Phase 5b (完了)

- [x] `analyze-impact.ts`：影響分析
- [x] create_node に coderef 重複ガード + filePath 正規化 + sourceAgentId 配線
- [x] CodeRefNodeSchema に summary / impact フィールド追加
- [x] CodebaseAgentButton 共通抽出 + AnalyzeImpactButton 追加

手動 E2E 手順は `docs/phase-5b-manual-e2e.md` 参照。
```

- [ ] **Step 3: 全テスト緑確認**

```bash
pnpm -r test
pnpm -r typecheck 2>&1 | tail -20
pnpm -r biome
```

Expected: すべて緑。ai-engine / frontend / core のテスト数が spec 節 9 の試算 (+25 前後) の範囲で増えていること。

- [ ] **Step 4: 変更サマリを Memory に反映**

`~/.claude/projects/<project-id>/memory/project_phase_progress.md` を以下のように更新:

```markdown
# Tally Phase 進捗

- Phase 0-4: 完了
- Phase 5a: 完了 (find-related-code + codebasePath UI + ADR-0007)
- Phase 5b: 完了 (analyze-impact + coderef 重複ガード + sourceAgentId 配線 + CodeRef summary/impact 追加)
- 次は Phase 5c (extract-questions) / Phase 5d (ingest-document)

テスト本数: core NN / storage NN / ai-engine NN / frontend NN = 合計 NN 全緑
```

(NN は Step 3 の `pnpm -r test` 出力から拾った実数に書き換える。)

- [ ] **Step 5: コミット**

```bash
git add docs/phase-5b-manual-e2e.md docs/04-roadmap.md
git commit -m "docs: Phase 5b 手動 E2E 手順書と roadmap 更新"
```

Memory は別の場所 (home) なので、このリポジトリへの git 操作とは独立して手動で更新する。

---

## 完了条件 (spec と対応)

spec 節を追跡して、全項目が plan のタスクで cover されているか確認する。

| spec 節 | 対応 Task | 完了条件 |
|---|---|---|
| 節 1 位置づけ | Task 3 (プロンプト) | issue 主役 / coderef 副次がプロンプトに明示 |
| 節 2.1 AgentName | Task 1 | AGENT_NAMES に analyze-impact |
| 節 2.2 CodeRef summary/impact | Task 1 | CodeRefNodeSchema 拡張 + 02-domain-model.md |
| 節 3 共通ヘルパ | Task 2 | validateCodebaseAnchor 抽出 + find-related-code 移行 |
| 節 4 プロンプト | Task 3 | 手順 5 項目 / 出力規約 / エッジ規約 / 個数目安 |
| 節 4 analyzeImpactAgent | Task 4 | registry 登録 + inputSchema / allowedTools |
| 節 5.1 重複ガード | Task 6 | filePath+startLine ±10 行のサーバ側ガード |
| 節 5.2 filePath 正規化 | Task 6 | `./` 剥ぎ + posix.normalize |
| 節 5.3 sourceAgentId | Task 6/7 | create-node / buildTallyMcpServer / agent-runner |
| 節 6.1 CodebaseAgentButton | Task 8 | 共通ロジック抽出 + テスト |
| 節 6.2 FindRelatedCode wrapper | Task 9 | thin wrapper 化 + テスト移行 |
| 節 6.3 AnalyzeImpactButton | Task 11 | UX 誘導 tooltip 実装 |
| 節 6.4 3 detail 配置 | Task 12 | UC / req / userstory 3 箇所に追加 |
| 節 7 startAnalyzeImpact | Task 10 | store に追加 + テスト |
| 節 8 エラー経路 | Task 2 / 5 | 共通ヘルパ 6 ケース + agent-runner happy-path |
| 節 9 テスト計画 | 全 Task | Task 1-12 が該当テストを含む |
| 節 10 スケジュール | 全 Task | 13 Task で完了 |
| 節 11 非目標 | — | 意図的に除外 |

---

## 自己レビュー済み

- placeholder/TODO は無い
- Task 5/7 の一部はモック方式が既存テストへの参照前提 (「既存モックを流用」) だが、これは Phase 5a plan で既に動いている既存コードに乗るため記述を圧縮してある
- 型とメソッド名は spec と plan で一致: `validateCodebaseAnchor` / `analyzeImpactAgent` / `CodebaseAgentButton` / `AnalyzeImpactButton` / `startAnalyzeImpact` / `sourceAgentId` / `summary` / `impact` は spec と plan で同じ綴り
- spec 節と Task の対応表で漏れなしを確認

---

## 備考

- 各 Task は 2-5 分以内のステップで構成 (failing test → 実行 → 実装 → 緑 → commit)
- commit は Task 粒度。サブタスクを 1 commit にまとめない
- Task 6 の `store.getAllNodes` 存在しない場合は `findNodesByType` への切り替えを Step 2 で必ず確認
- Task 7 の Step 4 (sourceAgentId の end-to-end 確認) は Task 6 の create-node.test.ts で代替可能。実装コストを見て判断
- Memory 更新 (Task 13 Step 4) は home ディレクトリのファイル編集、git 対象外
