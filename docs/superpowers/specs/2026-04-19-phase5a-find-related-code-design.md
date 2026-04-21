# Phase 5a: find-related-code エージェント — 設計書

- 日付: 2026-04-19
- ステータス: Accepted (brainstorming で合意)
- 関連: `docs/04-roadmap.md` Phase 5 / ADR-0002 / ADR-0005 / ADR-0006

## 目的

Tally の核心価値である「既存コードを読みながら要件を組み立てる」を最初に動く形で届ける。Phase 5 (ロードマップ全体) から以下を先行実装:

- `find-related-code` エージェント (UC / requirement / userstory → coderef proposal)
- `codebasePath` 編集 UI (ヘッダ歯車ボタン)
- 読み取り専用モード (エージェントごとに `allowedTools` を切り替える基盤)

残りの `analyze-impact` / `extract-questions` / `ingest-document` は Phase 5b-d で別 spec として実装する。

## 全体構成

```
Phase 5a スコープ (1 spec / 1 plan)
├── ai-engine: agent registry 化 + find-related-code エージェント追加
├── core: AgentName union 型追加
├── frontend: 歯車ボタン + project-settings-dialog + 関連コード探索ボタン (3 detail 共通)
└── storage: 既存 saveProjectMeta で間に合う想定 (部分更新は不要)
```

---

## 1. エージェント registry と agent-runner 拡張

### 現状

`packages/ai-engine/src/agent-runner.ts` は `agent: 'decompose-to-stories'` のみハードコード。

### 変更

`packages/ai-engine/src/agents/registry.ts` を新規作成:

```typescript
import type { Node } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

export interface AgentDefinition<Input = unknown> {
  name: string;
  validateInput(store: ProjectStore, input: Input): Promise<
    | { ok: true; anchor: Node; cwd?: string }
    | { ok: false; code: 'bad_request' | 'not_found'; message: string }
  >;
  buildPrompt(input: { anchor: Node; cwd?: string }): { systemPrompt: string; userPrompt: string };
  allowedTools: string[];
}

export const AGENT_REGISTRY: Record<string, AgentDefinition> = {
  'decompose-to-stories': decomposeToStoriesAgent,
  'find-related-code': findRelatedCodeAgent,
};
```

`agent-runner.ts` を registry 参照に書き換え:

```typescript
export async function* runAgent(deps: RunAgentDeps): AsyncGenerator<AgentEvent> {
  yield { type: 'start', agent: req.agent, input: req.input };
  const def = AGENT_REGISTRY[req.agent];
  if (!def) {
    yield { type: 'error', code: 'bad_request', message: `未知の agent: ${req.agent}` };
    return;
  }
  const vr = await def.validateInput(store, req.input);
  if (!vr.ok) {
    yield { type: 'error', code: vr.code, message: vr.message };
    return;
  }
  const { anchor, cwd } = vr;
  // MCP server 構築、プロンプト生成、SDK query 呼び出し (既存ロジックを継承)
}
```

`SdkLike.query` の options に `cwd?: string` を追加。

### decompose-to-stories の registry 移行

`agents/decompose-to-stories.ts` に registry エントリを追加:

