// ADR-0011 PR-E2: 外部 MCP server に対する OAuth 2.1 (Authorization Code + PKCE) クライアント。
// Node 標準のみで実装する (依存追加を避ける)。
//
// 設計判断:
// - PKCE は S256 のみサポート (RFC 7636 推奨)。plain は実装しない。
// - state は Tally 側で生成 + verify する (CSRF + 偽 callback 防止)。
// - state / code_verifier / refresh_token を返さず、呼び出し側 (PR-E3 の Orchestrator) が
//   管理する。本モジュールは純粋関数とネットワーク I/O のみに集中する。
// - token endpoint は application/x-www-form-urlencoded で叩く (RFC 6749 §4.1.3)。

import { createHash, randomBytes } from 'node:crypto';

import type { OAuthProviderConfig } from '@tally/core';

// PKCE pair。code_verifier はクライアント側で保持し、token 交換時に渡す。
// code_challenge は authorization request の URL に乗せる。
export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
}

// RFC 7636 §4.1: code_verifier は 43-128 文字の URL-safe random。
// 32 byte の random を base64url すると 43 文字になり下限を満たす。
export function generatePkcePair(): PkcePair {
  const codeVerifier = randomBytes(32).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
}

// state は CSRF 防止用の opaque random。authorization request に乗せて、callback で
// 一致を verify する。長すぎると URL が膨れるので 16 byte で十分 (entropy 128 bit)。
export function generateOAuthState(): string {
  return randomBytes(16).toString('base64url');
}

export interface BuildAuthorizationUrlInput {
  provider: OAuthProviderConfig;
  clientId: string;
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  codeChallenge: string;
}

// Authorization URL を組み立てる (Authorization Code + PKCE フロー)。
// Atlassian は audience が必須なので provider.audience があれば付ける。
// prompt=consent を付けて refresh_token を確実に取得する (provider 依存だが大半で有効)。
export function buildAuthorizationUrl(input: BuildAuthorizationUrlInput): string {
  const url = new URL(input.provider.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (input.provider.audience) {
    url.searchParams.set('audience', input.provider.audience);
  }
  // prompt は provider 設定 (例: Atlassian は 'consent') で指定された場合のみ付ける。
  // ハードコードすると prompt 不可 / 別値必須の provider を将来追加した際に詰む。
  if (input.provider.prompt) {
    url.searchParams.set('prompt', input.provider.prompt);
  }
  return url.toString();
}

// Token endpoint からの response。snake_case のまま受け、呼び出し側が camelCase に変換する。
interface TokenEndpointResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
}

// 呼び出し側に返す形 (camelCase)。
export interface TokenExchangeResult {
  accessToken: string;
  refreshToken?: string;
  // Token endpoint レスポンスの expires_in (秒)。expiresAt 化は呼び出し側で行う。
  expiresIn?: number;
  // 実際に許可された scope (space 区切り、provider が絞った場合に把握)。
  scope?: string;
  tokenType: string;
}

export interface ExchangeCodeInput {
  provider: OAuthProviderConfig;
  clientId: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

// Authorization code を access_token に交換する (RFC 6749 §4.1.3 + RFC 7636)。
// public client (PKCE 経由) なので client_secret は使わない。
export async function exchangeCodeForToken(input: ExchangeCodeInput): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: input.clientId,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
  return await postTokenEndpoint(input.provider.tokenEndpoint, body);
}

export interface RefreshTokenInput {
  provider: OAuthProviderConfig;
  clientId: string;
  refreshToken: string;
}

// Refresh token を使って access_token を更新する (RFC 6749 §6)。
// 一部 provider は refresh 時に新しい refresh_token を返すので、戻り値の refreshToken を
// 必ず token store に書き戻す必要がある (rotation policy)。
export async function refreshAccessToken(input: RefreshTokenInput): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  });
  return await postTokenEndpoint(input.provider.tokenEndpoint, body);
}

async function postTokenEndpoint(
  endpoint: string,
  body: URLSearchParams,
): Promise<TokenExchangeResult> {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    // エラー本文には機密が含まれる可能性が低いが、念のため最初の 512 文字に切る。
    const text = (await res.text().catch(() => '')).slice(0, 512);
    throw new Error(`token endpoint failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as TokenEndpointResponse;
  if (typeof json.access_token !== 'string' || json.access_token === '') {
    throw new Error('token endpoint response missing access_token');
  }
  // exactOptionalPropertyTypes 下では `?: string` に `string | undefined` を直接 assign
  // できないので、各 optional は値が存在するときだけ object に乗せる (spread 経由)。
  return {
    accessToken: json.access_token,
    ...(json.refresh_token !== undefined ? { refreshToken: json.refresh_token } : {}),
    ...(json.expires_in !== undefined ? { expiresIn: json.expires_in } : {}),
    ...(json.scope !== undefined ? { scope: json.scope } : {}),
    tokenType: json.token_type ?? 'Bearer',
  };
}
