// ADR-0011 PR-E2: OAuth callback URL を loopback IP (127.0.0.1) で受ける一時 HTTP server。
//
// 設計判断:
// - port は OS 採番 (0 を渡す)。固定 port にすると複数フローや他プロセスとの衝突が発生する。
// - host は 127.0.0.1 固定。`localhost` だと IPv4/IPv6 どちらに bind するか実装依存で
//   redirect_uri と一致しないことがある。
// - state 検証は本モジュールで行わない (orchestrator 側の責務)。受領した code/state を
//   そのまま callback API で返す。
// - レスポンスは「タブを閉じてください」の最小 HTML。CSRF / XSS 対策で content type を
//   text/plain でも良いが、UX を考えて最小 HTML にする。
// - timeout は呼び出し側で指定 (デフォルト 5 分)。timeout で reject されたあとも close()
//   を呼べばリソース解放される。

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface LoopbackCallback {
  code: string;
  state: string;
}

export interface LoopbackCallbackHandle {
  // ブラウザに渡す redirect_uri (例: http://127.0.0.1:54321/callback)。
  redirectUri: string;
  // callback の到達を待つ。1 ハンドル 1 回だけ resolve する設計。
  awaitCallback(timeoutMs?: number): Promise<LoopbackCallback>;
  // server を閉じる。再呼び出しは no-op。
  close(): Promise<void>;
}

export interface StartLoopbackCallbackServerOptions {
  // callback path (default: '/callback')
  path?: string;
  // 希望 port (default: 0 = OS 採番)。固定 port が必要な provider 設定の場合のみ指定する。
  preferredPort?: number;
}

export async function startLoopbackCallbackServer(
  opts: StartLoopbackCallbackServerOptions = {},
): Promise<LoopbackCallbackHandle> {
  const callbackPath = opts.path ?? '/callback';
  const port = opts.preferredPort ?? 0;

  let resolveCallback: ((cb: LoopbackCallback) => void) | null = null;
  let rejectCallback: ((err: Error) => void) | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;

  const cleanup = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    resolveCallback = null;
    rejectCallback = null;
  };

  const server: Server = createServer((req, res) => {
    // path が違うものは 404。`favicon.ico` 等のノイズ対策。
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname !== callbackPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');

    if (error) {
      // Provider が OAuth error を返したケース (access_denied 等)。
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><meta charset="utf-8"><h1>認証エラー</h1><p>${escapeHtml(error)}: ${escapeHtml(errorDescription ?? '')}</p>`,
      );
      const reject = rejectCallback;
      cleanup();
      reject?.(new Error(`OAuth callback error: ${error} ${errorDescription ?? ''}`));
      return;
    }

    if (!code || !state) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        '<!doctype html><meta charset="utf-8"><h1>認証エラー</h1><p>code または state が見つかりません。</p>',
      );
      const reject = rejectCallback;
      cleanup();
      reject?.(new Error('OAuth callback missing code or state'));
      return;
    }

    // 成功レスポンス。ブラウザに「タブを閉じて Tally に戻ってください」と促す。
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><meta charset="utf-8"><h1>認証完了</h1><p>このタブを閉じて Tally に戻ってください。</p>',
    );
    const resolve = resolveCallback;
    cleanup();
    resolve?.({ code, state });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const addr = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${addr.port}${callbackPath}`;

  let closed = false;
  // 1 ハンドル 1 回だけ awaitCallback を許す。多重呼び出しは先行 Promise が
  // 未解決のまま resolveCallback/rejectCallback を上書きされてリークするため
  // 明示的に弾く (CR Major)。close 後の呼び出しも server が閉じている以上
  // callback は届かないので即時失敗にする。
  let awaitStarted = false;

  return {
    redirectUri,
    async awaitCallback(timeoutMs = 5 * 60 * 1000): Promise<LoopbackCallback> {
      if (closed) {
        throw new Error('OAuth callback server is already closed');
      }
      if (awaitStarted) {
        throw new Error('awaitCallback can only be called once per handle');
      }
      awaitStarted = true;
      return new Promise<LoopbackCallback>((resolve, reject) => {
        resolveCallback = resolve;
        rejectCallback = reject;
        if (timeoutMs > 0) {
          timeoutHandle = setTimeout(() => {
            const r = rejectCallback;
            cleanup();
            r?.(new Error(`OAuth callback timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        }
      });
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      // cleanup() より前に pending な awaitCallback を reject 発火させる
      // (cleanup() は rejectCallback を null 化するだけで reject を呼ばない)。
      // これを先にしないと、ユーザーキャンセル等で close() された際に
      // 既存の awaitCallback Promise が永遠に settle せずリークする (CR Major)。
      const reject = rejectCallback;
      cleanup();
      reject?.(new Error('OAuth callback server closed before callback received'));
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

// 最小 HTML エスケープ (provider が返す error 文言を表示する用)。
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
