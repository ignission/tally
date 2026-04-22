import type { Node } from '@tally/core';
import { z } from 'zod';

import { buildAdditionalRepoSection, validateCodebaseAnchor } from './codebase-anchor';
import type { AgentDefinition } from './registry';

export interface AnalyzeImpactPromptInput {
  anchor: Node;
  additionalCwds?: string[];
  // validateInput が解決した対象 codebase の ID。
  // プロンプト内で AI に明示し、coderef proposal の additional に必ず含めさせる。
  codebaseId?: string;
}

// analyze-impact のプロンプト。issue proposal が主役、coderef は補助 (find-related-code が
// 拾い切れていない変更点のみ)。既存 coderef と重複する filePath/startLine は作らせない。
export function buildAnalyzeImpactPrompt(input: AnalyzeImpactPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    'あなたは Tally の影響分析アシスタントです。',
    '対象ノード (usecase / requirement / userstory) を実装した場合に、',
    'codebasePath 配下の既存コードへ与える影響を洗い出し、',
    '「変更が必要な箇所 (coderef proposal)」と「変更に伴う課題・リスク (issue proposal)」を記録します。',
    '',
    'あなたの主役は issue proposal (変更の意味付け・リスク洗い出し) です。',
    'coderef proposal は find-related-code が拾い切れていなかった新規の変更点のみを補うため、',
    '「主役ではない」ことを強く意識すること。',
    '',
    '手順:',
    '1. mcp__tally__find_related(nodeId=対象ノード) で対象ノードにエッジ接続済みのノードを取得する。',
    '   既存 coderef / issue の filePath / タイトルを必ず確認し、同じものは再作成しない。',
    '2. mcp__tally__list_by_type("coderef") / list_by_type("issue") で他 anchor に紐づく既存を確認し、',
    '   同一 filePath+startLine の coderef、同一 anchor+同タイトルの issue は作らない。',
    '3. Glob / Grep / Read で codebase を探索し、実装時に変更が必要そうなファイル・関数を特定する。',
    '4. 変更点が find-related-code 由来の既存 coderef で既にカバーされているなら coderef proposal は',
    '   作成せず、issue proposal の body 中で「<既存 coderef のタイトル> を変更する必要あり」と言及する。',
    '   既存 coderef に未カバーの新規変更点がある場合のみ coderef proposal を追加作成する。',
    '5. 「テスト未整備」「データ移行が必要」「後方互換性の懸念」「パフォーマンス影響」などの懸念は',
    '   issue proposal として作成する。issue は anchor ごとに同じタイトルで重複させない。',
    '',
    '出力規約:',
    '- coderef proposal (副次的, 0〜5 件): create_node で type="proposal", adoptAs="coderef"',
    '  タイトル: "[AI] <filePath>:<startLine>"',
    '  body: "<現状要約> / 影響: <実装したらどう変更する必要があるか>" (人間可読)',
    '  additional: { codebaseId, filePath, startLine, endLine, summary, impact }',
    '    filePath は codebasePath 基準の相対パス ("./" は付けない)',
    '    summary = 現状要約、impact = 実装で変わる方向性 (UI の将来拡張用、body と内容を一致させる)',
    '- issue proposal (主役, 0〜5 件): create_node で type="proposal", adoptAs="issue"',
    '  タイトル: "[AI] <短く具体的な課題名>" (同一 anchor に同タイトルの issue を既に持たないこと)',
    '  body: 課題の説明 / 影響範囲 (参照 coderef があればそのタイトルを列挙) / 検討ポイント (2〜4 行)',
    '',
    'エッジ規約:',
    '- 対象ノード → 新規 coderef proposal: create_edge で type="derive"',
    '- 対象ノード → issue proposal: create_edge で type="derive"',
    '',
    '個数目安:',
    '- coderef proposal: 0〜5 件 (find-related-code が拾っていない新規影響箇所のみ)',
    '- issue proposal: 0〜5 件',
    '- 影響が薄ければ 0 件でも可。無理に作らないこと。',
    '- 最後に「何を分析し、何を見つけたか」を 3〜4 行で日本語で要約する。',
    '',
    'ツール使用方針: 探索は Glob / Grep / Read のみ。Edit / Write / Bash は使わない。',
    buildAdditionalRepoSection(input.additionalCwds),
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  const userPrompt = [
    `対象ノード: ${input.anchor.id}`,
    `type: ${input.anchor.type}`,
    `タイトル: ${input.anchor.title}`,
    `本文:\n${input.anchor.body}`,
    ...(input.codebaseId ? [`\n対象 codebaseId: ${input.codebaseId}`] : []),
    '',
    '上記ノードを実装した場合の既存コードへの影響を分析し、',
    'coderef proposal と issue proposal として記録してください。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

const AnalyzeImpactInputSchema = z.object({
  nodeId: z.string().min(1),
  // フロントから選択された codebase の ID。省略時は codebases[0] を使う (後方互換)。
  codebaseId: z.string().optional(),
});
type AnalyzeImpactInput = z.infer<typeof AnalyzeImpactInputSchema>;

const ALLOWED_ANCHOR_TYPES = ['usecase', 'requirement', 'userstory'] as const;

export const analyzeImpactAgent: AgentDefinition<AnalyzeImpactInput> = {
  name: 'analyze-impact',
  inputSchema: AnalyzeImpactInputSchema,
  async validateInput({ store, projectDir }, input) {
    return validateCodebaseAnchor(
      { store, projectDir },
      input.nodeId,
      ALLOWED_ANCHOR_TYPES,
      'analyze-impact',
      { ...(input.codebaseId !== undefined ? { codebaseId: input.codebaseId } : {}) },
    );
  },
  // anchor 必須エージェント: validateInput が通過した時点で anchor は必ず存在する。
  buildPrompt: ({ anchor, additionalCwds, codebaseId }) =>
    buildAnalyzeImpactPrompt({
      anchor: anchor!,
      ...(additionalCwds ? { additionalCwds } : {}),
      ...(codebaseId ? { codebaseId } : {}),
    }),
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
    'Read',
    'Glob',
    'Grep',
  ],
};
