// ADR-0011 PR-E5: OAuth フロー全体の E2E テスト。
// PR-E1 〜 PR-E4 で実装した部品を統合した「authorize → token 交換 → store 永続化 →
// buildMcpServers が header に注入」のシナリオを 1 本通す。
//
// 実 OAuth provider は使えないので token endpoint を mock し、それ以外 (loopback callback への
// fetch) は real fetch に流す。OAuthFlowOrchestrator の test と同じ手法。
//
// 検証する範囲:
// 1. orchestrator が authorize URL を発行
// 2. ブラウザ相当の loopback callback fetch
// 3. orchestrator が token endpoint を叩いて token を取得
// 4. FileSystemOAuthStore に YAML 永続化
// 5. buildMcpServers が同 store から token を読み Authorization header を組み立てる
// 6. token 期限が近づいたら refresh して store に書き戻す

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ATLASSIAN_CLOUD_OAUTH } from '@tally/core';
import { FileSystemOAuthStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildMcpServers } from '../mcp/build-mcp-servers';
import { __resetAllFlowsForTest, awaitOAuthFlowSettled, startOAuthFlow } from './index';

function makeProjectDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'tally-oauth-e2e-'));
}

const PROJECT_ID = 'pE5';
const ATLASSIAN_CONFIG = {
  id: 'atlassian',
  name: 'Atlassian',
  kind: 'atlassian' as const,
  url: 'https://api.atlassian.com/mcp',
  oauth: { clientId: 'cid-e2e' },
  options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
};

describe('OAuth E2E (ADR-0011 PR-E5)', () => {
  beforeEach(async () => {
    await __resetAllFlowsForTest();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await __resetAllFlowsForTest();
  });

  it('authorize → callback → token store → buildMcpServers が Authorization header を注入する', async () => {
    const projectDir = makeProjectDir();
    try {
      // token endpoint だけ mock、loopback callback への fetch は real に流す。
      // (oauth-flow-orchestrator.test.ts と同じパターン)
      const realFetch = globalThis.fetch.bind(globalThis);
      vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input.toString();
        if (u === ATLASSIAN_CLOUD_OAUTH.tokenEndpoint) {
          return new Response(
            JSON.stringify({
              access_token: 'e2e-access',
              refresh_token: 'e2e-refresh',
              expires_in: 3600,
              scope: 'read:jira-work offline_access',
              token_type: 'Bearer',
            }),
            { status: 200 },
          );
        }
        return await realFetch(input, init);
      });

      // 1. orchestrator を start
      const { authorizationUrl } = await startOAuthFlow({
        projectId: PROJECT_ID,
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: ATLASSIAN_CONFIG.oauth.clientId,
        projectDir,
      });
      expect(authorizationUrl).toMatch(/^https:\/\/auth\.atlassian\.com\/authorize\?/);

      // 2. ブラウザ相当: redirect_uri に callback を投げる
      const url = new URL(authorizationUrl);
      const redirectUri = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      if (!redirectUri || !state) throw new Error('invalid auth URL');
      const cbRes = await fetch(`${redirectUri}?code=AAA&state=${encodeURIComponent(state)}`);
      expect(cbRes.status).toBe(200);

      // 3. orchestrator の bg promise が settle するまで待つ
      await awaitOAuthFlowSettled(PROJECT_ID, 'atlassian');

      // 4. token store に永続化されていること
      const store = new FileSystemOAuthStore(projectDir);
      const persisted = await store.read('atlassian');
      expect(persisted?.accessToken).toBe('e2e-access');
      expect(persisted?.refreshToken).toBe('e2e-refresh');
      expect(persisted?.tokenType).toBe('Bearer');

      // 5. buildMcpServers が同 store から読んで Authorization header を組み立てる
      const built = await buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [ATLASSIAN_CONFIG],
        oauthStore: store,
      });
      const atlassianMcp = built.mcpServers.atlassian as {
        type: string;
        url: string;
        headers?: Record<string, string>;
      };
      expect(atlassianMcp.headers).toEqual({ Authorization: 'Bearer e2e-access' });
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('期限切れ間近の token は buildMcpServers 経由で transparent に refresh される', async () => {
    const projectDir = makeProjectDir();
    try {
      // 直接 token store に「期限切れ間近」の token を書く (ユーザーが過去に認証済の状態を再現)。
      const store = new FileSystemOAuthStore(projectDir);
      const aboutToExpire = new Date(Date.now() + 60_000).toISOString();
      await store.write({
        mcpServerId: 'atlassian',
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        acquiredAt: new Date(Date.now() - 3540_000).toISOString(),
        expiresAt: aboutToExpire,
        tokenType: 'Bearer',
        scopes: ['read:jira-work'],
      });

      // refresh 用 token endpoint を mock
      vi.stubGlobal(
        'fetch',
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                access_token: 'refreshed-access',
                refresh_token: 'rotated-refresh',
                expires_in: 3600,
                token_type: 'Bearer',
                scope: 'read:jira-work offline_access',
              }),
              { status: 200 },
            ),
        ),
      );

      // buildMcpServers が refresh を発火させ、新 access_token を header に乗せる
      const built = await buildMcpServers({
        tallyMcp: { type: 'sdk' } as unknown,
        configs: [ATLASSIAN_CONFIG],
        oauthStore: store,
      });
      const atlassianMcp = built.mcpServers.atlassian as { headers?: Record<string, string> };
      expect(atlassianMcp.headers).toEqual({ Authorization: 'Bearer refreshed-access' });

      // store にも書き戻されている (rotation が反映される)
      const persisted = await store.read('atlassian');
      expect(persisted?.accessToken).toBe('refreshed-access');
      expect(persisted?.refreshToken).toBe('rotated-refresh');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
