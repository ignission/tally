# CLAUDE.md

このファイルは Claude Code がこのプロジェクトを実装する際の指針です。すべての作業前に読んでください。

## プロジェクト概要

**Tally** は、既存システムへの機能追加を視覚的に要件定義するためのツールです。ノード（要求・UC・ストーリー・論点・コード・課題・AI提案）を SysML 2.0 準拠のエッジで接続するキャンバスUIを中心に、Claude Agent SDK による既存コード読解・AI支援を組み込みます。

詳細は `README.md` および `docs/` を参照してください。

## 開発の大原則

### 1. 思考の道具としての正しさを優先

このツールは「**思考のキャンバス**」です。機能追加時は常に以下を自問してください。

- ユーザーの思考プロセスに乗れているか
- 決定した事と未決定の事の区別が一目で分かるか
- AIが生成したものと人間が確定したものが区別できているか
- キャンバスが情報過多にならないか

迷ったら `docs/01-concept.md` に戻ってください。

### 2. ドメインモデルは SysML 2.0 を参考

エッジ種別の内部識別子は SysML 2.0 の要求関係ステレオタイプに準拠します（`satisfy` / `contain` / `derive` / `refine` / `verify` / `trace`）。UI表示は日本語ラベル。詳細は `docs/02-domain-model.md`。

独自の命名を勝手に追加しないでください。追加する場合は ADR を書くこと。

### 3. AI提案は「一段低い信頼性レイヤー」

AI が生成するノードは必ず `type: 'proposal'` で作成し、破線枠で描画します。人間が「採用」ボタンを押して初めて正規ノードになります。

この分離は UX の根幹です。AI が直接正規ノードを作る機能を追加してはいけません。

### 4. 論点（question）ノードは決定と未決定を区別する

論点ノードは複数の選択肢候補を持ちます。選択肢が選ばれていない状態は破線で描画し、選ばれた瞬間に実線＋「決定」バッジに切り替わります。

「決定」は後から取り消せます。決定プロセスは可逆でなければなりません。

### 5. 規格対応用の拡張点は保持する

`Node.kind` / `Node.qualityCategory` / `Node.priority` などの拡張属性は、現在 UI に表示されていなくても型定義から削除しないでください。将来 IEEE 29148 / ISO 25010 対応を入れる受け皿です。

## アーキテクチャ

`docs/03-architecture.md` を参照。要点：

- **モノレポ**（pnpm workspaces）
- `packages/core`：型定義、全パッケージで共有
- `packages/frontend`：Next.js、キャンバスUI（React Flow）
- `packages/ai-engine`：Claude Agent SDK のラッパー、WebSocketサーバー
- `packages/storage`：ファイル永続化層（`.tally/` ディレクトリへのYAML読み書き）

## 実装順序

**必ず `docs/04-roadmap.md` の Phase 順に実装してください**。飛ばし読みせずに順を追うこと。

Phase 1 が完了するまで Phase 2 のコードは書かない。各 Phase の完了条件を満たさずに次へ進まない。

## 技術選定の固定事項

以下は決定済み。変更する場合は ADR を書き、必ずユーザーに確認してください。

- **言語**：TypeScript（Frontend / AI Engine / Storage すべて）
- **フロント**：Next.js 15+ App Router
- **グラフ描画**：React Flow
- **スタイル**：CSS-in-JS（styled-componentsは使わない、コンポーネント内の style オブジェクト直書き）
- **状態管理**：Zustand
- **バックエンドAPI**：Next.js Route Handlers
- **AI**：Claude Agent SDK（`@anthropic-ai/claude-agent-sdk`）
- **永続化**：YAML ファイル（`.tally/` ディレクトリ）、MVP段階ではDBなし
- **リアルタイム同期**：MVPでは単一ユーザー前提、Phase 3 で Yjs 追加
- **パッケージマネージャ**：pnpm

## 禁止事項

- `localStorage` / `sessionStorage` を使わない（将来のArtifact対応のため）
- グローバルな状態に巨大なオブジェクトを置かない
- ノード型・エッジ型を `packages/core` 以外で定義しない
- AI に直接正規ノードを作らせない
- テストを書かずにマージしない
- `docs/` を更新せずに仕様変更しない

## コーディング規約

- **命名**：変数・関数は camelCase、型・クラスは PascalCase、定数は SCREAMING_SNAKE_CASE
- **コメント**：日本語OK。ただし意図を書く（何をしているかはコードを読めば分かる）
- **ファイル名**：kebab-case（`node-canvas.tsx`）
- **import 順**：外部ライブラリ → 内部パッケージ → 相対パス、間に空行
- **1ファイルの長さ**：500行を超えそうなら分割を検討
- **テスト**：各パッケージで Vitest、重要ロジックは必ずユニットテスト

## コミット規約

Conventional Commits。

```
feat(frontend): 論点ノードに選択肢編集UIを追加
fix(ai-engine): タイムアウト時のストリーム漏れを修正
docs: ADR-0004 追加（YAML形式の詳細）
refactor(core): Node型にsourceAgentId追加
```

スコープは `frontend`, `ai-engine`, `core`, `storage`, `docs`。

## 詰まったとき

- **要件の解釈に迷ったら**：`docs/01-concept.md` と `docs/02-domain-model.md` に戻る
- **実装方針に迷ったら**：該当する ADR を探す、なければ新規 ADR を書いてユーザーに確認
- **プロトタイプと矛盾する仕様**：プロトタイプは参考、正は `docs/`
- **AI 関連で迷ったら**：Claude Agent SDK の公式ドキュメント（https://docs.claude.com/en/api/agent-sdk）

## プロトタイプ

`docs/prototypes/tally-mobile.jsx` に React 単一ファイルのモバイル向けプロトタイプがあります。これは**設計意図を伝えるためのサンプル**であり、本実装のコードではありません。参考にしつつも、本実装ではパッケージ分割・型安全・テストを徹底してください。

プロトタイプの初期データは完全架空のサンプル（TaskFlowというタスク管理SaaS）です。

## 作業報告

作業完了時は以下を必ず報告してください。

1. **何を作ったか**（ファイル一覧）
2. **なぜその判断をしたか**（設計判断の理由）
3. **何を確認したか**（手動テスト結果、ユニットテスト結果）
4. **次のステップ**（ロードマップ上の位置）
5. **懸念事項**（動くが気になる点、後で見直すべき点）
