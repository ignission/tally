# examples/taskflow-backend

`examples/sample-project` の `codebasePath: ../taskflow-backend` が指す最小サンプル。
Tally の `find-related-code` エージェントが実際にコードを読み込めることを手動 E2E で確認するための固定コードベース。

## 構成

- `src/invite.ts` — チーム招待 UC 相当の実装骨子
- `src/mailer.ts` — メール送信のダミー実装

これは「動くアプリ」ではなく、Glob / Grep / Read で AI が辿れる最小形。
追加のビルド設定や依存は入れていない。
