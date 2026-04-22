'use client';

import { useEffect, useRef } from 'react';

import { useCanvasStore } from '@/lib/store';

import { ChatMessage } from './chat-message';

// メッセージ一覧。新メッセージが来たら末尾に自動スクロール。
export function ChatMessages() {
  const messages = useCanvasStore((s) => s.chatThreadMessages);
  const streaming = useCanvasStore((s) => s.chatThreadStreaming);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  return (
    <div ref={scrollRef} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 4 }}>
      {messages.length === 0 && !streaming && (
        <div style={{ color: '#8b949e', fontSize: 12, padding: 8 }}>
          メッセージを送信してください。
        </div>
      )}
      {messages.map((m) => (
        <ChatMessage key={m.id} message={m} />
      ))}
      {streaming && <div style={{ color: '#8b949e', fontSize: 11, paddingLeft: 8 }}>…</div>}
    </div>
  );
}
