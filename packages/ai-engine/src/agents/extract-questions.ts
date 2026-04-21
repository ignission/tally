import type { Node } from '@tally/core';
import { z } from 'zod';

import { validateCodebaseAnchor } from './codebase-anchor';
import type { AgentDefinition } from './registry';

export interface ExtractQuestionsPromptInput {
  anchor: Node;
}

// extract-questions のプロンプト。対象ノードと近傍ノードの記述だけを見て、
// まだ決めていない設計判断を question proposal として出す。コード探索はしない。
export function buildExtractQuestionsPrompt(input: ExtractQuestionsPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    'あなたは Tally の論点抽出アシスタントです。',
    '対象ノード (usecase / requirement / userstory) を眺めて、',
    'この要求を実装するにあたって「まだ決めていない設計判断」を question proposal として洗い出します。',
    '',
    'あなたの主役は question proposal (未決定の判断の表面化) です。',
    '実装詳細や既存コードへの影響は別エージェント (analyze-impact / find-related-code) の担当なので、',
    'ここでは「そもそも決まっていない判断」にフォーカスしてください。',
    '',
    '手順:',
    '1. mcp__tally__find_related(nodeId=対象ノード) で anchor に繋がる近傍ノードを取得する。',
    '   既存 question の title を確認し、同じ論点は再作成しない。',
    '2. mcp__tally__list_by_type("question") で他 anchor に紐づく既存を確認し、',
    '   同一 anchor+同タイトルの question は作らない。',
    '3. anchor の title / body と近傍ノードの記述から、',
    '   「まだ決めていない判断」を 0〜5 件抽出する。',
    '   例: スコープの切り方、処理タイミング、データ保存方針、認証方式、',
    '   エラー時の振る舞い、競合時の挙動、既定値、権限境界、API 粒度、など。',
    '4. 各 question には必ず 2〜4 個の options 候補を添える。',
    '   options は互いに排他的で、それぞれが 1 行で意味が分かる簡潔な表現にする。',
    '',
    '出力規約:',
    '- create_node で type="proposal", adoptAs="question"',
    '  タイトル: "[AI] <短く具体的な問い>" (疑問形または "〜を〜にするか" の形)',
    '  body: 問いの背景 / 決めるべき理由 / 検討の観点 (2〜4 行)',
    '  additional: { options: [{ text: "..." }, ...], decision: null }',
    '    options の id / selected はサーバ側で補完される (AI が指定する必要なし)',
    '- エッジ: create_edge(type="derive", from=<対象ノード>, to=<新 question>)',
    '',
    '個数目安:',
    '- question proposal: 0〜5 件',
    '- 論点が見えなければ 0 件でも可。無理に作らないこと。',
    '- 最後に「何を見て、何が未決定と判断したか」を 3〜4 行で日本語で要約する。',
    '',
    'ツール使用方針: mcp__tally__* のみ使用 (build に含まれていない探索系は呼ばない)。',
  ].join('\n');

  const userPrompt = [
    `対象ノード: ${input.anchor.id}`,
    `type: ${input.anchor.type}`,
    `タイトル: ${input.anchor.title}`,
    `本文:\n${input.anchor.body}`,
    '',
    '上記ノードを実装するうえで、まだ決めていない設計判断を抽出し、',
    'question proposal として記録してください。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

const ExtractQuestionsInputSchema = z.object({ nodeId: z.string().min(1) });
type ExtractQuestionsInput = z.infer<typeof ExtractQuestionsInputSchema>;

const ALLOWED_ANCHOR_TYPES = ['usecase', 'requirement', 'userstory'] as const;

export const extractQuestionsAgent: AgentDefinition<ExtractQuestionsInput> = {
  name: 'extract-questions',
  inputSchema: ExtractQuestionsInputSchema,
  async validateInput({ store, workspaceRoot }, input) {
    return validateCodebaseAnchor(
      { store, workspaceRoot },
      input.nodeId,
      ALLOWED_ANCHOR_TYPES,
      'extract-questions',
      { requireCodebasePath: false },
    );
  },
  // anchor 必須エージェント: validateInput が通過した時点で anchor は必ず存在する。
  buildPrompt: ({ anchor }) => buildExtractQuestionsPrompt({ anchor: anchor! }),
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
  ],
};
