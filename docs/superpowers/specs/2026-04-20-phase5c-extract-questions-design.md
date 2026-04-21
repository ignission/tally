# Phase 5c: extract-questions エージェント — 設計書

- 日付: 2026-04-20
- ステータス: Accepted (brainstorming で合意)
- 関連: `docs/04-roadmap.md` Phase 5 / ADR-0002 / ADR-0005 / ADR-0006 / ADR-0007 / `docs/superpowers/specs/2026-04-19-phase5b-analyze-impact-design.md`

## 目的

Phase 5a (find-related-code) / 5b (analyze-impact) で既存コードとの関係・変更影響を洗い出せるようになった。Phase 5c では「キャンバスの未確定部分」を AI に指摘させる。対象ノード (要求 / UC / ストーリー) を眺めて、**まだ決めていない設計判断**を `question` proposal として抽出する。

キャンバスの目的は「決定した事と未決定の事の区別が一目で分かる」こと (CLAUDE.md 原則 1)。extract-questions はその未決定側を AI が提示することで、ユーザーが「そもそも何が決まっていないか」に気づけるようにする。

Phase 5c 完了時点で、ドッグフーディング中に AI が「これ決まってないですよ」と横から突いてくれる状態になる。残りの `ingest-document` (要求書取り込み) は Phase 5d で別 spec。

## 全体構成

```
Phase 5c スコープ (1 spec / 1 plan)
├── core:
│   └── AgentName union に 'extract-questions' 追加 (schema 変更なし)
├── ai-engine:
│   ├── 共通ヘルパ validateCodebaseAnchor に requireCodebasePath オプション追加
│   │   (find-related-code / analyze-impact 側は true を明示、extract-questions は false)
│   ├── extract-questions エージェント新規 (prompt + registry 登録)
│   └── create_node ツール補強 (2 点):
│       ├── adoptAs='question' + additional.options の ID/selected 補完 (decision=null 固定)
│       └── adoptAs='question' の anchor+同タイトル重複ガード (anchorId を deps に追加)
├── frontend:
│   ├── GraphAgentButton 共通抽出 (CodebaseAgentButton の codebasePath 不要版)
│   ├── ExtractQuestionsButton 新規 (thin wrapper)
│   ├── store に startExtractQuestions 追加
│   └── 3 detail (usecase / requirement / userstory) に配置
└── docs:
    ├── phase-5c-manual-e2e.md 新規
    ├── phase-5c-progress.md 新規 (別 PC 引き継ぎ用の memory 代替)
    ├── 02-domain-model.md: question 節に「extract-questions 由来の proposal」1 行追記
    └── 04-roadmap.md: Phase 5c 完了マーク
```

---

## 1. 既存エージェントとの棲み分け

| agent | 主役 proposal | 探索ソース | codebasePath | 位置づけ |
|---|---|---|---|---|
| decompose-to-stories (4) | userstory | グラフ (anchor + 近傍) | 不要 | UC を実装単位に刻む |
| find-related-code (5a) | coderef | **コード (G/G/R)** | 必須 | 関連既存コードを列挙 |
| analyze-impact (5b) | issue (+coderef 副) | **コード (G/G/R)** | 必須 | 変更の意味付け・リスク洗い出し |
| **extract-questions (5c)** | **question** | **グラフ (anchor + 近傍)** | **不要** | **未決定の設計判断を表面化** |

extract-questions は「グラフ文脈のみ・codebasePath 不要」で decompose-to-stories と同じ陣営。コードは読まない。

**棲み分け要点**:
- `analyze-impact` は「コードを読んでリスク・懸念を `issue` として出す」(既存コードベース前提の分析)
- `extract-questions` は「ノードの記述だけ見て未決定判断を `question` として出す」(設計段階の論点出し)
- 同じノードに両方走らせれば「実装時のリスク (issue)」と「そもそも決まっていない判断 (question)」が別種の proposal として並ぶ。UX の誤認防止は adoptAs と proposal の色でカバー済み (現行 UI)

将来 UI で sourceAgentId に基づくバッジ/フィルタを入れる余地は残す (Phase 5c スコープ外)。

---

## 2. core: AgentName 拡張のみ

### 2.1 AgentName

`packages/core/src/types.ts`:

