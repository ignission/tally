'use client';

import type { ChatBlock, ChatMessage as ChatMessageType } from '@tally/core';

import { ToolApprovalCard } from './tool-approval-card';

interface Props {
  message: ChatMessageType;
}

// 1 メッセージを role ごとに分岐 render。assistant は block ごとに分解。
export function ChatMessage({ message }: Props) {
  if (message.role === 'user') {
    const text = message.blocks
      .filter((b): b is Extract<ChatBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return (
      <div style={USER_WRAP_STYLE}>
        <div style={USER_BUBBLE_STYLE}>{text}</div>
      </div>
    );
  }
  return <div style={ASSISTANT_WRAP_STYLE}>{message.blocks.map((b, i) => renderBlock(b, i))}</div>;
}

function renderBlock(block: ChatBlock, idx: number) {
  if (block.type === 'text') {
    return (
      <div key={idx} style={TEXT_STYLE}>
        {block.text}
      </div>
    );
  }
  if (block.type === 'tool_use') {
    if (block.approval === 'pending') {
      return <ToolApprovalCard key={idx} block={block} />;
    }
    return (
      <div key={idx} style={TOOL_STATUS_STYLE}>
        🔧 {block.name} —{' '}
        {block.approval === 'approved'
          ? '承認済'
          : block.approval === 'rejected'
            ? '却下'
            : block.approval}
      </div>
    );
  }
  if (block.type === 'tool_result') {
    return (
      <div key={idx} style={{ ...TOOL_STATUS_STYLE, color: block.ok ? '#8b949e' : '#f85149' }}>
        {block.ok ? '✓' : '✗'}{' '}
        {block.output.length > 120 ? `${block.output.slice(0, 120)}…` : block.output}
      </div>
    );
  }
  return null;
}

const USER_WRAP_STYLE = {
  display: 'flex',
  justifyContent: 'flex-end',
};
const USER_BUBBLE_STYLE = {
  background: '#1f6feb22',
  border: '1px solid #388bfd55',
  borderRadius: 8,
  padding: '6px 10px',
  fontSize: 12,
  maxWidth: '85%',
  whiteSpace: 'pre-wrap' as const,
  color: '#e6edf3',
};
const ASSISTANT_WRAP_STYLE = {
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 4,
  alignItems: 'flex-start',
};
const TEXT_STYLE = {
  fontSize: 12,
  color: '#e6edf3',
  whiteSpace: 'pre-wrap' as const,
  padding: '2px 4px',
};
const TOOL_STATUS_STYLE = {
  fontSize: 11,
  color: '#8b949e',
  padding: '2px 6px',
  borderRadius: 4,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
};
