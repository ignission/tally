import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { AuthRequestCard } from './auth-request-card';

describe('AuthRequestCard', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  // window.open / sendChatMessage の spy がテスト中の throw でリストアされず
  // 後続テストに漏れるのを防ぐ (vi.restoreAllMocks は spyOn で作った spy のみ復元する)。
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const pendingBlock = {
    type: 'auth_request' as const,
    mcpServerId: 'atlassian',
    mcpServerLabel: 'My Atlassian',
    authUrl: 'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc&state=xyz',
    status: 'pending' as const,
  };

  it('pending: ラベル / 認証ボタン / paste 入力欄が表示される', () => {
    useCanvasStore.setState({ sendOAuthCallback: vi.fn() } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    expect(screen.getByText(/My Atlassian 認証/)).toBeInTheDocument();
    expect(screen.getByText(/未認証/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My Atlassian で認証/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /callback URL/ })).toBeInTheDocument();
  });

  it('「認証」ボタンクリックで authUrl を新規タブで開く (window.open)', () => {
    useCanvasStore.setState({ sendOAuthCallback: vi.fn() } as never);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<AuthRequestCard block={pendingBlock} />);
    fireEvent.click(screen.getByRole('button', { name: /My Atlassian で認証/ }));
    expect(openSpy).toHaveBeenCalledWith(pendingBlock.authUrl, '_blank', 'noopener,noreferrer');
  });

  it('callback URL 入力 → 認証完了で sendOAuthCallback に mcpServerId と URL を構造化送信', async () => {
    const send = vi.fn();
    useCanvasStore.setState({ sendOAuthCallback: send } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    const input = screen.getByRole('textbox', { name: /callback URL/ }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'http://localhost:54801/callback?code=AAA&state=xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^認証完了$/ }));
    await screen.findByDisplayValue('');
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'atlassian',
      'http://localhost:54801/callback?code=AAA&state=xyz',
    );
  });

  it('callback URL の形式が不正なら認証完了ボタンが disabled (送信されない)', () => {
    const send = vi.fn();
    useCanvasStore.setState({ sendOAuthCallback: send } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    const input = screen.getByRole('textbox', { name: /callback URL/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not a url' } });
    const btn = screen.getByRole('button', { name: /^認証完了$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(send).not.toHaveBeenCalled();
  });

  it('host が localhost / 127.0.0.1 でない URL は reject (paste 偽造の防御)', () => {
    useCanvasStore.setState({ sendOAuthCallback: vi.fn() } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    const input = screen.getByRole('textbox', { name: /callback URL/ }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'http://evil.example.com/callback?code=AAA&state=xyz' },
    });
    const btn = screen.getByRole('button', { name: /^認証完了$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('credential 付き URL (user:pass@) は reject', () => {
    useCanvasStore.setState({ sendOAuthCallback: vi.fn() } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    const input = screen.getByRole('textbox', { name: /callback URL/ }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'http://user:pass@localhost:54801/callback?code=AAA&state=xyz' },
    });
    const btn = screen.getByRole('button', { name: /^認証完了$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('completed: 完了メッセージを表示し paste 欄は出ない', () => {
    useCanvasStore.setState({ sendOAuthCallback: vi.fn() } as never);
    render(<AuthRequestCard block={{ ...pendingBlock, status: 'completed' }} />);
    expect(screen.getByText(/認証済/)).toBeInTheDocument();
    expect(screen.getByText(/認証完了/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /callback URL/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /My Atlassian で認証/ })).toBeNull();
  });

  it('failed: 失敗メッセージと failureMessage 内容を表示', () => {
    useCanvasStore.setState({ sendOAuthCallback: vi.fn() } as never);
    render(
      <AuthRequestCard
        block={{
          ...pendingBlock,
          status: 'failed',
          failureMessage: 'invalid_grant: state mismatch',
        }}
      />,
    );
    expect(screen.getAllByText(/失敗/).length).toBeGreaterThan(0);
    expect(screen.getByText(/invalid_grant: state mismatch/)).toBeInTheDocument();
  });
});
