'use client';

import type { ProposalNode } from '@tally/core';

import { NODE_META } from '@tally/core';
import { useEffect, useMemo, useState } from 'react';

import { useCanvasStore } from '@/lib/store';

interface Props {
  open: boolean;
  onClose: () => void;
}

// 全ての proposal を一覧表示し、チェックされたものを一括で採用するダイアログ。
// 既定では全件チェック済み。型別にグループ化して見通しをよくする。
export function BulkAdoptDialog({ open, onClose }: Props) {
  const nodes = useCanvasStore((s) => s.nodes);
  const bulkAdopt = useCanvasStore((s) => s.bulkAdoptProposals);

  const proposals = useMemo<ProposalNode[]>(
    () =>
      Object.values(nodes).filter((n): n is ProposalNode => n.type === 'proposal' && !!n.adoptAs),
    [nodes],
  );

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [running, setRunning] = useState(false);

  // 開くたびに全件チェック初期化。
  useEffect(() => {
    if (!open) return;
    const init: Record<string, boolean> = {};
    for (const p of proposals) init[p.id] = true;
    setChecked(init);
  }, [open, proposals]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // 型別にグループ化 (requirement, usecase, userstory, question, coderef, issue)。
  const grouped = new Map<string, ProposalNode[]>();
  for (const p of proposals) {
    const key = p.adoptAs ?? 'unknown';
    const arr = grouped.get(key) ?? [];
    arr.push(p);
    grouped.set(key, arr);
  }

  const selectedIds = proposals.filter((p) => checked[p.id]).map((p) => p.id);

  const toggleAll = (on: boolean) => {
    const next: Record<string, boolean> = {};
    for (const p of proposals) next[p.id] = on;
    setChecked(next);
  };

  const handleAdopt = async () => {
    if (selectedIds.length === 0 || running) return;
    setRunning(true);
    try {
      const { adopted, failed } = await bulkAdopt(selectedIds);
      if (failed.length > 0) {
        // eslint-disable-next-line no-alert
        alert(`採用完了: ${adopted.length} 件 / 失敗: ${failed.length} 件`);
      }
      onClose();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('bulk adopt failed', err);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={CONTAINER_STYLE}>
      <button type="button" aria-label="閉じる" onClick={onClose} style={BACKDROP_STYLE} />
      <dialog open aria-modal="true" aria-label="提案一括採用" style={DIALOG_STYLE}>
        <div style={{ display: 'flex', alignItems: 'baseline', marginBottom: 12, gap: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>AI 提案の一括採用</div>
          <div style={{ fontSize: 11, color: '#8b949e' }}>
            {proposals.length} 件中 {selectedIds.length} 件選択
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button type="button" onClick={() => toggleAll(true)} style={LINK_STYLE}>
              全選択
            </button>
            <button type="button" onClick={() => toggleAll(false)} style={LINK_STYLE}>
              全解除
            </button>
          </div>
        </div>

        {proposals.length === 0 ? (
          <div style={{ fontSize: 12, color: '#8b949e', padding: 20, textAlign: 'center' }}>
            採用可能な AI 提案はありません。
          </div>
        ) : (
          <div style={LIST_STYLE}>
            {Array.from(grouped.entries()).map(([type, items]) => {
              const meta = NODE_META[type as keyof typeof NODE_META];
              return (
                <div key={type} style={{ marginBottom: 12 }}>
                  <div style={{ ...GROUP_HEADER_STYLE, color: meta?.accent ?? '#c8d1da' }}>
                    <span aria-hidden="true">{meta?.icon}</span>
                    <span>
                      {meta?.label ?? type} として採用 ({items.length})
                    </span>
                  </div>
                  {items.map((p) => (
                    <label key={p.id} style={ROW_STYLE}>
                      <input
                        type="checkbox"
                        checked={!!checked[p.id]}
                        onChange={(e) =>
                          setChecked((prev) => ({ ...prev, [p.id]: e.target.checked }))
                        }
                      />
                      <span style={{ fontSize: 12, color: '#e6edf3' }}>{p.title}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} style={CANCEL_STYLE} disabled={running}>
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleAdopt}
            style={CONFIRM_STYLE}
            disabled={selectedIds.length === 0 || running}
          >
            {running ? '採用中…' : `${selectedIds.length} 件を採用`}
          </button>
        </div>
      </dialog>
    </div>
  );
}

const CONTAINER_STYLE = {
  position: 'fixed' as const,
  inset: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

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
  width: 520,
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column' as const,
  background: '#161b22',
  color: '#e6edf3',
  borderRadius: 10,
  border: '1px solid #30363d',
  padding: 20,
  boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
};

const LIST_STYLE = {
  flex: 1,
  overflowY: 'auto' as const,
  minHeight: 0,
  paddingRight: 4,
};

const GROUP_HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.5,
  marginBottom: 6,
};

const ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 6px',
  borderRadius: 4,
  cursor: 'pointer' as const,
};

const LINK_STYLE = {
  background: 'transparent',
  color: '#8b949e',
  border: 'none',
  fontSize: 11,
  cursor: 'pointer',
  padding: 0,
  textDecoration: 'underline',
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
  background: '#238636',
  color: '#fff',
  border: '1px solid #1a6b2c',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
};
