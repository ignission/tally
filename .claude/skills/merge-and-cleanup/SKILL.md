---
name: merge-and-cleanup
description: PRマージ → worktree/ローカルブランチ掃除 → main 最新化を一括実行
allowed-tools: Bash
argument-hint: [PR番号]
---

## PR マージ後のクリーンアップ

PR $0 をマージし、worktree で作業中ならそれも削除、main を最新化する。

## 手順

以下の順序で実行すること:

### 1. 現在の作業ツリーを判定

```bash
# .git がファイルなら worktree、ディレクトリならメインツリー
if [ -f .git ]; then
  WORKTREE_PATH=$(pwd)
  MAIN_TREE=$(git worktree list --porcelain | awk '/^worktree/{print $$2; exit}')
  IS_WORKTREE=1
else
  IS_WORKTREE=0
fi
```

### 2. PR マージ (squash + リモートブランチ削除)

```bash
gh pr merge $0 --squash --delete-branch
```

### 3. worktree の場合: メインツリーへ移動して worktree 削除

```bash
if [ "$IS_WORKTREE" = "1" ]; then
  cd "$MAIN_TREE"
  git worktree remove "$WORKTREE_PATH" --force
fi
```

`--force` はマージ済みなので安全。未コミット変更があれば事前に停止する。

### 4. main 最新化

```bash
git checkout main && git pull
git fetch --prune
```

### 5. マージ済みローカルブランチの掃除

リモートが削除されたローカルブランチを検出して削除:

```bash
git branch -vv | grep '\[origin/.*: gone\]' | awk '{print $$1}' | xargs -r git branch -d
```

`-d` は未マージブランチを拒否するため誤削除を防げる。強制削除が必要な場合はユーザーに確認すること。

### 6. worktree 追加クリーンアップ (オプション)

その他の孤立 worktree を検出:

```bash
git worktree prune -v
```

`.git/worktrees/` に残った無効エントリを削除する。

## 完了報告

全ステップ完了後、以下を報告:

- PR #$0 マージ完了
- worktree 削除: あり/なし (パス)
- ブランチ: main (最新)
- 削除したローカルブランチ一覧
