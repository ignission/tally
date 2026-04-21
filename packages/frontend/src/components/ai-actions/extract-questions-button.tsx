'use client';

import { useCanvasStore } from '@/lib/store';

import { type AnchorNode, GraphAgentButton } from './graph-agent-button';

// 「論点を抽出」AI アクションボタン。UC / requirement / userstory の 3 detail から共通利用する。
// codebasePath を要求しないエージェント (extract-questions) 用の thin wrapper。
export function ExtractQuestionsButton({ node }: { node: AnchorNode }) {
  const start = useCanvasStore((s) => s.startExtractQuestions);
  return (
    <GraphAgentButton
      node={node}
      agentName="extract-questions"
      label="論点を抽出"
      busyLabel="論点抽出: 実行中…"
      tooltip="未決定の設計判断を質問として洗い出す"
      onRun={start}
    />
  );
}
