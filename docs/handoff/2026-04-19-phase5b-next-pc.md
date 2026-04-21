# Phase 5b 引き継ぎ (別 PC で再開する際のセットアップ)

**状況**: 2026-04-19 夜、Phase 5b を別 PC で続ける必要が出た。Phase 5a 完了 + Phase 5b Task 1-2 完了済みの状態で中断。メモリ (`~/.claude/projects/.../memory/`) は PC 間で自動同期されないため、必要な状態情報はすべてリポジトリに移した。本ドキュメントは別 PC で Claude Code を立ち上げた時の最初の手順と、そのまま貼り付けて使える初期プロンプトを提供する。

---

## セットアップ手順 (別 PC 側)

### 1. リポジトリを clone (まだなら)

```bash
git clone git@github.com:ignission/tally.git
cd tally
```

### 2. ツールチェイン準備

- [mise](https://mise.jdx.dev/) インストール
- `mise install` で `.mise.toml` の Node.js を入れる (もしくは直接 pnpm / Node 22)
- `mise` があれば `pnpm` 等が自動で shim 経由に
- `.env` は `.env.example` をコピー (ADR-0006 参照)

### 3. 依存インストール + 全緑確認

```bash
pnpm install
pnpm -r test   # 202 テスト全緑が出発点 (core 36 / ai-engine 53 / storage 46 / frontend 67)
pnpm -r typecheck
```

通らなければ「ここから何かが壊れている」= 引き継ぎ前提が崩れているサイン。原因特定してから実装着手。

### 4. Claude Code (CLI) 認証

- `claude login` で ChatGPT / Claude Code サブスクの OAuth 認証 (ADR-0006)
- もしくは `ANTHROPIC_API_KEY` を `.env` に設定
- `packages/ai-engine` の手動 E2E で実通信が発生するが、自動 CI テストは通信しない (mock のみ)

### 5. codex CLI 認証 (推奨、壁打ち用)

ユーザー固有設定だがリポジトリには `.claude/agents/codex-{reviewer,sounding-board}.md` が既にコミット済み。別 PC でも使うなら:

```bash
codex login
```

切れると 401。

### 6. Claude Code セッション起動

リポジトリルートで `claude` を起動し、下記「初期プロンプト」を貼り付けて始める。

---

## 初期プロンプト (Claude Code に貼り付ける)

以下をそのまま Claude Code の最初の入力として使う。`**` 装飾は自然な強調、コピー時に残しても問題ない。

```
別 PC から作業を引き継ぎます。Phase 5b (analyze-impact エージェント) の実装途中です。

まず以下を順に読み、状態を把握してください:

1. `CLAUDE.md` (プロジェクト指針、禁止事項、コミット規約) ── 必読
2. `docs/workflow.md` (開発ワークフロー、gstack / superpowers / codex の使い分け、memory と repo の切り分け)
3. `docs/phase-5b-progress.md` (実装進捗。メモリ代替。本ドキュメントが HEAD と一致するかを git log で確認)
4. `docs/superpowers/specs/2026-04-19-phase5b-analyze-impact-design.md` (設計書)
5. `docs/superpowers/plans/2026-04-19-phase5b-analyze-impact.md` (TDD 実装計画、13 タスク)
6. `docs/adr/0007-agent-tool-restriction.md` (Agent SDK ツール制約の非自明な仕様)

読了後、以下を報告してください:

- 現在の HEAD commit SHA と `docs/phase-5b-progress.md` の「HEAD 情報」が一致しているか
- `pnpm -r test` を実行した結果 (合計テスト数、全緑か)
- 次に着手すべきタスク番号とその内容要約
- 進捗表に誤りや陳腐化があれば指摘

確認 OK が出たら `superpowers:subagent-driven-development` スキルを使って、Task 3 から subagent-driven で実装を再開してください。1 タスクごとに implementer → spec reviewer → code quality reviewer のサイクル。

作業ルール (Phase 5a と同じ):
- main ブランチに直接 commit (worktree なし、私が明示同意済み)
- `AskUserQuestion` ツールで選択式確認 (テキスト羅列禁止)
- コミットに `Co-Authored-By` / `Generated with Claude Code` フッタは絶対に付けない
- タスク完了ごとに `docs/phase-5b-progress.md` の進捗表を更新してコミットに含める (scope は `docs` か対象 package)
- Phase 5b 全タスク完了後は全体最終レビュー (内部 `superpowers:code-reviewer` + codex セカンドオピニオン `/codex-review base <Phase 5b 開始直前の SHA>`) を並行投入
- 手動 E2E は Task 13 で `docs/phase-5b-manual-e2e.md` を新規作成する (Phase 5a E2E 手順書と同形式)

まずドキュメント読了後の報告を待ちます。
```

---

## 本 PC (中断側) の状態メモ

引き継ぎ直前の状況。別 PC で `pnpm -r test` が緑なら不要な情報。

- 最新 commit: `3dc1e37 refactor(ai-engine): validateCodebaseAnchor 共通ヘルパ抽出 + find-related-code 移行`
- push 済み (origin/main 同期)
- ブランチ: `main` (worktree 未使用)
- 未 commit の変更: `docs/phase-5a-manual-e2e.md` に **無関係なタイポ** が 1 箇所残っている (`以p上の` という入力ミス、ユーザー由来)。Phase 5b とは無関係なので触らず放置。気になるなら別 PR で修正推奨。
- Task 2 の code-quality review は未実施のまま中断 (spec review は ✅ 通過、コミットは整合)

## Phase 5b 完了までの大まかな流れ (別 PC 側が計画しやすいように)

plan ファイルに詳細があるが概観:

- **Task 3-5**: ai-engine に analyze-impact エージェント本体を追加 (prompt → agent definition → registry → runner テスト)
- **Task 6-7**: create_node に重複ガード + filePath 正規化 + sourceAgentId 配線
- **Task 8-9**: frontend の CodebaseAgentButton 抽出 + FindRelatedCodeButton リファクタ
- **Task 10-12**: frontend に startAnalyzeImpact / AnalyzeImpactButton / 3 detail 配置
- **Task 13**: ドキュメント + ロードマップ + 全緑確認

目安: 各 Task は 2-5 分のステップ × 5-8 個。subagent-driven で 1 Task あたり implementer 1 + reviewer 2 の計 3 subagent を dispatch する前提 (skill のルール)。13 Task × 3 = 39 subagent 程度。

## 困ったら

- spec / plan と現実が食い違う → plan を信じる。ズレがあれば spec/plan の方を修正してから実装に戻る。
- `AGENT_REGISTRY satisfies Record<AgentName, AgentDefinition>` で TS エラー → Task 4 未完了のシグナル (Task 1 で AGENT_NAMES を先に拡張したため、Task 4 完了まで `pnpm --filter ai-engine build` は通らない。Task 4 完了で解消)。Task 3 時点では `test` のみで確認可。
- 手動 E2E で SDK が変なツールを呼び出す → ADR-0007 の仕様差を再確認。`tools: []` と `permissionMode: 'dontAsk'` の両方が渡っているか `agent-runner.ts` で確認。

## 本 PC 側でやり残し

なし。本ドキュメントと `docs/phase-5b-progress.md` を commit + push したら完了。
