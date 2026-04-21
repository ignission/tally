'use client';

import { useState } from 'react';

import { useCanvasStore } from '@/lib/store';

// スレッド一覧 (dropdown) + 新規ボタン + 現スレッド削除ボタン。
// 選択で openChatThread、新規で createChatThread + 自動 open、× で deleteChatThread。
export function ChatThreadList() {
  const threads = useCanvasStore((s) => s.chatThreadList);
  const activeId = useCanvasStore((s) => s.activeChatThreadId);
  const createChatThread = useCanvasStore((s) => s.createChatThread);
  const openChatThread = useCanvasStore((s) => s.openChatThread);
  const deleteChatThread = useCanvasStore((s) => s.deleteChatThread);
  const [busy, setBusy] = useState(false);

  const onNew = async () => {
    setBusy(true);
    try {
      const id = await createChatThread();
      await openChatThread(id);
    } finally {
      setBusy(false);
    }
  };

  const onSelect = async (id: string) => {
    if (id === activeId) return;
    await openChatThread(id);
  };

  const onDelete = async () => {
    if (!activeId) return;
    const thread = threads.find((t) => t.id === activeId);
    const label = thread?.title ?? activeId;
    // 単純な window.confirm で十分 (頻繁な操作ではないため専用ダイアログ不要)
    if (!window.confirm(`スレッド「${label}」を削除しますか？`)) return;
    setBusy(true);
    try {
      await deleteChatThread(activeId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={ROW_STYLE}>
      <select
        aria-label="スレッド選択"
        value={activeId ?? ''}
        onChange={(e) => {
          const v = e.target.value;
          if (v) onSelect(v).catch(console.error);
        }}
        disabled={busy}
        style={SELECT_STYLE}
      >
        <option value="" disabled>
          {threads.length === 0 ? 'スレッド無し' : 'スレッドを選ぶ'}
        </option>
        {threads.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => {
          onNew().catch(console.error);
        }}
        disabled={busy}
        style={BUTTON_STYLE}
      >
        + 新規
      </button>
      <button
        type="button"
        onClick={() => {
          onDelete().catch(console.error);
        }}
        disabled={busy || !activeId}
        title={activeId ? '現在のスレッドを削除' : 'スレッド未選択'}
        style={DELETE_BUTTON_STYLE}
        aria-label="現在のスレッドを削除"
      >
        ×
      </button>
    </div>
  );
}

const ROW_STYLE = { display: 'flex', gap: 6 };
const SELECT_STYLE = {
  flex: 1,
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '4px 8px',
  fontSize: 12,
};
const BUTTON_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
};
const DELETE_BUTTON_STYLE = {
  background: '#2f1720',
  color: '#f85149',
  border: '1px solid #5c1e28',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 14,
  cursor: 'pointer',
  lineHeight: 1,
};
