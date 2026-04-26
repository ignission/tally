'use client';

import { useEffect } from 'react';

import { useCanvasStore } from '@/lib/store';

import { ChatContextBar } from './chat-context-bar';
import { ChatInput } from './chat-input';
import { ChatMessages } from './chat-messages';
import { ChatThreadList } from './chat-thread-list';

// 右サイドバー Chat タブの外枠。
// マウント時にスレッド一覧を取得し、activeChatThreadId があれば messages もロード済み前提。
// スレッド未選択時は ChatThreadList のみ表示 (新規作成 / 既存選択を促す)。
export function ChatTab() {
  const loadChatThreads = useCanvasStore((s) => s.loadChatThreads);
  const activeId = useCanvasStore((s) => s.activeChatThreadId);
  const closeChatThread = useCanvasStore((s) => s.closeChatThread);

  useEffect(() => {
    loadChatThreads().catch(console.error);
    return () => {
      closeChatThread();
    };
  }, [loadChatThreads, closeChatThread]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: 8,
      }}
    >
      <ChatThreadList />
      {activeId ? (
        <>
          <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
            <ChatMessages />
          </div>
          <ChatContextBar />
          <ChatInput />
        </>
      ) : (
        <div style={{ padding: 16, color: '#8b949e', fontSize: 13 }}>
          スレッドを選択または新規作成してください。
        </div>
      )}
    </div>
  );
}
