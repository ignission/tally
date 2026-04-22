# ADR-0008: プロジェクトをリポジトリから切り離す

- **日付**: 2026-04-21
- **ステータス**: Accepted
- **Supersedes**: [ADR-0003](./0003-git-managed-yaml.md)

## コンテキスト

ADR-0003 は 1 プロジェクト = 1 リポジトリを前提に `.tally/` サブディレクトリに YAML を置く設計だった。実運用でこの前提が崩れるケースが頻出している。

- フロントエンドとバックエンドが別リポジトリに分かれる構成（マルチリポ）が一般的
- 個人の思考ログや初期検証段階のアイデアなど、まだリポジトリに紐付けたくないプロジェクトの置き場所がない
- `.tally/` サブディレクトリはリポジトリのルートを「プロジェクトの境界」と暗黙的に定義してしまい、柔軟性を損なう

## 決定

- プロジェクトは任意のディレクトリとして扱う
- `.tally/` サブディレクトリ規約を廃止し、プロジェクトディレクトリ**直下**に `project.yaml` / `nodes/` / `edges/` / `chats/` を配置する
- プロジェクトはリポジトリの中でも外でも置ける
- デフォルトの置き場所は `~/.local/share/tally/projects/<slug>/`

### ディレクトリ構造

```
<project_dir>/
├── project.yaml
├── nodes/
│   ├── req-<id>.yaml
│   ├── uc-<id>.yaml
│   └── ...
├── edges/
│   └── edges.yaml
└── chats/
    └── chat-<id>.yaml
```

## 影響

- ADR-0003 は Superseded
- 暗黙スキャン（ghq / TALLY_WORKSPACE）を廃止する（ADR-0009 で詳述）
- 1 プロジェクト = 1 リポジトリという前提を解消する（ADR-0010 で詳述）
- 既存の `.tally/` 配下データは移行ツールまたはマニュアル手順が必要

## 参考

- spec: `docs/superpowers/specs/2026-04-21-project-storage-redesign-design.md`
- [ADR-0009: プロジェクトレジストリによる発見](./0009-project-registry.md)
- [ADR-0010: 複数 codebases の参照モデル](./0010-multiple-codebases.md)
