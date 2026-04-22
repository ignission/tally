import type { UseCaseNode } from '@tally/core';
import { z } from 'zod';

import type { AgentDefinition } from './registry';

// decompose-to-stories: UC ノードを渡すと userstory の proposal を生成するエージェント。
// プロンプトは system (規約) + user (入力 UC) で構成。個数の上限は示唆のみ (自律判断)。
export interface DecomposeInput {
  ucNode: UseCaseNode;
}

export interface DecomposePrompt {
  systemPrompt: string;
  userPrompt: string;
}

export function buildDecomposePrompt(input: DecomposeInput): DecomposePrompt {
  const systemPrompt = [
    'あなたは Tally の要件分解アシスタントです。',
    '与えられた UC ノードを読み、実装 1 スプリントで完結する粒度の userstory を複数提案してください。',
    '提案は必ず create_node ツールで type="proposal", adoptAs="userstory" として作成すること。',
    'タイトルは "[AI] " プレフィックスを付け、body は Mike Cohn 形式 (〇〇として／〜したい／なぜなら〜) で書くこと。',
    '各 proposal は必ず create_edge ツールで UC ノードからの derive エッジを張ること。',
    '個数は UC 内容に応じて 1〜7 の範囲を目安とし、粗すぎ・細かすぎを避けること。',
    '重複を避けるため、作業前に list_by_type で既存 userstory を確認してよい。',
    '最後に「何をどう分解したか」を 2〜3 行で日本語で要約してください。',
  ].join('\n');

  const userPrompt = [
    `対象 UC: ${input.ucNode.id}`,
    `タイトル: ${input.ucNode.title}`,
    `本文:\n${input.ucNode.body}`,
    '',
    '上記 UC を userstory 群に分解し、proposal として作成してください。',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

const DecomposeInputSchema = z.object({ nodeId: z.string().min(1) });
type DecomposeAgentInput = z.infer<typeof DecomposeInputSchema>;

export const decomposeToStoriesAgent: AgentDefinition<DecomposeAgentInput> = {
  name: 'decompose-to-stories',
  inputSchema: DecomposeInputSchema,
  async validateInput({ store }, input) {
    const uc = await store.getNode(input.nodeId);
    if (!uc) {
      return { ok: false, code: 'not_found', message: `ノードが存在しない: ${input.nodeId}` };
    }
    if (uc.type !== 'usecase') {
      return {
        ok: false,
        code: 'bad_request',
        message: `decompose-to-stories は usecase 限定: ${uc.type}`,
      };
    }
    return { ok: true, anchor: uc };
  },
  buildPrompt: ({ anchor }) => buildDecomposePrompt({ ucNode: anchor as UseCaseNode }),
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
  ],
};
