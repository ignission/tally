import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TextInput } from './text-input';

describe('TextInput', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('通常の Enter は onKeyDown に届く', () => {
    const onKeyDown = vi.fn();
    render(<TextInput onKeyDown={onKeyDown} aria-label="t" />);
    fireEvent.keyDown(screen.getByLabelText('t'), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('IME 変換中の Enter は onKeyDown に届かない', () => {
    const onKeyDown = vi.fn();
    render(<TextInput onKeyDown={onKeyDown} aria-label="t" />);
    const el = screen.getByLabelText('t');
    fireEvent.compositionStart(el);
    fireEvent.keyDown(el, { key: 'Enter', isComposing: true });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('compositionEnd 直後 150ms 以内の Enter（確定 Enter）は onKeyDown に届かない', () => {
    const onKeyDown = vi.fn();
    render(<TextInput onKeyDown={onKeyDown} aria-label="t" />);
    const el = screen.getByLabelText('t');
    fireEvent.compositionStart(el);
    fireEvent.compositionEnd(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onKeyDown).not.toHaveBeenCalled();
    // 窓を抜ければ届く
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it('IME 変換中の Escape も抑止（ダイアログ誤閉じ防止）', () => {
    const onKeyDown = vi.fn();
    render(<TextInput onKeyDown={onKeyDown} aria-label="t" />);
    const el = screen.getByLabelText('t');
    fireEvent.compositionStart(el);
    fireEvent.keyDown(el, { key: 'Escape', isComposing: true });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('追加の onCompositionStart / End も呼ばれる', () => {
    const onCompositionStart = vi.fn();
    const onCompositionEnd = vi.fn();
    render(
      <TextInput
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
        aria-label="t"
      />,
    );
    const el = screen.getByLabelText('t');
    fireEvent.compositionStart(el);
    fireEvent.compositionEnd(el);
    expect(onCompositionStart).toHaveBeenCalled();
    expect(onCompositionEnd).toHaveBeenCalled();
  });
});
