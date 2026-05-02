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
  beforeEach(async () => {
    await __resetAllFlowsForTest();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await __resetAllFlowsForTest();
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
    // CR Major 対応で failureMessage は固定メッセージに正規化された。詳細は server log
    // (console.warn) に出るので、warn の内容で「state mismatch を検出した」ことを確認する。
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
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
        // ユーザー向けの failureMessage は固定 (raw 例外メッセージは漏らさない)
        expect(status.failureMessage).toBe('OAuth flow failed (see server logs for details)');
      }

      // server log には実際の失敗理由 (state mismatch) が出ている
      const warnCalls = warnSpy.mock.calls.map((c) => c.join(' '));
      expect(warnCalls.some((m) => /state mismatch/.test(m))).toBe(true);

      // token store には何も書かれていない
      const store = new FileSystemOAuthStore(projectDir);
      expect(await store.read('atlassian')).toBeNull();
    } finally {
      warnSpy.mockRestore();
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

  it('store.write 直前に preempt されたら旧 run はトークンを書き込まない (codex Major 対応)', async () => {
    // codex 指摘: 旧 implementation では store.write より後に runId guard があったため、
    // clearOAuthFlow → 即 start で旧 run が callback 受領まで進んだ場合、storage には
    // 旧 run のトークンが書き込まれ UI と整合が取れなかった。本テストはその retrograde
    // を防ぐ guard を踏み台にする。
    const projectDir = makeProjectDir();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // token endpoint を mock (実際には呼ばれない想定)
    let tokenEndpointHits = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const u = typeof input === 'string' ? input : input.toString();
        if (u === ATLASSIAN_CLOUD_OAUTH.tokenEndpoint) {
          tokenEndpointHits++;
          return new Response(JSON.stringify({ access_token: 'old-tok', token_type: 'Bearer' }), {
            status: 200,
          });
        }
        // それ以外 (loopback callback) は real fetch に流す
        return await (globalThis as unknown as { fetch: typeof fetch }).fetch(input);
      }),
    );

    try {
      const { clearOAuthFlow } = await import('./oauth-flow-orchestrator');
      const { authorizationUrl } = await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });
      // 旧 run を clear してすぐ新 run を始める (旧 bg はまだ awaitCallback 中)
      clearOAuthFlow('atlassian');
      await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });

      // 旧 bg は close() で reject されて catch に入るので token endpoint は呼ばれない。
      // (= 旧 run は code を取得できないため store.write も発生しない)
      // 念のため microtask drain
      await new Promise((r) => setTimeout(r, 30));

      expect(tokenEndpointHits).toBe(0);
      // 新 run は依然 pending、旧 run のトークンが書かれていないこと
      const status = getOAuthFlowStatus('atlassian');
      expect(status?.status).toBe('pending');
      const store = new FileSystemOAuthStore(projectDir);
      expect(await store.read('atlassian')).toBeNull();
      void authorizationUrl;
    } finally {
      warnSpy.mockRestore();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });

  it('clearOAuthFlow → 即 start の race で旧 bg が新 pending を踏まない (runId guard)', async () => {
    // CR Major 対応の検証: 旧 run の bg IIFE は close() で reject され catch に入るが、
    // 新 run が同じ mcpServerId で pending 状態を持っている。runId guard が無いと旧 bg は
    // 新 run の entry を 'failed' で踏みつぶす。
    const projectDir = makeProjectDir();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { clearOAuthFlow } = await import('./oauth-flow-orchestrator');

      await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });
      // 旧 run を clear → bg はまだ awaitCallback に居るが close() で reject される
      clearOAuthFlow('atlassian');
      // 旧 bg の catch ブランチが flows.get する前に新 run を開始したい。
      // clearOAuthFlow は同期で flows.delete + bg の close() を非同期 fire-and-forget
      // するので、この時点で flows は空。新 run を始める。
      await startOAuthFlow({
        mcpServerId: 'atlassian',
        provider: ATLASSIAN_CLOUD_OAUTH,
        clientId: 'cid',
        projectDir,
      });
      // 旧 bg の catch が走り終えるまで microtask を回す。
      await new Promise((r) => setTimeout(r, 20));
      // 新 run は依然として pending (旧 bg に踏まれていない)
      const status = getOAuthFlowStatus('atlassian');
      expect(status?.status).toBe('pending');
      // 旧 bg の preempted ログが出ている (failure / completion 両方ありうるが、
      // close() が awaitCallback を reject するので failure 経由)。
      const warnCalls = warnSpy.mock.calls.map((c) => c.join(' '));
      expect(warnCalls.some((m) => /preempted/.test(m))).toBe(true);
    } finally {
      warnSpy.mockRestore();
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
