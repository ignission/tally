# Phase 5c 実装進捗

**本ドキュメントは Claude Code のメモリ代替。別 PC へ引き継いでも最新状態を復元できるよう、タスク完了の都度ここを更新する。**

関連ドキュメント:
- 設計書 (spec): [`docs/superpowers/specs/2026-04-20-phase5c-extract-questions-design.md`](superpowers/specs/2026-04-20-phase5c-extract-questions-design.md)
- 実装計画 (plan): [`docs/superpowers/plans/2026-04-20-phase5c-extract-questions.md`](superpowers/plans/2026-04-20-phase5c-extract-questions.md)
- 前 Phase 進捗: [`docs/phase-5b-progress.md`](phase-5b-progress.md) (Phase 5b 完了)
- ADR-0007 (エージェントツール制約): [`docs/adr/0007-agent-tool-restriction.md`](adr/0007-agent-tool-restriction.md) **実装前に必読**

## 全体状況 (2026-04-20 時点)

| Phase | 状態 |
|---|---|
| 0-4 | 完了 |
| 5a | 完了 (find-related-code) |
| 5b | 完了 (analyze-impact) |
| **5c** | **完了 (extract-questions、11 タスク全完了、手動 E2E は別途実施)** |
| 5d | 未着手 (`ingest-document`) |
| 6+ | 未着手 |

## Phase 5c タスク進捗

| # | タスク | 状態 | 担当 commit |
|---|---|---|---|
| 1 | core: AGENT_NAMES 拡張 + newQuestionOptionId 追加 | ✅ 完了 | `b7d9508` |
| 2 | ai-engine: validateCodebaseAnchor に requireCodebasePath オプション追加 | ✅ 完了 | `5f82602` |
| 3 | ai-engine: extract-questions エージェント (プロンプト + 定義) | ✅ 完了 | `f1530e8` |
| 4 | ai-engine: registry 登録 + agent-runner happy-path | ✅ 完了 | `f7400aa` |
| 5 | ai-engine: create_node で adoptAs=question の options 正規化 (decision=null 固定) | ✅ 完了 | `5efcf6f` |
| 6 | ai-engine: create_node で anchor+同タイトル重複ガード + anchorId 配線 | ✅ 完了 | `cbaeda9` |
| 7 | frontend: GraphAgentButton 共通抽出 | ✅ 完了 | `db99cf8` |
| 8 | frontend: store に startExtractQuestions 追加 | ✅ 完了 | `87e31d7` |
| 9 | frontend: ExtractQuestionsButton 追加 | ✅ 完了 | `8f0e4d3` |
| 10 | frontend: 3 detail に ExtractQuestionsButton 配置 | ✅ 完了 | `2635ca3` |
| - | Task 5/7 の typecheck エラー follow-up fix | ✅ 完了 | `dc598d9` |
| 11 | docs: 02-domain-model.md + 04-roadmap.md 更新 + phase-5c-manual-e2e.md + 本ファイル | ✅ 完了 | `a3f4e0d` |
| - | codex セカンドオピニオン対応 (options 最低 2 個強制 + session-local 重複ガード) | ✅ 完了 | `91dacff` |

**次のタスク**: Phase 5d `ingest-document` (別 spec で設計から)

## HEAD 情報

- ブランチ: `main` (worktree なし、ユーザー明示同意のもと直接 main に commit する運用)
- Phase 5c 完了時点の最新 commit は Task 11 の「docs: Phase 5c 完了マーク」

## テスト本数 (Phase 5c 完了時点)

- `@tally/core`: 38 tests (Task 1 で +2)
- `@tally/ai-engine`: 93 tests (Task 2 で +2、Task 3 で +7、Task 4 で +1、Task 5 で +2、Task 6 で +3、codex fix で +3、計 74→93)
- `@tally/storage`: 46 tests (変更なし)
- `@tally/frontend`: 83 tests (Task 7 で +3、Task 8 で +1、Task 9 で +2、Task 10 で +1 = +7 累計)
- 合計 **260 テスト全緑** (Phase 5b 完了時の 232 → +28。codex fix で ai-engine +3)

## Phase 5c 完了後の follow-up (別 PR で対応推奨)

### 実装 / UX
- **analyze-impact の issue 重複ガード**: 現状プロンプト任せ。extract-questions で確立した anchor+同タイトルガードを issue proposal にも適用する follow-up PR。
- **QuestionNodeSchema の options 制約**: extract-questions 経由では必ず 2〜4 個だが、UI の手動編集では 0 個から始まる。スキーマ側で min/max を強制するかは別論点として残す。

