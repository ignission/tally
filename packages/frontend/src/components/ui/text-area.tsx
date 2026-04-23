'use client';

import type { TextareaHTMLAttributes } from 'react';

import { useComposition } from '@/lib/ime';

// IME (CJK 変換) を安全に扱う <textarea> ラッパー。
// 呼び出し側の onKeyDown には「IME 変換中および確定直後を除外した生 Enter」だけが届く。
// Tally 全体で素の <textarea> の代わりに必ずこれを使う（書き忘れ防止）。
// スタイルは Tally 規約どおり props.style で渡す。
export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function TextArea({
  onKeyDown,
  onCompositionStart,
  onCompositionEnd,
  ...props
}: TextAreaProps) {
  const composition = useComposition<HTMLTextAreaElement>({
    onKeyDown,
    onCompositionStart,
    onCompositionEnd,
  });

  return (
    <textarea
      {...props}
      onKeyDown={composition.onKeyDown}
      onCompositionStart={composition.onCompositionStart}
      onCompositionEnd={composition.onCompositionEnd}
    />
  );
}
