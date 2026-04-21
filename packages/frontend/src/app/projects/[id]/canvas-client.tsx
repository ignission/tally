'use client';

import { useEffect } from 'react';

import type { Project } from '@tally/core';

import { Canvas } from '@/components/canvas/canvas';
import { DetailSheet } from '@/components/details/detail-sheet';
import { NodePalette } from '@/components/palette/node-palette';
import { AgentProgressPanel } from '@/components/progress/agent-progress-panel';
import { useCanvasStore } from '@/lib/store';

export function CanvasClient({ project }: { project: Project }) {
  const hydrate = useCanvasStore((s) => s.hydrate);
  const reset = useCanvasStore((s) => s.reset);
  // SSR で取得した Project をストアへ流し込み、アンマウント時にクリアする。
  useEffect(() => {
    hydrate(project);
    return reset;
  }, [project, hydrate, reset]);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <NodePalette />
      <div style={{ flex: 1, minWidth: 0 }}>
        <Canvas />
      </div>
      <DetailSheet />
      <AgentProgressPanel />
    </div>
  );
}
