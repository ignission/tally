// Atlassian Cloud OAuth 2.1 endpoint registry。
// ADR-0011 で導入。Tally 側で OAuth フローを管理する際に、kind ごとの定数として参照する。
//
// 参考:
// - https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/
// - https://developer.atlassian.com/cloud/jira/platform/scopes-for-oauth-2-3LO-and-forge-apps/
//
// 注: Server / DC は OAuth 2.0 endpoint のホスト名が different なので、Cloud のみここに置く。
// Server/DC 対応が必要になった時点で kind を 'atlassian' から 'atlassian-cloud' /
// 'atlassian-server' に分割する想定。

// PR-E2 で OAuthClient / LoopbackCallbackServer が引数として受ける形を先に決めておく。
// readonly array にしておくことで const-as-const 値も literal 型を維持できる。
export interface OAuthProviderConfig {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  // OAuth 2.1 の token endpoint で必要な audience (provider 依存、optional)。
  audience?: string;
  // requested scopes 未指定時の default。refresh_token に必要な scope (例: offline_access)
  // はここに含める想定。
  defaultScopes: readonly string[];
  // authorization request に付ける prompt パラメータ (Atlassian / Auth0 で 'consent' を
  // 指定すると refresh_token を確実に得られる)。provider が prompt を受け付けない場合は
  // undefined にして送らない。`buildAuthorizationUrl` ではここに値があるときだけ url に乗せる。
  prompt?: string;
}

export const ATLASSIAN_CLOUD_OAUTH: OAuthProviderConfig = {
  // Authorization endpoint (PKCE で code を受け取る画面)
  authorizationEndpoint: 'https://auth.atlassian.com/authorize',
  // Token endpoint (code を access_token に交換)
  tokenEndpoint: 'https://auth.atlassian.com/oauth/token',
  // refresh_token を発行させるための audience。Atlassian の OAuth 2.1 仕様で必要。
  audience: 'api.atlassian.com',
  // 既定 scopes。MVP は Jira read 系のみ。Confluence や write 系は McpServerConfig.oauth.scopes
  // でユーザーが追加指定する。
  // refresh_token を得るには `offline_access` が必須。
  defaultScopes: ['read:jira-work', 'read:jira-user', 'offline_access'],
  // Atlassian は再ログイン時 (=既存 grant あり) に refresh_token が返らないことがあるため、
  // 毎回 consent を要求して確実に refresh_token を得る。
  prompt: 'consent',
};

// kind ごとの OAuth endpoint registry。kind が増えたらここにエントリを追加する。
export const OAUTH_REGISTRY = {
  atlassian: ATLASSIAN_CLOUD_OAUTH,
} as const satisfies Readonly<Record<string, OAuthProviderConfig>>;

export type OAuthKind = keyof typeof OAUTH_REGISTRY;
