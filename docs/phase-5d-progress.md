# Phase 5d 実装進捗

**本ドキュメントは Claude Code のメモリ代替。別 PC へ引き継いでも最新状態を復元できるよう、タスク完了の都度ここを更新する。**

関連ドキュメント:
- 設計書 (spec): [`docs/superpowers/specs/2026-04-20-phase5d-ingest-document-design.md`](superpowers/specs/2026-04-20-phase5d-ingest-document-design.md)
- 実装計画 (plan): [`docs/superpowers/plans/2026-04-20-phase5d-ingest-document.md`](superpowers/plans/2026-04-20-phase5d-ingest-document.md)
- 前 Phase 進捗: [`docs/phase-5c-progress.md`](phase-5c-progress.md) (Phase 5c 完了)
- ADR-0007 (エージェントツール制約): [`docs/adr/0007-agent-tool-restriction.md`](adr/0007-agent-tool-restriction.md)

## 全体状況 (2026-04-20 時点)

| Phase | 状態 |
|---|---|
| 0-4 | 完了 |
| 5a | 完了 (find-related-code) |
| 5b | 完了 (analyze-impact) |
| 5c | 完了 (extract-questions) |
| **5d** | **完了 (ingest-document、7 タスク全完了、手動 E2E は別途実施)** |
| 6+ | 未着手 |

## Phase 5d タスク進捗

| # | タスク | 状態 | 担当 commit |
|---|---|---|---|
| 1 | core: AGENT_NAMES に ingest-document 追加 | ✅ 完了 | `40273e9` |
| 2 | ai-engine: registry 型拡張 (anchor optional + input) + ingest-document agent 実装 | ✅ 完了 | `4a07a26` |
| 3 | ai-engine: registry 登録 + agent-runner anchor 無し対応 + happy-path | ✅ 完了 | `a50f672` |
| 4 | frontend: store に runAgentWithInput 並設 + startIngestDocument | ✅ 完了 | `92be19b` |
| 5 | frontend: IngestDocumentDialog 新規 | ✅ 完了 | `212305b` |
| 6 | frontend: ProjectHeaderActions に「要求書から取り込む」ボタン + 型追従 | ✅ 完了 | `88bd15c` |
| 7 | docs: 04-roadmap 更新 + phase-5d-manual-e2e.md + 本ファイル | ✅ 完了 | `fbf76a6` |
| - | codex セカンドオピニオン対応 (WS StartSchema / ダイアログ global mutex / エラー時テキスト保持) | ✅ 完了 | `99db7ab` |

**次のタスク**: Phase 5 全体完了 (a-d 全て揃った)。次は Phase 6 (書き出し: Markdown / Mermaid 等) または codex セカンドオピニオン + ドッグフーディング

## HEAD 情報

- ブランチ: `main` (worktree なし、ユーザー明示同意のもと直接 main に commit)
- Phase 5d 完了時点の最新 commit は Task 7 の「docs: Phase 5d 完了マーク」

## テスト本数 (Phase 5d 完了時点)

- `@tally/core`: 38 tests (変更なし)
- `@tally/storage`: 46 tests (変更なし)
- `@tally/ai-engine`: 101 tests (Task 2 で +6、Task 3 で +2 = Phase 5c 完了時 93 → +8)
- `@tally/frontend`: 91 tests (Task 4 で +1、Task 5 で +5、codex fix で +2 = Phase 5c 完了時 83 → +8)
- 合計 **276 テスト全緑** (Phase 5c 完了時の 260 → +16。codex fix でダイアログに +2)

## Phase 5d 完了後の follow-up (別 PR で対応推奨)