### コード品質 (Task 6 レビューで指摘された軽微事項)
- **create_node の adoptAs='question' ブロック統合**: options 正規化 + 重複ガードが連続する 2 つの `if (adoptAs === 'question')` ブロックになっている。1 ブロックに統合すると読みやすい。
- **Node 型の narrow**: dedup の `rec` キャスト (`as unknown as {...}`) より discriminated union の `n.type === 'question'` / `n.type === 'proposal' && n.adoptAs === 'question'` の方が型安全。小規模な refactor 候補。

### UI 統合
- **CodebaseAgentButton / GraphAgentButton の統合**: 差分は codebasePath 分岐のみ。さらに他のグラフ系エージェントが増えたら `requireCodebasePath` prop で 1 コンポーネント化を検討。現時点では並列維持。
- **AnchorNode 型の重複 export**: `codebase-agent-button.tsx` と `graph-agent-button.tsx` に同一の型定義。片方に寄せるか共通モジュールへ抽出。

### 将来拡張
- **question の sourceAgentId 保持**: 現状 transmuteNode で proposal → 正規 question になると sourceAgentId が落ちる (5a/5b 共通の未決定論点)。

## 実装ルール (必ず守る、次タスクも同じ)

1. **Plan に書かれた順で実装**。Task 1→2→3→...、飛ばさない。
2. **TDD を厳守**。各タスクは「failing test 書く → RED 確認 → 実装 → GREEN 確認 → commit」のステップ。
3. **1 タスク = 1 コミット** が基本。plan 指定のコミットメッセージをそのまま使う。
4. **Biome / typecheck** を通してから commit。`NODE_ENV=development pnpm -r typecheck` を最終確認。
5. **ADR-0007 準拠**。新エージェントの `allowedTools` は registry 宣言に「MCP と built-in を全列挙」するだけ。
6. **AI は proposal しか作らない** (ADR-0005)。
7. **コミット規約**: Conventional Commits 日本語件名、scope は `core|ai-engine|storage|frontend|docs|chore|test|fix|refactor|style`。**`Co-Authored-By` と `Generated with Claude Code` フッタは絶対に付けない**。
8. **確認は `AskUserQuestion` ツール** で選択式。
9. **`NODE_ENV=development` で test / install / typecheck を実行する** (本 PC 固有の罠。shell の `NODE_ENV=production` が react-dom/testing-library に影響し、React production build が `act` を剥ぎ取って 26 本 fail する)。

## 設計の非自明ポイント (実装者が見落としがち)

- **question は codebasePath 不要**: find-related-code / analyze-impact と違い、`validateCodebaseAnchor` に `{ requireCodebasePath: false }` を渡す。
- **allowedTools に built-in を含めない**: MCP 4 個のみ (Glob/Grep/Read 無し)。ADR-0007 により `agent-runner` が `tools: []` を SDK に渡して built-in ツールを自動遮断する。
- **proposal の options は passthrough で保持**: `ProposalNodeSchema.passthrough()` のおかげで `options` / `decision` がスキーマ検証を通過。採用時に `ProposalDetail` が additional として渡し、`transmuteNode` 内の `NodeSchema.parse` で QuestionNodeSchema が options を正しくバリデートする。スキーマ変更不要。
- **options の ID 生成はサーバ側**: AI は `{ text }` だけ渡す。`create_node` で `opt-xxxxxxxxxx` を付与し `selected: false` / `decision: null` を固定。AI の ID 生成は不安定なので信頼しない。
- **anchor+同タイトル重複ガード**: anchor の近傍に同タイトル question (正規 or proposal) があれば reject。比較は `stripAiPrefix` で揃える。
- **agent-runner のテストで mock SDK は MCP handler を呼ばない**: 実 SDK は MCP runtime を内包するが mock は持たない。agent-runner の integration test は start / tool_use / error 等の高レベルイベント通過のみ検証し、`store.addNode` 副作用の検証は `create-node.test.ts` の unit test に任せる。

## 復元手順 (別 PC で続きをやる場合)

1. 本ドキュメントと設計書 / plan を読む
2. ADR-0007 を読む
3. `git log --oneline -15` で HEAD と一致するか確認
4. `NODE_ENV=development pnpm -r test` で全緑を確認 (257 テスト)
5. `NODE_ENV=development pnpm -r typecheck` で型エラーなしを確認
6. Phase 5d `ingest-document` は未着手なので、次は `superpowers:brainstorming` で spec から

## 更新ルール

Task N を完了 (commit + push 済み) したら、以下を本ファイルで更新:
- 進捗表の状態を「⏳ 未着手」→「✅ 完了」
- `担当 commit` 列に commit SHA 先頭 7 桁
- 「次のタスク」を 1 つ進める
- 「HEAD 情報」を最新 commit に差し替え
- 「テスト本数」合計を更新
