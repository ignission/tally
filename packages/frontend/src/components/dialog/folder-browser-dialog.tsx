'use client';

import { useCallback, useEffect, useState } from 'react';

import { type FsListResult, listDirectory, mkdir } from '@/lib/api';
import { isImeComposing } from '@/lib/ime';

export type FolderBrowserPurpose = 'create-project' | 'import-project' | 'add-codebase';

export interface FolderBrowserDialogProps {
  open: boolean;
  initialPath?: string;
  purpose: FolderBrowserPurpose;
  onConfirm: (absolutePath: string) => void;
  onClose: () => void;
}

export function FolderBrowserDialog(props: FolderBrowserDialogProps) {
  const [listing, setListing] = useState<FsListResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [newDirName, setNewDirName] = useState('');
  // パス入力は編集中の draft を別持ちし、keystroke 毎に load しない。
  // Enter / blur で確定したときだけ load を走らせ、中間パスの解決失敗で
  // スナップバックするのを防ぐ (codex P2 指摘)。
  const [pathDraft, setPathDraft] = useState('');

  const load = useCallback(async (targetPath?: string) => {
    setError(null);
    try {
      const res = await listDirectory(targetPath);
      setListing(res);
      setPathDraft(res.path);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  }, []);

  useEffect(() => {
    if (props.open) void load(props.initialPath);
  }, [props.open, props.initialPath, load]);

  if (!props.open) return null;

  const confirmDisabled =
    listing === null || (props.purpose === 'import-project' && !listing.containsProjectYaml);

  const visibleEntries = (listing?.entries ?? []).filter((e) => showHidden || !e.isHidden);

  const onConfirmClick = () => {
    if (!listing) return;
    props.onConfirm(listing.path);
  };

  const onCreateDir = async () => {
    if (!listing || newDirName.trim().length === 0) return;
    try {
      const res = await mkdir(listing.path, newDirName.trim());
      setNewDirName('');
      await load(res.path);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <div role="dialog" style={BACKDROP_STYLE}>
      <div style={DIALOG_STYLE}>
        <h2 style={TITLE_STYLE}>{titleFor(props.purpose)}</h2>
        <div style={TOOLBAR_STYLE}>
          <input
            type="text"
            value={pathDraft}
            onChange={(e) => setPathDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeComposing(e)) {
                e.preventDefault();
                void load(pathDraft);
              } else if (e.key === 'Escape') {
                // 編集を破棄して現在の listing.path に戻す。
                setPathDraft(listing?.path ?? '');
              }
            }}
            onBlur={() => {
              // フォーカスが外れたらその時点の draft で確定。draft が現在位置と同じなら no-op。
              if (pathDraft && pathDraft !== listing?.path) void load(pathDraft);
            }}
            aria-label="現在のパス"
            style={PATH_INPUT_STYLE}
          />
          <button
            type="button"
            disabled={listing?.parent === null || listing === null}
            onClick={() => listing?.parent && void load(listing.parent)}
            style={BUTTON_STYLE}
          >
            ↑ 親
          </button>
        </div>
        {error && (
          <div role="alert" style={ERROR_STYLE}>
            {error}
          </div>
        )}
        <ul style={LIST_STYLE}>
          {visibleEntries.length === 0 ? (
            <li style={EMPTY_STATE_STYLE}>
              {listing === null
                ? '読み込み中…'
                : (listing.entries.length ?? 0) > 0
                  ? '隠しフォルダのみ（上の「隠しフォルダを表示」で表示）'
                  : 'このフォルダにサブフォルダはありません（「↑ 親」で戻る）'}
            </li>
          ) : (
            visibleEntries.map((e) => (
              <li key={e.path} style={LIST_ITEM_STYLE}>
                <button type="button" onClick={() => void load(e.path)} style={ENTRY_BUTTON_STYLE}>
                  <span aria-hidden="true">📁</span>
                  {e.name}
                  {e.hasProjectYaml && <span style={BADGE_STYLE}>project.yaml あり</span>}
                </button>
              </li>
            ))
          )}
        </ul>
        <label style={LABEL_STYLE}>
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
            aria-label="隠しフォルダを表示"
          />
          隠しフォルダを表示
        </label>
        <div style={MKDIR_ROW_STYLE}>
          <input
            type="text"
            placeholder="新規フォルダ名"
            value={newDirName}
            onChange={(e) => setNewDirName(e.target.value)}
            aria-label="新規フォルダ名"
            style={MKDIR_INPUT_STYLE}
          />
          <button type="button" onClick={() => void onCreateDir()} style={BUTTON_STYLE}>
            + 新規フォルダ
          </button>
        </div>
        {props.purpose === 'import-project' && listing && !listing.containsProjectYaml && (
          <div style={HINT_STYLE}>
            このフォルダは Tally プロジェクトではありません（project.yaml が無い）。project.yaml
            を含むフォルダを選んでください。
          </div>
        )}
        <div style={FOOTER_STYLE}>
          <button type="button" onClick={props.onClose} style={CANCEL_BUTTON_STYLE}>
            キャンセル
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirmClick}
            style={confirmDisabled ? PRIMARY_BUTTON_DISABLED_STYLE : PRIMARY_BUTTON_STYLE}
          >
            選択
          </button>
        </div>
      </div>
    </div>
  );
}

