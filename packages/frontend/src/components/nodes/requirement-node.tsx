import type { RequirementNode } from '@tally/core';
import { NODE_META } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeBadge, NodeCard } from './node-card';
import { useNodeAccordion } from './use-accordion';

const PRIORITY_LABEL: Record<NonNullable<RequirementNode['priority']>, string> = {
  must: 'MUST',
  should: 'SHOULD',
  could: 'COULD',
  wont: 'WONT',
};

export function RequirementNodeView({ id, data }: NodeProps) {
  const node = (data as { node: RequirementNode }).node;
  const { collapsed, toggle } = useNodeAccordion(id);
  const badge = node.priority ? (
    <NodeBadge tone="info">{PRIORITY_LABEL[node.priority]}</NodeBadge>
  ) : null;
  return (
    <NodeCard
      meta={NODE_META.requirement}
      title={node.title}
      body={node.body}
      badge={badge}
      collapsed={collapsed}
      onToggleCollapse={toggle}
    />
  );
}