```typescript
export const decomposeToStoriesAgent: AgentDefinition<{ nodeId: string }> = {
  name: 'decompose-to-stories',
  async validateInput(store, input) {
    const uc = await store.getNode(input.nodeId);
    if (!uc) return { ok: false, code: 'not_found', message: `...` };
    if (uc.type !== 'usecase') return { ok: false, code: 'bad_request', message: `...` };
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

既存の `buildDecomposePrompt` はそのまま流用。

---

## 2. find-related-code エージェント

### ファイル

`packages/ai-engine/src/agents/find-related-code.ts` を新規作成。

### 契約

入力: `{ nodeId: string }` — UC / requirement / userstory のいずれか
出力: coderef proposal × N + 元ノード → coderef の `derive` エッジ
ツール:
- `mcp__tally__create_node` / `mcp__tally__create_edge` (書き込み)
- `mcp__tally__find_related` / `mcp__tally__list_by_type` (既存 coderef の重複確認)
- SDK 組み込み: `Read` / `Glob` / `Grep` (コード探索)

`Bash` / `Edit` / `Write` は `allowedTools` に含めない (disallowedTools ではなく allowedTools ホワイトリスト運用)。

### 検証

```typescript
async validateInput(store, input) {
  const node = await store.getNode(input.nodeId);
  if (!node) return { ok: false, code: 'not_found', message: `ノードが存在しない: ${input.nodeId}` };
  if (!['usecase', 'requirement', 'userstory'].includes(node.type)) {
    return { ok: false, code: 'bad_request', message: `find-related-code の対象外: ${node.type}` };
  }
  const meta = await store.getProjectMeta();
  if (!meta?.codebasePath) {
    return { ok: false, code: 'bad_request', message: 'プロジェクト設定で codebasePath を指定してください' };
  }
  const abs = path.resolve(workspaceRoot, meta.codebasePath);
  try { await fs.access(abs); } catch {
    return { ok: false, code: 'not_found', message: `codebasePath 解決失敗: ${abs}` };
  }
  return { ok: true, anchor: node, cwd: abs };
}
```

`workspaceRoot` は ProjectStore から取れないので、agent-runner 側で store 構築時の引数として追加 (`RunAgentDeps` に `workspaceRoot` を含める、server.ts が resolveProjectById の結果から渡す)。

### プロンプト

system:

```
あなたは Tally の関連コード探索アシスタントです。
与えられたノード (UC / requirement / userstory) の意図に照らして、codebasePath 配下の既存コードから関連する実装・インタフェース・テストを発見し、coderef proposal として記録します。

ルール:
- 探索は Glob / Grep / Read ツールを使う。Edit / Write / Bash は使わない。
- 関連コードを見つけたら create_node (type='proposal', adoptAs='coderef', additional={ filePath, startLine, endLine }) で作成する。タイトルは '[AI] <filePath>:<startLine>' の形式、body にその範囲で該当コードが何をしているかの要約を書く。
- 各 coderef proposal に対して create_edge (from=<元ノード>, to=<coderef>, type='derive') を張る。
- list_by_type('coderef') で既存の coderef を確認し、同じ範囲の重複を避ける。
- 個数は対象ノードの関連性に応じて 1〜8 件を目安とし、薄い関連まで拾いすぎないこと。
- 最後に「何を探し、何を見つけたか」を 2〜3 行で要約する。
```

user: ノードの type / id / title / body を渡す。

### additional の型

proposal として保存する際の additional:

```typescript
{
  filePath: string;          // codebasePath 基準の相対パス
  startLine?: number;
  endLine?: number;
}
```

採用時 (`transmuteNode(id, 'coderef', additional)`) に `CodeRefNodeSchema` で検証される。既存の ADR-0005 が `coderef` の additional を「任意。filePath / startLine / endLine が来れば検証」と規定しており整合。

---

## 3. ProposalDetail 拡張 (coderef 採用時)

現状 `ProposalDetail` は `adoptProposal(id, adoptAs, undefined)` としており additional を渡していない。coderef 採用時は、proposal に保存済みの `filePath / startLine / endLine` を `transmuteNode` に引き継がないと、採用後のノードがこれらを失う。

### 変更

`ProposalNode` は `Record<string, unknown>` 相当の追加属性を保持できる (スキーマが `.passthrough()` かどうかで挙動が変わる)。現在の `ProposalNodeSchema` を確認:

```typescript
// packages/core/src/schema.ts
const ProposalNodeSchema = NodeBaseSchema.extend({
  type: z.literal('proposal'),
  adoptAs: z.enum(NODE_TYPES).optional(),
  sourceAgentId: z.string().optional(),
}).passthrough();
```

`.passthrough()` なら `additional` 由来の filePath 等は YAML に残る。実装時に確認が必要だが、残っていなければ `.passthrough()` を足すか ProposalNodeSchema を拡張する。

`ProposalDetail` 側の変更:

```typescript
const onAdopt = async () => {
  // coderef / requirement / userstory など type 固有 additional を proposal ノードから
  // 抜き出して transmute に渡す。既知キー (id/type/x/y/title/body/adoptAs/sourceAgentId)
  // 以外をすべて additional として扱う。
  const { id: _i, type: _t, x: _x, y: _y, title: _ti, body: _b, adoptAs: _a, sourceAgentId: _s, ...rest } = node as unknown as Record<string, unknown>;
  await adoptProposal(node.id, adoptAs, Object.keys(rest).length > 0 ? rest : undefined);
};
```

このアプローチは全 adoptable type に対して汎用的で、coderef だけでなく requirement や userstory が additional を持つケースにも自然に対応する。

---

## 4. codebasePath UI

### ヘッダ歯車ボタン

`packages/frontend/src/app/projects/[id]/page.tsx` に歯車ボタンを追加 (Client 側で dialog 開閉制御するため新規 `project-header-actions.tsx` を作る):

```tsx
<header>
  <Link>← プロジェクト一覧</Link>
  <h1>{project.name}</h1>
  <span>ノード ... / エッジ ...</span>
  <ProjectHeaderActions projectId={project.id} initialCodebasePath={project.codebasePath} />
