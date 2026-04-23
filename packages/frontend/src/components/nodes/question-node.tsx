import type { QuestionNode } from '@tally/core';
import { getSelectedOption, isDecided, NODE_META } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeBadge, NodeCard } from './node-card';
import { useNodeAccordion } from './use-accordion';

export function QuestionNodeView({ id, data }: NodeProps) {
  const node = (data as { node: QuestionNode }).node;
  const { collapsed, toggle } = useNodeAccordion(id);
  const decided = isDecided(node);
  const selected = getSelectedOption(node);

  const badge = decided ? (
    <NodeBadge tone="success">決定</NodeBadge>
  ) : (
    <NodeBadge>未決定</NodeBadge>
  );

  const footer = node.options && node.options.length > 0 && (
    <ul
      style={{
        margin: 0,
        padding: 0,
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      {node.options.map((opt) => {
        const isSelected = selected?.id === opt.id;
        return (
          <li
            key={opt.id}
            style={{
              fontSize: 11,
              color: isSelected ? '#fff' : '#8b949e',
              fontWeight: isSelected ? 600 : 400,
              padding: '2px 6px',
              borderRadius: 4,
              background: isSelected ? '#238636' : 'transparent',
            }}
          >
            {isSelected ? '✓ ' : '・'} {opt.text}
          </li>
        );
      })}
    </ul>
  );

  return (
    <NodeCard
      meta={NODE_META.question}
      title={node.title}
      body={node.body}
      dashed={!decided}
      faded={decided}
      badge={badge}
      footer={footer}
      collapsed={collapsed}
      onToggleCollapse={toggle}
    />
  );
}
