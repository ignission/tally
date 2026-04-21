# Phase 5e 手動 E2E 手順: ingest-document (docs-dir モード)

Phase 5e で追加した docs-dir 入力の実通信確認。`.tally/` と `docs/*.md` を持つ実リポジトリで試す。

## 前提

- `claude login` 済み (ADR-0006)
- `NODE_ENV=development pnpm -r test` 全緑
- 検証対象: `~/dev/github.com/your-org/your-repo` など `.tally/` + `docs/*.md` がある構成
- `.env` で `TALLY_WORKSPACE` が対象の親ディレクトリ (例: `~/dev/github.com/your-org`)
- `pnpm --filter @tally/ai-engine dev` + `NODE_ENV=development pnpm --filter @tally/frontend dev` 起動済み

## シナリオ 1: 貼り付けモード (Phase 5d 互換)

1. 対象プロジェクトを開く
2. ヘッダー「要求書から取り込む」
3. 初期タブ「貼り付け」のまま短い要求書を貼り付け → 「取り込む」→ Phase 5d と同じ挙動

## シナリオ 2: ディレクトリモード (5e 新機能)

1. ダイアログで「ディレクトリ」タブ切替え
2. dirPath デフォルト `docs` のまま「取り込む」
3. 進捗パネルに Glob → 複数 Read (docs/**/*.md) → tool_use (create_node × N, create_edge × M)
4. 完了でダイアログ自動クローズ、キャンバスに紫破線 proposal 群
   - requirement: 5〜15 個
   - usecase: 10〜30 個
   - satisfy エッジで繋がる
5. 各 proposal を選択 → 採用 → 正規ノード化
6. 採用した UC で「関連コードを探す」→ backend/frontend 実装に紐付け
7. 全体として「対象リポジトリの機能マップ」がキャンバスに展開

## シナリオ 3: バリデーション

1. 「ディレクトリ」タブで dirPath 空 → 「取り込む」disabled
2. dirPath `../escape` → 実行で error: `dirPath が workspaceRoot 配下ではない`
3. dirPath `missing-dir` → error: `dirPath が存在しない`
4. dirPath に MD ファイル (例: `README.md`) → error: `dirPath がディレクトリではない`
5. 他エージェント実行中は全ボタン disabled + tooltip「別のエージェントが実行中です」
6. 失敗時はダイアログ維持 + エラー表示 + 入力保持

## 失敗時のトラブルシュート

- Glob が空 → AI がパターンを誤解。進捗パネルの tool_use.input を確認
- proposal が全く生えない → Markdown 薄い or 構造想定外。summary 行で AI の判断を確認
- `not_authenticated` → `claude login` 再実行
- `dirPath が workspaceRoot 配下ではない` → `TALLY_WORKSPACE` 設定を確認、absolute path NG
