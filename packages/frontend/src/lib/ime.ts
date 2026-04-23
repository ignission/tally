import {
  type CompositionEventHandler,
  type KeyboardEventHandler,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
} from 'react';

// IME 変換中の Enter を送信扱いしないための低レベル判定ユーティリティ。
// 主に window レベルの生 KeyboardEvent で使う（通常の input / textarea 用途は
// useComposition フックを使うこと）。
//
// 日本語など CJK IME での変換確定 Enter は：
//   - モダンブラウザ: KeyboardEvent.isComposing === true で発火
//   - 旧 Safari など:  keyCode === 229 で発火（isComposing が未設定）
// React の SyntheticEvent は isComposing を直接公開しないため nativeEvent も見る。
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

export interface UseCompositionOptions<T extends HTMLInputElement | HTMLTextAreaElement> {
  onKeyDown?: KeyboardEventHandler<T> | undefined;
  onCompositionStart?: CompositionEventHandler<T> | undefined;
  onCompositionEnd?: CompositionEventHandler<T> | undefined;
}

export interface UseCompositionReturn<T extends HTMLInputElement | HTMLTextAreaElement> {
  onKeyDown: KeyboardEventHandler<T>;
  onCompositionStart: CompositionEventHandler<T>;
  onCompositionEnd: CompositionEventHandler<T>;
  isComposing: () => boolean;
}

// compositionEnd 後に「確定 Enter」が別イベントとして流入するまでの許容窓 (ms)。
// Safari は compositionEnd を keydown より先に発火させる既知バグがあるため、
// 150ms 程度の余裕を取らないと 1 回目の確定 Enter を取りこぼす。
const JUST_ENDED_WINDOW_MS = 150;

// input / textarea 向けに IME 状態を追跡しつつ Enter / Escape の親伝播を抑止する hook。
//
// - composition 中は onKeyDown を呼ばず stopPropagation（親ダイアログの close 等も抑止）
// - composition 終了直後 JUST_ENDED_WINDOW_MS 以内の Enter も「確定 Enter」として抑止
// - その結果、呼び出し側の onKeyDown には「ユーザーが IME 外で押した生の Enter」だけが届く
export function useComposition<T extends HTMLInputElement | HTMLTextAreaElement>(
  options: UseCompositionOptions<T> = {},
): UseCompositionReturn<T> {
  const { onKeyDown, onCompositionStart, onCompositionEnd } = options;

  const composingRef = useRef(false);
  const justEndedRef = useRef(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
    };
  }, []);

  const handleCompositionStart = useCallback<CompositionEventHandler<T>>(
    (e) => {
      composingRef.current = true;
      justEndedRef.current = false;
      if (endTimerRef.current) {
        clearTimeout(endTimerRef.current);
        endTimerRef.current = null;
      }
      onCompositionStart?.(e);
    },
    [onCompositionStart],
  );

  const handleCompositionEnd = useCallback<CompositionEventHandler<T>>(
    (e) => {
      composingRef.current = false;
      justEndedRef.current = true;
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
      endTimerRef.current = setTimeout(() => {
        justEndedRef.current = false;
        endTimerRef.current = null;
      }, JUST_ENDED_WINDOW_MS);
      onCompositionEnd?.(e);
    },
    [onCompositionEnd],
  );

  const handleKeyDown = useCallback<KeyboardEventHandler<T>>(
    (e) => {
      const composing = composingRef.current || justEndedRef.current || isImeComposing(e);
      if (composing && (e.key === 'Enter' || e.key === 'Escape')) {
        // 親の window listener（確認ダイアログ等）や他の onKeyDown に届けない。
        e.stopPropagation();
        return;
      }
      onKeyDown?.(e);
    },
    [onKeyDown],
  );

  const isComposing = useCallback(() => composingRef.current || justEndedRef.current, []);

  return {
    onKeyDown: handleKeyDown,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    isComposing,
  };
}

// window レベルで IME 変換状態を追跡する hook。
// 確認ダイアログなど「document 全体の keydown を拾う」系のリスナーで Enter を
// 誤発火させないために使う。返り値は isComposing() 関数。
export function useWindowComposition(): () => boolean {
  const composingRef = useRef(false);
  const justEndedRef = useRef(false);
  const endTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onStart = () => {
      composingRef.current = true;
      justEndedRef.current = false;
      if (endTimerRef.current) {
        clearTimeout(endTimerRef.current);
        endTimerRef.current = null;
      }
    };
    const onEnd = () => {
      composingRef.current = false;
      justEndedRef.current = true;
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
      endTimerRef.current = setTimeout(() => {
        justEndedRef.current = false;
        endTimerRef.current = null;
      }, JUST_ENDED_WINDOW_MS);
    };
    window.addEventListener('compositionstart', onStart);
    window.addEventListener('compositionend', onEnd);
    return () => {
      window.removeEventListener('compositionstart', onStart);
      window.removeEventListener('compositionend', onEnd);
      if (endTimerRef.current) clearTimeout(endTimerRef.current);
    };
  }, []);

  return useCallback(() => composingRef.current || justEndedRef.current, []);
}
