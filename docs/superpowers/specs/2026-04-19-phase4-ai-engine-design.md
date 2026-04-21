# Phase 4: AI Engine 基盤 — 設計書

- 日付: 2026-04-19
- ステータス: Accepted (brainstorming で合意)
- 関連: `docs/04-roadmap.md` Phase 4 / ADR-0002 / ADR-0005 / 新規 ADR-0006

## 目的

ロードマップ Phase 4 の完了条件を満たす。すなわち

1. UC ノードで「ストーリー分解」ボタンを押すと、破線 proposal ノードが生成される
2. 生成中の進捗がリアルタイム表示される
3. 生成後にキャンバスが自動更新される
4. 認証未設定時に適切なエラーが出る

あわせて ADR-0005 で先送りしていた proposal 採用フロー (`transmuteNode` / `POST /adopt` / `ProposalDetail`) を完成させる。

## 全体構成 (3 サブフェーズ)

```
Phase 4-A  proposal 採用実装         AI 不要で完結。手動 proposal で E2E 可
Phase 4-B  AI Engine 基盤            独立 WS プロセス + Agent SDK + decompose-to-stories
Phase 4-C  統合 E2E                  Claude Code OAuth で実エージェント動作確認
```

Phase 4-B の書き込み経路は **ai-engine が `FileSystemProjectStore` を直接使って YAML に書く**。WS を通じて `node_created` / `edge_created` イベントを frontend に流し、zustand へ反映する。

---

## Phase 4-A: proposal 採用実装

### storage (`packages/storage/src/project-store.ts`)

`ProjectStore` interface と `FileSystemProjectStore` に追加。

```typescript
transmuteNode(
  id: string,
  newType: Exclude<NodeType, 'proposal'>,
  additional?: Record<string, unknown>,
): Promise<Node>
```

実装手順 (ADR-0005 通り):

1. `getNode(id)` → 存在しなければ `Error('存在しないノード: ${id}')`
2. `current.type !== 'proposal'` なら `Error('proposal 以外は採用対象外: ${current.type}')`
3. 書き込み直前にもう一度 `getNode(id)` を呼び `type === 'proposal'` を再確認 (read-check-write で競合耐性)
4. 共通属性 `{ id, x, y, title, body }` を継承、`title` の `^\s*\[AI\]\s*` を除去
5. `sourceAgentId` / `adoptAs` は破棄
6. `additional` を採用先 type 固有属性としてマージ (undefined 値はスキップ)
7. `NodeSchema.parse` で検証 → `<id>.yaml` 上書き

エッジは ID 不変なので自動的に維持される。

### core (`packages/core/src/`)

- `types.ts` に `AdoptableType = Exclude<NodeType, 'proposal'>` を追加
- `logic/` に `stripAiPrefix(title: string): string` を追加 (正規表現 `^\s*\[AI\]\s*` を 1 回置換)

### frontend API (`packages/frontend/src/app/api/projects/[id]/nodes/[nodeId]/adopt/route.ts` 新規)

- `POST` のみ
- body: `{ adoptAs: AdoptableType, additional?: Record<string, unknown> }`
- 入力検証: `adoptAs` は `AdoptableType` (proposal を除く) のみ
- レスポンス:
  - 200: 新しい正規ノード (完全な Node)
  - 400: スキーマ違反 / proposal 以外を採用しようとした / adoptAs 不正
  - 404: project or node 不在
- `Error` メッセージで 400/404 を分岐 (既存 PATCH ルートと同じパターン)

### frontend store (`packages/frontend/src/lib/store.ts`)

```typescript
adoptProposal: async (id, adoptAs, additional?) => {
  const adopted = await adoptProposalApi(pid, id, adoptAs, additional);
  set((s) => ({ nodes: { ...s.nodes, [id]: adopted } }));
  return adopted;
}
```

**非楽観**。理由は ADR-0005 の通り (type 変化のロールバックが複雑)。

### frontend api.ts

- `adoptProposalApi(projectId, nodeId, adoptAs, additional?)` を追加

### frontend UI

- `components/details/ProposalDetail.tsx` 新規
  - `adoptAs` セレクタ (初期値 `node.adoptAs ?? 'userstory'`、選択肢は `AdoptableType` 全種)
  - 「採用」ボタン → `adoptProposal`
  - 採用中は loading、失敗は簡易トースト (既存 DetailSheet 流儀に合わせる)
- `DetailSheet` の proposal 分岐を `ProposalDetail` に委譲
- 採用成功後、選択中ノードは新 type の DetailSheet に自動切替 (zustand の `selectedId` はそのまま、`nodes[id]` が差し替わるので自然に切替わる)

### テスト (Phase 4-A)

