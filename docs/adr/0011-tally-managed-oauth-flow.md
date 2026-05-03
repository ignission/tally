# ADR-0011: 外部 MCP サーバーの OAuth 2.1 フローを Tally 側で管理する

- **日付**: 2026-05-02
- **ステータス**: Accepted (PR-E5 merge をもって確定。PR-E1 〜 PR-E5 で実装)

## コンテキスト

PR #19 (PR-A) で外部 MCP サーバー (Atlassian 等) を Tally Chat から呼べる土台を作り、PR #21 (PR-B) で OAuth 2.1 / Claude Agent SDK 任せの認証フローに pivot した。callback URL は UI の `AuthRequestCard` で paste させ、`mcp__<id>__complete_authentication` を AI に呼ばせる設計。

PR #22 (PR-C) で `ChatRunner` を long-lived Query 化したが、CodeRabbit から複数回にわたり以下の指摘を受けた:

- callback URL の `code` / `state` を `this.input.push` 経由で SDK に渡すと、同 `sdk.query()` の **会話 context に turn 跨ぎで残る**
- `allowedTools` を callback turn だけ単一 (`mcp__<id>__complete_authentication`) に絞れず、prompt 指示頼みになる

issue #28 で SDK API を調査した結果、以下が判明:

- `Query.setMcpServers` / `toggleMcpServer` / `applyFlagSettings` は動的更新できる (mid-session で MCP server 入れ替え可能)
- しかし **`allowedTools` の動的変更 API は存在しない**
- MCP HTTP transport の OAuth state (PKCE / token) を **subprocess 跨ぎで共有する API も存在しない**
- 一方で SDK は **token を外部から `headers: { Authorization: Bearer ... }` で注入できる**

つまり、SDK 機能だけで「再認証 avoid」と「context 漏洩防止」を両立する API は無い。

## 決定

OAuth 2.1 フロー全体を **Tally 側で完結させる** 設計に転換する。SDK は完成済み access token を `headers` で渡されるだけで、`mcp__<id>__authenticate` / `complete_authentication` は使わない。

これにより:

- callback URL は Tally プロセス内の loopback callback サーバーで受けて token 交換する → AI 会話 context に **一切渡さない**
- access token は Tally の token store に永続化、SDK の `mcpServers` config の `headers` に inject
- subprocess を再起動しても token store から読めば再注入できる → **再認証不要**
- `allowedTools` の動的変更が不要になる (OAuth フローが SDK に乗らないため)

## 詳細設計

### 1. OAuth client 設定

`McpServerConfig` (packages/core/src/schema.ts) を拡張:

```typescript
interface McpServerConfig {
  id: string;
  name: string;
  kind: 'atlassian'; // 将来 'github' / 'slack' 等に拡張可能
  url: string;
  // OAuth client 設定 (kind ごとに endpoint を持つ registry を core 側に置く)。
  // 段階導入のため PR-E1 では optional で追加、PR-E4 で旧 auth_request 経路を
  // 削除するのと同時に required 化する。
  oauth?: {
    clientId: string;        // OAuth client ID (各 server で発行されたもの)
    scopes?: string[];       // 任意、kind ごとに default あり
  };
  options: McpServerOptions;
}
```

`kind: 'atlassian'` の場合の OAuth 2.1 endpoint は core/src/oauth/atlassian.ts 等に hardcode する registry を持つ。MVP は Atlassian のみ。

### 2. Token store

`.tally/oauth/<mcpServerId>.yaml` に永続化:

```yaml
mcpServerId: atlassian
acquiredAt: 2026-05-02T10:00:00Z
accessToken: <encrypted or plain — ADR-0012 で別途検討>
refreshToken: <...>
expiresAt: 2026-05-02T11:00:00Z
scopes: [read:jira-work, read:jira-user, offline_access]
```

注: MVP は Atlassian Cloud の **Jira read 系のみ**を default scopes にする (`read:jira-work` / `read:jira-user` / `offline_access`)。Confluence や write 系を必要とする場合は `McpServerConfig.oauth.scopes` で追加指定する想定。

- 暗号化方針は ADR-0012 で別途検討 (MVP は plain で `chmod 600`、後から OS keychain 統合)
- token store は `~/.local/share/tally/projects/<id>/oauth/` ではなく **プロジェクトディレクトリ直下**に置く (ADR-0008 の「プロジェクト = 任意のディレクトリ」原則に従う)

### 3. OAuth flow 実装

新パッケージ or `packages/ai-engine/src/oauth/` ディレクトリで以下を実装:

- `OAuthClient` クラス: PKCE code_verifier / code_challenge 生成、authorization URL 構築、token 交換、refresh
- `LoopbackCallbackServer`: 一時的に `http://localhost:0/callback` を listen (port は OS 採番)、`code` と `state` を受領
- `OAuthFlowOrchestrator`: UI からの開始要求を受けて authorization URL 生成 → ユーザーに返す → callback で token 交換 → token store に保存

依存ライブラリ候補: `oauth4webapi` (OAuth 2.1 + PKCE 公式準拠、軽量)。MVP では小さいので自前実装も検討。

### 4. SDK 統合

`packages/ai-engine/src/mcp/build-mcp-servers.ts` を拡張:

```typescript
async function buildMcpServers(opts) {
  for (const config of configs) {
    const token = await tokenStore.read(config.id);
    const headers = token
      ? { Authorization: `Bearer ${token.accessToken}` }
      : {};
    mcpServers[config.id] = { type: 'http', url: config.url, headers };
  }
  // Tally MCP は従来通り
  ...
}
```

