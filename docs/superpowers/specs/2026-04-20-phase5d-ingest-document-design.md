# Phase 5d: ingest-document エージェント — 設計書

- 日付: 2026-04-20
- ステータス: Accepted (brainstorming で合意、simplified scope)
- 関連: `docs/04-roadmap.md` Phase 5 / ADR-0002 / ADR-0005 / ADR-0006 / ADR-0007 / `docs/superpowers/specs/2026-04-20-phase5c-extract-questions-design.md`

## 目的

Phase 5a-5c で、既存ノードを anchor として AI が副次情報 (関連コード / 影響 / 論点) を出すエージェントが揃った。Phase 5d では **キャンバスが空の状態からの出発点** を AI で埋める。ユーザーが貼り付けた要求書テキストから、`requirement` と `usecase` の proposal + それらを繋ぐ `satisfy` エッジを生成する。

これで「要求書が届いた → キャンバスに構造化 → 残りの関連コード / 論点 / 影響分析は既存エージェントで肉付け」というドッグフード一周が通る。

## Keep it simple

本 spec は意図的に最小機能に絞る。拡張可能な要素は MVP では削り、Phase 5e+ の follow-up に回す。

**スコープに含む (MVP)**:
- 貼り付けテキストから `requirement` + `usecase` + `satisfy` を生成
- ヘッダーボタン 1 本 + textarea ダイアログ
- anchor 無しエージェントの基盤 (`AgentValidateOk.anchor` optional 化)

**スコープに含まない (Phase 5e+ で可)**:
- ファイルパス入力 (Read tool 必要)
- 空キャンバス CTA
- ファイル / 貼り付けタブ切替 UI
- 既存ノードとの重複ガード (proposal は人間が採用時に選別)
- ストーリー / 課題 / 論点の自動抽出 (decompose / analyze-impact / extract-questions に任せる)

## 全体構成

```
Phase 5d スコープ
├── core:
│   ├── AgentName union に 'ingest-document' 追加
│   └── AgentValidateOk.anchor / AgentPromptInput.anchor を optional 化
├── ai-engine:
│   ├── ingest-document エージェント新規 (prompt + registry 登録)
│   ├── agent-runner: anchor 無しルート (anchor{x:0,y:0} / anchorId='' で create_node に渡す)
│   └── create_node: anchor 無しでも既存 adoptAs=requirement/usecase は動く (question 分岐のみ anchorId 必須のまま)
├── frontend:
│   ├── IngestDocumentDialog 新規 (textarea + 実行 + 進捗)
│   ├── store に startIngestDocument(text) 追加
│   └── ProjectHeaderActions に「要求書から取り込む」ボタン配置
└── docs:
    ├── phase-5d-manual-e2e.md 新規
    ├── phase-5d-progress.md 新規
    └── 04-roadmap.md: Phase 5d 完了マーク
```

---

## 1. 既存エージェントとの棲み分け

| agent | 入力 | 主役 proposal | 副次 | codebasePath |
|---|---|---|---|---|
| decompose-to-stories | UC anchor | userstory | — | 不要 |
| find-related-code | anchor | coderef | — | 必須 |
| analyze-impact | anchor | issue | coderef | 必須 |
| extract-questions | anchor | question | — | 不要 |
| **ingest-document** | **要求書テキスト** | **requirement + usecase + satisfy エッジ** | — | **不要** |

ingest-document は「anchor 無しで project 全体に proposal を注入する」唯一のエージェント。他は anchor 1 つから副次ノードを派生する形。

---

## 2. core: AgentValidateOk.anchor を optional 化

`packages/core/src/types.ts`:
```typescript
export const AGENT_NAMES = [
  'decompose-to-stories',
  'find-related-code',
  'analyze-impact',
  'extract-questions',
  'ingest-document',
] as const;
```

`packages/ai-engine/src/agents/registry.ts`:
```typescript
export interface AgentValidateOk {
  ok: true;
  anchor?: Node;  // 以前は required、ingest-document 等 anchor 無しエージェント用に optional 化
  cwd?: string;
}

export interface AgentPromptInput {
  anchor?: Node;  // 以前は required、同上
  cwd?: string;
}
```

既存 4 エージェントの `validateInput` / `buildPrompt` は `anchor: Node` を返し続ける (`ok: true, anchor: node`)。挙動互換。

---

## 3. ai-engine: ingest-document.ts

### 3.1 input スキーマ

```typescript
const IngestDocumentInputSchema = z.object({
  text: z.string().min(1).max(50_000),  // 50 KB 上限 (超長文は Phase 5e+ で分割)
});
```

### 3.2 validateInput

anchor も codebasePath も不要。`ok: true` で即返す。validation は `text` の長さだけ (schema 段階)。

```typescript
async validateInput(_deps, _input) {
  return { ok: true };
}
```

### 3.3 buildPrompt

system prompt の骨子:

