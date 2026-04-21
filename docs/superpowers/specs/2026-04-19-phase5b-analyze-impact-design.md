# Phase 5b: analyze-impact エージェント — 設計書

- 日付: 2026-04-19
- ステータス: Accepted (brainstorming で合意)
- 関連: `docs/04-roadmap.md` Phase 5 / ADR-0002 / ADR-0005 / ADR-0006 / ADR-0007 / `docs/superpowers/specs/2026-04-19-phase5a-find-related-code-design.md`

## 目的

Phase 5a (find-related-code) で「要求に**関連する**既存コード」を列挙できるようになった。Phase 5b ではこれに**変更分析**の層を重ね、「この要求・UC・ストーリーを**実装したら**、どの既存コードを変更する必要があり、どんな課題・リスクが生じるか」を AI に洗い出させる。

キャンバス上で「思考のキャンバス」を完成させるための中核の一歩。Phase 5b 完了時点でドッグフーディングに十分な AI アクション群 (decompose-to-stories / find-related-code / analyze-impact) が揃う。

残りの `extract-questions` (論点抽出) と `ingest-document` (要求書取り込み) は Phase 5c / 5d で別 spec として実装する。

## 全体構成

```
Phase 5b スコープ (1 spec / 1 plan)
├── core:
│   ├── AgentName union に 'analyze-impact' 追加
│   └── CodeRefNodeSchema に summary / impact フィールド追加 (+ 02-domain-model.md 更新)
├── ai-engine:
│   ├── 共通ヘルパ validateCodebaseAnchor 抽出 (find-related-code も移行)
│   ├── analyze-impact エージェント新規 (prompt + registry 登録)
│   └── create_node ツール補強 (3 点):
│       ├── coderef 重複ガード (filePath + startLine 近接 ±10 行)
│       ├── filePath 正規化 (path.posix.normalize + 先頭 ./ 剥ぎ)
│       └── sourceAgentId 自動注入 (agent 名の刻印)
├── frontend:
│   ├── CodebaseAgentButton 共通抽出 + FindRelatedCodeButton を thin wrapper に
│   ├── AnalyzeImpactButton 新規 (UX 誘導 tooltip つき、disabled にはしない)
│   ├── store に startAnalyzeImpact 追加
│   └── 3 detail (usecase / requirement / userstory) に配置
└── docs: phase-5b-manual-e2e.md + roadmap 更新
```

---

## 1. find-related-code との棲み分け

| 観点 | find-related-code (5a) | analyze-impact (5b) |
|---|---|---|
| 問い | 「この要求に**関連する**既存コードは?」 | 「この要求を**実装したら**どこを変える必要がある? どんな課題が生じる?」 |
| 主役ノード | coderef proposal | **issue proposal** (変更の意味付け・リスク) |
| 補助ノード | — | coderef proposal (既知で足りない変更点の**補完**のみ、0 件可) |
| coderef additional | `{ filePath, startLine, endLine, summary? }` | 左と同じ + `impact?` (実装で変わる方向性) |
| 既存 coderef の扱い | 気にしない | **重複作成禁止** (既存を尊重) |
| sourceAgentId | `find-related-code` | `analyze-impact` |

**位置づけ**: analyze-impact は「**変更の意味付けとリスク洗い出し**」が主で、coderef は find-related-code が拾い切れていなかった新規の変更点のみを補う副次的出力。これにより「同じ coderef を別方向から見ただけ」にならない。

将来的に UI で sourceAgentId に基づくバッジやフィルタを入れる余地を残す (Phase 5b スコープ外)。

---

## 2. core: AgentName 拡張 + CodeRef スキーマ拡張

### 2.1 AgentName

`packages/core/src/types.ts`:

```typescript
export const AGENT_NAMES = ['decompose-to-stories', 'find-related-code', 'analyze-impact'] as const;
```

`AGENT_REGISTRY` 側で `satisfies Record<AgentName, AgentDefinition>` により未登録があれば compile error になる (Phase 5a で導入済みの保証機構)。