```typescript
export const AGENT_NAMES = [
  'decompose-to-stories',
  'find-related-code',
  'analyze-impact',
  'extract-questions',
] as const;
```

`AGENT_REGISTRY` 側 `satisfies Record<AgentName, AgentDefinition>` で未登録検知 (5a 以降の保証機構を継続)。

### 2.2 スキーマは変更なし

- `QuestionNodeSchema` は既存の `options?: QuestionOption[]` / `decision?: string | null` で十分 (5b の CodeRefNodeSchema 拡張のような追加は不要)
- `ProposalNodeSchema` は `.passthrough()` なので AI が生成する `options` / `decision` を additional としてそのまま保持可能
- `transmuteNode` は `NodeSchema.parse(merged)` で検証するため、proposal.options がそのまま QuestionNode.options に移る。ここも**変更なし**

### 2.3 02-domain-model.md への追記

`question` 節末尾に 1 行:

> `extract-questions` エージェント (Phase 5c) が proposal として生成する。proposal 時点で `options` 候補 (2〜4 個) を含み、`decision` は null。人間が採用後に決定する。

---

## 3. ai-engine: 共通ヘルパと新 agent

### 3.1 validateCodebaseAnchor の一般化

`packages/ai-engine/src/agents/codebase-anchor.ts`:

```typescript
export interface ValidateCodebaseAnchorOptions {
  requireCodebasePath?: boolean; // default: true
}

export async function validateCodebaseAnchor(
  deps: { store: ProjectStore; workspaceRoot: string },
  nodeId: string,
  allowedTypes: readonly NodeType[],
  agentLabel: string,
  options: ValidateCodebaseAnchorOptions = {},
): Promise<ValidationResult> {
  const requireCodebasePath = options.requireCodebasePath ?? true;
  // ... anchor 型チェック ...
  if (requireCodebasePath) {
    // ... codebasePath 必須チェック ...
  }
  // ...
}
```

**命名**: 関数名は `validateCodebaseAnchor` のまま。2 callsite (find-related-code / analyze-impact) は option を省略 (デフォルト true 維持) で挙動互換。extract-questions だけ `{ requireCodebasePath: false }` を明示。

**リネームしない理由**:
- 互換性を崩さない
- 「codebase anchor」= anchor node として codebase エージェントの対象になり得る、という広義の意味で通る
- リネームすると既存 2 callsite + テスト + import の diff が増えて本題が埋もれる

### 3.2 extract-questions.ts 新規

`packages/ai-engine/src/agents/extract-questions.ts`:

```typescript
import type { Node } from '@tally/core';
import { z } from 'zod';

import { validateCodebaseAnchor } from './codebase-anchor';
import type { AgentDefinition } from './registry';

export interface ExtractQuestionsPromptInput {
  anchor: Node;
}

export function buildExtractQuestionsPrompt(input: ExtractQuestionsPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  // § 3.3 参照
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

`allowedTools` に `Glob` / `Grep` / `Read` は**含めない**。ADR-0007 に従い `agent-runner` が built-in ツール (`Bash` / `Read` / `Glob` / `Grep` / `Edit` / `Write` 等) を自動遮断する。

registry 登録: `analyze-impact` の直後に追加。

### 3.3 プロンプト設計

**system prompt の骨子**:

```
あなたは Tally の論点抽出アシスタントです。
対象ノード (usecase / requirement / userstory) を眺めて、
「この要求を実装するにあたって、まだ決まっていない設計判断」を question proposal として洗い出します。

あなたの主役は question proposal (未決定の判断の表面化) です。
実装詳細・既存コードへの影響ではなく、「そもそも決まっていない判断」にフォーカスしてください。
(実装影響は analyze-impact、関連コード列挙は find-related-code が別途担当)

手順:
1. mcp__tally__find_related(nodeId=対象ノード) で anchor に繋がる近傍ノードを取得する。
   既存 question の title を確認し、同じ論点は再作成しない。
2. mcp__tally__list_by_type('question') で他 anchor に紐づく既存を確認し、
   同一 anchor+同タイトルの question は作らない。
3. anchor の title / body と近傍ノードの記述から、「まだ決めていない判断」を 0〜5 件抽出する。
   例: スコープの切り方、処理タイミング、データ保存方針、認証方式、
   エラー時の振る舞い、競合時の挙動、既定値、権限境界、API 粒度、など。
