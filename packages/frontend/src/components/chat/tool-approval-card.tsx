'use client';

import type { ChatBlock } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

type PendingToolBlock = Extract<ChatBlock, { type: 'tool_use' }>;

// pending tool_use のカード UI。承認 / 却下ボタン。
export function ToolApprovalCard({ block }: { block: PendingToolBlock }) {
  const approveChatTool = useCanvasStore((s) => s.approveChatTool);
  const shortName = block.name.replace(/^mcp__tally__/, '');
  const inputPreview = previewInput(block.input);

  return (
    <div style={CARD_STYLE}>
      <div style={HEADER_STYLE}>
        🔧 <span style={TOOL_NAME_STYLE}>{shortName}</span>
        <span style={BADGE_STYLE}>承認待ち</span>
      </div>
      <pre style={INPUT_STYLE}>{inputPreview}</pre>
      <div style={BUTTONS_STYLE}>
        <button
          type="button"
          onClick={() => approveChatTool(block.toolUseId, false)}
          style={REJECT_BUTTON_STYLE}
        >
          却下
        </button>
        <button
          type="button"
          onClick={() => approveChatTool(block.toolUseId, true)}
          style={APPROVE_BUTTON_STYLE}
        >
          承認
        </button>
      </div>
    </div>
  );
}

function previewInput(input: unknown): string {
  try {
    const str = JSON.stringify(input, null, 2);
    if (str.length > 400) return `${str.slice(0, 400)}…`;
    return str;
  } catch {
    return String(input);
  }
}

const CARD_STYLE = {
  background: '#161b22',
  border: '1px solid #a371f7',
  borderRadius: 6,
  padding: 8,
  display: 'flex',
  flexDirection: 'column' as const,
  gap: 6,
  width: '100%',
};
const HEADER_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: '#e6edf3',
};
const TOOL_NAME_STYLE = {
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  flex: 1,
};
const BADGE_STYLE = {
  fontSize: 10,
  background: '#a371f733',
  color: '#d2a8ff',
  padding: '1px 6px',
  borderRadius: 4,
};
const INPUT_STYLE = {
  background: '#0d1117',
  border: '1px solid #30363d',
  borderRadius: 4,
  padding: 6,
  fontSize: 11,
  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
  color: '#c8d1da',
  overflow: 'auto' as const,
  maxHeight: 160,
  whiteSpace: 'pre-wrap' as const,
  margin: 0,
};
const BUTTONS_STYLE = {
  display: 'flex',
  justifyContent: 'flex-end',
  gap: 6,
};
const REJECT_BUTTON_STYLE = {
  background: '#21262d',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 11,
  cursor: 'pointer',
};
const APPROVE_BUTTON_STYLE = {
  background: '#238636',
  color: '#fff',
  border: '1px solid #2ea043',
  borderRadius: 6,
  padding: '4px 10px',
  fontSize: 11,
  cursor: 'pointer',
};
