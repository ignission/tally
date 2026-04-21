# Phase 6 実装進捗

**本ドキュメントは Claude Code のメモリ代替**。別 PC 引き継ぎ可能。

関連:
- 設計書: [`specs/2026-04-20-phase6-chat-panel-design.md`](superpowers/specs/2026-04-20-phase6-chat-panel-design.md)
- 実装詳細 (Task 4 用): [`specs/2026-04-20-phase6-chat-runner-detail.md`](superpowers/specs/2026-04-20-phase6-chat-runner-detail.md)
- 実装計画: [`plans/2026-04-20-phase6-chat-panel.md`](superpowers/plans/2026-04-20-phase6-chat-panel.md)
- 前 Phase: [`phase-5e-progress.md`](phase-5e-progress.md)

## 全体状況

| Phase | 状態 |
|---|---|
| 0-5d | 完了 |
| 5e | 完了 (ingest-document docs-dir) |
| New Project UI | 完了 |
| **6** | **完了 (チャットパネル、9 タスク全完了)** |
| 7+ | 未着手 |

## タスク進捗

| # | タスク | 状態 | commit |
|---|---|---|---|
| 1 | core に Chat schema + id helper | ✅ 完了 | `e836904` |
| 2 | storage: FileSystemChatStore | ✅ 完了 | `879cbfe` |
| 3 | frontend API routes (chats) | ✅ 完了 | `b729c46` |
| 3.5 | chat-runner 設計詰め doc | ✅ 完了 | `92759e9` |
| - | chat-store ブロック操作 helper + mutex 追加 | ✅ 完了 | `cd01b92` |
| 4 | ai-engine ChatRunner (初版) | ✅ 完了 | `586294a` |
| - | ChatRunner に MCP server 登録 (production fix) | ✅ 完了 | `08b18c4` |
| 5 | ai-engine WS /chat エンドポイント | ✅ 完了 | `2842121` |
| 6 | frontend ws/store チャット拡張 | ✅ 完了 | `0e432a7` |
| 7 | Chat UI コンポーネント群 | ✅ 完了 | `330752a` |
| 8 | DetailSheet タブ化 (Detail/Chat) | ✅ 完了 | `acb3268` |
| 9 | docs + 最終全緑 + Playwright E2E | ✅ 完了 | (本コミット) |

## HEAD 情報

- ブランチ: `main` (直接 commit)
- Phase 6 完了時の最新 commit は Task 9 の「docs: Phase 6 完了マーク」

## テスト本数 (Phase 6 完了時点)

- `@tally/core`: 48 tests (Task 1 で +8)
- `@tally/storage`: 66 tests (Task 2 で +8、Task 4 前の helper 追加で +5 → 再集計で 66)
- `@tally/ai-engine`: 113 tests (Task 4 で +3、Task 5 で +3)
- `@tally/frontend`: 115 tests (Task 3 で +7、Task 6 で +4、Task 7 で +10 = +21 / 別途増分は DetailSheet テスト)
- 合計 **342 テスト前後全緑** (Phase 5e 完了時の 285 → +57)

## アーキテクチャの要点

### ChatRunner の MCP 統合

- `createSdkMcpServer` で 4 つの tally tool を登録
- `mcp__tally__create_node` / `create_edge`: handler 内で `invokeInterceptedTool` を呼び、承認待ち
- `mcp__tally__find_related` / `list_by_type`: read-only、承認不要で即実行
- `invokeInterceptedTool` は `Promise<{ ok, output }>` を返すので MCP handler は CallToolResult に変換して SDK に返す
- ui-toolUseId は ChatRunner が独自に生成 (SDK 内部 id は不使用)

### WS プロトコル (/chat)

- `{ type: 'open', projectId, threadId }`: 接続初期化、ChatRunner 1 インスタンス作成
- `{ type: 'user_message', text }`: user ターン開始、runUserTurn で stream
- `{ type: 'approve_tool', toolUseId, approved }`: pending tool_use の Promise 解決
- server → client: ChatEvent 群 (chat_opened / chat_text_delta / chat_tool_pending / chat_tool_result / chat_turn_ended / error)

### 永続化 (.tally/chats/<id>.yaml)

- 1 スレッド = 1 YAML ファイル
- `FileSystemChatStore.withWriteLock` で同一スレッドへの並列書き込みを FIFO 直列化
- tool_use (pending) は handler 入口で即永続化 (クラッシュ耐性)
- text blocks は turn 末にまとめて永続化 (+ streaming 中は WS 経由でリアルタイム)

### UI (右サイドバー)

- DetailSheet を Detail / Chat タブ切替に
- Chat タブ: ThreadList (select + 新規) / Messages / Input
- tool_use pending → ToolApprovalCard (承認/却下ボタン)
- 送信中は textarea disabled + 「応答生成中…」

## follow-up (Phase 7+)

- **スレッド管理 UX**: リネーム / 削除 / アーカイブ / 検索
- **チェーン実行**: チャットから既存エージェント (decompose-to-stories 等) を tool として呼べる
- **長いスレッドの要約 → 新スレッドへ持ち越し**
- **proposal 採用の chat UI**: 承認時に adoptAs 変更 / 座標調整
- **連続 approve の batching**: 複数 pending を 1 操作で承認
- **message 再実行**: user メッセージ編集 + branching
- **モデル選択**: Opus / Sonnet / Haiku 切替
- **text+tool の順序保持**: 現状 assistant msg は text blocks 先頭 → tool 群の順で統合 (時系列不一致あり)
- **codebasePath ありのコード探索**: chat-runner に Glob / Read / Grep を追加 (allowedTools 拡張)
- **agentName プレースホルダ整理**: chat 用の AgentName を新設 (現在は `decompose-to-stories` を流用)

## 実装ルール (Phase 5 と同じ)

1. TDD: failing test → RED → 実装 → GREEN → commit
2. Conventional Commits 日本語、scope: `core|storage|ai-engine|frontend|docs|fix`
3. **`Co-Authored-By` / `Generated with Claude Code` フッタ絶対に付けない**
4. `NODE_ENV=development` で test/build/typecheck
5. ADR-0007 準拠: allowedTools は使う tool を全列挙、MCP server を必ず registerして実 SDK で動くこと

## 設計の非自明ポイント

- **ChatRunner は MCP server を必ず登録する**: `mcpServers: {}` にすると実 SDK で model が tool を知らず、tool_use を出さない → chat 機能無力化。Task 4 の初版でこの罠を踏んだので fix commit `08b18c4` で修正
- **invokeInterceptedTool は public**: MCP handler と test 両方から呼ぶため (test は SDK 経由せず直接呼ぶ)
- **text blocks は turn 末に先頭統合**: stream 中は memory buffer、turn_ended 時に assistant msg の先頭に insert (tool_use/result は intercept 経路で即 append)
- **WS routing は path 判別**: `/agent` と `/chat` を同じ WebSocketServer で req.url 分岐、既存 `/agent` 挙動を完全維持
- **chat-user message は楽観更新しない**: server 側で append された user msg は WS 経由で `chat_user_message_appended` event が来るが、現実装は messages 配列更新せず、次 open 時に永続化済みのものを取得する方針 (MVP 許容)

## 復元手順

1. 本ドキュメント + spec + plan 一式 + chat-runner detail doc を読む
2. ADR-0005 / 0007 を読む
3. `git log --oneline -20` で Phase 6 の commit 列を確認
4. `NODE_ENV=development pnpm -r test` で全緑確認
5. 次は Phase 7 (follow-up どれか) か、ドッグフード継続 / ユーザー要望に応じて