- storage: 
  - 正常採用 (7 種すべての `AdoptableType` を網羅)
  - `[AI]` プレフィックス除去
  - additional マージ (userstory.acceptanceCriteria 等)
  - 存在しない → Error
  - proposal 以外 → Error
  - 接続エッジが残ることを確認 (採用前後で listEdges が不変)
- API route: 200 / 400 / 404
- store: 成功ケースで `nodes[id]` が置換、失敗で例外
- UI: `ProposalDetail` の採用ボタン押下で `adoptProposal` が正しい引数で呼ばれる (jsdom、fetch モック)

---

## Phase 4-B: AI Engine 基盤

### 依存追加 (`packages/ai-engine/package.json`)

- dependencies: `@anthropic-ai/claude-agent-sdk`, `ws`, `zod`, `@tally/core` (既存), `@tally/storage` (追加)
- devDependencies: `@types/ws` (既存: `tsx`, `typescript`, `vitest`)

### ディレクトリ構成

```
packages/ai-engine/src/
├── index.ts                     # 再エクスポート
├── server.ts                    # WS サーバ: 接続受付、リクエスト解釈、agent 起動
├── config.ts                    # PORT, workspace 解決 (frontend の project-resolver と共通化)
├── stream.ts                    # AgentEvent 型 + SDK message → AgentEvent 変換
├── agent-runner.ts              # DI された sdk を使い agent を実行するラッパー
├── tools/
│   ├── index.ts                 # createSdkMcpServer で 4 ツールを登録
│   ├── create-node.ts
│   ├── create-edge.ts
│   ├── find-related.ts
│   └── list-by-type.ts
└── agents/
    └── decompose-to-stories.ts  # プロンプト + 入力スキーマ
```

なお `project-resolver` は既に frontend 側にあるが、ai-engine からも使うため **`@tally/storage` に移動**する (依存整理)。frontend の `lib/project-resolver.ts` は storage 側を薄く再エクスポートするだけに変える。

### WS エンドポイント契約

接続: `ws://localhost:${AI_ENGINE_PORT||4000}/agent`

クライアント → サーバ (最初の 1 メッセージ):

```json
{
  "type": "start",
  "agent": "decompose-to-stories",
  "projectId": "<project-id>",
  "input": { "nodeId": "<uc-xxxx>" }
}
```

サーバ → クライアント (NDJSON、WS text frame で 1 メッセージ 1 イベント):

```typescript
type AgentEvent =
  | { type: 'start'; agent: string; input: unknown }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; output: unknown }
  | { type: 'node_created'; node: Node }
  | { type: 'edge_created'; edge: Edge }
  | { type: 'done'; summary: string }
  | { type: 'error'; code: ErrorCode; message: string };

type ErrorCode =
  | 'not_authenticated'   // Claude Code のトークンが無い / 失効
  | 'bad_request'         // start メッセージ不正
  | 'not_found'           // project or node 不在
  | 'agent_failed';       // SDK 内例外
```

`node_created` / `edge_created` は Tally ツールハンドラが書き込み成功後に発行する (frontend zustand が受けてキャンバスへ反映するため)。

### 認証 (ADR-0006 で別途明文化、下記参照)

- Claude Code の OAuth トークンを Agent SDK が暗黙的に利用
- 前提: ユーザーが `claude` CLI をインストール + `claude login` 済み
- `ANTHROPIC_API_KEY` が設定されていれば SDK がそちらを優先 (従量課金フォールバック)
- 起動時に自前でトークン存在チェックはせず、**最初の SDK 呼び出しで失敗したら `not_authenticated` イベントを返して close** するスタイル (SDK の挙動に委ねる)

### ツール詳細 (`tools/`)

すべて `createSdkMcpServer` で登録し、`@anthropic-ai/claude-agent-sdk` の query に MCP サーバとして渡す。

| ツール | 入力 | 動作 | 発行イベント |
|---|---|---|---|
| `create_node` | `{ type: 'proposal', adoptAs: AdoptableType, title, body, x?, y?, additional? }` | `store.addNode` (type='proposal' 固定、AI が other type を書けないようスキーマで縛る) | `node_created` |
| `create_edge` | `{ from, to, type: EdgeType }` | `store.addEdge` | `edge_created` |
| `find_related` | `{ nodeId }` | `store.findRelatedNodes(nodeId)` を JSON で返す | なし |
| `list_by_type` | `{ type: NodeType }` | `store.findNodesByType(type)` を JSON で返す | なし |

`create_node` の x/y 未指定時は、親 UC の座標から右方向にオフセット (UC.x + 260 + index * 20, UC.y + index * 120 程度) で自動配置。レイアウト精度は Phase 4 で不問、Phase 5 以降で改善余地。

### `decompose-to-stories` プロンプト方針

