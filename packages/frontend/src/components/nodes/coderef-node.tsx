import type { CodeRefNode } from '@tally/core';
import { NODE_META } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeBadge, NodeCard } from './node-card';
import { useNodeAccordion } from './use-accordion';

export function CodeRefNodeView({ id, data }: NodeProps) {
  const node = (data as { node: CodeRefNode }).node;
  const { collapsed, toggle } = useNodeAccordion(id);
  const range =
    node.startLine != null
      ? `${node.startLine}${
          node.endLine && node.endLine !== node.startLine ? `-${node.endLine}` : ''
        }`
      : null;
  const badge = node.filePath ? <NodeBadge>{range ? `L${range}` : 'file'}</NodeBadge> : null;

  const footer = node.filePath && (
    <code
      style={{
        fontSize: 11,
        color: '#8b949e',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      {node.filePath}
    </code>
  );

  return (
    <NodeCard
      meta={NODE_META.coderef}
      title={node.title}
      body={node.body}
      badge={badge}
      footer={footer}
      collapsed={collapsed}
      onToggleCollapse={toggle}
    />
  );
}
