'use client';

import type { AgentName, RequirementNode, UseCaseNode, UserStoryNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

import { CodebasePickerSelect } from './codebase-picker-select';
import { useCodebaseSelector } from './use-codebase-selector';

export type AnchorNode = UseCaseNode | RequirementNode | UserStoryNode;

interface CodebaseAgentButtonProps {
  node: AnchorNode;
  agentName: AgentName;
  label: string;
  busyLabel: string;
  tooltip: string;
  // codebaseId を受け取る形に変更。選択された codebase を ai-engine に渡す。
  onRun: (nodeId: string, codebaseId: string) => Promise<void>;
}

// codebase を読むエージェント用の共通ボタン。
// codebases が 0 件: disabled + tooltip でヒント表示。
// codebases が 1 件: 自動選択。
// codebases が 2 件以上: select で選択できる。
// busyLabel はこのボタン自身のエージェントが実行中のときだけ表示する
// (他エージェント実行中に誤って自分の "実行中..." 表示が出ないように agentName で判定)。
export function CodebaseAgentButton({
  node,
  agentName,
  label,
  busyLabel,
  tooltip,
  onRun,
}: CodebaseAgentButtonProps) {
  const running = useCanvasStore((s) => s.runningAgent);
  const { codebases, selected, pick, disabled: cbDisabled, tooltip: cbTooltip } = useCodebaseSelector();

  const busy = running !== null;
  const mine = running?.agent === agentName;
  const disabled = busy || cbDisabled;

  const resolvedTooltip = cbDisabled
    ? cbTooltip
    : busy
      ? mine
        ? tooltip
        : '別のエージェントが実行中です'
      : tooltip;

  const onClick = () => {
    if (disabled || !selected) return;
    onRun(node.id, selected.id).catch(console.error);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <CodebasePickerSelect
        codebases={codebases}
        value={selected?.id ?? ''}
        onChange={pick}
        disabled={busy}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        title={resolvedTooltip}
        style={{
          ...BUTTON_STYLE,
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {mine ? busyLabel : label}
      </button>
    </div>
  );
}

const BUTTON_STYLE = {
  background: '#8957e5',
  color: '#fff',
  border: '1px solid #a371f7',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: 12,
  width: '100%',
} as const;