### 2.2 CodeRefNodeSchema に `summary` / `impact` を追加

codex 指摘: coderef body を `<現状要約> / 影響: ...` という文字列二層構造にすると、将来 UI で「現状」「影響」を別レイアウトで表示したくなった時に body のパース依存になる。最初から構造化フィールドを用意しておく。

`packages/core/src/schema.ts`:

```typescript
export const CodeRefNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('coderef'),
  filePath: z.string().optional(),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),  // 追加: 現状要約 (人間可読)
  impact: z.string().optional(),   // 追加: 実装で変わる方向性 (analyze-impact 由来のみ)
});
```

`docs/02-domain-model.md` の `CodeRefExtensions` も同じ形に更新する。

**後方互換**: いずれも optional。既存 YAML (Phase 5a 由来の coderef) は `summary` / `impact` なしで読み込める。

**body と構造化フィールドの関係**: body は従来通り人間可読の主フィールド、`summary` / `impact` は UI 将来拡張の予備。AI には「body には両者を結合したテキストを書き、additional に summary/impact を個別に入れる」と指示する。冗長に見えるが、body は採用後の編集対象 (ユーザーが手で書き換える)、additional は AI 由来の初期値保持、という役割分担。

---

## 3. ai-engine: 共通バリデーションヘルパ

### 動機

find-related-code の `validateInput` と analyze-impact の `validateInput` は以下が完全に同一:

- 対象ノード存在確認 (`not_found`)
- anchor type が `usecase` / `requirement` / `userstory` に限定されること (`bad_request`)
- `projectMeta.codebasePath` 設定済みであること (`bad_request`)
- 解決パスが実在ディレクトリであること (`not_found` / `bad_request`)

Phase 5b 時点で **2 エージェントが同じロジックを持つため、新規ヘルパに抽出**する。find-related-code も本ヘルパ経由に切り替え、既存テストで回帰を確認する。

### 新規ファイル

`packages/ai-engine/src/agents/codebase-anchor.ts`:

```typescript
import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Node, NodeType } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

import type { AgentValidateResult } from './registry';

// UC / requirement / userstory のいずれかで、かつ codebasePath が有効ディレクトリであることを
// 検証する共通ヘルパ。find-related-code と analyze-impact で共用する。
export async function validateCodebaseAnchor(
  deps: { store: ProjectStore; workspaceRoot: string },
  nodeId: string,
  allowedTypes: readonly NodeType[],
  agentLabel: string, // エラーメッセージ用の人間可読名 ('find-related-code' 等)
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

### find-related-code の移行

既存 `find-related-code.ts` の `validateInput` 実装を本ヘルパ呼び出しに置き換える:

```typescript
async validateInput({ store, workspaceRoot }, input) {
  return validateCodebaseAnchor(
    { store, workspaceRoot },
    input.nodeId,
    ALLOWED_ANCHOR_TYPES,
    'find-related-code',
  );
},
```

既存の find-related-code.test.ts のケース (不在 / 型外 / codebasePath 未設定 / 存在しない codebasePath / 成功) がそのまま通ることを回帰で確認する。

---

## 4. ai-engine: analyze-impact エージェント

### 新規ファイル

`packages/ai-engine/src/agents/analyze-impact.ts`:

```typescript
import type { Node } from '@tally/core';
import { z } from 'zod';

import { validateCodebaseAnchor } from './codebase-anchor';
import type { AgentDefinition } from './registry';

export interface AnalyzeImpactPromptInput {
  anchor: Node;
}

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

### registry 登録

`packages/ai-engine/src/agents/registry.ts`:

```typescript
import { analyzeImpactAgent } from './analyze-impact';
import { decomposeToStoriesAgent } from './decompose-to-stories';
import { findRelatedCodeAgent } from './find-related-code';

export const AGENT_REGISTRY = {
  'decompose-to-stories': decomposeToStoriesAgent,
  'find-related-code': findRelatedCodeAgent,
  'analyze-impact': analyzeImpactAgent,
} satisfies Record<AgentName, AgentDefinition>;
```

