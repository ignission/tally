# Phase 5d 手動 E2E 手順: ingest-document

Phase 5d で追加した `ingest-document` エージェントを実通信で確認する手順。Phase 5c と同形式。

## 前提

- `claude login` 済み (ADR-0006) もしくは `ANTHROPIC_API_KEY` 設定済み
- `NODE_ENV=development pnpm -r test` 緑 (≈274 本)
- サンプルプロジェクト: ノード 0 件の空プロジェクトが最適。既存のサンプルを使う場合も新規ページを開く
- `pnpm --filter frontend dev` で開発サーバ起動済み、AI Engine (`pnpm --filter ai-engine start` 等) も起動済み

## シナリオ 1: 空キャンバス → 骨格生成

1. 空プロジェクトを開く (ノード 0 件のキャンバスが表示される)
2. ヘッダー右の「要求書から取り込む」ボタンをクリック → IngestDocumentDialog が開く
3. textarea に短い要求書テキストを貼り付け (例):

```
タスク管理アプリに「チーム招待」機能を追加する。

- チームメンバーがメールアドレスで他人を招待できる
- 招待されたユーザーは招待リンクから登録できる
- 管理者は招待の一覧と取り消しができる
- 招待は 7 日で自動失効する
```

4. 「取り込む」ボタンをクリック
5. 進捗パネルに thinking / tool_use (`create_node` x 複数 / `create_edge` x 複数) が流れる
6. ダイアログが自動で閉じる
7. キャンバス上に紫色の破線 proposal ノードが複数生える
   - 3〜8 個の requirement proposal (例: 「チーム招待を可能にする」「招待の有効期限管理」)
   - 3〜15 個の usecase proposal (例: 「メールで招待を送る」「招待を取り消す」)
   - satisfy エッジ (破線) が requirement → usecase に張られている

## シナリオ 2: 個別採用

1. 任意の proposal ノードを選択 → ProposalDetail が開く
2. タイトルは `[AI] <短い名前>`、body に要約
3. 採用先 select が `requirement` または `usecase` になっている
4. 「採用する」→ 正規ノードに昇格 (青 or 緑の実線)
5. 複数 proposal を順に採用し、キャンバスが段階的に構造化される

## シナリオ 3: 採用後の後続エージェント連鎖

1. 採用した usecase ノードを選択
2. 詳細から「ストーリー分解」ボタン → decompose-to-stories が走り、userstory proposal が生える
3. 「関連コードを探す」や「影響を分析する」は codebasePath 設定後に利用可 (Phase 5a/5b)
4. 「論点を抽出」は codebasePath 不要でそのまま動く (Phase 5c)

→ ingest-document → decompose / find-related / analyze / extract の連鎖でキャンバスが肉付けされる

## シナリオ 4: バリデーション

1. 空の textarea で「取り込む」は disabled
2. 50,001 文字以上貼り付けると server 側で `invalid input` エラー
3. 実行中は「キャンセル」も disabled

## 失敗時のトラブルシュート

- `not_authenticated`: `claude login` を再実行
- `未知の agent: ingest-document`: registry 登録が抜けている、Task 3 確認
- proposal が生えない: Anthropic のレート制限 or テキスト内容が希薄で 0 件返ってきた可能性 (進捗パネルの summary 行で AI の判断を確認)
- satisfy エッジが張られない: `create_edge` の tool_use が発火しているか進捗で確認。AI が順序を守らず edge を先に作ろうとすると create_node から返る id を待てず失敗することがある
