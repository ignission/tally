# 開発ワークフロー

このプロジェクト固有の Claude Code / gstack / superpowers / codex の使い分け。別 PC で作業を再開する Claude Code セッションも、ここを読んで前提を揃えること。

関連ドキュメント:
- ユーザー個人のグローバル指針 (応答スタイル、コミット規約) はユーザー自身の `~/.claude/CLAUDE.md` に集約されている (PC 間で user 自身が同期)
- 本リポジトリの実装指針は `CLAUDE.md`
- 進捗は `docs/phase-5b-progress.md` (Task 完了ごとに更新)

## Phase 実装の標準フロー

1. `docs/04-roadmap.md` の該当 Phase 節を読む
2. `superpowers:brainstorming` スキルで設計を詰める
3. `superpowers:writing-plans` で TDD ベースの実装計画を `docs/superpowers/plans/YYYY-MM-DD-<name>.md` に保存
4. `superpowers:subagent-driven-development` でタスクごとに implementer → spec review → code quality review サイクル
5. 各タスクのコミット粒度は小さく (1 タスク = 1 コミット、Biome / typecheck 修正があれば follow-up コミット)
6. Phase 完了時に全体最終レビュー (内部 `superpowers:code-reviewer` + codex セカンドオピニオン)

## gstack vs superpowers の使い分け

### gstack を使う場面 (ビジネス / 運用レンズ)
- `/office-hours` — アイデアの初期検証 (ビジネス・プロダクト視点)
- `/plan-ceo-review` — プロダクト判断・ビジネスレンズ
- `/plan-eng-review` — アーキテクチャのロック
- `/qa` — Playwright による自動 QA
- `/retro` — 週次統計・振り返り
- `/browse` — ヘッドレスブラウザ操作 (Web ブラウジング)
- `/ship` — リリース・PR 作成
- `/cso` — セキュリティ監査

### superpowers を使う場面 (技術設計 / 実装)
- `brainstorming` — 技術設計の Socratic 対話
- `writing-plans` — 2-5 分単位のタスク分割による実装計画
- `subagent-driven-development` — fresh subagent per task + 2 段階レビュー
- `requesting-code-review` — 並列コードレビュー
- `test-driven-development` — RED-GREEN-REFACTOR サイクル
- `finishing-a-development-branch` — マージ / PR 判定

### 統合フロー (推奨)
1. `/office-hours` (gstack) → アイデア検証
2. `/plan-ceo-review` + `/plan-eng-review` (gstack) → ビジネス & アーキテクチャ承認
3. `brainstorming` (superpowers) → 技術設計の深掘り
4. `writing-plans` (superpowers) → 実装計画
5. `subagent-driven-development` (superpowers) → 実装
6. レビュー: 軽量は `/review` (gstack)、重要は `requesting-code-review` (superpowers) + codex セカンドオピニオン
7. `/qa` (gstack) → 自動 QA
8. `/ship` (gstack) → リリース

## codex セカンドオピニオンの使い方

本リポジトリには `.claude/agents/` と `.claude/commands/` に codex 連携が設置済み。別 PC で使うには `codex login` が必要 (ユーザー認証は PC 固有)。

- **PR 前のセカンドオピニオン**: `/codex-review uncommitted`
- **ブランチ差分レビュー**: `/codex-review base main`
- **技術判断の相談**: `/codex-ask <議題>`

内部動作:
- バイナリ: `~/.local/share/mise/shims/codex` (絶対パス)
- サンドボックス: `-s read-only` 固定 (サブエージェント内にハードコード)
- 生出力は親エージェントに返さず、要点 (Critical / Important / Minor) だけ要約して返す
- 認証切れ (401) 時は `codex login` を案内して停止

`.claude/tmp/` は `.gitignore` 済み (生出力の退避先として使う場合)。

## 本プロジェクトのコミット規約まとめ (ユーザー global CLAUDE.md 準拠)

- Conventional Commits、日本語件名
- scope: `core | ai-engine | storage | frontend | docs | chore | test | fix | refactor | style`
- **`Co-Authored-By: Claude` フッタは絶対に付けない**
- **`Generated with Claude Code` フッタも絶対に付けない**
- ユーザーへの確認は `AskUserQuestion` ツールで選択式 (テキスト羅列禁止)
- main ブランチでの直接作業はユーザーの都度許可必須 (worktree も選択肢として提示)

## Task 完了時の報告フォーマット (CLAUDE.md 準拠)

1. **何を作ったか** (ファイル一覧)
2. **なぜその判断をしたか** (設計判断の理由)
3. **何を確認したか** (手動テスト結果、ユニットテスト結果)
4. **次のステップ** (ロードマップ上の位置)
5. **懸念事項** (動くが気になる点、後で見直すべき点)

## memory と repo 管理の切り分け

Claude Code のメモリ (`~/.claude/projects/<proj>/memory/`) は PC 間で同期されない。原則:

| 種別 | 保管場所 |
|---|---|
| 実装進捗 (Phase 5b の Task 完了状況など) | **repo** (`docs/phase-5b-progress.md`) |
| SDK / ライブラリの非自明な仕様メモ | **repo** (ADR として `docs/adr/`) |
| ツール / スキルの設置状況 (codex 連携など) | **repo** (`.claude/` 以下 + 本ドキュメント) |
| ワークフローのルール | **repo** (本ドキュメント) |
| ユーザー個人のコミュニケーションスタイル | ユーザーの `~/.claude/CLAUDE.md` (PC 間同期は user 側の責務) |
| 一時的な会話の覚え書き (次セッションで陳腐化するもの) | memory (repo には入れない) |

別 PC でセッションを立ち上げたとき、memory は空から始まるのが前提。必要な情報はすべて repo を読めば揃うよう本ドキュメントと `docs/phase-5b-progress.md` を最新に保つ。
