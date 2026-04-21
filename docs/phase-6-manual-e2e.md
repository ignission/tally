# Phase 6 手動 E2E: チャットパネル

Phase 6 の対話 UX (チャット + tool 承認) を実通信で確認する手順。

## 前提

- `claude login` 済み or `ANTHROPIC_API_KEY` 設定
- `CLAUDE_CODE_PATH` が `.env` に設定済み (Linux musl 不整合対策、必要なら)
- `NODE_ENV=development pnpm -r test` 全緑 (目安 335 本前後)
- `pnpm --filter @tally/ai-engine dev` + `NODE_ENV=development pnpm --filter @tally/frontend dev` 起動済み
- 任意のプロジェクト (空 or 既存、`.tally/` あり)

## シナリオ 1: 初回スレッド + text-only 応答

1. http://localhost:3000/projects/<proj-id> を開く
2. 右サイドバーのタブを **Chat** に切替
3. 「+ 新規」ボタン → 新規スレッド作成 → ドロップダウンに追加 + 自動 open
4. 入力欄に `こんにちは` → Enter
5. AI が text で挨拶応答、末尾にカーソル自動スクロール
6. 応答終了 (`chat_turn_ended`) で「応答生成中…」表示が消える

## シナリオ 2: tool_use 承認 → ノード作成

1. 既存 / 新規スレッドを開く
2. 入力欄に `要求を追加して: ユーザー管理画面の CSV エクスポート機能が必要` → Enter
3. AI がスコープ確認の text を返すか、いきなり `create_node` を呼ぶ
4. tool_use pending カードが出る (紫枠 + 🔧 create_node + 承認/却下ボタン + input プレビュー)
5. 「承認」クリック → サーバで実行、カードが「承認済」バッジに、tool_result が追記
6. 左 canvas に新しい proposal ノードが出現 (store の `nodes` にも反映)
7. AI が続きの応答 (別 tool_use or text) を生成

## シナリオ 3: tool_use 却下

1. 上と同じ流れで tool_use pending カードが出たら「却下」クリック
2. カードが「却下」バッジに、tool_result は `✗ ユーザー却下`
3. canvas にノードは作成されない
4. AI は却下を受け取って別の案を提示 or 質問で方針再確認

## シナリオ 4: 複数スレッド切替

1. 「+ 新規」で 2 つ目のスレッドを作成
2. 異なる話題でやり取り (例: 別機能の要求)
3. ドロップダウンで最初のスレッドに切替 → 過去のメッセージが復元される
4. 2 つ目に切替 → 独立したコンテキスト

## シナリオ 5: サーバ再起動 + 永続化確認

1. ai-engine を `Ctrl+C` で停止
2. `cat <workspaceRoot>/.tally/chats/<threadId>.yaml` で messages が保存されているか確認
3. ai-engine 再起動 (`pnpm --filter @tally/ai-engine dev`)
4. ブラウザでスレッド再 open → 過去メッセージが表示される (API GET /chats/<threadId> で取得)

## シナリオ 6: read-only tool (承認不要)

1. スレッドで `既存の要求を教えて` と送信
2. AI が `list_by_type` or `find_related` を呼ぶ
3. **承認カードは出ない** (read-only なので即実行)
4. tool_use(approved) + tool_result が即追記される

## 失敗時のトラブルシュート

- WS 接続失敗: `pnpm --filter @tally/ai-engine dev` のログ確認、`.env` の `AI_ENGINE_PORT` と `NEXT_PUBLIC_AI_ENGINE_URL` の整合確認
- `open 未送信`: 接続直後に `user_message` を送ってる。ブラウザの DevTools Network → WS で `open` frame 送信を確認
- tool_use pending が来ない: AI が tool を呼ばず text だけ返した可能性。MCP 登録確認 (`packages/ai-engine/src/chat-runner.ts` の `buildInterceptedMcp`)
- 承認しても tool_result が来ない: サーバ側 `approve_tool` ハンドラで `runner.approveTool` が呼ばれているか確認、pending Promise 解決できているか
- canvas にノードが出ない: `applyChatEvent` 内の `chat_tool_result` → 簡易 JSON パース分岐で store.nodes に入っているか
- スレッド永続化されない: `.tally/chats/` ディレクトリ権限、YAML 書き込みエラー (ai-engine ログ)
