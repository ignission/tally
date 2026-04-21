# 04. ロードマップ

本ドキュメントは Claude Code が実装を進める順序を定義する。**必ず Phase 順に進める**こと。

## Phase 0: リポジトリ基盤

### ゴール

`pnpm install` → `pnpm dev` が通る状態にする。各パッケージは空のまま。

### タスク

- [ ] ルートに `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- [ ] `packages/core`, `packages/frontend`, `packages/ai-engine`, `packages/storage` の雛形
- [ ] 各パッケージの `package.json`, `tsconfig.json`, `README.md`
- [ ] `packages/frontend` に Next.js 15 の最小セットアップ
- [ ] Biome + Vitest の設定（ADR-0004 参照）
- [ ] `.gitignore`, `.env.example`

### 完了条件

- `pnpm install` がエラーなく完了
- `pnpm -r test` が通る（空のテストでOK）
- `pnpm --filter frontend dev` で http://localhost:3000 が表示される

---

## Phase 1: ドメインモデルと永続化

### ゴール

ノード・エッジ・プロジェクトの型定義と、YAML ファイルへの読み書きが動く。

### タスク

- [ ] `packages/core/src/types.ts`：Node, Edge, Project, NodeType, EdgeType 等の型定義
- [ ] `packages/core/src/meta.ts`：NODE_META, EDGE_META
- [ ] `packages/core/src/schema.ts`：Zod スキーマ
- [ ] `packages/core/src/id.ts`：nanoid ベースの ID 生成
- [ ] `packages/storage/src/project-store.ts`：YAML 読み書き実装
- [ ] `packages/storage/src/yaml.ts`：YAML ユーティリティ
- [ ] ユニットテスト：各ストアの CRUD がファイルシステムに反映されること
- [ ] ADR-0003 の形式に従った `.tally/` ディレクトリ構造の実装

### 完了条件

- `ProjectStore` の `addNode`, `updateNode`, `addEdge`, `findNodesByType`, `findRelatedNodes` がすべて動く
- YAML ファイルが想定通りの形式で書き出される
- 外部から YAML を手編集しても読み直せる
- ユニットテストカバレッジ 80% 以上

---

## Phase 2: キャンバス UI（読み取り専用）

### ゴール

YAML から読み込んだプロジェクトをキャンバスに表示する。編集はまだできない。

### タスク

- [ ] `packages/frontend` に React Flow セットアップ
- [ ] `components/canvas/Canvas.tsx`：メインキャンバス
- [ ] `components/nodes/`：各ノード型のカスタムレンダラ（7種）
- [ ] `components/edges/`：エッジ種別ごとの線種
- [ ] `lib/store.ts`：Zustand ストア（読み込んだプロジェクトの状態）
- [ ] `app/projects/[id]/page.tsx`：プロジェクト表示ページ
- [ ] `app/api/projects/[id]/route.ts`：プロジェクト取得 API
- [ ] 架空サンプルプロジェクト（`examples/sample-project/`）を用意してデモできるように

### 完了条件

- ブラウザでサンプルプロジェクトが表示される
- 各ノード型が仕様通りの色・形で描画される
- エッジ種別ごとに線種が切り替わる
- パン・ズームが動く
- 論点ノードは決定状態によって破線/実線が切り替わる

---

## Phase 3: キャンバス編集機能

### ゴール

キャンバス上でノード・エッジの作成・編集・削除ができる。

### タスク

- [ ] ノードドラッグによる位置変更
- [ ] 詳細シート（選択ノードの編集 UI）
- [ ] ノードパレット（左サイドバー、新規追加）
- [ ] エッジ接続 UI（ハンドルからドラッグ）
- [ ] エッジ種別の変更 UI
- [ ] 論点ノードの選択肢管理（追加・削除・選択）
- [ ] ストーリーノードの AC・タスク管理
- [ ] 削除の確認ダイアログ
- [ ] API ルート：POST/PATCH/DELETE nodes/edges
- [ ] Zustand の楽観的更新 + API 失敗時のロールバック

### 完了条件

- キャンバス編集がすべて YAML に反映される
- ブラウザリロードで状態が復元される
- 複数タブで同一プロジェクトを開くと、それぞれ独立して動く（衝突解決は Phase 6 で）

---

## Phase 4: AI Engine 基盤

### ゴール

Claude Agent SDK を使った最小限の AI アクションが動く。

### タスク

- [x] `packages/ai-engine/src/server.ts`：WebSocket サーバー
- [x] `packages/ai-engine/src/tools/`：Tally カスタムツール（create_node, create_edge, find_related, list_by_type）
- [x] `packages/ai-engine/src/agents/decompose-to-stories.ts`：最初のエージェント
- [x] `packages/frontend/lib/ws.ts`：WebSocket クライアント
- [x] 詳細シートから AI アクションボタンが押せる UI
- [x] ストリーミング進捗表示パネル（thinking / tool_use / tool_result を流す）
- [x] proposal 採用フロー (ADR-0005): `transmuteNode` / `POST /adopt` / `ProposalDetail`
- [x] ADR-0006 (Claude Code OAuth 利用)

### 完了条件

- UC ノードで「ストーリー分解」ボタンを押すと、破線の proposal ノードが 1〜7 個生える (エージェント自律判断)
- 生成中の進捗がリアルタイムに表示される
- 生成後にキャンバスが自動更新される
- 認証未設定時に `not_authenticated` エラーが UI に出る

手動 E2E 手順は `docs/phase-4-manual-e2e.md` 参照。

---

## Phase 5: AI アクション拡充

### ゴール

すべての AI アクションが動く。

### Phase 5a (完了)

- [x] `find-related-code.ts`：既存コード探索（Glob/Grep/Read 使用）
- [x] プロジェクト設定で `codebasePath` を指定する UI（ヘッダ歯車ボタン）
- [x] ツール使用の権限制御（読み取り専用モード基盤 — エージェントごとの allowedTools ホワイトリスト）
- [x] ProposalDetail の additional 引き継ぎ（coderef 採用時に filePath 等を保持）
- [x] agent registry 化（decompose-to-stories も移行）

手動 E2E 手順は `docs/phase-5a-manual-e2e.md` 参照。

### Phase 5b (完了)

- [x] `analyze-impact.ts`：影響分析 (issue proposal 主役 + 副次的 coderef proposal)
- [x] CodeRefNodeSchema に `summary` / `impact` 追加 (構造化フィールド)
- [x] `create_node` に coderef 重複ガード + filePath 正規化 + `sourceAgentId` 自動注入
- [x] `CodebaseAgentButton` 共通抽出 + `AnalyzeImpactButton` 追加 (UX 誘導 tooltip つき)
- [x] 3 detail (UC / requirement / userstory) に配置
- [x] `validateCodebaseAnchor` 共通ヘルパ抽出 + find-related-code 移行

手動 E2E 手順は `docs/phase-5b-manual-e2e.md` 参照。

### Phase 5c (完了)

- [x] `extract-questions.ts`：論点抽出 (anchor グラフ文脈のみ、codebasePath 不要)
- [x] `create_node` で `adoptAs='question'` の options ID 補完 + anchor+同タイトル重複ガード
- [x] `GraphAgentButton` 共通抽出 + `ExtractQuestionsButton` thin wrapper
- [x] 3 detail (UC / requirement / userstory) に配置

手動 E2E 手順は `docs/phase-5c-manual-e2e.md` 参照。

### Phase 5d (完了)

- [x] `ingest-document.ts`：要求書取り込み (貼り付けテキスト → requirement + usecase + satisfy)

手動 E2E 手順は `docs/phase-5d-manual-e2e.md` 参照。

### Phase 5e (完了)

- [x] `ingest-document` にディレクトリ入力を追加 (docs-dir モード): workspaceRoot 配下の Markdown 群を AI が Glob + Read で読み requirement + usecase を生成

手動 E2E 手順は `docs/phase-5e-manual-e2e.md` 参照。

---

## Phase 6: チャットパネル (完了)

### ゴール

対話 UI でスコープを詰めてから proposal を個別承認して生成する UX を導入。マルチスレッド + YAML 永続化。既存ボタン型エージェントは共存で残す。

### タスク

- [x] `ChatThread` / `ChatMessage` / `ChatBlock` schema (core)
- [x] `FileSystemChatStore` (.tally/chats/<id>.yaml)
- [x] チャット API routes (GET list, POST create, GET by id)
- [x] `ChatRunner` (multi-turn + tool 承認 intercept、MCP 登録)
- [x] WS `/chat` エンドポイント
- [x] frontend `ws.ts` に `openChat` + `ChatHandle`、store に chat state/actions
- [x] Chat UI コンポーネント群 (ChatTab / ThreadList / Messages / Message / ToolApprovalCard / Input)
- [x] DetailSheet を Detail/Chat タブ構成に変更

### 完了条件

- 右サイドバーに Chat タブ、新規スレッド / 切替 / 継続会話が動く
- AI の create_node/create_edge は tool_use pending → 承認 UI → 実行 の流れ
- `.tally/chats/<id>.yaml` に永続化、リロードで復元
- 承認フロー: 個別承認 (tool 毎)、read-only tool (find_related / list_by_type) は承認不要
- マルチスレッド: プロジェクトごと複数、独立コンテキスト

手動 E2E 手順は `docs/phase-6-manual-e2e.md` 参照。

### 完了条件

- 既存コードを指定したプロジェクトで「関連コード」アクションがコードベースを実際に読む（Phase 5a）
- 生成された coderef ノードが実ファイルパスを指している（Phase 5a）
- 論点ノードが選択肢候補付きで正しく生成される（Phase 5c）

---

## Phase 6: 書き出し

### ゴール

プロジェクトを Markdown / Mermaid / Confluence 向けに書き出せる。

### タスク

- [ ] `packages/core/src/export/markdown.ts`：Markdown エクスポータ
- [ ] `packages/core/src/export/mermaid.ts`：Mermaid 図エクスポータ
- [ ] エクスポートボタン UI
- [ ] プロジェクトサマリの自動生成（要求 → UC → ストーリーのツリー）

### 完了条件

- Markdown エクスポートが Confluence にそのまま貼れる形式
- Mermaid 図がトレーサビリティを表現できている

---

## Phase 7: Jira 連携（片方向）

### ゴール

ストーリーノードを Jira Story として作成できる。

### タスク

- [ ] Jira API クライアント（`packages/storage/src/jira.ts`）
- [ ] プロジェクト設定で Jira 接続情報を入力
- [ ] ストーリーノードから「Jira に作成」ボタン
- [ ] Jira ID をストーリーノードに紐付けて保存

### 完了条件

- Tally のストーリーが Jira の Story / Sub-task として作成される
- 受け入れ基準が Jira の Description に反映される

---

## Phase 8 以降（将来）

- GitHub Issues / Linear 対応
- Yjs によるリアルタイム協調編集
- プラグイン機構
- MCP サーバー対応（Claude Code から Tally データへアクセス）
- ReqIF / SysML v2 相互運用
- IEEE 29148 / ISO 25010 対応属性の UI 化
- VSCode 拡張

これらは MVP が一度動いてから、実利用でのフィードバックを元に優先度を決める。

---

## 各 Phase の鉄則

- **必ず順番通り**。Phase 1 を飛ばして Phase 2 を始めない
- **各 Phase の完了条件をすべて満たしてから次へ**
- **完了時に動作確認とテスト実行**
- **コミットは細かく**（1 Phase で複数の PR でも OK）
- **ADR に該当する判断があれば記録**
