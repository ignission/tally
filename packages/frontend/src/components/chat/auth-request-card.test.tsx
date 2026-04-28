import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { AuthRequestCard } from './auth-request-card';

describe('AuthRequestCard', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  const pendingBlock = {
    type: 'auth_request' as const,
    mcpServerId: 'atlassian',
    mcpServerLabel: 'My Atlassian',
    authUrl: 'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc&state=xyz',
    status: 'pending' as const,
  };

  it('pending: ラベル / 認証ボタン / paste 入力欄が表示される', () => {
    useCanvasStore.setState({ sendChatMessage: vi.fn() } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    expect(screen.getByText(/My Atlassian 認証/)).toBeInTheDocument();
    expect(screen.getByText(/未認証/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /My Atlassian で認証/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /callback URL/ })).toBeInTheDocument();
  });

  it('「認証」ボタンクリックで authUrl を新規タブで開く (window.open)', () => {
    useCanvasStore.setState({ sendChatMessage: vi.fn() } as never);
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null);
    render(<AuthRequestCard block={pendingBlock} />);
    fireEvent.click(screen.getByRole('button', { name: /My Atlassian で認証/ }));
    expect(openSpy).toHaveBeenCalledWith(pendingBlock.authUrl, '_blank', 'noopener,noreferrer');
    openSpy.mockRestore();
  });

  it('callback URL 入力 → 認証完了で sendChatMessage に mcpServerId 付き user_message を送る', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ sendChatMessage: send } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    const input = screen.getByRole('textbox', { name: /callback URL/ }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'http://localhost:54801/callback?code=AAA&state=xyz' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^認証完了$/ }));
    // sendChatMessage 呼び出し待ち
    await screen.findByDisplayValue(''); // 送信成功時は input がクリアされる
    expect(send).toHaveBeenCalledTimes(1);
    const text = send.mock.calls[0]?.[0] as string;
    expect(text).toContain('[OAuth callback for atlassian]');
    expect(text).toContain('http://localhost:54801/callback?code=AAA&state=xyz');
    expect(text).toContain('My Atlassian');
  });

  it('callback URL の形式が不正なら認証完了ボタンが disabled (送信されない)', () => {
    const send = vi.fn();
    useCanvasStore.setState({ sendChatMessage: send } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    const input = screen.getByRole('textbox', { name: /callback URL/ }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'not a url' } });
    const btn = screen.getByRole('button', { name: /^認証完了$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(send).not.toHaveBeenCalled();
  });

  it('host が localhost / 127.0.0.1 でない URL は reject (paste 偽造の防御)', () => {
    useCanvasStore.setState({ sendChatMessage: vi.fn() } as never);
    render(<AuthRequestCard block={pendingBlock} />);
    const input = screen.getByRole('textbox', { name: /callback URL/ }) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: 'http://evil.example.com/callback?code=AAA&state=xyz' },
    });
    const btn = screen.getByRole('button', { name: /^認証完了$/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('completed: 完了メッセージを表示し paste 欄は出ない', () => {
    useCanvasStore.setState({ sendChatMessage: vi.fn() } as never);
    render(
      <AuthRequestCard
        block={{
          ...pendingBlock,
          status: 'completed',
        }}
      />,
    );
    expect(screen.getByText(/認証済/)).toBeInTheDocument();
    expect(screen.getByText(/認証完了/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /callback URL/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /My Atlassian で認証/ })).toBeNull();
  });

  it('failed: 失敗メッセージと failureMessage 内容を表示', () => {
    useCanvasStore.setState({ sendChatMessage: vi.fn() } as never);
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
