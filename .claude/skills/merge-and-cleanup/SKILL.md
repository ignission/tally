---
name: merge-and-cleanup
description: PRマージ → main 最新化 → ローカル/リモートブランチ削除を一括実行
allowed-tools: Bash
argument-hint: [PR番号]
---

## PR マージ後のクリーンアップ

PR $0 をマージし、main を最新化してマージ済みブランチを掃除する。

## 手順

以下の順序で実行すること:

### 1. PR マージ (squash + リモートブランチ削除)

```bash
gh pr merge $0 --squash --delete-branch
```

### 2. ローカル main 最新化

```bash
git checkout main && git pull
```

### 3. マージ済みローカルブランチの掃除

リモートが削除されたローカルブランチを検出して削除:

```bash
git fetch --prune
git branch -vv | grep '\[origin/.*: gone\]' | awk '{print $$1}' | xargs -r git branch -d
```

`-d` は未マージブランチを拒否するため、誤削除を防げる。強制削除が必要な場合はユーザーに確認すること。

## 完了報告

全ステップ完了後、以下を報告:

- PR #$0 マージ完了
- ブランチ: main (最新)
- 削除したローカルブランチ一覧
