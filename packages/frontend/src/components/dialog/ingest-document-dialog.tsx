'use client';

import { useState } from 'react';

import { type IngestDocumentInput, useCanvasStore } from '@/lib/store';

interface IngestDocumentDialogProps {
  open: boolean;
  onClose: () => void;
}

type Mode = 'paste' | 'docs-dir';

// 要求書を貼り付け or ディレクトリ指定で ingest-document を起動するダイアログ。
// 他エージェント実行中は全ボタン disabled (WS 二重起動防止)。
// 取り込み失敗時はテキスト/パスを保持し、ダイアログ維持 + エラー表示。
export function IngestDocumentDialog({ open, onClose }: IngestDocumentDialogProps) {
  const [mode, setMode] = useState<Mode>('paste');
  const [text, setText] = useState('');
  const [dirPath, setDirPath] = useState('docs');
  const [error, setError] = useState<string | null>(null);
  const startIngestDocument = useCanvasStore((s) => s.startIngestDocument);
  const runningAgent = useCanvasStore((s) => s.runningAgent);
  const anyBusy = runningAgent !== null;
  const mine = runningAgent?.agent === 'ingest-document';

  if (!open) return null;

  const disabledByEmpty = mode === 'paste' ? text.trim().length === 0 : dirPath.trim().length === 0;

  const onIngest = async () => {
    setError(null);
    const input: IngestDocumentInput =
      mode === 'paste' ? { source: 'paste', text } : { source: 'docs-dir', dirPath };
    const result = await startIngestDocument(input);
    if (result.ok) {
      if (mode === 'paste') setText('');
      onClose();
    } else {
      setError(result.errorMessage ?? '取り込みに失敗しました');
    }
  };

  const primaryLabel = mine ? '取り込み中…' : '取り込む';
  const primaryTooltip = anyBusy && !mine ? '別のエージェントが実行中です' : undefined;

  return (
    <div style={BACKDROP_STYLE}>
      <div style={DIALOG_STYLE}>
        <h2 style={TITLE_STYLE}>要求書から取り込む</h2>
        <p style={DESC_STYLE}>
          要求書を貼り付け、または workspaceRoot
          配下のドキュメントディレクトリを指定してください。AI が requirement と usecase の proposal
          を生成します。
        </p>
        <div style={TABS_STYLE} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'paste'}
            onClick={() => setMode('paste')}
            style={tabStyle(mode === 'paste')}
          >
            貼り付け
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'docs-dir'}
            onClick={() => setMode('docs-dir')}
            style={tabStyle(mode === 'docs-dir')}
          >
            ディレクトリ
          </button>
        </div>
        {mode === 'paste' ? (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="要求書のテキストをここに貼り付け"
            rows={16}
            disabled={anyBusy}
            style={TEXTAREA_STYLE}
          />
        ) : (
          <label style={DIR_LABEL_STYLE}>
            ディレクトリパス (workspaceRoot 相対)
            <input
              type="text"
              value={dirPath}
              onChange={(e) => setDirPath(e.target.value)}
              placeholder="docs"
              disabled={anyBusy}
              style={DIR_INPUT_STYLE}
            />
          </label>
        )}
        {error && <div style={ERROR_STYLE}>エラー: {error}</div>}
        <div style={BUTTONS_STYLE}>
          <button type="button" onClick={onClose} disabled={anyBusy} style={CANCEL_BUTTON_STYLE}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              onIngest().catch((e) => setError(String(e)));
            }}
            disabled={anyBusy || disabledByEmpty}
            title={primaryTooltip}
            style={PRIMARY_BUTTON_STYLE}
          >
            {primaryLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const BACKDROP_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const DIALOG_STYLE = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 20,
  width: 600,
  maxWidth: '90vw',
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 12,
};

const TITLE_STYLE = {
  margin: 0,
  fontSize: 16,
  color: '#e6edf3',
};

const DESC_STYLE = {
  margin: 0,
  fontSize: 12,
  color: '#8b949e',
  lineHeight: 1.5,
};

const TABS_STYLE = {
  display: 'flex',
  gap: 4,
  borderBottom: '1px solid #30363d',
};

function tabStyle(active: boolean) {
  return {
    background: active ? '#21262d' : 'transparent',
    color: active ? '#e6edf3' : '#8b949e',
    borderTop: active ? '1px solid #30363d' : '1px solid transparent',
    borderLeft: active ? '1px solid #30363d' : '1px solid transparent',
    borderRight: active ? '1px solid #30363d' : '1px solid transparent',
    borderBottom: 'none',
    borderRadius: '6px 6px 0 0',
    padding: '6px 12px',
    fontSize: 12,
    cursor: 'pointer',
  };
}

const TEXTAREA_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: 8,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  resize: 'vertical' as const,
};

const DIR_LABEL_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  fontSize: 12,
  color: '#8b949e',
};

const DIR_INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const BUTTONS_STYLE = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 8,
};

const ERROR_STYLE = {
  color: '#f85149',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid #6e2130',
  borderRadius: 6,
  background: '#2b1419',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-word' as const,
};

const CANCEL_BUTTON_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};

const PRIMARY_BUTTON_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