```
あなたは Tally の要求書取り込みアシスタントです。
ユーザーから提供された要求書テキストを読み、
プロジェクト初期の骨格となる requirement と usecase を proposal として生成します。

手順:
1. 要求書テキストを最初から最後まで読み、全体像を把握する。
2. 「何を達成したいか」(ビジネス目標・顧客要望) を 3〜8 個の requirement proposal として抽出する。
3. 各要求を達成するためのユーザー操作・システム相互作用を 3〜15 個の usecase proposal として抽出する。
4. requirement → usecase の関係を satisfy エッジで張る (1 つの UC は 1〜2 個の requirement を満たす想定)。
5. 最後に「何を読み、何を抽出したか」を 3〜5 行で日本語要約する。

出力規約:
- create_node(adoptAs='requirement', title='[AI] <短い要求>', body='<要求の意図、背景>')
  座標は指定不要 (サーバ側で自動配置)
- create_node(adoptAs='usecase', title='[AI] <UC 名>', body='<UC のトリガ / 主な流れ / 終了条件>')
- create_edge(type='satisfy', from=<requirement>, to=<usecase>)
  (SysML 2.0 の satisfy: 上位要求を下位 UC が満たす。矢印は要求 → UC)

個数目安:
- requirement: 3〜8 件
- usecase: 3〜15 件
- 要求書の密度が低ければ少なめで可。無理に増やさない。

ツール使用方針: mcp__tally__* のみ使用。コード探索系 (Glob/Grep/Read) は付与されていない。
```

user prompt:
```
以下は要求書のテキストです。読み込んで requirement と usecase proposal を生成してください。

<ここに text を挿入>
```

### 3.4 allowedTools

MCP 4 個のみ。Read も不要 (テキストは user prompt 内)。

```typescript
allowedTools: [
  'mcp__tally__create_node',
  'mcp__tally__create_edge',
  'mcp__tally__find_related',  // 使わない想定だが、AI が既存ノードを確認したくなった時の逃げ道
  'mcp__tally__list_by_type',  // 同上
]
```

### 3.5 AgentDefinition

```typescript
export const ingestDocumentAgent: AgentDefinition<IngestDocumentInput> = {
  name: 'ingest-document',
  inputSchema: IngestDocumentInputSchema,
  validateInput: async () => ({ ok: true }),
  buildPrompt: ({}) => buildIngestDocumentPrompt(<input を buildPrompt 側に渡す経路が必要>),
  allowedTools: [...],
};
```

**非自明ポイント**: `buildPrompt` は現状 `{ anchor, cwd }` を受け取る。ingest-document は input の `text` を buildPrompt で使いたい。現状の agent-runner は input を buildPrompt に渡していないため、シグネチャ拡張が必要:

```typescript
// registry.ts
export interface AgentPromptInput<TInput = unknown> {
  anchor?: Node;
  cwd?: string;
  input?: TInput;  // agent 固有入力 (ingest-document の text など)
}
```

agent-runner.ts で `def.buildPrompt({ anchor, cwd, input: parsed.data })` のように input を伝える。既存 4 エージェントは input を使わないので挙動互換。

### 3.6 registry 登録

```typescript
export const AGENT_REGISTRY = {
  'decompose-to-stories': ...,
  'find-related-code': ...,
  'analyze-impact': ...,
  'extract-questions': ...,
  'ingest-document': ingestDocumentAgent,
} satisfies Record<AgentName, AgentDefinition>;
```

### 3.7 agent-runner: anchor 無しの扱い

`validateInput` が anchor 無しで返ってきた時:
- `buildTallyMcpServer` に `anchor: { x: 0, y: 0 }` (原点) と `anchorId: ''` (空文字) を渡す。
- `create_node` の既存コードは anchor をベース座標として使うので、原点ベースで連続配置される (Phase 5e+ で「空カラム検出して配置」に改善余地)。
- `create_node` の question 重複ガードは `adoptAs === 'question'` のときだけ発火するので、anchorId='' でも ingest-document (requirement/usecase を作る) は問題なし。

```typescript
// agent-runner.ts
const anchor: Node | undefined = vr.anchor;
const mcp = buildTallyMcpServer({
  store,
  emit: (e) => sideEvents.push(e),
  anchor: anchor ? { x: anchor.x, y: anchor.y } : { x: 0, y: 0 },
  anchorId: anchor?.id ?? '',
  agentName: req.agent,
});
```

---

## 4. frontend

### 4.1 IngestDocumentDialog (新規)

`packages/frontend/src/components/dialog/ingest-document-dialog.tsx`:
- textarea で要求書テキストを受け取る (rows=20, monospace)
- 「取り込む」ボタンで `startIngestDocument(text)` を呼ぶ
- 実行中は textarea disabled + ボタン「取り込み中…」
- 進捗は既存の AgentProgressPanel で受ける (store.runningAgent 経由)
- 完了 (runningAgent が null になる) でダイアログを自動閉じる
- 既存の ProjectSettingsDialog と同じスタイル

### 4.2 ProjectHeaderActions に配置

