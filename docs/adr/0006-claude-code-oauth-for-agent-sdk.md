# ADR-0006: Claude Code の OAuth トークンを Agent SDK の認証として採用

- **日付**: 2026-04-19
- **ステータス**: Accepted
- **関連**: ADR-0002 の「認証は API キー必須」条項を更新する

## コンテキスト

ADR-0002 で Claude Agent SDK の採用を決めたとき、認証は「API キー必須」とされ、エンドユーザーが `ANTHROPIC_API_KEY` を用意する前提だった。

Phase 4 実装を進める中で、次の事実が重要になった:

- Tally の想定ユーザーは Claude Code (`claude` CLI) を日常的に使う開発者が多い
- Claude Pro / Max サブスクリプション保有者は、既に `claude login` で OAuth トークンを OS Keychain に保存している
- Agent SDK は、`ANTHROPIC_API_KEY` が未設定の場合、この既存の OAuth トークンを暗黙に利用できる
- API 従量課金を強制すると、Pro / Max ユーザーには二重課金感が出て導入障壁になる

## 決定

**Claude Code の OAuth トークンを Tally の Agent SDK 呼び出しで利用する**。
`ANTHROPIC_API_KEY` を明示的に設定した場合はそちらを優先するフォールバック構造を維持する。

### 具体的な振る舞い

- ai-engine は起動時に認証トークンの存在チェックを**行わない**
- SDK が `query()` を実行する時点で Claude Code の keychain / `ANTHROPIC_API_KEY` を自動的に探す
- 認証失敗時は SDK が例外を投げる。ai-engine 側は例外を捕捉し、`AgentEvent: { type: 'error', code: 'not_authenticated' }` に変換してクライアントに返す
- エラーメッセージは `claude login` への誘導文を含める

### 前提ユーザー

- ローカル対話利用: `claude` CLI インストール + `claude login` 済み
- CI / リモート環境: `ANTHROPIC_API_KEY` または `CLAUDE_CODE_OAUTH_TOKEN` を明示設定

## 理由

1. **UX: 追加セットアップ不要**: Claude Code 既利用者なら Tally 導入時に API キー発行・設定ステップが不要
2. **課金の二重化回避**: Pro / Max サブスクリプションを活用でき、従量課金とダブらない
3. **非対話環境フォールバック**: CI では環境変数で明示指定できる経路が残る
4. **認証責務を Tally から外す**: SDK 層が認証を担当するので、ai-engine のコードに認証ロジックが入らない

## 影響

### メリット

- 新規ユーザーの導入時コストが低い
- Claude Code エコシステムとの親和性が高い
- ai-engine コードが認証非依存になる

### デメリット / 制約

- `claude` CLI のインストールが前提になる (環境依存性)
- OAuth トークン更新は Claude Code 側の責務 (Tally は関与できない)
- 将来 SDK が OAuth サポートを変更したら追従が必要

## 考慮した他の選択肢

### 選択肢 1: 固定 `ANTHROPIC_API_KEY` 必須 (ADR-0002 初期案)

- ✗ Pro / Max ユーザーの二重課金感
- ✗ 個人利用時の鍵発行ステップが追加
- 不採用

### 選択肢 2: `CLAUDE_CODE_OAUTH_TOKEN` を現役で使う

- `claude setup-token` で発行した長期トークンを環境変数に設定
- CI / リモートマシン向けには有効
- ローカル対話利用でもセットアップが増える
- **採用決定**: ただし **ローカルは OAuth 自動探索が主経路**、`CLAUDE_CODE_OAUTH_TOKEN` は CI フォールバック

### 選択肢 3: `claude` CLI をサブプロセスで呼ぶ

- Agent SDK ではなく CLI をプロセス起動し標準入出力で会話
- ✗ ツール呼び出しループの制御が複雑
- ✗ Claude Code と同じ体験は再現できない
- 不採用

## 監査要件

認証経路の監査は Claude Code 側のログに委ねる。Tally はトークンを保持・ログしない。

## 将来の拡張余地

- SDK 側で OAuth リフレッシュが失敗した場合のユーザー誘導 UI 追加
- 企業向けに Anthropic API キーを ai-engine が中央集権的に保持するモード (別 ADR)

## 参考

- [ADR-0002: Claude Agent SDK の採用](./0002-agent-sdk-adoption.md)
- Agent SDK 認証ドキュメント: https://docs.claude.com/en/api/agent-sdk
- `claude login` / `claude setup-token` の仕様
