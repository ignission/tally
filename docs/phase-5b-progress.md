# Phase 5b 実装進捗

**本ドキュメントは Claude Code のメモリ代替。別 PC へ引き継いでも最新状態を復元できるよう、タスク完了の都度ここを更新する。**

関連ドキュメント:
- 設計書 (spec): [`docs/superpowers/specs/2026-04-19-phase5b-analyze-impact-design.md`](superpowers/specs/2026-04-19-phase5b-analyze-impact-design.md)
- 実装計画 (plan): [`docs/superpowers/plans/2026-04-19-phase5b-analyze-impact.md`](superpowers/plans/2026-04-19-phase5b-analyze-impact.md)
- 前 Phase 進捗: Phase 5a は完了、[`docs/04-roadmap.md`](04-roadmap.md) 参照
- ADR-0007 (エージェントツール制約): [`docs/adr/0007-agent-tool-restriction.md`](adr/0007-agent-tool-restriction.md) **実装前に必読**

## 全体状況 (2026-04-19 時点)

| Phase | 状態 |
|---|---|
| 0-4 | 完了 (キャンバス基盤 + proposal 採用 + decompose-to-stories エージェント + Claude Code OAuth) |
| 5a | 完了 (find-related-code + codebasePath UI + ADR-0007 のツール制約基盤) |
| **5b** | **完了 (13 タスク全完了、手動 E2E は別途実施)** |
| 5c-d | 未着手 (`extract-questions` / `ingest-document`) |
| 6+ | 未着手 |

## Phase 5b タスク進捗

| # | タスク | 状態 | 担当 commit |
|---|---|---|---|
| 1 | core: `AGENT_NAMES` 拡張 + `CodeRefNodeSchema` に `summary` / `impact` 追加 + 02-domain-model.md 更新 | ✅ 完了 | `a307660` + `e4f783f` (minor コメント追加) |
| 2 | ai-engine: `validateCodebaseAnchor` 共通ヘルパ抽出 + `find-related-code` 移行 | ✅ 完了 | `3dc1e37` |
| 3+4 | ai-engine: `analyze-impact` プロンプト + `analyzeImpactAgent` 定義 + registry 登録 | ✅ 完了 | `ddeb203` (Task 3+4 統合) |
| 5 | ai-engine: `agent-runner.test.ts` に analyze-impact happy-path | ✅ 完了 | `4a9d979` |
| 6 | ai-engine: `create_node` に coderef 重複ガード + filePath 正規化 + `sourceAgentId` 注入 | ✅ 完了 | `b1bf0fb` |
| 7 | ai-engine: `buildTallyMcpServer` / `agent-runner` に `agentName` 配線 | ✅ 完了 | `b88528c` |
| 8 | frontend: `CodebaseAgentButton` 共通抽出 | ✅ 完了 | `7294ce7` |
| 9 | frontend: `FindRelatedCodeButton` を thin wrapper に書き換え | ✅ 完了 | `57ca1ea` |
| 10 | frontend: store に `startAnalyzeImpact` 追加 | ✅ 完了 | `c45b7f5` |
| 11 | frontend: `AnalyzeImpactButton` 新規 (関連 coderef 有無で tooltip 切り替え) | ✅ 完了 | `6a29b23` |
| 12 | frontend: 3 detail (UC/req/story) に `AnalyzeImpactButton` 配置 | ✅ 完了 | `5f3c7cd` |
| 13 | docs: `phase-5b-manual-e2e.md` 新規 + `04-roadmap.md` 更新 + 本ファイル更新 + 全緑確認 | ✅ 完了 | (本コミット) |

**次のタスク**: Phase 5c `extract-questions` (別 spec で設計から)

## HEAD 情報 (引き継ぎ時に git log で確認すべき)

- ブランチ: `main` (worktree なし、ユーザー明示同意のもと直接 main に commit する運用)
- Phase 5b 完了時点の最新 commit は Task 13 の「docs: Phase 5b 完了マーク」

