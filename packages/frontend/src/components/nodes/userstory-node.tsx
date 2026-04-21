import { NODE_META, computeStoryProgress } from '@tally/core';
import type { UserStoryNode } from '@tally/core';
import type { NodeProps } from '@xyflow/react';

import { NodeBadge, NodeCard } from './node-card';

export function UserStoryNodeView({ data }: NodeProps) {
  const node = (data as { node: UserStoryNode }).node;
  const progress = computeStoryProgress(node);
  const badge = node.points ? <NodeBadge tone="success">{`${node.points}pt`}</NodeBadge> : null;

  const footer =
    progress.acceptance.total + progress.tasks.total > 0 ? (
      <div style={{ display: 'flex', gap: 10, fontSize: 11, color: '#8b949e' }}>
        {progress.acceptance.total > 0 && (
          <span>
            AC {progress.acceptance.done}/{progress.acceptance.total}
          </span>
        )}
        {progress.tasks.total > 0 && (
          <span>
            Tasks {progress.tasks.done}/{progress.tasks.total}
          </span>
        )}
      </div>
    ) : null;

  return (
    <NodeCard
      meta={NODE_META.userstory}
      title={node.title}
      body={node.body}
      badge={badge}
      footer={footer}
    />
  );
}
