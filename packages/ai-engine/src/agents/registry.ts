import type { AgentName, Node } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import type { z } from 'zod';

import { analyzeImpactAgent } from './analyze-impact';
import { decomposeToStoriesAgent } from './decompose-to-stories';
import { extractQuestionsAgent } from './extract-questions';
import { findRelatedCodeAgent } from './find-related-code';
import { ingestDocumentAgent } from './ingest-document';

// エージェント個別の input 形状は zod スキーマで検証する。
// registry 側は ZodTypeAny として扱い、ランタイムで safeParse を走らせる。
export interface AgentValidateOk {
  ok: true;
  anchor?: Node; // anchor 無しエージェント (ingest-document) は undefined を返す
  cwd?: string;
  // 横断機能用: primary cwd に加えて AI が読み取り参照してよい絶対パス群。
  // SDK の cwd は単一なので、プロンプト内で位置を明示して Read/Grep させる。
  additionalCwds?: string[];
  // 検証通過した対象 codebase の id。create_node が coderef proposal 生成時に
  // additional へ注入して、後の adopt で codebaseId 整合性検証が通るようにする。
  codebaseId?: string;
}
export interface AgentValidateError {
  ok: false;
  code: 'bad_request' | 'not_found';
  message: string;
}
export type AgentValidateResult = AgentValidateOk | AgentValidateError;

export interface AgentPromptInput {
  anchor?: Node;
  cwd?: string;
  additionalCwds?: string[];
  input?: unknown; // agent 固有入力 (ingest-document の text など)
}

export interface AgentPrompt {
  systemPrompt: string;
  userPrompt: string;
}

export interface AgentDefinition<TInput = unknown> {
  name: AgentName;
  inputSchema: z.ZodType<TInput>;
  validateInput(
    deps: { store: ProjectStore; projectDir: string },
    input: TInput,
  ): Promise<AgentValidateResult>;
  buildPrompt(args: AgentPromptInput): AgentPrompt;
  allowedTools: string[];
}

// satisfies で AgentName の全メンバーが登録されていることを compile-time に検証する。
// 新しい AgentName を増やしてここに登録を追加し忘れると TS エラーになる。
// 値のプロパティ型は具体的な AgentDefinition<TInput> のまま保たれるため、
// AGENT_REGISTRY[req.agent] は AgentDefinition を返す (undefined にならない)。
export const AGENT_REGISTRY = {
  'decompose-to-stories': decomposeToStoriesAgent,
  'find-related-code': findRelatedCodeAgent,
  'analyze-impact': analyzeImpactAgent,
  'extract-questions': extractQuestionsAgent,
  'ingest-document': ingestDocumentAgent,
} satisfies Record<AgentName, AgentDefinition>;