4. 各 question には必ず 2〜4 個の options 候補を添える。
   options は互いに排他的で、それぞれが 1 行で意味が分かる簡潔な表現にする。

出力規約:
- create_node で type="proposal", adoptAs="question"
  タイトル: "[AI] <短く具体的な問い>" (疑問形または "〜を〜にするか" の形)
  body: 問いの背景 / 決めるべき理由 / 検討の観点 (2〜4 行)
  additional: { options: [{ text: "..." }, ...], decision: null }
    options の id / selected はサーバ側で補完される (AI が指定する必要なし)
- エッジ: create_edge(type="derive", from=<anchor>, to=<新 question>)

個数目安:
- question proposal: 0〜5 件
- 論点が見えなければ 0 件でも可。無理に作らないこと。
- 最後に「何を見て、何が未決定と判断したか」を 3〜4 行で日本語で要約する。

ツール使用方針: mcp__tally__* のみ使用。コード探索 (Glob/Grep/Read) は使わない
(そもそもこのエージェントには付与されていない)。
```

**user prompt**:
```
対象ノード: <id>
type: <type>
タイトル: <title>
本文:
<body>

上記ノードを実装するうえで、まだ決めていない設計判断を抽出し、
question proposal として記録してください。
```

### 3.4 create_node ツール補強

`packages/ai-engine/src/tools/create-node.ts`:

**1. adoptAs='question' 時の options 補完**:

```typescript
if (adoptAs === 'question' && additional) {
  const rawOptions = additional.options;
  if (Array.isArray(rawOptions)) {
    normalizedAdditional = {
      ...additional,
      options: rawOptions.map((opt) => {
        const text =
          typeof opt === 'object' && opt !== null && 'text' in opt
            ? String((opt as { text: unknown }).text ?? '')
            : String(opt ?? '');
        return { id: newQuestionOptionId(), text, selected: false };
      }),
      decision: null,
    };
  } else {
    normalizedAdditional = { ...additional, options: [], decision: null };
  }
}
```

`newQuestionOptionId()` は `packages/core/src/id.ts` に既存パターン (`newEdgeId` と同じ `generateSuffix()` ベース) で `opt-<nanoid10>` 形式を追加。

**2. adoptAs='question' の anchor+同タイトル重複ガード**:

`createNodeHandler` の `deps` に `anchorId: string` を追加:

```typescript
export interface CreateNodeDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  anchorId: string; // NEW: 重複ガード用
  agentName: AgentName;
}
```

呼び出し元 (`mcp-server` 側、agent-runner 経由) で anchor node の id を渡す。

重複判定:

```typescript
if (adoptAs === 'question') {
  const neighbors = await deps.store.findRelatedNodes(deps.anchorId);
  const normalizedTitle = stripAiPrefix(title); // "[AI] " を剥ぐ
  const dup = neighbors.find((n) => {
    const isQuestion =
      n.type === 'question' ||
      (n.type === 'proposal' && (n as ProposalNode).adoptAs === 'question');
    return isQuestion && stripAiPrefix(n.title) === normalizedTitle;
  });
  if (dup) {
    return {
      ok: false,
      output: `重複: anchor ${deps.anchorId} に既に同タイトル question 候補 ${dup.id} が存在`,
    };
  }
}
```

`stripAiPrefix` は `@tally/core` の既存ヘルパ (`packages/core/src/logic/prefix.ts`) を import して再利用。

**同 PR での対応範囲**:
- analyze-impact の issue 重複ガード (現状プロンプト任せ) は**別 PR**。extract-questions で成立したパターンを後から適用する follow-up として `docs/phase-5c-progress.md` に記載。

### 3.5 mcp-server / agent-runner からの anchorId 配線

既に 5b で `agentName` を配線済み。同じルートに `anchorId` を追加するだけ。
- `buildTallyMcpServer({ store, emit, anchor, anchorId, agentName })` に anchorId パラメータ追加
- `agent-runner` で validate 時に取った `anchor` ノードの `id` を渡す

---

## 4. frontend

### 4.1 GraphAgentButton 共通抽出

`packages/frontend/src/components/ai-actions/graph-agent-button.tsx` (新規):

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

// codebasePath を要求しないエージェント用の共通ボタン。
// disabled は他エージェント実行中 (busy) のみで判定。
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

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onRun(node.id).catch(console.error);
      }}
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

`CodebaseAgentButton` と似ているが、codebasePath 依存の分岐がない分シンプル。重複ではなく「異なる前提のための別コンポーネント」として並列に保つ。将来的に統合が必要になれば別 PR で検討。

### 4.2 ExtractQuestionsButton 新規 (thin wrapper)

`packages/frontend/src/components/ai-actions/extract-questions-button.tsx` (新規):

```typescript
'use client';

