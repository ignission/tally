# Phase 5e 実装進捗

**本ドキュメントは Claude Code のメモリ代替**。別 PC 引き継ぎ可能。

関連:
- 設計書: [`specs/2026-04-20-phase5e-ingest-docs-dir-design.md`](superpowers/specs/2026-04-20-phase5e-ingest-docs-dir-design.md)
- 実装計画: [`plans/2026-04-20-phase5e-ingest-docs-dir.md`](superpowers/plans/2026-04-20-phase5e-ingest-docs-dir.md)
- 前 Phase: [`phase-5d-progress.md`](phase-5d-progress.md)

## 全体状況

| Phase | 状態 |
|---|---|
| 0-5c | 完了 |
| 5d | 完了 (ingest-document paste モード) |
| **5e** | **完了 (ingest-document に docs-dir モード追加)** |
| 5f+ | 未着手 |

## タスク進捗

| # | タスク | 状態 | commit |
|---|---|---|---|
| 1 | ai-engine: ingest-document に discriminated input + docs-dir | ✅ 完了 | `a8d69c1` |
| 2 | frontend: store.startIngestDocument を IngestDocumentInput 受けに | ✅ 完了 | `0ea6577` |
| 3 | frontend: IngestDocumentDialog にタブ切替追加 | ✅ 完了 | `de1ce98` |
| 4 | docs: 04-roadmap + phase-5e-manual-e2e + 本ファイル + 最終全緑 | ✅ 完了 | (本コミット) |

## HEAD 情報

- ブランチ: `main` (worktree なし、ユーザー明示同意で main 直 commit)
- Phase 5e 完了時の最新 commit は Task 4 の「docs: Phase 5e 完了マーク」

## テスト本数 (Phase 5e 完了時点)

- `@tally/core`: 38 (変更なし)
- `@tally/storage`: 46 (変更なし)
- `@tally/ai-engine`: 107 (Task 1 で +6)
- `@tally/frontend`: 94 (Task 2 で +1、Task 3 で +2)
- 合計 **285 テスト全緑** (Phase 5d 完了時 276 → +9)

## follow-up (Phase 5f+)

- `summarize-codebase` エージェント (コード直読みで req/UC 逆生成)
- as-is / to-be 区別の schema 化 (既存仕様と新要求を Node で区別)
- 再 ingest 時の重複ガード (docs 差分検出)
- doc → node の trace エッジ (出典 metadata 保持)
- 階層表示 / キャンバス認知負荷対策 (ノード爆発対策)
- 任意拡張子対応 (`.adoc` / `.rst`)
- 大規模 docs の分割 ingest (100+ files)
- `runAgentWS` と `runAgentWithInput` の統合 (重複削減)
- `IngestDocumentInput` 型を core に昇格 (ai-engine と frontend で重複定義)

## 実装ルール (Phase 5d と同じ)

1. TDD: failing test → RED → 実装 → GREEN → commit
2. Conventional Commits 日本語、scope は `ai-engine|frontend|docs`
3. **`Co-Authored-By` / `Generated with Claude Code` フッタ絶対に付けない**
4. `NODE_ENV=development` で test/build/typecheck
5. ADR-0007 準拠: allowedTools は MCP + 使う built-in を全列挙

## 設計の非自明ポイント

- **discriminated union 入力**: `source` 判別子で分岐。zod が UI / AI 両側で安全に扱える
- **workspaceRoot 配下制約**: `path.relative(workspaceRoot, resolved).startsWith('..')` で検証 + 絶対パス拒否。シンボリックリンク経由の脱出は拾わない (本ケースは許容範囲)
- **cwd は workspaceRoot**: docs-dir モードでは AI が Glob/Read で走査するため cwd 必須
- **paste モードは cwd 無し**: 貼り付けならファイル読まないので cwd 不要、5d 互換
- **allowedTools に Read/Glob 常時追加**: paste モードでも付与されるが、プロンプトが file 参照しないので AI は呼ばない想定。ADR-0007 準拠
- **ダイアログは 1 つでタブ切替**: dialog 1 + state 1 (mode: 'paste'|'docs-dir') + label の出し分けで分岐、重複コンポーネントを回避

## 復元手順 (別 PC で続きを)

1. 本ドキュメントと spec / plan / ADR-0007 を読む
2. `git log --oneline -10` で HEAD 確認
3. `NODE_ENV=development pnpm -r test` で全緑確認 (≈285)
4. `NODE_ENV=development pnpm -r typecheck` で型緑確認
5. 次は Phase 5f (`summarize-codebase` or as-is/to-be 区別 or ドッグフード結果次第)
