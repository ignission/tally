'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  type WorkspaceCandidate,
  createProject,
  fetchWorkspaceCandidates,
} from '@/lib/api';

interface NewProjectDialogProps {
  open: boolean;
  onClose: () => void;
}

// トップページの「+ 新規プロジェクト」ダイアログ。
// 候補リスト (ghq list -p + TALLY_WORKSPACE 配下) から未初期化ディレクトリを選ぶ方式。
// 候補外パスを使いたい場合は「直接入力」モードにフォールバック可能。
export function NewProjectDialog({ open, onClose }: NewProjectDialogProps) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<WorkspaceCandidate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [customMode, setCustomMode] = useState(false);
  const [customPath, setCustomPath] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCandidates(null);
    setLoadError(null);
    fetchWorkspaceCandidates()
      .then((list) => setCandidates(list))
      .catch((err) => setLoadError(String((err as Error).message ?? err)));
  }, [open]);

  const filtered = useMemo(() => {
    if (!candidates) return [];
    const q = filter.trim().toLowerCase();
    if (q === '') return candidates;
    return candidates.filter((c) => c.path.toLowerCase().includes(q));
  }, [candidates, filter]);

  const workspaceRoot = customMode ? customPath.trim() : selected ?? '';
  const disabled =
    busy || workspaceRoot.length === 0 || name.trim().length === 0;

  if (!open) return null;

  const onCreate = async () => {
    setSubmitError(null);
    setBusy(true);
    try {
      const result = await createProject({
        workspaceRoot,
        name: name.trim(),
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      });
      router.push(`/projects/${encodeURIComponent(result.id)}`);
    } catch (err) {
      setSubmitError(String((err as Error).message ?? err));
      setBusy(false);
    }
  };

  const initializedCount = candidates?.filter((c) => c.hasTally).length ?? 0;

  return (
    <div style={BACKDROP_STYLE}>
      <div style={DIALOG_STYLE}>
        <h2 style={TITLE_STYLE}>新規プロジェクト</h2>
        <p style={DESC_STYLE}>
          ディレクトリを選択してください (ghq 管理下 + TALLY_WORKSPACE 配下)。
          Tally 化済みのものはグレーアウト表示。
        </p>

        {!customMode && (
          <>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="パスで絞り込み"
              disabled={busy}
              style={INPUT_STYLE}
            />
            <div style={LIST_STYLE}>
              {candidates === null && !loadError && (
                <div style={MUTED_STYLE}>候補を読み込み中…</div>
              )}
              {loadError && <div style={ERROR_STYLE}>候補取得失敗: {loadError}</div>}
              {candidates !== null && filtered.length === 0 && (
                <div style={MUTED_STYLE}>該当なし</div>
              )}
              {filtered.map((c) => {
                const active = selected === c.path;
                return (
                  <button
                    key={c.path}
                    type="button"
                    onClick={() => {
                      if (c.hasTally || busy) return;
                      setSelected(c.path);
                    }}
                    disabled={c.hasTally || busy}
                    style={{
                      ...CANDIDATE_STYLE,
                      background: active ? '#1f6feb22' : 'transparent',
                      borderColor: active ? '#388bfd' : '#30363d',
                      opacity: c.hasTally ? 0.5 : 1,
                      cursor: c.hasTally ? 'not-allowed' : 'pointer',
                    }}
                  >
                    <span style={CANDIDATE_PATH_STYLE}>{c.path}</span>
                    {c.hasTally && <span style={BADGE_STYLE}>Tally 化済</span>}
                  </button>
                );
              })}
            </div>
            {candidates !== null && (
              <div style={MUTED_STYLE}>
                {filtered.length} 件表示 ({initializedCount} 件は初期化済みで選択不可)
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                setCustomMode(true);
                setSelected(null);
              }}
              style={LINK_BUTTON_STYLE}
            >
              候補にないパスを直接入力
            </button>
          </>
        )}

        {customMode && (
          <label style={LABEL_STYLE}>
            workspaceRoot (絶対パス)
            <input
              type="text"
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="/home/you/dev/github.com/you/your-repo"
              disabled={busy}
              style={INPUT_STYLE}
            />
            <button
              type="button"
              onClick={() => {
                setCustomMode(false);
                setCustomPath('');
              }}
              style={LINK_BUTTON_STYLE}
            >
              ← 候補から選ぶに戻る
            </button>
          </label>
        )}

        <label style={LABEL_STYLE}>
          プロジェクト名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="MyProject"
            disabled={busy}
            style={INPUT_STYLE}
          />
        </label>
        <label style={LABEL_STYLE}>
          説明 (任意)
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="短い説明 (省略可)"
            disabled={busy}
            style={INPUT_STYLE}
          />
        </label>

        {submitError && <div style={ERROR_STYLE}>エラー: {submitError}</div>}

        <div style={BUTTONS_STYLE}>
          <button type="button" onClick={onClose} disabled={busy} style={CANCEL_BUTTON_STYLE}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => {
              onCreate().catch((e) => {
                setSubmitError(String(e));
                setBusy(false);
              });
            }}
            disabled={disabled}
            style={PRIMARY_BUTTON_STYLE}
          >
            {busy ? '作成中…' : '作成して開く'}
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
  width: 680,
  maxWidth: '92vw',
  maxHeight: '85vh',
  overflow: 'auto' as const,
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

const LABEL_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  fontSize: 12,
  color: '#8b949e',
};

const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};

const LIST_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  maxHeight: 300,
  overflow: 'auto' as const,
  padding: 4,
  border: '1px solid #30363d',
  borderRadius: 6,
  background: '#0d1117',
};

const CANDIDATE_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 8px',
  border: '1px solid #30363d',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  fontSize: 12,
  color: '#e6edf3',
  textAlign: 'left' as const,
};

const CANDIDATE_PATH_STYLE = {
  flex: 1,
  overflow: 'hidden' as const,
  textOverflow: 'ellipsis' as const,
  whiteSpace: 'nowrap' as const,
};

const BADGE_STYLE = {
  fontSize: 10,
  color: '#8b949e',
  border: '1px solid #30363d',
  borderRadius: 4,
  padding: '1px 6px',
  flexShrink: 0,
};

const MUTED_STYLE = {
  fontSize: 12,
  color: '#8b949e',
  padding: '4px 2px',
};

const LINK_BUTTON_STYLE = {
  background: 'transparent',
  color: '#58a6ff',
  border: 'none',
  padding: 0,
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline' as const,
  textAlign: 'left' as const,
  alignSelf: 'flex-start' as const,
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