</header>
```

### ProjectHeaderActions + dialog

`components/header/project-header-actions.tsx` (client):

- 歯車ボタン (⚙ / 日本語で「設定」)
- click で `ProjectSettingsDialog` 開く
- dialog は codebasePath の input + 保存ボタン
- 保存時: `PATCH /api/projects/:id` (新規エンドポイント) で ProjectMeta を更新 → zustand の `projectMeta` も更新

### API: `PATCH /api/projects/[id]/route.ts` を追加

現状は GET のみ。body `{ codebasePath?: string | null }` (null は削除) を受けて `saveProjectMeta` を呼ぶ。

### zustand 拡張

`patchProjectMeta(patch: { codebasePath?: string | null }): Promise<void>` を追加。現状 `projectMeta` state は既に保持。

---

## 5. find-related-code UI ボタン

### 共通ボタンコンポーネント

`components/ai-actions/find-related-code-button.tsx`:

- props: `node: UseCaseNode | RequirementNode | UserStoryNode`
- `useCanvasStore` から `projectMeta.codebasePath` と `runningAgent` を読む
- codebasePath 未設定なら disabled + tooltip「コードベースパス未設定」
- runningAgent 非 null なら disabled
- click で `startFindRelatedCode(node.id)` を呼ぶ

3 つの detail (`usecase-detail.tsx` / `requirement-detail.tsx` / `userstory-detail.tsx`) に配置。UC detail は既に「ストーリー分解」ボタンを持っているので、AI アクション節の 2 行目として追加。

### zustand `startFindRelatedCode`

`startDecompose` と同じ構造 (WS 接続、イベント反映、`runningAgent` 更新)。共通化のために内部ヘルパ `runAgentWS(agentName, inputNodeId)` に統合する。

```typescript
runningAgent: {
  agent: 'decompose-to-stories' | 'find-related-code';
  inputNodeId: string;
  events: AgentEvent[];
} | null;

