'use client';

import type { InputHTMLAttributes } from 'react';

import { useComposition } from '@/lib/ime';

// IME (CJK 変換) を安全に扱う <input> ラッパー。
// 呼び出し側の onKeyDown には「IME 変換中および確定直後を除外した生 Enter」だけが届く。
// Tally 全体で素の <input> の代わりに必ずこれを使う（書き忘れ防止）。
// スタイルは Tally 規約どおり props.style で渡す。
export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: TextInputProps) {
  const composition = useComposition<HTMLInputElement>({
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
  });

  return (
    <input
      {...props}
      onKeyDown={composition.onKeyDown}
      onCompositionStart={composition.onCompositionStart}
      onCompositionEnd={composition.onCompositionEnd}
    />
  );
}
