import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ChatInput } from './chat-input';

describe('ChatInput', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });

  it('空入力なら送信 disabled', () => {
    render(<ChatInput />);
    const btn = screen.getByRole('button', { name: /送信/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('テキスト入力 + 送信クリックで sendChatMessage を呼ぶ', () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ sendChatMessage: spy } as never);
    render(<ChatInput />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /送信/ }));
    expect(spy).toHaveBeenCalledWith('hello');
    expect(textarea.value).toBe('');
  });

  it('Enter 単独で送信、Shift+Enter なら送信しない', () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ sendChatMessage: spy } as never);
    render(<ChatInput />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(spy).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith('hi');
  });

  it('streaming 中は disabled', () => {
    useCanvasStore.setState({ chatThreadStreaming: true } as never);
    render(<ChatInput />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    const btn = screen.getByRole('button', { name: /送信/ }) as HTMLButtonElement;
    expect(textarea.disabled).toBe(true);
    expect(btn.disabled).toBe(true);
  });
});