startDecompose: (ucNodeId: string) => Promise<void>;           // 既存 -> 内部で runAgentWS
startFindRelatedCode: (nodeId: string) => Promise<void>;       // 新規 -> 内部で runAgentWS
```

---

## 6. エラー経路まとめ

| 条件 | code | message |
|---|---|---|
| nodeId 不在 | `not_found` | `ノードが存在しない: <id>` |
| 対象 type が UC/req/story 以外 | `bad_request` | `find-related-code の対象外: <type>` |
| codebasePath 未設定 | `bad_request` | `プロジェクト設定で codebasePath を指定してください` |
| codebasePath 解決先が無い | `not_found` | `codebasePath 解決失敗: <abs>` |
| 認証失敗 | `not_authenticated` | (SDK 例外由来) |
| SDK 例外 | `agent_failed` | - |

UI 側: `runningAgent.events` の最後が `error` なら AgentProgressPanel で強調表示 (既存の `❌ code: message` のままで OK)。

---

## 7. テスト計画

### CI 自動テスト

- `core`: AgentName union の型定義 (コンパイル時のみ、専用テスト不要)
- `ai-engine`:
  - `agents/registry.ts`: 登録された 2 エージェントが取れる / 未知名で undefined
  - `agents/find-related-code.ts`:
    - `buildFindRelatedCodePrompt` containment テスト
    - `findRelatedCodeAgent.validateInput`:
      - UC/requirement/userstory で `ok: true, anchor, cwd`
      - 他 type で `bad_request`
      - 不在 nodeId で `not_found`
      - codebasePath 未設定で `bad_request`
      - codebasePath 存在しないで `not_found`
  - `agent-runner.test.ts`: find-related-code の start → validate → sdk.query 呼び出し形状の検証 (cwd / allowedTools が期待通り)
- `frontend`:
  - `project-settings-dialog.test.tsx`: codebasePath 入力 → 保存 → patchProjectMeta 呼ばれる
  - `find-related-code-button.test.tsx`: codebasePath 未設定で disabled / 非 null runningAgent で disabled / click で startFindRelatedCode
  - `store.test.ts`: startFindRelatedCode の基本フロー
  - `api.test.ts`: patchProjectMeta
- `storage`: `saveProjectMeta` の部分更新テスト (getProjectMeta で読み→ 変更 → save の往復)

### 手動 E2E (`docs/phase-5a-manual-e2e.md`)

1. `examples/taskflow-backend/` に最小 TS サンプル (`src/invite.ts` など) を用意
2. ブラウザで sample-project 開く → ヘッダ歯車 → codebasePath を `../taskflow-backend` に設定
3. UC `uc-send-invite` を選択 → 「関連コード探索」ボタン
4. AgentProgressPanel に thinking / tool_use (Glob/Grep/Read/mcp__tally__*) / node_created / edge_created が流れる
5. Canvas に coderef proposal が生成、元 UC から derive エッジが張られる
6. proposal を採用 → coderef (灰) に昇格、filePath が YAML に残っている

---

## 8. 実装スケジュール (サブフェーズ)

| サブ | タスク | 予想タスク数 |
|---|---|---:|
| 5a-A | agent registry 化 + decompose 移行 + agent-runner 拡張 | 3 |
| 5a-B | find-related-code エージェント (registry + prompt + validation) | 2 |
| 5a-C | ProposalDetail の additional 引き継ぎ | 1 |
| 5a-D | storage + API: saveProjectMeta 部分更新経路、PATCH /projects/:id | 2 |
| 5a-E | UI: project-settings-dialog + ヘッダ歯車ボタン | 2 |
| 5a-F | UI: find-related-code-button + 3 detail 統合 + store.startFindRelatedCode | 2 |
| 5a-G | examples/taskflow-backend 最小サンプル + 手動 E2E 手順書 | 2 |
| 5a-H | ロードマップ更新 + Memory 更新 | 1 |

合計 ~15 タスク。Phase 4 (23 タスク) より小さめ。

---

## 9. 非目標 (Phase 5a 範囲外)

以下は Phase 5b 以降で別 spec:

- `analyze-impact` / `extract-questions` / `ingest-document`
- codebasePath 複数対応 (現状は 1 プロジェクト = 1 codebase)
- 認証プロンプト誘導 (Claude Code 未ログイン時のオンボーディング UI)
- AgentProgressPanel のキャンセルボタン
- coderef 採用後の自動コード同期 (ファイル変更追跡)
- codebasePath を監視するファイル変更通知

## 10. リスクと対策

| リスク | 対策 |
|---|---|
| Read/Glob/Grep の cwd スコープが効かず、SDK が `/etc/passwd` 等を読む | SDK の `cwd` option で相対パスベースを固定、さらに `settingSources: []` で外部設定を拒否。念のため手動 E2E で `cd /tmp && Read ../` 相当を試して境界確認 |
| ProposalNodeSchema が passthrough でない場合、AI が additional に入れた filePath が YAML に保存されない | 実装時に Schema を確認。passthrough でなければ `.passthrough()` を追加 |
| 大きなリポジトリで Grep が遅く、SDK タイムアウトで agent_failed | Phase 5a では制御しない (MVP)。Phase 5b で timeout / max_turns を registry に追加 |
| codebasePath が相対でリポを外れる (../../.. 等) | 今段階では信頼する。悪意ある入力の防御は Phase 5b 以降 |

## 11. 参考

- `docs/04-roadmap.md` Phase 5
- `docs/superpowers/specs/2026-04-19-phase4-ai-engine-design.md` (Phase 4 設計、大部分が継続利用)
- `docs/adr/0005-proposal-adoption.md` (additional の扱い、コード採用時の filePath)
- `docs/02-domain-model.md` (coderef 属性)
- Claude Agent SDK の `Options.cwd`、`allowedTools`、`settingSources`