- system: 「あなたは Tally の要件分解アシスタント。与えられた UC ノードを読み、実装 1 スプリント単位の userstory proposal を適切な粒度で提案する。個数は UC 内容に応じて 1〜7 の範囲を目安とし、粗すぎ・細かすぎを避ける。各 proposal は Mike Cohn 形式 (〇〇として／〜したい／なぜなら〜) で body を書く」
- 入力コンテキスト: UC の title/body、`find_related` で取得した関連ノード、`list_by_type('userstory')` で既存ストーリー (重複回避)
- 出力規約: 各 proposal について
  1. `create_node(type='proposal', adoptAs='userstory', title='[AI] ...', body='...')`
  2. `create_edge(from=<uc>, to=<新 proposal.id>, type='derive')`
- 完了時に短い総評を自然言語で返す (SDK の最終テキストが `done.summary` に入る)

### `agent-runner.ts`

```typescript
interface SdkLike {
  query(opts: QueryOptions): AsyncIterable<SdkMessage>;
}

async function* runAgent(
  sdk: SdkLike,
  store: ProjectStore,
  req: StartRequest,
  onToolEvent: (evt: AgentEvent) => void,
): AsyncIterable<AgentEvent> {
  // 1. agent 定義を解決 (decompose-to-stories のみ Phase 4)
  // 2. tools を MCP サーバとして組み立て、各ハンドラは store を閉包、node_created/edge_created を onToolEvent 経由で push
  // 3. sdk.query(...) の AsyncIterable を読み、stream.ts の変換器で AgentEvent 列に整形して yield
  // 4. 最後に done or error を yield
}
```

テストでは `sdk: SdkLike` を DI し、モック実装に決定論的 message 列を流す。

### `server.ts`

`ws.Server` で `/agent` パスを待ち受け:

1. 接続受付
2. 最初の text frame を JSON parse → zod で `start` メッセージ検証
3. projectId から workspace root を解決 (`@tally/storage` の `project-resolver`)
4. `FileSystemProjectStore` を生成
5. `runAgent(sdk, store, req, (evt) => ws.send(JSON.stringify(evt)))` を回し、各 AgentEvent を送信
6. 完了 or エラーで close
7. ws が切断された場合、`AbortController` で SDK query をキャンセル

### frontend 統合

- `packages/frontend/src/lib/ws.ts` 新規
  - `startAgent(projectId, agent, input)` が `{ events: AsyncIterable<AgentEvent>, close: () => void }` を返す
  - `process.env.NEXT_PUBLIC_AI_ENGINE_URL` (default `ws://localhost:4000`)
- `components/details/UseCaseDetail.tsx` に「ストーリー分解」ボタン追加
  - 押下で `store.startDecompose(selectedNodeId)` を呼ぶ
- Zustand ストア
  - `runningAgent: { agent: string; inputNodeId: string; events: AgentEvent[] } | null`
  - `startDecompose(nodeId)`: ws.ts を使って接続、受信イベントを `runningAgent.events` に push、`node_created` で `nodes` に追加、`edge_created` で `edges` に追加
  - エラー / done で `runningAgent = null` or イベント配列に記録
- `components/progress/AgentProgressPanel.tsx` 新規
  - 右オーバーレイ、`runningAgent` が非 null のとき表示
  - thinking / tool_use / tool_result / node_created / edge_created を縦に時系列表示
  - done/error で自動クローズ可能なトーストも併用

### ルート package.json scripts

- `pnpm dev` は現状 `pnpm -F @tally/frontend dev` のみ。
- 追加: `"dev:ai": "pnpm -F @tally/ai-engine dev"`
- 追加: `"dev:all": "concurrently -n web,ai -c blue,magenta \"pnpm -F @tally/frontend dev\" \"pnpm -F @tally/ai-engine dev\""`
  - **ルート** の devDependency に `concurrently` を追加 (workspace root に入れるのが pnpm 慣習)
- README の起動手順を更新

### テスト (Phase 4-B)

すべて DI モックで SDK を差し替え、**CI で本物の Claude API / OAuth は叩かない**。

- `stream.ts`: SDK message (text / tool_use / tool_result / end) → AgentEvent 変換の単体テスト
- `tools/*.ts`: 各ハンドラが ProjectStore を正しく呼び、書き込み系は node_created/edge_created を発行すること
- `agents/decompose-to-stories.ts`: 入力ノード ID から期待されるシステムプロンプト / 初期ユーザーメッセージを組み立てるヘルパーの単体テスト (プロンプト本文そのものを固定値テストにはせず、主要要素の inclusion だけ検証)
- `agent-runner.ts`: mock sdk で決定論的に 2 proposal + 2 edge を作らせ、WS に流れるイベント列を検証
- `server.ts`: 実 ws クライアントで start メッセージ → mock sdk → 期待イベント列 → close までの E2E 結合テスト
- 既存パッケージへの影響: storage/frontend のテストは回帰のみ確認

