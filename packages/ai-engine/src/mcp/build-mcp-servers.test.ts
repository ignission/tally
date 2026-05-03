import { ATLASSIAN_CLOUD_OAUTH, type McpOAuthToken } from '@tally/core';
import type { OAuthStore } from '@tally/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildMcpServers } from './build-mcp-servers';

// PR-E4 の token 注入 + PR-E5 の refresh 検証用 OAuthStore モック。
// write は内部 map を更新するので refresh 後の永続化を assert できる。
function makeOAuthStore(initial: Record<string, McpOAuthToken>): OAuthStore & {
  current: Record<string, McpOAuthToken>;
} {
  const current = { ...initial };
  return {
    current,
    async read(id: string) {
      return current[id] ?? null;
    },
    async write(token: McpOAuthToken) {
      current[token.mcpServerId] = token;
    },
    async delete(id: string) {
      delete current[id];
    },
    async list() {
      return Object.keys(current);
    },
  };
}

const baseAtlassianConfig = {
  id: 'atlassian',
  name: 'Atlassian',
  kind: 'atlassian' as const,
  url: 'https://mcp.atlassian.example/v1/mcp',
  oauth: { clientId: 'cid' },
  options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
};

describe('buildMcpServers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mcpServers 空配列 → external 無し、allowedTools は tally のみ', async () => {
    const result = await buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [],
      oauthStore: makeOAuthStore({}),
    });
    expect(Object.keys(result.mcpServers)).toEqual(['tally']);
    expect(result.allowedTools).toEqual(['mcp__tally__*']);
  });

  it('token 未登録 → headers なし HTTP config (= MCP 側 401 で UI が認証フローへ)', async () => {
    const result = await buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [baseAtlassianConfig],
      oauthStore: makeOAuthStore({}),
    });
    const atlassian = result.mcpServers.atlassian as {
      type: string;
      url: string;
      headers?: unknown;
    };
    expect(atlassian.type).toBe('http');
    expect(atlassian.url).toBe(baseAtlassianConfig.url);
    expect(atlassian.headers).toBeUndefined();
    expect(result.allowedTools).toContain('mcp__atlassian__*');
  });

  it('token あり → Authorization: <tokenType> <accessToken> を headers に注入 (PR-E4)', async () => {
    const result = await buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [baseAtlassianConfig],
      oauthStore: makeOAuthStore({
        atlassian: {
          mcpServerId: 'atlassian',
          accessToken: 'a-tok',
          acquiredAt: '2026-05-02T00:00:00Z',
          tokenType: 'Bearer',
        },
      }),
    });
    const atlassian = result.mcpServers.atlassian as {
      type: string;
      url: string;
      headers?: Record<string, string>;
    };
    expect(atlassian.headers).toEqual({ Authorization: 'Bearer a-tok' });
  });

  it('tokenType が DPoP のような非 Bearer でもそのまま注入する (RFC 9449 互換)', async () => {
    const result = await buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [baseAtlassianConfig],
      oauthStore: makeOAuthStore({
        atlassian: {
          mcpServerId: 'atlassian',
          accessToken: 'd-tok',
          acquiredAt: '2026-05-02T00:00:00Z',
          tokenType: 'DPoP',
        },
      }),
    });
    const atlassian = result.mcpServers.atlassian as { headers?: Record<string, string> };
    expect(atlassian.headers).toEqual({ Authorization: 'DPoP d-tok' });
  });

  it('expiresAt が過去のトークンは無視 (= headers 無し、MCP 側 401 → UI が再認証)', async () => {
    // codex Major 対応の検証: 期限切れトークンを盲目的に注入すると 401 が AI ツール失敗
    // として埋もれ、UI 側でユーザーに認証必要と通知できない。expiresAt < now なら null 扱い。
    const result = await buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [baseAtlassianConfig],
      oauthStore: makeOAuthStore({
        atlassian: {
          mcpServerId: 'atlassian',
          accessToken: 'a-tok-old',
          acquiredAt: '2020-01-01T00:00:00Z',
          expiresAt: '2020-01-01T01:00:00Z', // 過去
          tokenType: 'Bearer',
        },
      }),
    });
    const atlassian = result.mcpServers.atlassian as {
      type: string;
      url: string;
      headers?: unknown;
    };
    expect(atlassian.headers).toBeUndefined();
  });

  it('expiresAt が未来のトークンは正常に注入', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    const result = await buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [baseAtlassianConfig],
      oauthStore: makeOAuthStore({
        atlassian: {
          mcpServerId: 'atlassian',
          accessToken: 'a-tok-fresh',
          acquiredAt: new Date().toISOString(),
          expiresAt: future,
          tokenType: 'Bearer',
        },
      }),
    });
    const atlassian = result.mcpServers.atlassian as { headers?: Record<string, string> };
    expect(atlassian.headers).toEqual({ Authorization: 'Bearer a-tok-fresh' });
  });

  it('複数 config: 一部にだけ token がある → 該当だけ headers が付く', async () => {
    const result = await buildMcpServers({
      tallyMcp: { type: 'sdk' } as unknown,
      configs: [
        {
          id: 'first',
          name: 'F',
          kind: 'atlassian',
          url: 'https://a.test/mcp',
          oauth: { clientId: 'cid' },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
        {
          id: 'second',
          name: 'S',
          kind: 'atlassian',
          url: 'https://b.test/mcp',
          oauth: { clientId: 'cid' },
          options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
        },
      ],
      oauthStore: makeOAuthStore({
        first: {
          mcpServerId: 'first',
          accessToken: 'tok-1',
          acquiredAt: '2026-05-02T00:00:00Z',
          tokenType: 'Bearer',
        },
      }),
    });
    expect(Object.keys(result.mcpServers)).toEqual(['tally', 'first', 'second']);
    const first = result.mcpServers.first as { headers?: Record<string, string> };
    const second = result.mcpServers.second as { headers?: Record<string, string> };
    expect(first.headers).toEqual({ Authorization: 'Bearer tok-1' });
    expect(second.headers).toBeUndefined();
    expect(result.allowedTools).toEqual(['mcp__tally__*', 'mcp__first__*', 'mcp__second__*']);
  });

  // PR-E5: refresh 自動化の検証。expiresAt が REFRESH_BUFFER (5 分) 以内 + refreshToken あり
  // → token endpoint を呼び、新 access_token で header を構築 + store に書き戻す。
  describe('PR-E5: token refresh on expiry', () => {
    it('expiry 直前 + refreshToken あり → refresh して新 access_token を注入 + store に書き戻し', async () => {
      // expiresAt = now + 1 min (REFRESH_BUFFER の 5 分以内 → refresh 対象)
      const aboutToExpire = new Date(Date.now() + 60_000).toISOString();
      const fetchMock = vi.fn(async (url: string | URL) => {
        const u = typeof url === 'string' ? url : url.toString();
        if (u === ATLASSIAN_CLOUD_OAUTH.tokenEndpoint) {
          return new Response(
            JSON.stringify({
              access_token: 'new-tok',
              refresh_token: 'new-refresh',
              expires_in: 3600,
              token_type: 'Bearer',
              scope: 'read:jira-work offline_access',
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch: ${u}`);
      });
      vi.stubGlobal('fetch', fetchMock);

      const store = makeOAuthStore({
        atlassian: {
          mcpServerId: 'atlassian',
          accessToken: 'old-tok',
          refreshToken: 'r-old',
          acquiredAt: new Date(Date.now() - 3540_000).toISOString(),
          expiresAt: aboutToExpire,
          tokenType: 'Bearer',
        },
      });

      const result = await buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [baseAtlassianConfig],
        oauthStore: store,
      });

      // header は新 access_token
      const atlassian = result.mcpServers.atlassian as { headers?: Record<string, string> };
      expect(atlassian.headers).toEqual({ Authorization: 'Bearer new-tok' });
      // token endpoint が 1 回呼ばれている (= refresh)
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // store に新 token が書き戻されている
      const persisted = store.current.atlassian;
      expect(persisted?.accessToken).toBe('new-tok');
      expect(persisted?.refreshToken).toBe('new-refresh');
      expect(persisted?.scopes).toEqual(['read:jira-work', 'offline_access']);
    });

    it('refresh response が新 refresh_token を返さない場合は旧 refresh_token を保持 (rotate 無し provider)', async () => {
      const aboutToExpire = new Date(Date.now() + 60_000).toISOString();
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                access_token: 'rotated-access',
                expires_in: 3600,
                token_type: 'Bearer',
                // refresh_token 未返却 (= rotate 無し)
              }),
              { status: 200 },
            ),
        ),
      );
      const store = makeOAuthStore({
        atlassian: {
          mcpServerId: 'atlassian',
          accessToken: 'old',
          refreshToken: 'kept-refresh',
          acquiredAt: new Date(Date.now() - 3540_000).toISOString(),
          expiresAt: aboutToExpire,
          tokenType: 'Bearer',
          scopes: ['read:jira-work'],
        },
      });

      await buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [baseAtlassianConfig],
        oauthStore: store,
      });

      expect(store.current.atlassian?.refreshToken).toBe('kept-refresh');
      // refresh が scope を返さなかったので元の scopes が維持される
      expect(store.current.atlassian?.scopes).toEqual(['read:jira-work']);
    });

    it('refresh 失敗 (token endpoint が 4xx) → 過去 token は null 扱い、header 無し', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('invalid_grant', { status: 400 })),
      );
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [baseAtlassianConfig],
        oauthStore: makeOAuthStore({
          atlassian: {
            mcpServerId: 'atlassian',
            accessToken: 'expired',
            refreshToken: 'revoked',
            acquiredAt: '2020-01-01T00:00:00Z',
            expiresAt: past,
            tokenType: 'Bearer',
          },
        }),
      });

      const atlassian = result.mcpServers.atlassian as { headers?: unknown };
      expect(atlassian.headers).toBeUndefined();
      // 詳細は server log
      expect(warnSpy.mock.calls.some((c) => /token refresh failed/.test(c.join(' ')))).toBe(true);
    });

    it('refreshToken が無い & expired → null (header 無し)、token endpoint は呼ばない', async () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [baseAtlassianConfig],
        oauthStore: makeOAuthStore({
          atlassian: {
            mcpServerId: 'atlassian',
            accessToken: 'old',
            // refreshToken 無し
            acquiredAt: '2020-01-01T00:00:00Z',
            expiresAt: past,
            tokenType: 'Bearer',
          },
        }),
      });
      const atlassian = result.mcpServers.atlassian as { headers?: unknown };
      expect(atlassian.headers).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('expiresAt が REFRESH_BUFFER より遠ければ refresh しない (毎ターン refresh しない)', async () => {
      const farFuture = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(); // 6 時間後
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      const result = await buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [baseAtlassianConfig],
        oauthStore: makeOAuthStore({
          atlassian: {
            mcpServerId: 'atlassian',
            accessToken: 'fresh-tok',
            refreshToken: 'r',
            acquiredAt: new Date().toISOString(),
            expiresAt: farFuture,
            tokenType: 'Bearer',
          },
        }),
      });
      const atlassian = result.mcpServers.atlassian as { headers?: Record<string, string> };
      expect(atlassian.headers).toEqual({ Authorization: 'Bearer fresh-tok' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