## テスト本数 (Phase 5b 完了時点)

- `@tally/core`: 36 tests (Task 1 で +2)
- `@tally/ai-engine`: 74 tests (Task 2 で +6、Task 3+4 で +10、Task 5 で +1、Task 6 で +10、Task 7 で ±0 = +27 累計)
- `@tally/storage`: 46 tests (変更なし)
- `@tally/frontend`: 76 tests (Task 8 で +4、Task 9 で -2、Task 10 で +1、Task 11 で +5、Task 12 で +1 = +9 累計)
- 合計 **232 テスト全緑**

## Phase 5b 完了後の follow-up (別 PR で対応推奨)

### 実装 / UX
- **usecase-detail.test.tsx のテスト間状態漏れ**: `runningAgent` 等が後続テストに残る。`beforeEach: useCanvasStore.getState().reset()` を入れるべき (Task 12 で一時的に新テスト冒頭で reset() 呼び出しで回避)
- **docs/phase-5a-manual-e2e.md のタイポ**: `以p上の` → `以上の` (Phase 5a 時点のユーザー由来の編集ミス)

### codex レビューで指摘された Trust boundary (早めに方針固定推奨)
- **filePath の絶対パス / 親ディレクトリ参照の扱い**: 現状 `normalizeFilePath` は `./` を剥ぐだけで、`/etc/passwd` や `../../x` も素通り。spec には「絶対パスは警告ログ」と書いたが実装未対応。対応案: (a) `..` を含む path を reject (b) 絶対パスを reject (c) `codebasePath` 配下に解決できる相対パスだけ許可
- **codebasePath の workspace 配下制約**: ユーザーが codebasePath に任意の絶対パス (例: `/`) を設定すると SDK の cwd が workspace 外になる。信頼できるローカル利用前提なら現状で妥当だが、非信頼プロジェクトを開くケースを想定するなら workspace 配下への制約 (`path.relative` で `..` 含むなら reject) が必要
- **`additional` の trust boundary 明文化**: `z.record(z.unknown())` + `ProposalNodeSchema.passthrough()` のまま、AI が任意キーを proposal YAML に永続化可。`summary` / `impact` / `sourceAgentId` のようにメタデータを使い始めたので「proposal は非構造化 AI 出力を含み得る」前提を ADR-0005 か domain-model に明文化推奨

### 将来拡張の論点 (Phase 5c 以降)
- **採用後の正規ノードで sourceAgentId を保持するか**: 現状 `transmuteNode` 時に proposal → 正規ノードで sourceAgentId が落ちる。provenance を UI で表示したくなったら ADR-0005 改訂が必要
- **issue のサーバ側重複ガード**: 現状プロンプト指示のみ。issue が主役の analyze-impact で重複が実害化したら、anchor + title 単位でサーバ側ガードを入れる候補

## 実装ルール (必ず守る)

1. **Plan に書かれた順で実装**。Task 1→2→3→...、飛ばさない。Task 4 の registry 登録は Task 3 の完了が前提。
2. **TDD を厳守**。plan の各タスクは「failing test 書く → RED 確認 → 実装 → GREEN 確認 → commit」のステップに分かれている。`pnpm --filter ... test` の RED/GREEN を必ず実行して確認してから進める。
3. **1 タスク = 1 コミット** が基本。plan 指定のコミットメッセージをそのまま使う。
4. **Biome / typecheck** を通してから commit。コミット前に `pnpm --filter <pkg> test` と、変更が複数 package にまたがるなら `pnpm -r test` も。
5. **ADR-0007 準拠**。新エージェントの `allowedTools` は registry 宣言に「MCP と built-in を全列挙」するだけ。`agent-runner` が自動で `tools` / `allowedTools` に振り分けて SDK に渡す。手動分離は禁止。
6. **AI は proposal しか作らない** (ADR-0005)。Tool `create_node` は常に `type: 'proposal'`、`adoptAs` で将来の昇格先を宣言。
7. **コミット規約**: Conventional Commits 日本語件名、scope は `core|ai-engine|storage|frontend|docs|chore|test|fix|refactor|style`。**`Co-Authored-By` と `Generated with Claude Code` フッタは絶対に付けない**。
8. **確認は `AskUserQuestion` ツール** で選択式。テキスト羅列で確認するのは禁止 (ユーザー global CLAUDE.md)。

