import type { IssueNode } from '@tally/core';
import { NODE_META } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeCard } from './node-card';
import { useNodeAccordion } from './use-accordion';

export function IssueNodeView({ id, data }: NodeProps) {
  const node = (data as { node: IssueNode }).node;
  const { collapsed, toggle } = useNodeAccordion(id);
  return (
    <NodeCard
      meta={NODE_META.issue}
      title={node.title}
      body={node.body}
      collapsed={collapsed}
      onToggleCollapse={toggle}
    />
  );
}
