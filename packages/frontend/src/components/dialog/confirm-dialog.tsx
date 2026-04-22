'use client';

import { useEffect } from 'react';

import { isImeComposing } from '@/lib/ime';

interface Props {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}

// 破壊的操作の前に挟む汎用確認ダイアログ。
// Escape でキャンセル、背景クリックでキャンセル、Enter でコンファーム。
// backdrop を <button>、ダイアログ本体を <dialog> として兄弟配置し
// a11y (Biome useSemanticElements / インタラクティブ要素のネスト禁止) を満たす。
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = '削除',
  onConfirm,
  onClose,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      // window レベルのリスナーなので、別の入力欄で IME 変換中の Enter を拾って誤確定しないよう除外。
      else if (e.key === 'Enter' && !isImeComposing(e)) onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onConfirm]);

  if (!open) return null;

  return (
    <div style={CONTAINER_STYLE}>
      <button type="button" aria-label="閉じる" onClick={onClose} style={BACKDROP_STYLE} />
      <dialog open aria-modal="true" aria-label={title} style={DIALOG_STYLE}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>{title}</div>
        {body && <div style={{ fontSize: 12, color: '#c8d1da' }}>{body}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={CANCEL_STYLE}>
            キャンセル
          </button>
          {/* biome-ignore lint/a11y/noAutofocus: 確認ダイアログは open 時にフォーカスを奪うのが UX 上正しい。 */}
          <button type="button" onClick={onConfirm} style={CONFIRM_STYLE} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </dialog>
    </div>
  );
}

// 画面全体を覆うラッパ。内部の backdrop ボタンと dialog を重ねるために position:fixed のレイヤを提供する。
const CONTAINER_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

// 背景クリックで閉じるための透過ボタン。dialog と同サイズに広げる。
const BACKDROP_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  border: 'none',
  padding: 0,
  cursor: 'default',
};

const DIALOG_STYLE = {
  position: 'relative' as const,
  width: 360,
  background: '#161b22',
  color: '#e6edf3',
  borderRadius: 10,
  border: '1px solid #30363d',
  padding: 20,
  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
};

const CANCEL_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
};

const CONFIRM_STYLE = {
  background: '#b62324',
  color: '#fff',
  border: '1px solid #8c1b1b',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
};