## 重要な SDK 仕様メモ (ADR-0007 の要約)

Claude Agent SDK の `Options` の各フィールドは名前から想像しにくい挙動を持つ。新エージェント追加時は必ず ADR-0007 を読むこと。

| フィールド | 実際の役割 |
|---|---|
| `allowedTools` | **自動承認 (auto-approve) リスト**。whitelist では**ない**。 |
| `disallowedTools` | 明示的に禁止。新 built-in ツールが追加されると追従が必要 |
| `tools` | built-in ツール (`Bash` / `Read` / `Glob` / `Grep` / `Edit` / `Write` 等) の**実質的 whitelist**。`[]` なら built-in 全オフ。MCP ツールはここでは指定しない |
| `permissionMode: 'dontAsk'` | 承認外は拒否 (WS セッションにプロンプト UI がないため) |
| `settingSources: []` | `~/.claude/settings.json` 等の外部権限を遮断 |

`agent-runner.ts` が全エージェントにこの 4 点を自動適用する。registry の `allowedTools` に「使いたいツールを MCP / built-in 問わず全列挙」すれば済む。

## 設計の非自明ポイント (実装者が見落としがち)

- **coderef 重複ガード** (Task 6): サーバ側で `filePath + startLine ±10 行` の近接を判定して重複 proposal をブロック。filePath は `path.posix.normalize` + 先頭 `./` 剥ぎで正規化してから比較。
- **analyze-impact は issue が主役**: coderef proposal は「find-related-code が拾えていなかった新規変更点のみ補う副次的出力」。「同じ coderef を別方向から見ただけ」にならないようプロンプトで明示 (spec §1 の棲み分け表)。
- **`CodeRefNodeSchema.impact`**: `analyze-impact` 由来のみ書く。find-related-code は書かない (spec §1 契約、schema.ts コメント済)。
- **AnalyzeImpactButton の UX 誘導**: anchor に紐づく coderef が 0 件の時は tooltip で「まず『関連コードを探す』を推奨」と出す。**disabled にはしない** (あえて analyze-impact から使いたいケースを塞がない)。

## 復元手順 (別 PC で続きをやる場合)

1. 本ドキュメントと [`docs/superpowers/specs/2026-04-19-phase5b-analyze-impact-design.md`](superpowers/specs/2026-04-19-phase5b-analyze-impact-design.md)、[`docs/superpowers/plans/2026-04-19-phase5b-analyze-impact.md`](superpowers/plans/2026-04-19-phase5b-analyze-impact.md) を読む
2. ADR-0007 ([`docs/adr/0007-agent-tool-restriction.md`](adr/0007-agent-tool-restriction.md)) を読む
3. `git log --oneline -10` で HEAD と一致するか確認
4. `pnpm -r test` で全緑を確認 (202 テスト全緑が出発点)
5. 本ファイルの「次のタスク」から着手
6. タスク完了ごとに本ファイルの進捗表を更新してコミット

## 更新ルール

Task N を完了 (commit + push 済み) したら、以下を本ファイルで更新:
- 進捗表の状態を「⏳ 未着手」→「✅ 完了」
- `担当 commit` 列に commit SHA 先頭 7 桁
- 「次のタスク」を 1 つ進める
- 「HEAD 情報」を最新 commit に差し替え
- 「テスト本数」の合計を更新 (変動した package 数のみ)

更新自体は独立コミット不要。実装コミットに同梱して良い (scope は `docs` が自然、または対象 package スコープに含めても可)。
