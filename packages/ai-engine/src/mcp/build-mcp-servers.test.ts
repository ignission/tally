import type { McpOAuthToken } from '@tally/core';
import type { OAuthStore } from '@tally/storage';
import { describe, expect, it } from 'vitest';

import { buildMcpServers } from './build-mcp-servers';

// PR-E4 の token 注入を検証するためのテスト用 OAuthStore。
// `read(id)` が指定 map から token を返す簡易実装。
function makeOAuthStore(map: Record<string, McpOAuthToken>): OAuthStore {
  return {
    async read(id: string) {
      return map[id] ?? null;
    },
    async write(_token) {
      // テストでは write は使わない。
    },
    async delete(_id: string) {
      // 同上。
    },
    async list() {
      return Object.keys(map);
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
});
