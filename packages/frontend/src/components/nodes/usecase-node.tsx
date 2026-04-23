import type { UseCaseNode } from '@tally/core';
import { NODE_META } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeCard } from './node-card';
import { useNodeAccordion } from './use-accordion';

export function UseCaseNodeView({ id, data }: NodeProps) {
  const node = (data as { node: UseCaseNode }).node;
  const { collapsed, toggle } = useNodeAccordion(id);
  return (
    <NodeCard
      meta={NODE_META.usecase}
      title={node.title}
      body={node.body}
      collapsed={collapsed}
      onToggleCollapse={toggle}
    />
  );
}
