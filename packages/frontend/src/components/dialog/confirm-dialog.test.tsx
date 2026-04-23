import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfirmDialog } from './confirm-dialog';

describe('ConfirmDialog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('open 時の Enter で onConfirm が呼ばれる', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open title="削除しますか?" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('open 時の Escape で onClose が呼ばれる', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open title="削除しますか?" onConfirm={onConfirm} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('IME 変換中の Enter では onConfirm が呼ばれない', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open title="削除しますか?" onConfirm={onConfirm} onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new CompositionEvent('compositionstart'));
    });
    fireEvent.keyDown(window, { key: 'Enter', isComposing: true });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('compositionEnd 直後 150ms 以内の Enter は抑止（Safari 対策）', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open title="削除しますか?" onConfirm={onConfirm} onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new CompositionEvent('compositionstart'));
      window.dispatchEvent(new CompositionEvent('compositionend'));
    });
    // 窓内（isComposing は false だが justEnded が true）
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    // 窓を抜ければ通常の確認
    act(() => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('IME 変換中の Escape でも onClose は呼ばれない（変換キャンセル誤検出防止）', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(<ConfirmDialog open title="削除しますか?" onConfirm={onConfirm} onClose={onClose} />);
    act(() => {
      window.dispatchEvent(new CompositionEvent('compositionstart'));
    });
    fireEvent.keyDown(window, { key: 'Escape', isComposing: true });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closed 状態では keydown を拾わない', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog open={false} title="削除しますか?" onConfirm={onConfirm} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: 'Enter' });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
