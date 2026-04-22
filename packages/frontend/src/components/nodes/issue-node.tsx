import type { IssueNode } from '@tally/core';
import { NODE_META } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeCard } from './node-card';

export function IssueNodeView({ data }: NodeProps) {
  const node = (data as { node: IssueNode }).node;
  return <NodeCard meta={NODE_META.issue} title={node.title} body={node.body} />;
}
