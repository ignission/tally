import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isImeComposing, useComposition, useWindowComposition } from './ime';

describe('isImeComposing', () => {
  it('isComposing=true なら true', () => {
    expect(isImeComposing({ isComposing: true })).toBe(true);
  });

  it('nativeEvent.isComposing=true なら true（React SyntheticEvent 経由）', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
  });

  it('keyCode=229 なら true（旧 Safari 互換）', () => {
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
  });

  it('すべて未設定なら false', () => {
    expect(isImeComposing({})).toBe(false);
  });

  it('isComposing=false かつ keyCode!=229 なら false', () => {
    expect(
      isImeComposing({ isComposing: false, keyCode: 13, nativeEvent: { isComposing: false } }),
    ).toBe(false);
  });
});

describe('useComposition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // テスト用の最小限 SyntheticEvent モック。必要プロパティだけ詰める。
  type KeyInit = {
    key: string;
    nativeIsComposing?: boolean;
    keyCode?: number;
    shiftKey?: boolean;
  };
  function keyEvent(init: KeyInit) {
    return {
      key: init.key,
      shiftKey: init.shiftKey ?? false,
      keyCode: init.keyCode ?? 0,
      nativeEvent: { isComposing: init.nativeIsComposing ?? false },
      stopPropagation: vi.fn(),
      preventDefault: vi.fn(),
    } as unknown as React.KeyboardEvent<HTMLInputElement>;
  }
  function compositionEvent() {
    return {} as React.CompositionEvent<HTMLInputElement>;
  }

  it('通常の Enter は onKeyDown に渡る', () => {
    const onKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition<HTMLInputElement>({ onKeyDown }));
    const e = keyEvent({ key: 'Enter' });
    act(() => {
      result.current.onKeyDown(e);
    });
    expect(onKeyDown).toHaveBeenCalledWith(e);
    expect(e.stopPropagation).not.toHaveBeenCalled();
  });

  it('composition 中の Enter は onKeyDown に渡さず stopPropagation', () => {
    const onKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition<HTMLInputElement>({ onKeyDown }));
    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });
    const e = keyEvent({ key: 'Enter' });
    act(() => {
      result.current.onKeyDown(e);
    });
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('composition 中の Escape も抑止される（ダイアログ誤閉じ防止）', () => {
    const onKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition<HTMLInputElement>({ onKeyDown }));
    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });
    const e = keyEvent({ key: 'Escape' });
    act(() => {
      result.current.onKeyDown(e);
    });
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('compositionEnd 直後 150ms 以内の Enter は確定Enter として抑止（Safari 対策）', () => {
    const onKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition<HTMLInputElement>({ onKeyDown }));
    act(() => {
      result.current.onCompositionStart(compositionEvent());
      result.current.onCompositionEnd(compositionEvent());
    });
    // 100ms 経過 → まだ窓内
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const e = keyEvent({ key: 'Enter' });
    act(() => {
      result.current.onKeyDown(e);
    });
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });

  it('compositionEnd から 150ms 経過後の Enter は通常送信', () => {
    const onKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition<HTMLInputElement>({ onKeyDown }));
    act(() => {
      result.current.onCompositionStart(compositionEvent());
      result.current.onCompositionEnd(compositionEvent());
    });
    act(() => {
      vi.advanceTimersByTime(200);
    });
    const e = keyEvent({ key: 'Enter' });
    act(() => {
      result.current.onKeyDown(e);
    });
    expect(onKeyDown).toHaveBeenCalledWith(e);
  });

  it('nativeEvent.isComposing=true の Enter も抑止', () => {
    const onKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition<HTMLInputElement>({ onKeyDown }));
    const e = keyEvent({ key: 'Enter', nativeIsComposing: true });
    act(() => {
      result.current.onKeyDown(e);
    });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('keyCode=229 の Enter も抑止', () => {
    const onKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition<HTMLInputElement>({ onKeyDown }));
    const e = keyEvent({ key: 'Enter', keyCode: 229 });
    act(() => {
      result.current.onKeyDown(e);
    });
    expect(onKeyDown).not.toHaveBeenCalled();
  });

  it('ユーザー指定の onCompositionStart / onCompositionEnd も呼ばれる', () => {
    const onCompositionStart = vi.fn();
    const onCompositionEnd = vi.fn();
    const { result } = renderHook(() =>
      useComposition<HTMLInputElement>({ onCompositionStart, onCompositionEnd }),
    );
    const start = compositionEvent();
    const end = compositionEvent();
    act(() => {
      result.current.onCompositionStart(start);
      result.current.onCompositionEnd(end);
    });
    expect(onCompositionStart).toHaveBeenCalledWith(start);
    expect(onCompositionEnd).toHaveBeenCalledWith(end);
  });
});

describe('useWindowComposition', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('window の compositionstart / end を追跡し、終了 150ms 窓を維持', () => {
    const { result } = renderHook(() => useWindowComposition());
    expect(result.current()).toBe(false);

    act(() => {
      window.dispatchEvent(new CompositionEvent('compositionstart'));
    });
    expect(result.current()).toBe(true);

    act(() => {
      window.dispatchEvent(new CompositionEvent('compositionend'));
    });
    // 窓内はまだ true
    expect(result.current()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current()).toBe(false);
  });
});
