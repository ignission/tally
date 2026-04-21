# Phase 5a 手動 E2E テスト手順

Phase 5a (`find-related-code` エージェント + codebasePath UI + 読み取り専用モード基盤) の動作を
Claude Code 実行環境で確認する手順。CI では実行できないため、このドキュメントに従って手動検証する。

## 前提

- macOS / Linux、Node.js 20+、pnpm 9+
- `claude` CLI (Claude Code) がインストールされ `claude login` 済み
- 本リポジトリがチェックアウトされている
- `examples/sample-project/.tally/project.yaml` が `codebasePath: ../taskflow-backend` を持つ
- `examples/taskflow-backend/` に `src/invite.ts`, `src/mailer.ts` が存在する

## 起動

```bash
pnpm install
pnpm dev
```

- frontend: http://localhost:3000
- ai-engine: ws://localhost:4000/agent

## 正常系: UC → 関連コード探索 → 採用

1. ブラウザで http://localhost:3000 を開き、TaskFlow 招待機能追加プロジェクトに入る
2. ヘッダ右上の歯車ボタン (⚙) を押し、ProjectSettingsDialog を開く
3. codebasePath 欄が `../taskflow-backend` になっていることを確認 (サンプル初期値)。
   空になっていたら `../taskflow-backend` と入力して「保存」
4. 招待関連の UC ノード (`uc-send-invite` など) をクリック
5. 右側 DetailSheet 下部の「AI アクション」節に「関連コードを探す」ボタンが出ていることを確認
6. 「関連コードを探す」ボタンを押下
7. 画面右下の AgentProgressPanel に以下が順に現れることを確認
   - `▶ start find-related-code`
   - thinking テキスト (codebase 探索の思考)
   - `🛠  Glob ...` / `🛠  Grep ...` / `🛠  Read ...` (ビルトインツール)
   - `🛠  mcp__tally__list_by_type ...` (既存 coderef 確認)
   - `🛠  mcp__tally__create_node ...` (proposal 作成)
   - `🛠  mcp__tally__create_edge ...` (derive エッジ作成)
   - `✓ node prop-xxx` と `✓ edge e-xxx` が proposal 数だけ繰り返される
   - `✅ done: ...` で要約
8. Canvas 上に UC から derive エッジで繋がった紫色 proposal ノード (1〜8 件) が
   生成されていることを確認
9. 生成された proposal ノードの 1 つをクリック → DetailSheet を確認:
   - タイトルが `[AI] src/invite.ts:NN` のような形式
   - body にコード要約が書かれている
   - 採用先が `coderef` で選ばれている
10. 「採用する」ボタンを押下
11. ノードの色が coderef (灰) に切り替わり、タイトルから `[AI] ` が消えることを確認
12. ブラウザをリロード → proposal / coderef が YAML に保存されていることを確認
13. ターミナルで `git diff examples/sample-project/.tally/nodes/` を実行 → 採用後の
    ノードに `filePath: src/invite.ts` / `startLine: N` / `endLine: M` が入っていることを確認

## 異常系: codebasePath 未設定

1. ヘッダ歯車 → codebasePath 欄を空にして「保存」
2. UC ノードを選択 → 「関連コードを探す」ボタンを確認
3. ボタンが disabled になっており、hover すると「codebasePath 未設定」のツールチップが出ることを確認

## 異常系: codebasePath 解決失敗

1. ヘッダ歯車 → codebasePath 欄を `../nonexistent-xyz` に変更 → 「保存」
2. UC ノードを選択 → 「関連コードを探す」ボタン押下
3. AgentProgressPanel に `❌ not_found: codebasePath 解決失敗: ...` が表示されることを確認

## 異常系: codebasePath がファイル

1. ヘッダ歯車 → codebasePath 欄を `README.md` のような「ファイル」を指すパスに変更 → 「保存」
2. UC ノードを選択 → 「関連コードを探す」ボタン押下
3. AgentProgressPanel に `❌ bad_request: codebasePath がディレクトリではない: ...` が表示されることを確認

## 境界確認: 書き込みツールが使われないこと

AgentProgressPanel のログに `Edit` / `Write` / `Bash` ツールの使用が現れないこと。
`mcp__tally__create_node` / `mcp__tally__create_edge` のみが書き込みツールとして現れる。
SDK の `allowedTools` ホワイトリストで弾かれているため、モデルが試みても 'tool not available' エラーになる。

## 後片付け

- 生成した proposal / coderef を破棄したい場合:
  ```
  git checkout -- examples/sample-project/.tally/
  ```
- または Canvas 上で選択 → 「ノードを削除」ボタン

## 完了条件 (ロードマップ Phase 5 部分)

- [x] `find-related-code.ts`: 既存コード探索 (Glob/Grep/Read 使用)
- [x] プロジェクト設定で `codebasePath` を指定する UI
- [x] ツール使用の権限制御 (読み取り専用モード基盤)
- 残り (`analyze-impact` / `extract-questions` / `ingest-document`) は Phase 5b-d で別途実装

以上の 3 項目が手動で動作することが Phase 5a 完了の条件。