import { type AnchorNode, GraphAgentButton } from './graph-agent-button';
import { useCanvasStore } from '@/lib/store';

export function ExtractQuestionsButton({ node }: { node: AnchorNode }) {
  const startExtractQuestions = useCanvasStore((s) => s.startExtractQuestions);
  return (
    <GraphAgentButton
      node={node}
      agentName="extract-questions"
      label="論点を抽出"
      busyLabel="抽出中…"
      tooltip="未決定の設計判断を質問として洗い出す"
      onRun={startExtractQuestions}
    />
  );
}
```

### 4.3 store: startExtractQuestions 追加

既存の `startAnalyzeImpact` と同パターン:

```typescript
startExtractQuestions: async (nodeId: string) => {
  await runAgent({ agent: 'extract-questions', nodeId }, set, get);
},
```

内部の `runAgent` ヘルパが WebSocket 送信・ストリーム受信・楽観的更新 (node_created / edge_created) を担当する (既存実装)。

### 4.4 3 detail への配置

- `packages/frontend/src/components/details/usecase-detail.tsx`
- `packages/frontend/src/components/details/requirement-detail.tsx`
- `packages/frontend/src/components/details/userstory-detail.tsx`

各 detail の AI アクション領域に 3 ボタン横並び:

```tsx
<div style={AI_ACTIONS_STYLE}>
  <FindRelatedCodeButton node={node} />
  <AnalyzeImpactButton node={node} />
  <ExtractQuestionsButton node={node} />
