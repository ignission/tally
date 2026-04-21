import { NODE_META } from '@tally/core';
import type { ProposalNode } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeBadge, NodeCard } from './node-card';

// 提案ノードは破線を保ったまま、adoptAs ヒントの対象型色で縁取りする。
// これにより「AI提案」という信頼性レイヤー (破線) を維持しつつ、
// 人間が「何の型として提案されているか」を色・アイコンで一目で判別できる。
export function ProposalNodeView({ data }: NodeProps) {
  const node = (data as { node: ProposalNode }).node;
  const targetMeta = node.adoptAs ? NODE_META[node.adoptAs] : null;
  // AI提案とわかるプレフィックス「✦ 提案」＋「→ 要求」などのバッジ。
  const headerLabel = targetMeta ? `✦ 提案 → ${targetMeta.label}` : NODE_META.proposal.label;

  const badge = node.adoptAs ? (
    <NodeBadge bgColor={NODE_META.proposal.color}>AI</NodeBadge>
  ) : null;

  const commonProps = {
    meta: NODE_META.proposal,
    title: node.title,
    body: node.body,
    dashed: true as const,
    badge,
  };
  if (!targetMeta) return <NodeCard {...commonProps} />;
  return (
    <NodeCard
      {...commonProps}
      accentOverride={{
        color: targetMeta.color,
        accent: targetMeta.accent,
        label: headerLabel,
        icon: targetMeta.icon,
      }}
    />
  );
}
