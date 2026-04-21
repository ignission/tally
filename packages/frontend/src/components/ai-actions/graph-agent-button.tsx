'use client';

import type { AgentName, RequirementNode, UseCaseNode, UserStoryNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export type AnchorNode = UseCaseNode | RequirementNode | UserStoryNode;

interface GraphAgentButtonProps {
  node: AnchorNode;
  agentName: AgentName;
  label: string;
  busyLabel: string;
  tooltip: string;
  onRun: (nodeId: string) => Promise<void>;
}

// codebase を読まず、グラフ文脈 (node + neighbors) だけで動くエージェント用の共通ボタン。
// codebasePath 要件は持たないので disabled は他エージェント実行中 (busy) のみで判定する。
export function GraphAgentButton({
  node,
  agentName,
  label,
  busyLabel,
  tooltip,
  onRun,
}: GraphAgentButtonProps) {
  const running = useCanvasStore((s) => s.runningAgent);
  const busy = running !== null;
  const mine = running?.agent === agentName;
  const disabled = busy;

  const resolvedTooltip = busy ? (mine ? tooltip : '別のエージェントが実行中です') : tooltip;

  const onClick = () => {
    if (disabled) return;
    onRun(node.id).catch(console.error);
  };

  return (
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