`packages/frontend/src/components/header/project-header-actions.tsx`:
- 既存の歯車ボタン (codebasePath 設定) の隣に「要求書から取り込む」ボタン追加
- クリックで IngestDocumentDialog を開く

### 4.3 store.startIngestDocument

`packages/frontend/src/lib/store.ts`:
- シグネチャ: `startIngestDocument: (text: string) => Promise<void>`
- 既存 `runAgentWS(agent, nodeId)` は input に `{ nodeId }` を入れるが、ingest-document は `{ text }` を入れる必要あり。
- 最小差分で対応: `runAgentWS` を一般化して input を受け取る形にリファクタ (`runAgentWS(agent, input, displayLabel?)`)。
  既存 4 呼び出しは `runAgentWS(agent, { nodeId })` に書き換え。
- displayLabel は runningAgent.inputNodeId の後継で、進捗パネル表示用のラベル (ingest-document は text の先頭 40 文字 + "…" など)。

代替案 (破壊的変更回避): 新規ヘルパ `runAgentWithInput(agent, input, displayLabel)` を並列配置。既存 `runAgentWS` を残す。**後者を採用**。リファクタは follow-up PR。

---

## 5. テスト方針

### 5.1 ユニットテスト (+目安 10 本)

| package | テスト |
|---|---|
| core | AGENT_NAMES に 'ingest-document' 含む (+1) |
| ai-engine | validateInput が trivial ok を返す (+1) |
| ai-engine | buildPrompt: 要求書テキストが user prompt に含まれる / 必要語彙を含む (+2) |
| ai-engine | agent definition の name / allowedTools / inputSchema (+2) |
| ai-engine | registry に登録されている (+1) |
| ai-engine | agent-runner: anchor 無しの validateInput 結果で anchor=(0,0) / anchorId='' を伝搬 (+1) |
| frontend | IngestDocumentDialog: textarea 入力 + 取り込むクリックで startIngestDocument 呼び出し (+2) |
| frontend | store.startIngestDocument: WS に agent=ingest-document, input={text} を送る (+1) |

### 5.2 手動 E2E

`docs/phase-5d-manual-e2e.md` を新規作成。`docs/phase-5c-manual-e2e.md` と同形式:

1. 準備: `claude login` 済み、`pnpm -r test` 緑
2. サンプルプロジェクト (空のキャンバス) を開く
3. ヘッダーの「要求書から取り込む」ボタンをクリック
4. ダイアログに短い要求書テキストを貼り付け (例: 2〜3 段落の招待機能仕様)
5. 「取り込む」をクリック
6. 進捗パネルに thinking / tool_use (`create_node` ×N / `create_edge` ×M) が流れる
7. ダイアログが自動で閉じ、キャンバスに 3〜8 個の requirement proposal + 3〜15 個の usecase proposal が表示される
8. satisfy エッジ (破線) が requirement → usecase に張られている
9. 人間が各 proposal を 1 つずつ採用して正規ノードに昇格できる

### 5.3 ロードマップ更新

`docs/04-roadmap.md` Phase 5d を「完了」に。Phase 5 全体の完了条件も全て ✓ を付ける (5a-d で full 揃う)。

### 5.4 進捗ドキュメント

`docs/phase-5d-progress.md` を Phase 5c と同形式で新設。

---

## 6. follow-up (Phase 5d 完了後に別 PR で対応)

- **ファイルパス入力**: Read tool 付与 + path 検証 + ダイアログにタブ切替追加 (Phase 5e)
- **空キャンバス CTA**: ノード 0 件プロジェクトで中央に大きく「要求書からスタート」を出す
- **大規模文書の分割**: 50 KB 超を章単位に分けて multi-turn で ingest
- **既存 requirement との重複ガード**: 再 ingest 時のマージ戦略
- **runAgentWS の一般化**: `runAgentWithInput` を作った後、既存 4 エージェントを移行して 1 本にまとめる
- **decompose-to-stories の自動チェーン**: ingest 直後に各 UC を decompose-to-stories で掘る連鎖 (UX が強力だがフィードバックループが必要)

---

## 7. 受入条件

1. `pnpm -r test` 全緑 (目安 270 本前後)
2. `pnpm -r typecheck` 緑
3. 手動 E2E で「空キャンバス → 貼り付け → requirement + usecase + satisfy が生える」が動く
4. ADR-0005 準拠: AI は proposal しか作らない (採用までは破線)
5. ADR-0007 準拠: built-in ツール (Glob/Grep/Read/Bash/Edit/Write) が実行されない
6. anchor 無しエージェントの基盤 (`AgentValidateOk.anchor` optional + agent-runner 分岐) が既存 4 エージェントの挙動を破壊していない

---

## 8. オープン論点

なし。brainstorming で以下を合意済み:
- 入力: 貼り付けテキストのみ (ファイルは 5e+)
- 出力: requirement + usecase + satisfy
- UI: ヘッダーボタン + 1 つの textarea ダイアログ
- 重複ガード: なし (人間が採用時に選別)
- anchor 扱い: AgentValidateOk.anchor を optional
