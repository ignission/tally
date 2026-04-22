# ADR-0009: プロジェクトレジストリによる発見

- **日付**: 2026-04-21
- **ステータス**: Accepted

## コンテキスト

旧設計では `ghq list -p` と `TALLY_WORKSPACE` 環境変数を使い、`.tally/` サブディレクトリを暗黙的にスキャンしてプロジェクトを発見していた。この方式には以下の問題がある。

- ghq がインストールされていない環境では動作しない
- `TALLY_WORKSPACE` の設定ミスやパス誤りで無言の失敗が起きる
- ghq で管理していないリポジトリは発見できない
- ADR-0008 でプロジェクトが任意のパスに置かれるようになったため、暗黙スキャンは根本的に成立しない

## 決定

- `$XDG_DATA_HOME/tally/registry.yaml`（省略時 `~/.local/share/tally/registry.yaml`）に既知プロジェクトのパスを明示的に記録する
- Registry エントリの形式: `{ id, path, lastOpenedAt }`
- プロジェクト作成時にレジストリへ自動登録する
- インポート操作（既存ディレクトリをレジストリに追加）とアンレジスト操作（レジストリから削除、ディレクトリは削除しない）を提供する
- 暗黙スキャン（ghq / TALLY_WORKSPACE）は全廃する

### registry.yaml の例

```yaml
projects:
  - id: proj_abc123
    path: /home/user/.local/share/tally/projects/taskflow-invite/
    lastOpenedAt: 2026-04-21T10:00:00Z
  - id: proj_def456
    path: /home/user/dev/myapp/.tally-project/
    lastOpenedAt: 2026-04-20T09:30:00Z
```

### 環境変数

- `TALLY_HOME`: レジストリのルートディレクトリを上書き（`$XDG_DATA_HOME/tally` 相当）
- `TALLY_WORKSPACE` は廃止

## 影響

- `TALLY_WORKSPACE` 環境変数を廃止し `TALLY_HOME` に置き換える
- ghq 連携コードを削除する
- レジストリファイルの並行編集は MVP では非対応（将来 fcntl lock を追加する余地を残す）
- ユーザーは初回利用時にプロジェクト作成またはインポートのアクションが必要になる

## 参考

- spec §レジストリ: `docs/superpowers/specs/2026-04-21-project-storage-redesign-design.md`
- [ADR-0008: プロジェクトをリポジトリから切り離す](./0008-project-independent-from-repo.md)
- [XDG Base Directory 仕様](https://specifications.freedesktop.org/basedir-spec/latest/)
