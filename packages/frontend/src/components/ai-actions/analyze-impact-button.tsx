'use client';

import { useCanvasStore } from '@/lib/store';

import { type AnchorNode, CodebaseAgentButton } from './codebase-agent-button';

// 「影響を分析する」AI アクションボタン。UC / requirement / userstory から共通利用する。
// anchor に紐づく coderef (proposal or 正規) の有無で tooltip を切り替え、
// まず「関連コードを探す」でコードを紐づけるよう UX 誘導する。
export function AnalyzeImpactButton({ node }: { node: AnchorNode }) {
  const start = useCanvasStore((s) => s.startAnalyzeImpact);
  const hasLinkedCoderef = useCanvasStore((s) => {
    const derivedTos = Object.values(s.edges)
      .filter((e) => e.from === node.id && e.type === 'derive')
      .map((e) => e.to);
    return Object.values(s.nodes).some((n) => {
      if (!derivedTos.includes(n.id)) return false;
      if (n.type === 'coderef') return true;
      const proposal = n as unknown as { adoptAs?: string };
      return n.type === 'proposal' && proposal.adoptAs === 'coderef';
    });
  });

  const tooltip = hasLinkedCoderef
    ? '実装時に変更が必要な既存コードと課題を洗い出します'
    : 'まず「関連コードを探す」で既存コードを紐づけると精度が上がります';

  return (
    <CodebaseAgentButton
      node={node}
      agentName="analyze-impact"
      label="影響を分析する"
      busyLabel="影響分析: 実行中…"
      tooltip={tooltip}
      onRun={start}
    />
  );
}