### agent-runner への影響

`agent-runner.ts` は `AGENT_REGISTRY` 参照なので自動で解決。追加変更なし。
ただし `create_node` の sourceAgentId 対応 (次節) で MCP server 構築時の引数を 1 つ増やす。

---

## 5. ai-engine: create_node の重複ガード + filePath 正規化 + sourceAgentId 配線

Phase 5b で `create_node` ツールに 3 点の補強を同時に入れる。いずれも 1 関数内の軽量な変更で、テスト追加込みで 1 ファイルに収まる。

### 5.1 coderef 重複ガード (adoptAs='coderef' 限定)

codex 指摘: 重複回避をプロンプトだけに任せると、AI が手順を逸脱した際に同一箇所の coderef が複数生える。サーバ側で軽量なフォールバックを入れる。

仕様:
- `adoptAs='coderef'` で、かつ `additional.filePath` と `additional.startLine` の両方が指定されているときのみガード発動
- 既存ノード (type='proposal' かつ adoptAs='coderef'、または type='coderef' 昇格済み) のうち、正規化後の `filePath` が一致し、かつ `startLine` の差が **10 行以内** (近接許容) のものが存在すれば、ガード発動
- ガード発動時は `{ ok: false, output: '重複: <既存ノード id> と近接 (filePath=<p>, startLine 差=<n>)' }` を返す。ノード作成はしない
- AI は tool result を見て別案に切り替える (プロンプト側でもこの挙動を明示)

近接許容の根拠: AI が抜粋する行番号はコメント行や空行の扱いでしばしば ±数行ズレる。厳密一致だけでは漏れが大きい。±10 行は代表的な関数定義の範囲内に収まる粒度として採用。

### 5.2 filePath 正規化

`additional.filePath` が指定されているとき、保存前に以下を適用:
- `path.posix.normalize` で `./` や `//` を除去
- 先頭の `./` を剥ぐ (`./src/a.ts` → `src/a.ts`)
- 先頭が `/` の絶対パスなら警告ログを出しつつ保存はそのまま通す (将来の防御的措置)

正規化は重複ガードの比較にも使う (比較前に正規化、保存値も正規化後)。

### 5.3 sourceAgentId 配線

`ProposalExtensions.sourceAgentId` は型定義として存在する (02-domain-model.md) が、Phase 5a 時点で `create_node` ツールが一切セットしていない。Phase 5b で find-related-code 由来 / analyze-impact 由来の coderef が混在するため、今配線する。

**`tools/index.ts` の `buildTallyMcpServer`:**

```typescript
import type { AgentName } from '@tally/core';

export function buildTallyMcpServer(deps: {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  agentName: AgentName; // 追加
}) {
  // create-node ハンドラにそのまま渡す
  ...
}
```

**`tools/create-node.ts`:**

```typescript
export interface CreateNodeDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  agentName: AgentName; // 追加
}

// handler 内
const created = await deps.store.addNode({
  ...(additional ?? {}),
  type: 'proposal',
  x: placedX,
  y: placedY,
  title: ensuredTitle,
  body,
  adoptAs,
  sourceAgentId: deps.agentName, // 追加: エージェント名を刻印
} as Parameters<typeof deps.store.addNode>[0]);
```

**`agent-runner.ts` 配線:**

```typescript
const mcp = buildTallyMcpServer({
  store,
  emit: (e) => sideEvents.push(e),
  anchor: { x: anchor.x, y: anchor.y },
  agentName: req.agent, // 追加
});
```

### 後方互換

`ProposalNodeSchema` は `.passthrough()`、`sourceAgentId` は optional。既存 YAML (Phase 5a までに生成されたもの) は `sourceAgentId` なしでそのまま読み込める。

### UI 反映 (スコープ外)

sourceAgentId に基づくバッジ / フィルタは Phase 5b では実装しない。Phase 6 以降で検討。

---

## 6. frontend: UI 共通抽象化 + 新規ボタン

