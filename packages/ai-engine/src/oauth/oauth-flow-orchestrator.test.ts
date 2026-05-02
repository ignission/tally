import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ATLASSIAN_CLOUD_OAUTH } from '@tally/core';
import { FileSystemOAuthStore } from '@tally/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __resetAllFlowsForTest,
  awaitOAuthFlowSettled,
  getOAuthFlowStatus,
  startOAuthFlow,
} from './oauth-flow-orchestrator';

function makeProjectDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'tally-oauth-orch-'));
}

describe('startOAuthFlow / getOAuthFlowStatus', () => {
  beforeEach(() => {
    __resetAllFlowsForTest();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    __resetAllFlowsForTest();
  });

  it('start すると authorizationUrl を返し、状態は pending', async () => {
    const projectDir = makeProjectDir();
    try {
      // fetch を呼ぶのは callback 受領後 (token 交換) なので start 単独では呼ばれない。
      const { authorizationUrl } = await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });
      expect(authorizationUrl).toMatch(/^https:\/\/auth\.atlassian\.com\/authorize\?/);
      expect(authorizationUrl).toContain('client_id=cid');
      expect(authorizationUrl).toContain('code_challenge_method=S256');

      const status = getOAuthFlowStatus('atlassian');
      expect(status?.status).toBe('pending');
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('callback 受領 → token 交換 成功で completed 状態 + token store に保存', async () => {
    const projectDir = makeProjectDir();
    try {
      // token endpoint を mock
      const fetchMock = vi.fn<typeof fetch>(
        async () =>
          new Response(
            JSON.stringify({
              access_token: 'a-tok',
              refresh_token: 'r-tok',
              expires_in: 3600,
              scope: 'read:jira-work offline_access',
              token_type: 'Bearer',
            }),
            { status: 200 },
          ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const { authorizationUrl } = await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });

      // authorization URL から redirect_uri と state を抜き出して、loopback に callback
      // を fetch する (= ブラウザの redirect 相当)。
      const url = new URL(authorizationUrl);
      const redirectUri = url.searchParams.get('redirect_uri');
      const state = url.searchParams.get('state');
      if (!redirectUri || !state) throw new Error('missing redirect_uri or state in auth URL');
      // unstubAllGlobals していない時点で fetch も mock されているので、real fetch を取り戻す。
      // → fetch モックは token endpoint だけ反応するように URL で振り分けるよう作り直す。
      // (今のテストでは token mock + loopback fetch を両立させたいので、
      //  loopback への fetch は mock を介さず Node の global fetch を直接使う必要がある)
      // 簡易解: token endpoint を判定して mock、それ以外は元の fetch に委譲。
      vi.unstubAllGlobals();
      const realFetch = globalThis.fetch.bind(globalThis);
      vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input.toString();
        if (u === ATLASSIAN_CLOUD_OAUTH.tokenEndpoint) {
          return new Response(
            JSON.stringify({
              access_token: 'a-tok',
              refresh_token: 'r-tok',
              expires_in: 3600,
              scope: 'read:jira-work offline_access',
              token_type: 'Bearer',
            }),
            { status: 200 },
          );
        }
        return await realFetch(input, init);
      });

      // loopback callback を叩く (real fetch で)
      const cbRes = await fetch(`${redirectUri}?code=AAA&state=${encodeURIComponent(state)}`);
      expect(cbRes.status).toBe(200);

      // bg promise の settle を待つ
      await awaitOAuthFlowSettled('atlassian');

      const status = getOAuthFlowStatus('atlassian');
      expect(status?.status).toBe('completed');

      // token store に書かれていることを確認
      const store = new FileSystemOAuthStore(projectDir);
      const token = await store.read('atlassian');
      expect(token?.accessToken).toBe('a-tok');
      expect(token?.refreshToken).toBe('r-tok');
      expect(token?.scopes).toEqual(['read:jira-work', 'offline_access']);
      expect(token?.tokenType).toBe('Bearer');
      // expiresAt は now + 3600 秒 (大まかな範囲確認)
      expect(token?.expiresAt).toBeDefined();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('state mismatch で failed 状態 (CSRF 検出)', async () => {
    const projectDir = makeProjectDir();
    try {
      const { authorizationUrl } = await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });
      const redirectUri = new URL(authorizationUrl).searchParams.get('redirect_uri');
      if (!redirectUri) throw new Error('missing redirect_uri');

      // 不正な state で callback を叩く
      await fetch(`${redirectUri}?code=AAA&state=wrong-state`);
      await awaitOAuthFlowSettled('atlassian');

      const status = getOAuthFlowStatus('atlassian');
      expect(status?.status).toBe('failed');
      if (status?.status === 'failed') {
        expect(status.failureMessage).toMatch(/state mismatch/);
      }

      // token store には何も書かれていない
      const store = new FileSystemOAuthStore(projectDir);
      expect(await store.read('atlassian')).toBeNull();
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('pending 中の二重 start は reject', async () => {
    const projectDir = makeProjectDir();
    try {
      await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });
      await expect(
        startOAuthFlow({
          mcpServerId: 'atlassian',
          provider: ATLASSIAN_CLOUD_OAUTH,
          clientId: 'cid',
          projectDir,
        }),
      ).rejects.toThrow(/already in progress/);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('concurrent な並走 start (await 中の race) でも 1 つだけ成功する', async () => {
    const projectDir = makeProjectDir();
    try {
      // 同 mcpServerId への start を Promise.all で同時起動する。HIGH 修正前は
      // 両方が `existing?.status === 'pending'` チェックを通過してフローが二重に走る。
      const results = await Promise.allSettled([
        startOAuthFlow({
          mcpServerId: 'atlassian',
          provider: ATLASSIAN_CLOUD_OAUTH,
          clientId: 'cid',
          projectDir,
        }),
        startOAuthFlow({
          mcpServerId: 'atlassian',
          provider: ATLASSIAN_CLOUD_OAUTH,
          clientId: 'cid',
          projectDir,
        }),
      ]);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('clearOAuthFlow で pending 中の bg を中断する (callbackHandle.close 経由)', async () => {
    const projectDir = makeProjectDir();
    try {
      await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });
      // 直接 clearOAuthFlow → bg IIFE が awaitCallback を reject されて catch に行く
      // が、entry は既に消えているので状態遷移は起きない (warn が出る)。
      const { clearOAuthFlow } = await import('./oauth-flow-orchestrator');
      clearOAuthFlow('atlassian');
      // bg promise が settle するまで待つ helper はもう entry が無いので no-op。
      // ここでは「再 start が即可能」であることを確認する。
      const { authorizationUrl } = await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });
      expect(authorizationUrl).toMatch(/^https:\/\/auth\.atlassian\.com\//);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('未開始の mcpServerId は getOAuthFlowStatus が null を返す', () => {
    expect(getOAuthFlowStatus('never-started')).toBeNull();
  });
});