### 実装 / UX
- **runAgentWS と runAgentWithInput の統合**: 現在 `{ nodeId }` 専用の `runAgentWS` と任意 input 用の `runAgentWithInput` が並設。本体ロジックはほぼ同じなので一本化したい。既存 4 agent を `runAgentWithInput(agent, { nodeId }, nodeId)` に書き換える follow-up PR。
- **`runningAgent.inputNodeId` リネーム**: 実態は「進捗表示用ラベル」。`displayLabel` 等にリネーム。破壊的ではないが影響範囲広い。
- **ingest-document のファイルパス入力**: 貼り付けのみ MVP → ファイルパス + Read tool で Git 管理下文書の取り込みを追加。
- **大規模文書の分割 ingest**: 50 KB 超を章単位で multi-turn ingest。
- **既存 requirement との重複マージ**: 再 ingest 時の titleメタ照合 or explicit merge 戦略。
- **空キャンバス CTA**: ノード 0 件時に「要求書からスタート」ボタンを中央大きく。

### コード品質
- **agent-runner の validateInput input 型**: 現状 `as unknown as never` で union intersection を回避。AGENT_REGISTRY を map しなおすか、request を discriminated union にする方が安全。
- **既存 4 agent の `buildPrompt({ anchor })` に `!` assertion**: Phase 5d で anchor optional 化した副作用。AgentDefinition を anchor-required / optional で型分離すると assertion を消せる。

## 実装ルール (必ず守る、次タスクも同じ)

1. **Plan に書かれた順で実装**。Task 1→2→3→...、飛ばさない。
2. **TDD を厳守**。各タスクは「failing test 書く → RED 確認 → 実装 → GREEN 確認 → commit」。
3. **1 タスク = 1 コミット**。plan 指定のコミットメッセージをそのまま使う。
4. **Biome / typecheck** を通してから commit。`NODE_ENV=development pnpm -r typecheck`。
5. **ADR-0007 準拠**。新エージェントの `allowedTools` は MCP と built-in を全列挙。
6. **AI は proposal しか作らない** (ADR-0005)。
7. **コミット規約**: Conventional Commits 日本語件名、scope は `core|ai-engine|storage|frontend|docs|chore|test|fix|refactor|style`。**`Co-Authored-By` と `Generated with Claude Code` フッタは絶対に付けない**。
8. **確認は `AskUserQuestion` ツール** で選択式。
9. **`NODE_ENV=development` で test / install / typecheck を実行**。

## 設計の非自明ポイント (実装者が見落としがち)

- **ingest-document は anchor 無し**: `AgentValidateOk.anchor` を optional にして対応。既存 4 agent は変更不要。
- **`AgentPromptInput.input?`**: buildPrompt が agent 固有入力 (`text` など) を受け取れるよう追加。既存 4 agent は input を使わないので互換。
- **agent-runner の fallback**: anchor 無しのとき `anchor: {x:0, y:0}` + `anchorId: ''` を create_node に渡す。question 重複ガードだけが anchorId を使うので、ingest-document (requirement/usecase を作る) は影響なし。
- **frontend の `startAgent` input 型**: `{ nodeId: string }` から `unknown` に緩めた。サーバ側が zod で検証するので実害なし。
- **`runAgentWithInput` は既存 `runAgentWS` と並設**: 破壊変更を避けるための一時的二重実装。follow-up で統合。

## 復元手順 (別 PC で続きをやる場合)

1. 本ドキュメントと spec / plan を読む
2. ADR-0005 (proposal 採用) と ADR-0007 (エージェントツール制約) を読む
3. `git log --oneline -15` で HEAD と一致するか確認
4. `NODE_ENV=development pnpm -r test` で全緑を確認 (274 テスト)
5. `NODE_ENV=development pnpm -r typecheck` で型エラーなしを確認
6. 次のタスクは Phase 5 完了記念の全体 codex レビュー or Phase 6 (書き出し)

## 更新ルール

Task N を完了 (commit + push 済み) したら、以下を本ファイルで更新:
- 進捗表の状態を「⏳ 未着手」→「✅ 完了」
- `担当 commit` 列に commit SHA 先頭 7 桁
- 「次のタスク」を 1 つ進める
- 「HEAD 情報」を最新 commit に差し替え
- 「テスト本数」合計を更新
