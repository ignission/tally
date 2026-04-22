import { describe, expect, it } from 'vitest';

import { isImeComposing } from './ime';

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