### 6.1 `CodebaseAgentButton` 共通抽出

現状 `find-related-code-button.tsx` が単体で codebasePath 検証 + runningAgent 排他 + スタイルを抱えている。Phase 5b で analyze-impact が加わるため、ロジックを共通化:

**新規**: `packages/frontend/src/components/ai-actions/codebase-agent-button.tsx`

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

// codebasePath が必要な AI エージェント用の共通ボタン。
// 未設定 / 他エージェント実行中は disabled にする。
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
      style={{ ...BUTTON_STYLE, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}
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

### 6.2 `FindRelatedCodeButton` を thin wrapper に書き換え

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

### 6.3 `AnalyzeImpactButton` 新規 (UX 誘導つき)

codex 指摘: analyze-impact を find-related-code 前に呼ぶと coderef が重複しがち。UI で順序を強制するのは硬直的なので、**非ブロッキングの警告 tooltip** で誘導する。

`packages/frontend/src/components/ai-actions/analyze-impact-button.tsx`:

```tsx
'use client';

import { useCanvasStore } from '@/lib/store';
import { type AnchorNode, CodebaseAgentButton } from './codebase-agent-button';

export function AnalyzeImpactButton({ node }: { node: AnchorNode }) {
  const start = useCanvasStore((s) => s.startAnalyzeImpact);
  // anchor に derive エッジで紐づく coderef が 1 件以上あるか
  const hasLinkedCoderef = useCanvasStore((s) => {
    const derived = s.edges
      .filter((e) => e.from === node.id && e.type === 'derive')
      .map((e) => s.nodes.find((n) => n.id === e.to))
      .filter((n): n is Node => !!n);
    return derived.some((n) => n.type === 'coderef' || (n.type === 'proposal' && n.adoptAs === 'coderef'));
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

**ボタン自体は disabled にしない**。hasLinkedCoderef=false でも押せる。tooltip で誘導するのみ。「あえて analyze-impact から使いたい」ケースをブロックしないため。

`CodebaseAgentButton` 側に `warningHint?: string` のようなスタイル変化を入れるかは Phase 5b では見送り (tooltip だけで十分)。将来必要なら拡張ポイントとして残す。

### 6.4 3 detail への配置

`usecase-detail.tsx` / `requirement-detail.tsx` / `userstory-detail.tsx` の AI アクション節に 2 ボタンを縦並べ:

```tsx
<div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
  <FindRelatedCodeButton node={node} />
  <AnalyzeImpactButton node={node} />
  {/* UC のみ: 既存「ストーリー分解」ボタン */}
</div>
```

---

## 7. frontend: zustand `startAnalyzeImpact`

既存 `runAgentWS(agent, nodeId)` ヘルパが共通化済み (Phase 5a で整備)。1 行追加:

```typescript
// store.ts
interface CanvasStore {
  ...
  startAnalyzeImpact: (nodeId: string) => Promise<void>;  // 追加
}

// 実装
startAnalyzeImpact: (nodeId) => runAgentWS('analyze-impact', nodeId),
```

`runningAgent.agent` の union 型は `AgentName` のため自動で拡張される。

---

## 8. エラー経路

`validateCodebaseAnchor` 由来:

| 条件 | code | message |
|---|---|---|
| nodeId 不在 | `not_found` | `ノードが存在しない: <id>` |
| 対象 type が UC/req/story 以外 | `bad_request` | `analyze-impact の対象外: <type>` |
| codebasePath 未設定 | `bad_request` | `プロジェクト設定で codebasePath を指定してください` |
| codebasePath がディレクトリでない | `bad_request` | `codebasePath がディレクトリではない: <abs>` |
| codebasePath 解決先が無い | `not_found` | `codebasePath 解決失敗: <abs>` |

`runAgent` 由来:

| 条件 | code | message |
|---|---|---|
| input schema 不正 | `bad_request` | (zod エラーメッセージ) |
| 認証失敗 | `not_authenticated` | (SDK 例外由来) |
| SDK 例外 | `agent_failed` | (例外文字列) |

UI 側: 既存 AgentProgressPanel の `❌ code: message` で十分 (追加実装なし)。

---

## 9. テスト計画

### CI 自動テスト

**ai-engine**

- `agents/codebase-anchor.test.ts` (新規):
  - 不在 nodeId → `not_found`
  - 対象外 type → `bad_request`
  - codebasePath 未設定 → `bad_request`
  - codebasePath がファイル → `bad_request`
  - codebasePath 不存在 → `not_found`
  - 成功 → `{ ok: true, anchor, cwd }`
- `agents/analyze-impact.test.ts` (新規):
  - `buildAnalyzeImpactPrompt` containment テスト (coderef / issue 両規約 / 「影響:」キーワード / 手順 5 項目)
  - `analyzeImpactAgent.allowedTools` が `[Read, Glob, Grep, mcp__tally__{4 tools}]` 相当であること
  - `inputSchema` が nodeId 必須
  - `validateInput` が共通ヘルパ経由で各ケースを返すこと (代表 3-4 ケースで網羅)
- `agents/find-related-code.test.ts` (既存): 共通ヘルパ経由に移行後も全ケース通ること (回帰)
- `agent-runner.test.ts`:
  - `analyze-impact` の start → validate → sdk.query 呼び出し形状 (`options.tools` / `options.allowedTools` / `permissionMode: 'dontAsk'` / `cwd`)
  - sideEvents 経由で coderef + issue の `node_created` が混在して flush されるシナリオ
- `tools/create-node.test.ts`:
  - `sourceAgentId` が作成ノードに含まれること (agentName='analyze-impact' で呼ぶケース)
  - agentName='find-related-code' で呼ぶケース (回帰)
  - coderef 重複ガード: 同 filePath + 同 startLine で既存あり → `{ok:false, output: 重複: ...}` 、新規ノード追加なし
  - coderef 重複ガード: 同 filePath + startLine 差 ±10 以内 → 重複扱い
  - coderef 重複ガード: 同 filePath + startLine 差 11 以上 → 新規作成許可
  - coderef 重複ガード: filePath 違い → 新規作成許可
  - coderef 重複ガード: `adoptAs !== 'coderef'` では発動しない (issue や userstory は重複判定対象外)
  - filePath 正規化: `./src/a.ts` → `src/a.ts` として保存、比較にも正規化後を使用
- `tools/tools-index.test.ts`: `buildTallyMcpServer` が agentName を受け取る呼び出し形状

**core**

- `AGENT_NAMES` に `'analyze-impact'` 追加 (コンパイル時検証のみ、個別テスト不要)

**frontend**

- `components/ai-actions/codebase-agent-button.test.tsx` (新規 / find-related-code-button.test の論理継承):
  - codebasePath 未設定で disabled
  - 他エージェント実行中で disabled
  - click で onRun が呼ばれる
- `components/ai-actions/find-related-code-button.test.tsx` (書き換え): click で `startFindRelatedCode` が呼ばれる薄い配線テスト
- `components/ai-actions/analyze-impact-button.test.tsx` (新規):
  - click で `startAnalyzeImpact` が呼ばれる薄い配線テスト
  - anchor に紐づく coderef が 0 件の状態で tooltip に「まず『関連コードを探す』...」が出る
  - anchor に紐づく coderef が 1 件以上の状態で tooltip が通常文言になる
- `lib/store.test.ts`: `startAnalyzeImpact` の AgentEvent 列流入で nodes/edges が拡張され runningAgent がクリアされるテスト (coderef + issue + 2 本の derive エッジ を含むイベント列)
- `components/details/usecase-detail.test.tsx` (既存): AnalyzeImpactButton が存在することを assert 追加。
  `requirement-detail.test.tsx` / `userstory-detail.test.tsx` は現状未整備のため、Phase 5b では新規作成せずボタン配線の回帰は存在する AnalyzeImpactButton / FindRelatedCodeButton 側の配線テストでカバーする (将来 detail 一式にテストを整備する際に同じパターンで追加)

**storage**

- 変更なし (既存 saveProjectMeta / ProposalNode passthrough で sourceAgentId は透過)

### 手動 E2E (`docs/phase-5b-manual-e2e.md`)

Phase 5a 同様 agent-browser 経由で自動化可能。

1. 前準備: `examples/taskflow-backend/` を Phase 5a と共用。ブラウザで sample-project を開き、codebasePath が設定済みであることを確認
2. UC `uc-send-invite` を選択 → **先に**「関連コードを探す」を実行し、coderef proposal が 2-3 件生成された状態にする
3. 同 UC で「影響を分析する」ボタンを押す
4. AgentProgressPanel に以下が流れる:
   - `thinking`
   - `tool_use(mcp__tally__find_related)` で対象ノードの接続済みノードを取得 (既存 coderef の有無確認)
   - `tool_use(mcp__tally__list_by_type)` で issue / coderef 全体の重複確認
   - `tool_use(Glob / Grep / Read)` でコード探索
   - `node_created` (coderef proposal × 0-5, issue proposal × 0-5)
   - `edge_created` (anchor → proposal の derive × N)
   - `result` で 3-4 行要約
5. Canvas に新規 coderef (既存 filePath と重複しないもの) + issue proposal が破線で表示され、anchor から derive エッジで接続される
6. coderef proposal の body 冒頭に「影響: 〜」が含まれる
7. 各 proposal の YAML (`.tally/nodes/*.yaml`) に `sourceAgentId: analyze-impact` が刻まれている
8. issue proposal を 1 件採用 → 黄色の issue ノードに昇格
9. **境界テスト**: 影響の薄いノード (孤立した requirement) に analyze-impact → 0 件で正常終了、result 要約に「特に影響なし」相当のメッセージ

---

## 10. 実装スケジュール (サブフェーズ)

| サブ | タスク内容 | 予想タスク数 |
|---|---|---:|
| 5b-A | core: `AGENT_NAMES` に `'analyze-impact'` 追加 + `CodeRefNodeSchema` に `summary` / `impact` 追加 + 02-domain-model.md 更新 | 1 |
| 5b-B | ai-engine: 共通ヘルパ `validateCodebaseAnchor` 抽出 + find-related-code 移行 + 回帰テスト通過 | 1 |
| 5b-C | ai-engine: `analyze-impact.ts` (prompt + registry entry) + ユニットテスト | 2 |
| 5b-D | ai-engine: registry 登録 + agent-runner happy-path テスト追加 | 1 |
| 5b-E1 | ai-engine: `create_node` に coderef 重複ガード + filePath 正規化 + 重複ガード/正規化のユニットテスト | 2 |
| 5b-E2 | ai-engine: `create_node` に `sourceAgentId` 注入 (tools 配線 + agent-runner 配線 + 既存テスト更新) | 1 |
| 5b-F | frontend: `CodebaseAgentButton` 抽出 + `FindRelatedCodeButton` thin wrapper 化 + テスト整理 | 1 |
| 5b-G | frontend: `AnalyzeImpactButton` 新規 (UX 誘導 tooltip つき) + 3 detail に配置 + 配線テスト | 1 |
| 5b-H | frontend: store `startAnalyzeImpact` 追加 + store.test 拡張 | 1 |
| 5b-I | docs: `phase-5b-manual-e2e.md` 新規 + roadmap Phase 5 の Phase 5b 項目更新 | 1 |
| 5b-J | 全体テスト通過 (typecheck / biome / `pnpm -r test`) + Memory 更新 | 1 |

**合計 13 タスク**。Phase 5a (16 タスク) より小ぶり。共通ヘルパ抽出と UI 抽象化の恩恵で新規コードは絞り込まれる。codex レビューの反映 (5b-E1 の重複ガード + filePath 正規化) で 1 タスク増えた。

---

## 11. 非目標 (Phase 5b 範囲外)

- **coderef 起点の逆方向影響分析** (「この関数を変えたら何に影響するか」) → 将来検討
- **sourceAgentId を UI に表示** (バッジ / フィルタ) → Phase 6 以降
- **採用後の正規ノードで sourceAgentId を保持** (ADR-0005 改訂が必要) → 別 ADR で検討
- **CodeRef の `summary` / `impact` を UI で別レイアウト表示** → Phase 6 以降 (現状は body 一本に両者を記載、additional は予備)
- **issue proposal 固有の UI 最適化** (既存の汎用 proposal UI を流用)
- **Phase 5c (extract-questions) / Phase 5d (ingest-document)** → 別 spec
- **影響分析のキャンセルボタン** → Phase 5 共通の未実装項目、別対応
- **find-related-code と analyze-impact のアイコン化** → 将来
- **既存 coderef の body を analyze-impact 結果で更新** (AI による追記) → 新規 coderef 生成 + issue 経由参照でカバー
- **issue proposal のサーバ側重複ガード** (タイトル厳密一致など) → プロンプト指示で運用、問題化したら後続 Phase で検討

---

## 12. リスクと対策

| リスク | 対策 |
|---|---|
| AI が既存 coderef を重複作成する (プロンプト指示を無視) | 2 重防御: (1) プロンプトで重複禁止を明示 (2) `create_node` 側で filePath + startLine 近接 (±10 行) のサーバ側ガード (節 5.1) |
| filePath の表記ゆれ (`./src/a.ts` vs `src/a.ts`) で重複ガードがすり抜ける | filePath 正規化を create_node で強制 (節 5.2)。保存値も比較値も正規化後 |
| 同じ内容の issue (「テスト未整備」等) が複数回生える | プロンプトで「anchor + title 単位で重複禁止」を明示 (節 4)。サーバ側ガードは入れない (issue は短いタイトルが多く厳密一致判定が弱いため、プロンプトで十分) |
| coderef と issue の生成比率が偏る / analyze-impact の主役が不明瞭になる | プロンプトで「issue が主役、coderef は副次的」「それぞれ 0〜5 件」と明示 (節 1 / 節 4) |
| analyze-impact を find-related-code 実行前に呼ぶと同じコードを coderef として再生成しがち | (1) AnalyzeImpactButton tooltip で誘導 (節 6.3) (2) サーバ側重複ガードで再生成そのものをブロック (節 5.1) |
| `sourceAgentId` / CodeRef 新フィールド (`summary` / `impact`) 追加で既存 YAML 読み込みが壊れる | すべて optional。ProposalNodeSchema は `.passthrough()`。回帰テストで既存サンプルプロジェクト (`examples/sample-project/`, `examples/taskflow-backend/`) が読み込めることを確認 |
| 採用後の正規ノードで sourceAgentId が失われる (ADR-0005 の仕様) | 本 Phase ではスコープ外 (UI 活用しないため)。将来「採用後も由来表示」したくなれば別 ADR で transmuteNode の挙動変更を検討 |
| 大規模 codebase で analyze-impact が長時間走る | Phase 5a と同じく制御しない (MVP)。将来 registry に timeout / max_turns を追加 |
| Phase 5a で検出された「allowedTools 単独では whitelist にならない」問題が analyze-impact でも再発 | ADR-0007 の運用ルールは registry 駆動で自動適用済み (agent-runner)。新規エージェントに追加コード不要 |

---

## 13. 参考

- `docs/04-roadmap.md` Phase 5
- `docs/superpowers/specs/2026-04-19-phase5a-find-related-code-design.md` (直系の設計前例)
- `docs/adr/0002-agent-sdk-adoption.md` (Agent SDK 採用)
- `docs/adr/0005-proposal-adoption.md` (proposal → 正規ノード採用、additional 継承)
- `docs/adr/0007-agent-tool-restriction.md` (tools + permissionMode + settingSources の運用)
- `docs/02-domain-model.md` (coderef / issue / proposal の意味論)
- `docs/phase-5a-manual-e2e.md` (E2E 手順書の体裁)
