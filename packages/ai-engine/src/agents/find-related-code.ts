import type { Node } from '@tally/core';
import { z } from 'zod';

import { buildAdditionalRepoSection, validateCodebaseAnchor } from './codebase-anchor';
import type { AgentDefinition } from './registry';

export interface FindRelatedCodePromptInput {
  anchor: Node;
  additionalCwds?: string[];
}

// find-related-code のプロンプトを組み立てる。エージェントは allowedTools の whitelist で
// Read / Glob / Grep / tally の read+write のみに制限されている。その上で system プロンプト側でも
// Edit / Write / Bash を使わないことを明示し、coderef proposal として結果を書き込む契約を守らせる。
export function buildFindRelatedCodePrompt(input: FindRelatedCodePromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  const systemPrompt = [
    'あなたは Tally の関連コード探索アシスタントです。',
    '与えられたノード (usecase / requirement / userstory) の意図に照らして、',
    'codebasePath 配下の既存コードから関連する実装・インタフェース・テストを発見し、',
    'coderef proposal として記録します。',
    '',
    'ルール:',
    '- 探索は Glob / Grep / Read ツールを使うこと。Edit / Write / Bash は使わない。',
    '- 関連コードを見つけたら create_node ツールで type="proposal", adoptAs="coderef" として作成する。',
    '  タイトルは "[AI] <filePath>:<startLine>" の形式、body にはその範囲で該当コードが何をしているかの要約を書く。',
    '  additional に { filePath, startLine, endLine } を入れる (filePath は primary リポからの相対パス、横断リポから見つけた場合は絶対パス)。',
    '- 各 coderef proposal に対して create_edge ツールで from=<元ノード>, to=<coderef>, type="derive" のエッジを張る。',
    '- list_by_type("coderef") で既存の coderef を事前確認し、同じ範囲の重複を避ける。',
    '- 個数は対象ノードの関連性に応じて 1〜8 件を目安とし、薄い関連まで拾いすぎないこと。',
    '- 最後に「何を探し、何を見つけたか」を 2〜3 行で日本語で要約する。',
    buildAdditionalRepoSection(input.additionalCwds),
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  const userPrompt = [
    `対象ノード: ${input.anchor.id}`,
    `type: ${input.anchor.type}`,
    `タイトル: ${input.anchor.title}`,
    `本文:\n${input.anchor.body}`,
    '',
    '上記ノードの意図に関連する既存コードを primary codebase (必要なら横断リポも) から探し、coderef proposal として記録してください。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

const FindRelatedCodeInputSchema = z.object({
  nodeId: z.string().min(1),
  // フロントから選択された codebase の ID。省略時は codebases[0] を使う (後方互換)。
  codebaseId: z.string().optional(),
});
type FindRelatedCodeInput = z.infer<typeof FindRelatedCodeInputSchema>;

// 対象ノード type: find-related-code はユーザーの「意図」を起点にコード探索するため、
// UC / requirement / userstory のいずれかに限定する。coderef や proposal から再帰的に
// 更に coderef を生やすのは MVP では許可しない。
const ALLOWED_ANCHOR_TYPES = ['usecase', 'requirement', 'userstory'] as const;

export const findRelatedCodeAgent: AgentDefinition<FindRelatedCodeInput> = {
  name: 'find-related-code',
  inputSchema: FindRelatedCodeInputSchema,
  async validateInput({ store, projectDir }, input) {
    return validateCodebaseAnchor(
      { store, projectDir },
      input.nodeId,
      ALLOWED_ANCHOR_TYPES,
      'find-related-code',
      { ...(input.codebaseId !== undefined ? { codebaseId: input.codebaseId } : {}) },
    );
  },
  // anchor 必須エージェント: validateInput が通過した時点で anchor は必ず存在する。
  buildPrompt: ({ anchor, additionalCwds }) =>
    buildFindRelatedCodePrompt({
      anchor: anchor!,
      ...(additionalCwds ? { additionalCwds } : {}),
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