token expiry が近ければ `OAuthClient.refresh` を呼んでから注入する。

### 5. UI 統合

既存の `AuthRequestCard` を再利用するが、内部実装を変更:

- 「認証」ボタン → Tally の API (`POST /api/mcp/<id>/oauth/start`) を呼んで authorization URL を取得 → 新規タブで開く
- callback URL の paste は **削除** (Tally が直接 loopback で受けるため)
- 認証完了は `chat_auth_request` event ではなく WS の別 event (`mcp_oauth_completed`) で通知

### 6. ChatRunner 修正

- `runOAuthCallback` メソッドを削除
- `auth-detector.ts` (mcp__*__authenticate / complete_authentication 検出) を削除
- `handleAuthToolResult` (auth_request 変換) を削除
- `stashedAuthUses` (TurnState) を削除
- `chat_auth_request` event 型を削除 (or 一般的な `mcp_oauth_status` event に置換)

これにより chat-runner は OAuth を完全に意識しないシンプルな構造に戻る。

## 実装段階 (PR 分割実績)

| PR | 範囲 | 状態 |
|---|---|---|
| **PR-E1** (#29) | core/schema.ts に oauth 設定追加、token store ファイル形式定義 + storage パッケージ実装 | ✅ Merged |
| **PR-E2** (#30) | OAuthClient (PKCE / token 交換 / refresh) + LoopbackCallbackServer 実装 | ✅ Merged |
| **PR-E3a** (#31) | OAuthFlowOrchestrator (Route Handler から呼べる singleton state + runId guard / preempt 防御) | ✅ Merged |
| **PR-E3b** (#32) | Route Handler `/api/projects/[id]/mcp/[mcpServerId]/oauth` (POST/GET/DELETE) + AuthRequestCard を Route Handler 駆動に改修 (paste UX 廃止) | ✅ Merged |
| **PR-E4** (#33) | `buildMcpServers` に token 注入、`ChatRunner` から OAuth 関連削除 (auth-detector / handleAuthToolResult / runOAuthCallback / chat_auth_request event)、AuthRequestCard を chat → project settings に移管 | ✅ Merged |
| **PR-E5** | `buildMcpServers` の expiry 近接 token 自動 refresh、E2E テスト、docs 整備 | 🚧 (本 PR) |

PR-E3 は当初 1 PR の予定だったが diff 量が大きくなり orchestrator (E3a) と Route Handler+UI (E3b) に分割した。各 PR は独立に merge 可能。

## 影響

### 利点

- **CR 指摘の根本解決**: callback URL が AI 会話 context に一切残らない
- **再認証不要**: subprocess 再起動後も token store から読み戻せる
- **`allowedTools` 動的変更不要**: OAuth フローが SDK に乗らないため、`runOAuthCallback` の単一 tool 強制問題が消える
- **chat-runner 簡素化**: OAuth 関連 (auth-detector / handleAuthToolResult 等) を削除

### 欠点

- **実装規模大**: PR-E1 〜 E5 で数日〜数週間
- **kind ごとの endpoint registry**: 新しい MCP server kind を追加するたびに OAuth endpoint 設定が必要 (Atlassian 専用から離脱する際のコスト)
- **token store のセキュリティ**: ADR-0012 で別途検討が必要 (MVP は file mode 600)

### 後方互換性

PoC / 個人開発段階のため **後方互換は不要**。具体的には:

- 既存 `McpServerConfig` YAML に `oauth` フィールドが無いものは PR-E4 で validation エラーで弾く (`oauth` を required 化)。ユーザーは手動で追加する。PR-E1 〜 E3 の間は optional で並走する
- 旧 `auth_request` ブロック / `chat_auth_request` event は schema から完全削除 (PR-E4)
- 既存 chat YAML 内の旧 `auth_request` block は読み込み時 validation エラーで弾く想定。必要なら該当 chat thread を手動削除して clean state から開始する
- migration script や互換 layer は実装しない

## 関連

- issue #28: PR-C 後続: OAuth callback の ephemeral 経路復元の再検討
- PR #22 (merged): https://github.com/ignission/tally/pull/22
- PR #21 (merged): OAuth 2.1 pivot
- ADR-0006: Claude Code OAuth for Agent SDK (Tally プロセス全体の OAuth)

## 補足: 暫定処置 (実装中)

ADR-0011 の実装が完了するまでは PR-C (long-lived 統合) のままで運用する。CodeRabbit の指摘は「設計トレードオフ + ADR で trace」として受容している。

## 完了後の確定事項 (PR-E5 時点)

- Token refresh は `buildMcpServers` が透過的に処理する。`expiresAt - now ≤ 5 min` で `refreshToken` があれば `refreshAccessToken` を呼び、新 access_token を header に注入し、新 token を `FileSystemOAuthStore` に書き戻す。refresh 失敗 (refresh_token revoked 等) は header 無しで構築 → MCP 401 → UI 側 AuthRequestCard で再認証
- 旧 `auth_request` ChatBlock / `chat_auth_request` ChatEvent / `oauth_callback` WS message / `runOAuthCallback` メソッド / `auth-detector.ts` はすべて削除済み (PR-E4)
- AuthRequestCard は `packages/frontend/src/components/mcp/auth-request-card.tsx` に独立し、project settings 画面の MCP server 行から呼び出される
- 永続化済み + clientId 入力済 + 編集なし のときだけ Connect ボタンが描画される (`isOAuthConnectable`)。未保存変更があれば「先に保存」と促す
