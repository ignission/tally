'use client';

import { useState } from 'react';

import { useCanvasStore } from '@/lib/store';

// チャット入力欄。Enter で送信、Shift+Enter で改行。
// 送信中 (streaming) は textarea disabled。
export function ChatInput() {
  const [text, setText] = useState('');
  const sendChatMessage = useCanvasStore((s) => s.sendChatMessage);
  const streaming = useCanvasStore((s) => s.chatThreadStreaming);

  const onSend = () => {
    const t = text.trim();
    if (t.length === 0 || streaming) return;
    setText('');
    sendChatMessage(t).catch(console.error);
  };

  return (
    <div style={WRAP_STYLE}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        placeholder={
          streaming ? '応答生成中…' : 'メッセージを入力 (Enter 送信 / Shift+Enter 改行)'
        }
        disabled={streaming}
        rows={3}
        style={TEXTAREA_STYLE}
      />
      <button
        type="button"
        onClick={onSend}
        disabled={streaming || text.trim().length === 0}
        style={SEND_BUTTON_STYLE}
      >
        送信
      </button>
    </div>
  );
}

const WRAP_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
  padding: 4,
};
const TEXTAREA_STYLE = {
  background: '#0d1117',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: 6,
  fontSize: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  resize: 'vertical' as const,
};
const SEND_BUTTON_STYLE = {
  background: '#1f6feb',
  color: '#fff',
  border: '1px solid #388bfd',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
  alignSelf: 'flex-end' as const,
};
