import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { AuthRequestCard } from './auth-request-card';

// ADR-0011 PR-E3b: AuthRequestCard は Tally Route Handler 駆動になり、UI は内部
// cardState でドライブされる。block.status / block.authUrl は使わない (PR-E4 まで残る
// 過渡期の field なので prop として渡るが見ない)。block.mcpServerId / mcpServerLabel
// だけが意味を持つ。

const pendingBlock = {
  type: 'auth_request' as const,
  mcpServerId: 'atlassian',
  mcpServerLabel: 'My Atlassian',
  // 旧 SDK 由来 URL。新カードは見ないが prop の shape を満たすため渡す。
  authUrl: 'https://legacy/sdk-loopback',
  status: 'pending' as const,
};

const PROJECT_ID = 'proj-1';
const EXPECTED_BASE_URL = `/api/projects/${PROJECT_ID}/mcp/atlassian/oauth`;

describe('AuthRequestCard (PR-E3b 新 API 駆動)', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
    useCanvasStore.setState({ projectId: PROJECT_ID } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('idle: 認証ボタンを表示し、paste 入力欄は出ない', () => {
    render(<AuthRequestCard block={pendingBlock} />);
    expect(screen.getByText(/My Atlassian 認証/)).toBeInTheDocument();
    expect(screen.getByText('未認証')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My Atlassian で認証/ })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /callback URL/ })).toBeNull();
  });

  it('認証ボタン → POST /oauth → window.open + 承認待ち状態に遷移', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === EXPECTED_BASE_URL && init?.method === 'POST') {
        return new Response(
          JSON.stringify({ authorizationUrl: 'https://auth.atlassian.com/authorize?x=1' }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${init?.method ?? 'GET'} ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);

    render(<AuthRequestCard block={pendingBlock} />);
    fireEvent.click(screen.getByRole('button', { name: /My Atlassian で認証/ }));

    await waitFor(() =>
      expect(openSpy).toHaveBeenCalledWith(
        'https://auth.atlassian.com/authorize?x=1',
        '_blank',
        'noopener,noreferrer',
      ),
    );
    expect(screen.getByText('承認待ち')).toBeInTheDocument();
    // paste UI は完全に消えている
    expect(screen.queryByRole('textbox', { name: /callback URL/ })).toBeNull();
  });

  it('POST が 409 を返したら failed 状態 + サーバ返却 error 文言を表示 (固定文言)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'oauth flow already in progress' }), {
            status: 409,
          }),
      ),
    );
    render(<AuthRequestCard block={pendingBlock} />);
    fireEvent.click(screen.getByRole('button', { name: /My Atlassian で認証/ }));
    await waitFor(() => expect(screen.getByText('失敗')).toBeInTheDocument());
    expect(screen.getByText(/oauth flow already in progress/)).toBeInTheDocument();
    // やり直すボタン
    expect(screen.getByRole('button', { name: 'やり直す' })).toBeInTheDocument();
  });

  it('やり直す → DELETE /oauth → idle に戻り再度認証ボタンが押せる', async () => {
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === EXPECTED_BASE_URL && init?.method === 'POST') {
        return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
      }
      if (url === EXPECTED_BASE_URL && init?.method === 'DELETE') {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error(`unexpected: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<AuthRequestCard block={pendingBlock} />);
    fireEvent.click(screen.getByRole('button', { name: /My Atlassian で認証/ }));
    await waitFor(() => expect(screen.getByText('失敗')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'やり直す' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /My Atlassian で認証/ })).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(EXPECTED_BASE_URL, { method: 'DELETE' });
  });

  it('マウント時に GET /oauth で状態 rehydrate (codex Major 対応): completed なら 認証済 表示', async () => {
    // codex 指摘: チャット再表示で AuthRequestCard がリマウントされた時、orchestrator
    // 側に completed / pending が残っていても card は常に idle で起動するため、ユーザーが
    // 「認証」を押すと 409 で詰まる。マウント時に GET で状態を取得して rehydrate する。
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === EXPECTED_BASE_URL && (!init?.method || init.method === 'GET')) {
          return new Response(
            JSON.stringify({ status: 'completed', authorizationUrl: 'https://x' }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected: ${init?.method ?? 'GET'} ${url}`);
      }),
    );
    render(<AuthRequestCard block={pendingBlock} />);
    await waitFor(() => expect(screen.getByText('認証済')).toBeInTheDocument());
  });

  it('マウント時 GET が 404 なら idle のまま (orchestrator 未開始)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'not started' }), { status: 404 })),
    );
    render(<AuthRequestCard block={pendingBlock} />);
    // 認証ボタンが残っている (idle 状態)
    expect(screen.getByRole('button', { name: /My Atlassian で認証/ })).toBeInTheDocument();
  });

  it('projectId 未設定なら認証ボタンが disabled (誤発火を防ぐ)', () => {
    useCanvasStore.setState({ projectId: null } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    const btn = screen.getByRole('button', { name: /My Atlassian で認証/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(screen.getByText(/プロジェクトが開かれていません/)).toBeInTheDocument();
  });
});
