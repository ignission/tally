'use client';

import type { Codebase } from '@tally/core';
import { useEffect, useMemo, useState } from 'react';

import { TextInput } from '@/components/ui/text-input';
import { useCanvasStore } from '@/lib/store';
import { FolderBrowserDialog } from './folder-browser-dialog';

export function ProjectSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const projectMeta = useCanvasStore((s) => s.projectMeta);
  const patchProjectMeta = useCanvasStore((s) => s.patchProjectMeta);

  const [codebases, setCodebases] = useState<Codebase[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && projectMeta) setCodebases(projectMeta.codebases);
  }, [open, projectMeta]);

  const duplicateIds = useMemo(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const c of codebases) {
      if (seen.has(c.id)) dup.add(c.id);
      seen.add(c.id);
    }
    return dup;
  }, [codebases]);

  const invalidIds = useMemo(
    () => new Set(codebases.filter((c) => !/^[a-z][a-z0-9-]{0,31}$/u.test(c.id)).map((c) => c.id)),
    [codebases],
  );

  if (!open) return null;

  const saveDisabled = busy || duplicateIds.size > 0 || invalidIds.size > 0;

  const onPickCodebase = (p: string) => {
    const baseSlug =
      p
        .split('/')
        .pop()
        ?.toLowerCase()
        .replace(/[^a-z0-9-]/g, '-') ?? 'cb';
    let id = baseSlug.slice(0, 32) || 'cb';
    while (codebases.some((c) => c.id === id)) {
      id = `${id.slice(0, 28)}-${Math.random().toString(36).slice(2, 4)}`;
    }
    setCodebases([...codebases, { id, label: p.split('/').pop() ?? id, path: p }]);
    setPickerOpen(false);
  };

  const onSave = async () => {
    setBusy(true);
    setError(null);
    try {
      await patchProjectMeta({ codebases });
      onClose();
    } catch (e) {
      setError(String((e as Error).message ?? e));
      setBusy(false);
    }
  };

  return (
    <div role="dialog" style={BACKDROP}>
      <div style={DIALOG}>
        <h2 style={TITLE}>プロジェクト設定</h2>

        <div style={SECTION}>
          <div style={SECTION_HEADER}>
            コードベース ({codebases.length})
            <button type="button" onClick={() => setPickerOpen(true)} disabled={busy} style={LINK}>
              + コードベースを追加
            </button>
          </div>
          {codebases.length === 0 && <div style={MUTED}>コードベース未設定</div>}
          <ul style={CB_LIST}>
            {codebases.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: path が空の初期行でも一意にするため index を組み合わせる
              <li key={`${c.path}-${i}`} style={CB_ITEM}>
                <TextInput
                  type="text"
                  value={c.id}
                  onChange={(e) => {
                    const next = [...codebases];
                    next[i] = { ...c, id: e.target.value };
                    setCodebases(next);
                  }}
                  disabled={busy}
                  aria-label={`codebase-${i}-id`}
                  style={{ ...INPUT, width: 140 }}
                />
                <TextInput
                  type="text"
                  value={c.label}
                  onChange={(e) => {
                    const next = [...codebases];
                    next[i] = { ...c, label: e.target.value };
                    setCodebases(next);
                  }}
                  disabled={busy}
                  aria-label={`codebase-${i}-label`}
                  style={{ ...INPUT, flex: 1 }}
                />
                <span style={CB_PATH}>{c.path}</span>
                {duplicateIds.has(c.id) && (
                  <span role="alert" style={ERROR_INLINE}>
                    id 重複
                  </span>
                )}
                {invalidIds.has(c.id) && (
                  <span role="alert" style={ERROR_INLINE}>
                    id 形式不正
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
            disabled={saveDisabled}
            onClick={() => void onSave()}
            style={PRIMARY_BTN}
          >
            {busy ? '保存中…' : '保存'}
          </button>
        </div>

        {pickerOpen && (
          <FolderBrowserDialog
            open
            purpose="add-codebase"
            onConfirm={onPickCodebase}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// スタイル定数（NewProjectDialog と同じパレット）
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
const INPUT = {
  background: '#0d1117',
  border: '1px solid #30363d',
  color: '#e6edf3',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
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
