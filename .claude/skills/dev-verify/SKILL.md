---
name: dev-verify
description: Tally のビルド・型チェック・テストを実行して MVP の健全性を確認する
allowed-tools: Bash
---

## 目的

Tally は MVP 段階で本番デプロイはまだ無い。変更後の健全性確認として、以下を順番に実行する。

## 手順

### 1. 型チェック

```bash
pnpm typecheck
```

全パッケージの TypeScript 型検査。失敗したら停止してエラーを報告。

### 2. lint（biome）

```bash
pnpm lint
```

失敗した場合は `pnpm check` で自動修正を試みる。

### 3. テスト

```bash
pnpm test
```

vitest を全パッケージで実行。失敗テストがあれば停止して原因報告。

### 4. ビルド

```bash
pnpm build
```

全パッケージのビルドが通ることを確認。

### 5. 結果報告

- 全て成功: 「健全性チェック完了（typecheck / lint / test / build 全て pass）」と報告
- 失敗: 失敗したステップと該当エラーを簡潔に報告

## 注意

- `.tally/` 配下（ドッグフード用ローカル状態）は触らない
- 本番デプロイフローは現時点では未定義（将来 Phase で追加）
