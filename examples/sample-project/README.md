# サンプルプロジェクト: TaskFlow 招待機能追加

架空のタスク管理 SaaS「TaskFlow」にチーム招待機能を追加するシナリオ。Tally の動作確認用。

## 内容

- 要求ノード 3つ
- 論点ノード 3つ（すべて未決定）
- UC 提案ノード 2つ
- 既存コード参照ノード 4つ
- 課題ノード 1つ

## ディレクトリ構造

```
sample-project/
└── .tally/
    ├── project.yaml
    ├── nodes/
    │   ├── req-invite.yaml         # 要求: チーム招待機能
    │   ├── req-permissions.yaml    # 要求: 権限レベルの柔軟設定
    │   ├── req-expiry.yaml         # 要求: 有効期限の管理
    │   ├── q-permission-rules.yaml # 論点: 権限の継承ルール
    │   ├── q-link-expiry.yaml      # 論点: 招待リンクの有効期限
    │   ├── q-duplicate.yaml        # 論点: 同一メール宛の複数招待
    │   ├── prop-send-invite.yaml   # AI提案: 招待リンクを発行する
    │   ├── prop-accept.yaml        # AI提案: 招待を承認する
    │   ├── code-user.yaml          # コード参照: User モデル
    │   ├── code-project.yaml       # コード参照: Project 集約
    │   ├── code-mail.yaml          # コード参照: MailSender
    │   ├── code-auth.yaml          # コード参照: Auth ミドルウェア
    │   └── issue-mail-fail.yaml    # 課題: メール配信失敗時の挙動
    └── edges/
        └── edges.yaml
```

## 使い方

```bash
# Tally を起動
pnpm dev

# ブラウザで以下を開く
# http://localhost:3321/projects/taskflow-invite
```

## 注意

これは**架空のプロジェクト**です。TaskFlow という製品は実在しません。Tally の機能紹介用のデモデータです。
