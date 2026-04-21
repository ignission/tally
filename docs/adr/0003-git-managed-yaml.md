# ADR-0003: プロジェクトを `.tally/` ディレクトリ内の YAML として Git 管理する

- **日付**: 2026-04-18
- **ステータス**: Accepted

## コンテキスト

Tally のプロジェクトデータの永続化方法として、以下の選択肢がある。

1. SQLite / PostgreSQL などの DB
2. 単一 JSON ファイル
3. 独自バイナリフォーマット
4. 複数 YAML ファイル（Git 管理可能）

要件：
- バージョン管理可能（PRレビュー、diff確認、履歴追跡）
- CI/CD で検証可能
- 外部ツールから編集・読み取り可能
- 個人利用・OSS 配布の観点から運用負荷が軽い

## 決定

プロジェクトは対象リポジトリ直下の `.tally/` ディレクトリに、**複数の YAML ファイル**として保存する。

### ディレクトリ構造

```
<repo_root>/
├── .tally/
│   ├── project.yaml         # プロジェクトメタデータ
│   ├── nodes/
│   │   ├── req-<id>.yaml    # 要求ノード
│   │   ├── uc-<id>.yaml     # UCノード
│   │   ├── story-<id>.yaml  # ストーリーノード
│   │   └── ...
│   └── edges/
│       └── edges.yaml       # 全エッジを1ファイル
└── src/
```

### ファイル命名規則

- ノードファイル：`<type-prefix>-<id>.yaml`
- 型プレフィックス：`req`, `uc`, `story`, `q`, `code`, `issue`, `prop`
- ID は nanoid（衝突を避けるため）

### なぜノードごとに別ファイルか

- Git の merge 時に衝突が起きにくい
- 個別の変更が PR で読みやすい
- ファイル履歴で特定ノードの変遷を追える

### なぜエッジは 1 ファイルか

- エッジは接続情報のみで情報量が少ない
- ノード追加時に複数エッジが同時に変わるケースが多く、まとめた方が diff が追いやすい

## 影響

### メリット

- Git で自然に管理でき、PR レビューが可能
- CI で「未解決論点が残っていないか」などの検証ができる
- エディタで直接編集できる
- 独自ツール不要で内容を確認できる

### デメリット

- 大規模プロジェクトでのパフォーマンス低下：数千ノード規模で遅くなる可能性
- ファイル数が多くなる：1プロジェクト数百ファイルになる場合も

これらの懸念は Phase 1 ですべて許容。数千ノード超えた段階で改めて評価する。

## YAML スキーマ例

### project.yaml

```yaml
id: proj_abc123
name: TaskFlow 招待機能追加
description: SaaS にチーム招待機能を追加するプロジェクト
codebasePath: ../taskflow-backend
createdAt: 2026-04-18T10:00:00Z
updatedAt: 2026-04-18T15:30:00Z
```

### nodes/req-invite.yaml

```yaml
id: req_invite
type: requirement
x: 40
y: 60
title: チーム招待機能
body: |
  複数のユーザーから「仕事仲間をプロジェクトに招待したい」との要望。
  メール経由の招待リンクで参加できるようにしたい。
kind: functional
priority: must
```

### nodes/q-invite-expiry.yaml

```yaml
id: q_invite_expiry
type: question
x: 340
y: 280
title: 招待リンクの有効期限
body: 招待リンクはどのくらいで失効させるか？
options:
  - id: opt_24h
    text: 24時間
    selected: false
  - id: opt_7d
    text: 7日間
    selected: true
  - id: opt_never
    text: 無期限
    selected: false
decision: opt_7d
```

### edges/edges.yaml

```yaml
edges:
  - id: e1
    from: req_invite
    to: uc_send_invite
    type: satisfy
  - id: e2
    from: req_invite
    to: q_invite_expiry
    type: derive
```

## 考慮した他の選択肢

1. **SQLite**：単一ファイルで扱いやすいが、Git での diff が取れない
2. **JSON**：人間可読性で YAML に劣る
3. **TOML**：ネスト構造の表現力で YAML に劣る
4. **単一 YAML ファイル**：大規模プロジェクトでマージ衝突が頻発

## 参考

- [Obsidian の Markdown+YAML frontmatter 方式](https://obsidian.md/)
- [Logseq の Markdown ベース保存](https://logseq.com/)
