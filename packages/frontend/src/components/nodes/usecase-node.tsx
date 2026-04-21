import { NODE_META } from '@tally/core';
import type { UseCaseNode } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeCard } from './node-card';

export function UseCaseNodeView({ data }: NodeProps) {
  const node = (data as { node: UseCaseNode }).node;
  return <NodeCard meta={NODE_META.usecase} title={node.title} body={node.body} />;
}
