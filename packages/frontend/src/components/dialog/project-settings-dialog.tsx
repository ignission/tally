'use client';

import { useEffect, useId, useState } from 'react';

import { useCanvasStore } from '@/lib/store';

// プロジェクトの ProjectMeta を編集するモーダルダイアログ。
// codebasePath (primary) と additionalCodebasePaths (横断機能用) を扱う。
export function ProjectSettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const projectMeta = useCanvasStore((s) => s.projectMeta);
  const patchProjectMeta = useCanvasStore((s) => s.patchProjectMeta);
  const [value, setValue] = useState<string>(projectMeta?.codebasePath ?? '');
  // 複数行テキストで編集。1 行 = 1 パス、空行は無視。
  const [additional, setAdditional] = useState<string>(
    (projectMeta?.additionalCodebasePaths ?? []).join('\n'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const additionalId = useId();

  // open が true になった瞬間、ストアの最新値でフォームをリセットする。
  useEffect(() => {
    if (open) {
      setValue(projectMeta?.codebasePath ?? '');
      setAdditional((projectMeta?.additionalCodebasePaths ?? []).join('\n'));
      setError(null);
    }
  }, [open, projectMeta?.codebasePath, projectMeta?.additionalCodebasePaths]);

  if (!open) return null;

  const onSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const trimmed = value.trim();
      const additionalList = additional
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await patchProjectMeta({
        codebasePath: trimmed === '' ? null : trimmed,
        additionalCodebasePaths: additionalList,
      });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={CONTAINER_STYLE}>
      <button type="button" aria-label="閉じる" onClick={onClose} style={BACKDROP_STYLE} />
      <dialog open aria-modal="true" aria-labelledby="project-settings-title" style={DIALOG_STYLE}>
        <h2 id="project-settings-title" style={TITLE_STYLE}>
          プロジェクト設定
        </h2>
        <div style={FIELD_STYLE}>
          <label htmlFor={inputId} style={LABEL_STYLE}>
            codebasePath (primary)
          </label>
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="../backend"
            style={INPUT_STYLE}
          />
          <div style={HINT_STYLE}>
            AI エージェントの cwd になるメインリポジトリ。.tally の親からの相対パス。空欄で設定解除。
          </div>
        </div>
        <div style={FIELD_STYLE}>
          <label htmlFor={additionalId} style={LABEL_STYLE}>
            追加リポジトリ (横断機能用)
          </label>
          <textarea
            id={additionalId}
            value={additional}
            onChange={(e) => setAdditional(e.target.value)}
            placeholder={'../other-repo\n../another-repo'}
            rows={3}
            style={{ ...INPUT_STYLE, fontFamily: 'monospace', resize: 'vertical' }}
          />
          <div style={HINT_STYLE}>
            1 行 1 パス。primary に加え、AI が参照してよいリポジトリを列挙する (読み取り専用)。
          </div>
        </div>
        {error && <div style={ERROR_STYLE}>{error}</div>}
        <div style={BUTTONS_STYLE}>
          <button type="button" onClick={onClose} disabled={busy} style={CANCEL_BUTTON_STYLE}>
            キャンセル
          </button>
          <button type="button" onClick={onSave} disabled={busy} style={SAVE_BUTTON_STYLE}>
            {busy ? '保存中…' : '保存'}
          </button>
        </div>
      </dialog>
    </div>
  );
}

// 画面全体を覆うラッパ。backdrop ボタンと dialog を重ねるための position:fixed レイヤ。
const CONTAINER_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

// 背景クリックで閉じるための透過ボタン。
const BACKDROP_STYLE = {
  position: 'absolute' as const,
  inset: 0,
  background: 'rgba(0,0,0,0.5)',
  border: 'none',
  padding: 0,
  cursor: 'default',
};

const DIALOG_STYLE = {
  position: 'relative' as const,
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 20,
  width: 420,
  color: '#e6edf3',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 16,
};
const TITLE_STYLE = { fontSize: 15, margin: 0, fontWeight: 700 };
const FIELD_STYLE = { display: 'flex', flexDirection: 'column' as const, gap: 4 };
const LABEL_STYLE = { fontSize: 11, color: '#8b949e' };
const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 10px',
  fontSize: 13,
};
const HINT_STYLE = { fontSize: 11, color: '#6e7681' };
const ERROR_STYLE = { color: '#f85149', fontSize: 12 };
const BUTTONS_STYLE = { display: 'flex', justifyContent: 'flex-end' as const, gap: 8 };
const CANCEL_BUTTON_STYLE = {
  background: 'transparent',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
const SAVE_BUTTON_STYLE = {
  background: '#238636',
  border: '1px solid #2ea043',
  color: '#fff',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
