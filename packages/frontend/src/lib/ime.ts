import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

// IME 変換中の Enter を送信扱いしないための判定ユーティリティ。
//
// 日本語など CJK IME での変換確定 Enter は：
//   - モダンブラウザ: KeyboardEvent.isComposing === true で発火
//   - 旧 Safari など:  keyCode === 229 で発火（isComposing が未設定）
// いずれのパターンでも送信をブロックする必要がある。
//
// 注意: React の SyntheticEvent は isComposing を直接公開しないため、
// nativeEvent 側も見る必要がある。
export function isImeComposing(
  e:
    | ReactKeyboardEvent<Element>
    | KeyboardEvent
    | { isComposing?: boolean; keyCode?: number; nativeEvent?: { isComposing?: boolean } },
): boolean {
  if ('isComposing' in e && e.isComposing) return true;
  if (
    'nativeEvent' in e &&
    e.nativeEvent &&
    typeof e.nativeEvent === 'object' &&
    'isComposing' in e.nativeEvent &&
    e.nativeEvent.isComposing
  )
    return true;
  if ('keyCode' in e && e.keyCode === 229) return true;
  return false;
}