function titleFor(purpose: FolderBrowserPurpose): string {
  switch (purpose) {
    case 'create-project':
      return 'プロジェクトルートを選択';
    case 'import-project':
      return '既存プロジェクトを選択';
    case 'add-codebase':
      return 'コードベースのリポジトリを選択';
  }
}

// スタイル定義（暗色テーマ・インライン style オブジェクト）
const BACKDROP_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1001,
};

const DIALOG_STYLE = {
  background: '#161b22',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: 20,
  width: 720,
  maxWidth: '92vw',
  maxHeight: '85vh',
  overflow: 'auto' as const,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 12,
};

const TITLE_STYLE = { margin: 0, fontSize: 16, color: '#e6edf3' };

const TOOLBAR_STYLE = { display: 'flex', gap: 8 };

const PATH_INPUT_STYLE = {
  flex: 1,
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const LIST_STYLE = {
  listStyle: 'none',
  margin: 0,
  padding: 4,
  border: '1px solid #30363d',
  borderRadius: 6,
  background: '#0d1117',
  maxHeight: 320,
  overflow: 'auto' as const,
};

const LIST_ITEM_STYLE = { margin: 0 };

const EMPTY_STATE_STYLE = {
  padding: '12px 8px',
  fontSize: 12,
  color: '#8b949e',
  textAlign: 'center' as const,
};

const ENTRY_BUTTON_STYLE = {
  background: 'transparent',
  border: '1px solid transparent',
  color: '#e6edf3',
  padding: '6px 8px',
  borderRadius: 4,
  width: '100%',
  textAlign: 'left' as const,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const BADGE_STYLE = {
  fontSize: 10,
  color: '#8b949e',
  border: '1px solid #30363d',
  borderRadius: 4,
  padding: '1px 6px',
};

const LABEL_STYLE = {
  fontSize: 12,
  color: '#8b949e',
  display: 'flex',
  gap: 6,
  alignItems: 'center',
};

const MKDIR_ROW_STYLE = { display: 'flex', gap: 8 };
const MKDIR_INPUT_STYLE = { ...PATH_INPUT_STYLE, flex: 1 };

const FOOTER_STYLE = { display: 'flex', justifyContent: 'flex-end', gap: 8 };

const BUTTON_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
const CANCEL_BUTTON_STYLE = BUTTON_STYLE;
const PRIMARY_BUTTON_STYLE = {
  ...BUTTON_STYLE,
  background: '#238636',
  border: '1px solid #2ea043',
  color: '#fff',
};
const PRIMARY_BUTTON_DISABLED_STYLE = {
  ...PRIMARY_BUTTON_STYLE,
  opacity: 0.45,
  cursor: 'not-allowed',
};

const HINT_STYLE = {
  fontSize: 11,
  color: '#8b949e',
  padding: '4px 2px',
};

const ERROR_STYLE = {
  color: '#f85149',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid #6e2130',
  borderRadius: 6,
  background: '#2b1419',
};
