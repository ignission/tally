---
description: 現在の変更を codex にセカンドオピニオンとしてレビューさせる
argument-hint: "[uncommitted|base <branch>|commit <sha>] [追加の着眼点]"
---

`codex-reviewer` サブエージェントを使い、以下の対象で codex によるコードレビューを取得してください。

**対象**: $ARGUMENTS

引数が空なら未コミット変更（`--uncommitted`）を対象にする。
引数に自然言語で「PR 直前チェック」「main 比較」などが来たら、意図を汲んで `--uncommitted` / `--base main` / `--commit <SHA>` のいずれかにマップする。

サブエージェント呼び出し後、返ってきた要約をそのままユーザーに提示してください。Claude 自身の追加レビューは、ユーザーから明示的に求められた場合のみ追記する。
