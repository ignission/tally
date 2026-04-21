'use client';

import type { AgentName, RequirementNode, UseCaseNode, UserStoryNode } from '@tally/core';

import { useCanvasStore } from '@/lib/store';

export type AnchorNode = UseCaseNode | RequirementNode | UserStoryNode;

interface CodebaseAgentButtonProps {
  node: AnchorNode;
  agentName: AgentName;
  label: string;
  busyLabel: string;
  tooltip: string;
  onRun: (nodeId: string) => Promise<void>;
}

// codebase を読むエージェント用の共通ボタン。
// codebasePath 未設定 or 他エージェント実行中は disabled + tooltip でヒント表示。
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
  const codebasePath = useCanvasStore((s) => s.projectMeta?.codebasePath);
  const running = useCanvasStore((s) => s.runningAgent);

  const hasCodebase = typeof codebasePath === 'string' && codebasePath.trim().length > 0;
  const busy = running !== null;
  const mine = running?.agent === agentName;
  const disabled = busy || !hasCodebase;

  const resolvedTooltip = !hasCodebase
    ? 'codebasePath 未設定: ヘッダの設定から指定してください'
    : busy
      ? mine
        ? tooltip
        : '別のエージェントが実行中です'
      : tooltip;

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
