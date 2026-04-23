import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TextArea } from './text-area';

describe('TextArea', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('通常の Enter は onKeyDown に届く', () => {
    const onKeyDown = vi.fn();
    render(<TextArea onKeyDown={onKeyDown} aria-label="t" />);
    fireEvent.keyDown(screen.getByLabelText('t'), { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalled();
  });

  it('IME 変換中の Enter は onKeyDown に届かない', () => {
    const onKeyDown = vi.fn();
    render(<TextArea onKeyDown={onKeyDown} aria-label="t" />);
    const el = screen.getByLabelText('t');
    fireEvent.compositionStart(el);
    fireEvent.keyDown(el, { key: 'Enter', isComposing: true });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('compositionEnd 直後 150ms 以内の Enter は onKeyDown に届かない（Safari 対策）', () => {
    const onKeyDown = vi.fn();
    render(<TextArea onKeyDown={onKeyDown} aria-label="t" />);
    const el = screen.getByLabelText('t');
    fireEvent.compositionStart(el);
    fireEvent.compositionEnd(el);
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onKeyDown).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});