### エラーハンドリング (Phase 4-B)

| 事象 | 動作 |
|---|---|
| start メッセージが JSON 不正 or スキーマ違反 | `error { code: 'bad_request' }` 送信 → close |
| projectId または nodeId が不在 | `error { code: 'not_found' }` |
| SDK 認証エラー (Claude Code 未ログイン等) | `error { code: 'not_authenticated' }` + close。メッセージに `claude login` を案内する誘導文を含める |
| ツール内例外 | `tool_result { ok: false, output: { message } }` を送り agent を継続させる (LLM 側でリトライ可能) |
| SDK 例外 | `error { code: 'agent_failed', message }` |
| WS 切断 | AbortController で SDK query をキャンセルして終了 |

---

## Phase 4-C: 統合 E2E

### 事前条件

- Claude Code (`claude` CLI) がインストール済み、`claude login` 済み
- `examples/sample-project` に UC ノードが 1 つ以上存在 (無ければ追加)

### 手順書 (`docs/phase-4-manual-e2e.md` を新規)

1. `claude login` 状態を確認 (`claude whoami` 等)
2. `pnpm dev:all` で frontend と ai-engine を同時起動
3. `http://localhost:3000/projects/<sample-id>` を開く
4. UC ノードを選択 → 「ストーリー分解」ボタン押下
5. 進捗パネルに thinking / tool_use / tool_result が流れる
6. 1〜7 個の proposal ノードが生成され、UC → proposal の derive エッジが張られる
7. 各 proposal を選択 → ProposalDetail で「userstory として採用」
8. [AI] プレフィックスが外れ、実線 userstory に昇格したことを確認

### 完了条件 (ロードマップ Phase 4)

- UC ノードで「ストーリー分解」ボタンを押すと破線 proposal が **1 個以上** 生える (自律判断で個数は変動)
- 生成中の進捗がリアルタイムに表示される
- 生成後にキャンバスが自動更新される (zustand 反映 + React Flow 再描画)
- Claude Code 未ログイン時に `not_authenticated` エラーが UI に表示される

---

## ADR-0006 (同時に追加)

`docs/adr/0006-claude-code-oauth-for-agent-sdk.md` を新規作成。

- タイトル: Claude Code の OAuth トークンを Agent SDK の認証として採用
- ステータス: Accepted
- ADR-0002 の「認証は API キー必須」を **訂正** する位置付け (Supersedes: ADR-0002 の該当部分のみ)
- 要点:
  - MVP は Claude Pro/Max サブスクリプションを活用 (API 従量課金を強制しない)
  - `claude` CLI + `claude login` を前提
  - `ANTHROPIC_API_KEY` が設定されている場合は SDK がそちらを優先 (CI / 非対話環境用フォールバック)
  - 自前のトークン存在チェックはせず、SDK の例外を `not_authenticated` イベントに変換して返す
- 影響: `.env.example` から `ANTHROPIC_API_KEY` 必須記述を削除 (存在すれば使う、という任意項目に)

## 非目標 (Phase 4 範囲外、将来 ADR)

- キャンセルボタン UI (WS 側では AbortController を繋ぎ込むが、UI ボタンは Phase 5 で)
- 複数エージェントの並列実行制御
- `find-related-code` / `analyze-impact` 等の他エージェント (Phase 5)
- バッチ採用 / Undo (ADR-0005 参照)
- プロジェクトごとのモデル切替 UI
- 外部 MCP サーバ追加

## リスクと対策

| リスク | 対策 |
|---|---|
| Claude Agent SDK の API が TypeScript 版で未安定 | 実装前に `@anthropic-ai/claude-agent-sdk` の最新 README を参照し、互換性に問題があれば ADR-0006 を更新 |
| ai-engine が ProjectStore 直書きする間に frontend からも PATCH が来る競合 | MVP は単一ユーザー前提で許容。Phase 6 の Yjs 導入時に扱う |
| WS サーバと Next.js dev が同時に起動しなくて E2E が壊れる | `dev:all` スクリプトを用意し README に明記 |
| 生成 proposal が多すぎてキャンバスが散らかる | プロンプトで「1〜7 個を目安」と明示。超過時は適宜 UI で折りたたむ余地を残す (Phase 5+) |
| Claude Code が未ログイン状態の新規ユーザーが混乱 | `not_authenticated` エラー文に `claude login` を案内 |

## 参考

- `docs/04-roadmap.md` Phase 4
- `docs/adr/0002-agent-sdk-adoption.md`
- `docs/adr/0005-proposal-adoption.md`
- `docs/02-domain-model.md`
- Claude Agent SDK: https://docs.claude.com/en/api/agent-sdk
