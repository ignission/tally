import { ATLASSIAN_CLOUD_OAUTH } from '@tally/core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAuthorizationUrl,
  exchangeCodeForToken,
  generateOAuthState,
  generatePkcePair,
  refreshAccessToken,
} from './oauth-client';

describe('generatePkcePair', () => {
  it('code_verifier は RFC 7636 §4.1 の長さ要件 (43-128 文字) を満たす', () => {
    for (let i = 0; i < 5; i++) {
      const { codeVerifier } = generatePkcePair();
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43);
      expect(codeVerifier.length).toBeLessThanOrEqual(128);
    }
  });

  it('code_challenge は code_verifier の SHA-256 を base64url した値', async () => {
    const { codeVerifier, codeChallenge } = generatePkcePair();
    // 自前で再計算して一致を確認
    const { createHash } = await import('node:crypto');
    const expected = createHash('sha256').update(codeVerifier).digest('base64url');
    expect(codeChallenge).toBe(expected);
  });

  it('呼び出しごとに別の値を返す (entropy 確認の最小限)', () => {
    const a = generatePkcePair();
    const b = generatePkcePair();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
  });
});

describe('generateOAuthState', () => {
  it('呼び出しごとに別の値を返す', () => {
    const a = generateOAuthState();
    const b = generateOAuthState();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe('buildAuthorizationUrl', () => {
  it('Atlassian の authorize URL に必須 PKCE / state / scope を載せる', () => {
    const url = new URL(
      buildAuthorizationUrl({
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid-abc',
        redirectUri: 'http://127.0.0.1:54321/callback',
        scopes: ['read:jira-work', 'offline_access'],
        state: 'state-xyz',
        codeChallenge: 'challenge-abc',
      }),
    );
    expect(url.origin + url.pathname).toBe(ATLASSIAN_CLOUD_OAUTH.authorizationEndpoint);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid-abc');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback');
    expect(url.searchParams.get('scope')).toBe('read:jira-work offline_access');
    expect(url.searchParams.get('state')).toBe('state-xyz');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    // refresh_token を確実に得るため毎回 consent
    expect(url.searchParams.get('prompt')).toBe('consent');
  });

  it('provider.audience がある場合は audience を付ける (Atlassian)', () => {
    const url = new URL(
      buildAuthorizationUrl({
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:1/cb',
        scopes: ['s'],
        state: 's',
        codeChallenge: 'c',
      }),
    );
    expect(url.searchParams.get('audience')).toBe('api.atlassian.com');
  });

  it('provider.audience が無い場合は audience パラメータを付けない', () => {
    // audience を除いた provider config を作る (exactOptionalPropertyTypes で undefined 代入を避ける)。
    const { audience: _audience, ...noAudienceProvider } = ATLASSIAN_CLOUD_OAUTH;
    const url = new URL(
      buildAuthorizationUrl({
        provider: noAudienceProvider,
        clientId: 'cid',
        redirectUri: 'http://127.0.0.1:1/cb',
        scopes: ['s'],
        state: 's',
        codeChallenge: 'c',
      }),
    );
    expect(url.searchParams.has('audience')).toBe(false);
  });
});

describe('exchangeCodeForToken / refreshAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('exchangeCodeForToken: token endpoint に form-encoded で POST し、camelCase で返す', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          access_token: 'a-tok',
          refresh_token: 'r-tok',
          expires_in: 3600,
          scope: 'read:jira-work offline_access',
          token_type: 'Bearer',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await exchangeCodeForToken({
      provider: ATLASSIAN_CLOUD_OAUTH,
      clientId: 'cid',
      code: 'auth-code',
      redirectUri: 'http://127.0.0.1:54321/callback',
      codeVerifier: 'verifier-xyz',
    });

    expect(result.accessToken).toBe('a-tok');
    expect(result.refreshToken).toBe('r-tok');
    expect(result.expiresIn).toBe(3600);
    expect(result.scope).toBe('read:jira-work offline_access');
    expect(result.tokenType).toBe('Bearer');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch not called');
    const [endpoint, init] = call;
    expect(endpoint).toBe(ATLASSIAN_CLOUD_OAUTH.tokenEndpoint);
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
    expect(body.get('code_verifier')).toBe('verifier-xyz');
    expect(body.get('redirect_uri')).toBe('http://127.0.0.1:54321/callback');
    expect(body.get('client_id')).toBe('cid');
  });

  it('exchangeCodeForToken: token_type が無いレスポンスは Bearer に default', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ access_token: 'a' }), { status: 200 })),
    );
    const result = await exchangeCodeForToken({
      provider: ATLASSIAN_CLOUD_OAUTH,
      clientId: 'cid',
      code: 'c',
      redirectUri: 'http://127.0.0.1:1/cb',
      codeVerifier: 'v',
    });
    expect(result.tokenType).toBe('Bearer');
  });

  it('exchangeCodeForToken: 4xx/5xx は throw', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('invalid_grant', { status: 400 })),
    );
    await expect(
      exchangeCodeForToken({
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        code: 'c',
        redirectUri: 'http://127.0.0.1:1/cb',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(/token endpoint failed.*400/);
  });

  it('exchangeCodeForToken: access_token 欠落は throw (provider バグの早期検出)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
    await expect(
      exchangeCodeForToken({
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        code: 'c',
        redirectUri: 'http://127.0.0.1:1/cb',
        codeVerifier: 'v',
      }),
    ).rejects.toThrow(/missing access_token/);
  });

  it('refreshAccessToken: grant_type=refresh_token と refresh_token を form で送る', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify({ access_token: 'new-tok' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshAccessToken({
      provider: ATLASSIAN_CLOUD_OAUTH,
      clientId: 'cid',
      refreshToken: 'old-refresh',
    });
    expect(result.accessToken).toBe('new-tok');

    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('fetch not called');
    const init = call[1];
    const body = new URLSearchParams(init?.body as string);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('old-refresh');
    expect(body.get('client_id')).toBe('cid');
  });
});
