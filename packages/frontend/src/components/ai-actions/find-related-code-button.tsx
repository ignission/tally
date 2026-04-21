'use client';

import { useCanvasStore } from '@/lib/store';

import { type AnchorNode, CodebaseAgentButton } from './codebase-agent-button';

// 「関連コードを探す」AI アクションボタン。UC / requirement / userstory の 3 detail から共通利用する。
// codebase を読むエージェント共通のロジックは CodebaseAgentButton に委譲する thin wrapper。
export function FindRelatedCodeButton({ node }: { node: AnchorNode }) {
  const start = useCanvasStore((s) => s.startFindRelatedCode);
  return (
    <CodebaseAgentButton
      node={node}
      agentName="find-related-code"
      label="関連コードを探す"
      busyLabel="関連コード: 実行中…"
      tooltip="既存コードから関連箇所を探索します"
      onRun={start}
    />
  );
}
