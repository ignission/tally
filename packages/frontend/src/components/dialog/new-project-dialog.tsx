'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';

import { createProject, fetchDefaultProjectPath } from '@/lib/api';
import type { Codebase } from '@tally/core';
import { FolderBrowserDialog } from './folder-browser-dialog';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function NewProjectDialog({ open, onClose }: Props) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [projectDir, setProjectDir] = useState('');
  const [dirManuallySet, setDirManuallySet] = useState(false);
  const [codebases, setCodebases] = useState<Codebase[]>([]);
  const [pickerFor, setPickerFor] = useState<null | 'root' | 'codebase'>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const duplicateIds = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const c of codebases) {
      if (seen.has(c.id)) dup.add(c.id);
      seen.add(c.id);
    }
    return dup;
  }, [codebases]);

  if (!open) return null;

  const disabled =
    busy || name.trim().length === 0 || projectDir.trim().length === 0 || duplicateIds.size > 0;

  const onNameBlur = async () => {
    if (dirManuallySet) return;
    if (name.trim().length === 0) return;
    try {
      const suggested = await fetchDefaultProjectPath(name.trim());
      setProjectDir(suggested);
    } catch {
      // 提案失敗は無視
    }
  };

  const onPickRoot = (p: string) => {
    setProjectDir(p);
    setDirManuallySet(true);
    setPickerFor(null);
  };

  const onPickCodebase = (p: string) => {
    // 末尾の空セグメント（trailing slash 等）を除いた最後のセグメントを取得する
    const segment = p.split('/').filter(Boolean).pop() ?? '';
    const normalized = segment.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    // CodebaseSchema の正規表現 /^[a-z][a-z0-9-]{0,31}$/ に合わせ先頭非英字を除去する
    const stripped = normalized.replace(/^[^a-z]+/, '');
    const rawSlug = stripped.length > 0 ? stripped : `cb-${normalized.replace(/^[^a-z0-9]+/, '') || 'dir'}`;
    let id = rawSlug.slice(0, 32) || 'cb';
    while (codebases.some((c) => c.id === id)) {
      id = `${id.slice(0, 28)}-${Math.random().toString(36).slice(2, 4)}`;
    }
    setCodebases([...codebases, { id, label: p.split('/').pop() ?? id, path: p }]);
    setPickerFor(null);
  };

  const onSubmit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await createProject({
        projectDir,
        name: name.trim(),
        ...(description.trim().length > 0 ? { description: description.trim() } : {}),
        codebases,
      });
      router.push(`/projects/${encodeURIComponent(res.id)}`);
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <div role="dialog" style={BACKDROP}>
      <div style={DIALOG}>
        <h2 style={TITLE}>新規プロジェクト</h2>

        <label style={LABEL}>
          プロジェクト名
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void onNameBlur()}
            disabled={busy}
            style={INPUT}
          />
        </label>

        <label style={LABEL}>
          説明 (任意)
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            style={INPUT}
          />
        </label>

        <div style={SECTION}>
          <div style={SECTION_HEADER}>
            保存先
            <button type="button" onClick={() => setPickerFor('root')} disabled={busy} style={LINK}>
              別のフォルダにする
            </button>
          </div>
          {projectDir ? (
            <div style={PATH_DISPLAY}>{projectDir}</div>
          ) : (
            <div style={MUTED}>プロジェクト名を入力すると自動で設定されます</div>
          )}
        </div>

        <div style={SECTION}>
          <div style={SECTION_HEADER}>
            コードベース ({codebases.length})
            <button
              type="button"
              onClick={() => setPickerFor('codebase')}
              disabled={busy}
              style={LINK}
            >
              + コードベース追加
            </button>
          </div>
          {codebases.length === 0 && (
            <div style={MUTED}>コードベース未設定（後からも追加できます）</div>
          )}
          <ul style={CB_LIST}>
            {codebases.map((c, i) => (
              <li key={`${c.path}-${i}`} style={CB_ITEM}>
                <input
                  type="text"
                  value={c.id}
                  onChange={(e) => {
                    const next = [...codebases];
                    next[i] = { ...c, id: e.target.value };
                    setCodebases(next);
                  }}
                  disabled={busy}
                  style={{ ...INPUT, width: 140 }}
                  aria-label={`codebase-${i}-id`}
                />
                <input
                  type="text"
                  value={c.label}
                  onChange={(e) => {
                    const next = [...codebases];
                    next[i] = { ...c, label: e.target.value };
                    setCodebases(next);
                  }}
                  disabled={busy}
                  style={{ ...INPUT, flex: 1 }}
                  aria-label={`codebase-${i}-label`}
                />
                <span style={CB_PATH}>{c.path}</span>
                {duplicateIds.has(c.id) && (
                  <span role="alert" style={ERROR_INLINE}>
                    id 重複
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setCodebases(codebases.filter((_, j) => j !== i))}
                  disabled={busy}
                  style={LINK}
                >
                  削除
                </button>
              </li>
            ))}
          </ul>
        </div>

        {error && (
          <div role="alert" style={ERROR}>
            {error}
          </div>
        )}

        <div style={FOOTER}>
          <button type="button" onClick={onClose} disabled={busy} style={CANCEL_BTN}>
            キャンセル
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onSubmit()}
            style={PRIMARY_BTN}
          >
            {busy ? '作成中…' : '作成'}
          </button>
        </div>

        {pickerFor !== null && (
          <FolderBrowserDialog
            open
            purpose={pickerFor === 'codebase' ? 'add-codebase' : 'create-project'}
            onConfirm={pickerFor === 'codebase' ? onPickCodebase : onPickRoot}
            onClose={() => setPickerFor(null)}
          />
        )}
      </div>
    </div>
  );
}

const BACKDROP = {
  position: 'fixed' as const,
  inset: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};
const DIALOG = {
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
const TITLE = { margin: 0, fontSize: 16, color: '#e6edf3' };
const LABEL = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  fontSize: 12,
  color: '#8b949e',
};
const INPUT = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
const SECTION = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  padding: 10,
  border: '1px solid #30363d',
  borderRadius: 6,
};
const SECTION_HEADER = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  fontSize: 12,
  color: '#8b949e',
};
const PATH_DISPLAY = {
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#e6edf3',
};
const MUTED = { fontSize: 12, color: '#8b949e' };
const CB_LIST = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
};
const CB_ITEM = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap' as const,
};
const CB_PATH = {
  flex: 1,
  fontSize: 11,
  color: '#8b949e',
  fontFamily: 'ui-monospace, monospace',
};
const ERROR_INLINE = { color: '#f85149', fontSize: 10 };
const LINK = {
  background: 'transparent',
  border: 'none',
  color: '#58a6ff',
  fontSize: 12,
  cursor: 'pointer',
  textDecoration: 'underline' as const,
  padding: 0,
};
const FOOTER = { display: 'flex', justifyContent: 'flex-end', gap: 8 };
const CANCEL_BTN = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
};
const PRIMARY_BTN = {
  ...CANCEL_BTN,
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
};
const ERROR = {
  color: '#f85149',
  fontSize: 12,
  padding: '6px 8px',
  border: '1px solid #6e2130',
  borderRadius: 6,
  background: '#2b1419',
};
