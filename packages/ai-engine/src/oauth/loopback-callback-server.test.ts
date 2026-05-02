import { describe, expect, it } from 'vitest';

import { startLoopbackCallbackServer } from './loopback-callback-server';

describe('startLoopbackCallbackServer', () => {
  it('redirectUri は http://127.0.0.1:<port>/callback 形式 (port は OS 採番)', async () => {
    const handle = await startLoopbackCallbackServer();
    try {
      expect(handle.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    } finally {
      await handle.close();
    }
  });

  it('callback URL を叩くと awaitCallback が code/state で resolve する', async () => {
    const handle = await startLoopbackCallbackServer();
    try {
      const promise = handle.awaitCallback();
      // ブラウザの redirect 相当を fetch で再現
      const callbackRes = await fetch(`${handle.redirectUri}?code=AAA&state=xyz`);
      expect(callbackRes.status).toBe(200);
      const got = await promise;
      expect(got).toEqual({ code: 'AAA', state: 'xyz' });
    } finally {
      await handle.close();
    }
  });

  it('error= 付き callback は awaitCallback を reject + 400 を返す', async () => {
    const handle = await startLoopbackCallbackServer();
    try {
      const promise = handle.awaitCallback();
      // unhandled rejection 抑止: rejection を先に観測予約しておかないと、
      // Vitest が fetch との race で reject を unhandled として記録する。
      promise.catch(() => {});
      const res = await fetch(
        `${handle.redirectUri}?error=access_denied&error_description=user%20canceled`,
      );
      expect(res.status).toBe(400);
      await expect(promise).rejects.toThrow(/access_denied/);
    } finally {
      await handle.close();
    }
  });

  it('code/state が無い callback は reject + 400', async () => {
    const handle = await startLoopbackCallbackServer();
    try {
      const promise = handle.awaitCallback();
      promise.catch(() => {});
      const res = await fetch(`${handle.redirectUri}?code=onlyCode`);
      expect(res.status).toBe(400);
      await expect(promise).rejects.toThrow(/missing code or state/);
    } finally {
      await handle.close();
    }
  });

  it('callback path 以外のリクエストは 404 (favicon 等のノイズ対策)', async () => {
    const handle = await startLoopbackCallbackServer();
    try {
      const res = await fetch(`http://127.0.0.1:${new URL(handle.redirectUri).port}/favicon.ico`);
      expect(res.status).toBe(404);
    } finally {
      await handle.close();
    }
  });

  it('timeout で awaitCallback が reject する', async () => {
    const handle = await startLoopbackCallbackServer();
    try {
      const start = Date.now();
      await expect(handle.awaitCallback(50)).rejects.toThrow(/timeout/);
      // 50ms ちょうどで止まる保証はないが、明らかに長すぎないことだけ確認
      expect(Date.now() - start).toBeLessThan(2000);
    } finally {
      await handle.close();
    }
  });

  it('close は冪等 (二度呼んでも throw しない)', async () => {
    const handle = await startLoopbackCallbackServer();
    await handle.close();
    await expect(handle.close()).resolves.toBeUndefined();
  });

  it('close() で pending な awaitCallback が reject される (永久 pending リーク防止)', async () => {
    const handle = await startLoopbackCallbackServer();
    const promise = handle.awaitCallback();
    promise.catch(() => {});
    await handle.close();
    await expect(promise).rejects.toThrow(/server closed/);
  });

  it('preferredPort 指定時はその port で listen (port=0 は OS 採番)', async () => {
    // 0 を指定したときと省略時は同じ挙動 (OS 採番)。
    const a = await startLoopbackCallbackServer({ preferredPort: 0 });
    try {
      expect(Number(new URL(a.redirectUri).port)).toBeGreaterThan(0);
    } finally {
      await a.close();
    }
  });

  it('path カスタマイズで redirect_uri が変わる', async () => {
    const handle = await startLoopbackCallbackServer({ path: '/oauth/callback' });
    try {
      expect(handle.redirectUri).toMatch(/\/oauth\/callback$/);
      const promise = handle.awaitCallback();
      await fetch(`${handle.redirectUri}?code=A&state=S`);
      const got = await promise;
      expect(got.code).toBe('A');
    } finally {
      await handle.close();
    }
  });
});
