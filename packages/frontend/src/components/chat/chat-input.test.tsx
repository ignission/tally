import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useCanvasStore } from '@/lib/store';

import { ChatInput } from './chat-input';

describe('ChatInput', () => {
  beforeEach(() => {
    useCanvasStore.getState().reset();
  });
  afterEach(() => {
    vi.useRealTimers();
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

  it('IME 変換中の Enter（isComposing=true）では送信しない', () => {
    const spy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ sendChatMessage: spy } as never);
    render(<ChatInput />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'にほんご' } });
    // 日本語 IME 変換確定時のEnterは isComposing=true で発火する。
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(spy).not.toHaveBeenCalled();
    // keyCode 229 も旧仕様互換として IME 中扱い（Safari 等）。
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
    expect(spy).not.toHaveBeenCalled();
    // 確定後の素の Enter は送信する。
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith('にほんご');
  });

  it('compositionStart/End 後 150ms 以内の Enter は確定 Enter として抑止される（Safari 対策）', () => {
    vi.useFakeTimers();
    const spy = vi.fn().mockResolvedValue(undefined);
    useCanvasStore.setState({ sendChatMessage: spy } as never);
    render(<ChatInput />);
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'にほんご' } });
    // Safari: compositionEnd が先に発火し、その直後に素の Enter keydown が来るパターン
    fireEvent.compositionStart(textarea);
    fireEvent.compositionEnd(textarea);
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(spy).not.toHaveBeenCalled();
    // 150ms 窓を超えれば通常 Enter として送信される
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(spy).toHaveBeenCalledWith('にほんご');
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