</div>
```

3 ボタンの配置スタイルは既存の 2 ボタン配置 (gap: 8 の flex row) を踏襲。縦並び or 折り返しは既存 CSS で自然に吸収される想定。

---

## 5. テスト方針

### 5.1 ユニットテスト

| package | 追加テスト | 目安 |
|---|---|---|
| `@tally/core` | AGENT_NAMES に 'extract-questions' 含む | +1 |
| `@tally/ai-engine` | validateCodebaseAnchor の requireCodebasePath=false 経路 | +2 |
| `@tally/ai-engine` | buildExtractQuestionsPrompt: 重要語彙 (論点 / 未決定 / options) を含む | +2 |
| `@tally/ai-engine` | extractQuestionsAgent: inputSchema / allowedTools に Glob 等非含有 | +2 |
| `@tally/ai-engine` | registry に extract-questions 登録確認 | +1 |
| `@tally/ai-engine` | agent-runner happy-path (mock SDK) | +1 |
| `@tally/ai-engine` | create_node: adoptAs='question' で options に id/selected 補完 | +2 |
| `@tally/ai-engine` | create_node: adoptAs='question' で anchor+同タイトル重複 reject | +2 |
| `@tally/frontend` | GraphAgentButton 単体 (busy / disabled / click) | +3 |
| `@tally/frontend` | ExtractQuestionsButton thin wrapper (onRun 呼び出し) | +2 |
| `@tally/frontend` | store.startExtractQuestions: WS 送信 payload | +1 |
| `@tally/frontend` | 3 detail に ExtractQuestionsButton が配置されている | +3 |

合計 **+22 本目安** → 232 → 254 テスト。

### 5.2 手動 E2E

`docs/phase-5c-manual-e2e.md` 新規。Phase 5b と同形式:

1. 準備: `claude login` + サンプルプロジェクト (examples/taskflow-backend)、**codebasePath 未設定でも動くこと**を示すため codebasePath をクリアした状態で開始
2. 要求ノードで「論点を抽出」ボタン押下 → question proposal が 0〜5 個生成される
3. 各 proposal の詳細で `options: [{text}]` が 2〜4 個 (ID 付きで表示) + decision=null (未決定バッジ)
4. 「採用する」→ question ノードに昇格、options が引き継がれている
5. 採用後の詳細で option を 1 つ選択 → 実線 + 「決定」バッジ
6. 決定を取り消し → 破線に戻る (既存動作の回帰なし)

### 5.3 ロードマップ更新

`docs/04-roadmap.md` Phase 5 節:
- `- [x] extract-questions.ts` にチェック
- 完了条件「論点ノードが選択肢候補付きで正しく生成される」のチェック根拠として本 spec + 手動 E2E 手順書を参照

### 5.4 進捗ドキュメント

`docs/phase-5c-progress.md` を Phase 5b と同形式で新設 (別 PC 引き継ぎ memory 代替)。
- 全体状況表 (Phase 0-5b 完了、5c 着手中)
- Phase 5c タスク進捗表 (後続の writing-plans で確定)
- HEAD 情報 / テスト本数 / follow-up / 実装ルール / 復元手順

---

## 6. follow-up (Phase 5c 完了後に別 PR で対応)

### 実装 / UX
- **analyze-impact の issue 重複ガード**: 現状プロンプト任せ。extract-questions で `anchor+同タイトル` 重複ガードを `create_node` に入れたら、同じパターンを issue にも適用する follow-up PR。anchor ごとに同タイトル issue が複数作られる実害が出たタイミングで着手
- **questionNodeSchema の options 厳密化**: 現状 `options?: z.array(QuestionOptionSchema).optional()` で空配列も許可。extract-questions 経由では必ず 2〜4 個あるはずなので、schema 側で `min(2).max(8)` など制約を検討。ただし UI 側で 0 options から編集開始するケースもあるので、schema 変更は別論点として残す

### UI 統合
- **CodebaseAgentButton と GraphAgentButton の統合**: 差分は codebasePath 分岐のみ。将来さらにエージェントが増えたら `requireCodebasePath` prop で 1 コンポーネント化を検討。現時点では並列維持

### 将来拡張
- **question の sourceAgentId 保持**: 現状 transmuteNode 時に proposal → 正規 question で sourceAgentId が落ちる。provenance を UI で表示したくなったら ADR-0005 改訂 (これは 5b と同じ未決定論点)

---

## 7. 非目標 (Phase 5c スコープ外)

- `ingest-document` エージェント (Phase 5d)
- 既存の question ノードから自動で options を再生成する機能 (別エージェント)
- question proposal の options を UI で編集する機能 (proposal 段階で options を触る UX は現状未定義)
- AI 生成結果の品質評価・フィードバックループ
- sourceAgentId に基づく UI バッジ / フィルタ (5a/5b から一貫して将来課題)

---

## 8. 受入条件 (plan で task に落とし込む時の合格ライン)

1. `pnpm -r test` が全緑 (目安 254 本)
2. `pnpm -r typecheck` が緑
3. `examples/taskflow-backend/.tally` で、codebasePath 未設定のまま UC から「論点を抽出」ボタン押下 → question proposal が 1 件以上生成され options が 2〜4 個付く (手動 E2E 手順書どおり)
4. 採用後に option を選択 → 決定バッジが出る、取り消し可能 (既存動作の回帰なし)
5. 他エージェント実行中に「論点を抽出」が disabled になる (排他制御が他と一致)
6. `docs/phase-5c-progress.md` が Task 完了時点の commit / テスト本数と一致
7. ADR-0007 の制約に沿って Glob/Grep/Read/Bash/Edit/Write が実行されない (allowedTools に含まれない + tools=[] + permissionMode='dontAsk' が agent-runner 経由で適用される)

---

## 9. オープン論点 (plan 着手前に確認したい)

なし。brainstorming で以下を合意済み:
- 探索ソース: anchor グラフ文脈のみ (コード読まない)
- anchor 3 型: usecase / requirement / userstory
- options 生成: 必ず 2〜4 個、decision=null 固定
- 重複ガード: プロンプト指示 + サーバ側 anchor+同タイトル
- エッジ: derive
- 個数目安: 0〜5 件
- アプローチ: A (analyze-impact 踏襲型)

疑義が生じたら本 spec を更新してから plan に戻る。
