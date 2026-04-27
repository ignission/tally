import type { z } from 'zod';

import type {
  CodeRefNodeSchema,
  EDGE_TYPES,
  EdgeSchema,
  IssueNodeSchema,
  NODE_TYPES,
  NodeSchema,
  ProjectMetaPatchSchema,
  ProjectMetaSchema,
  ProjectSchema,
  ProposalNodeSchema,
  QUALITY_CATEGORIES,
  QuestionNodeSchema,
  REQUIREMENT_KINDS,
  REQUIREMENT_PRIORITIES,
  RequirementNodeSchema,
  UseCaseNodeSchema,
  UserStoryNodeSchema,
} from './schema';

export type { ChatBlock, ChatMessage, ChatThread, ChatThreadMeta, McpServerConfig } from './schema';

export type NodeType = (typeof NODE_TYPES)[number];
export type EdgeType = (typeof EDGE_TYPES)[number];
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];
export type RequirementPriority = (typeof REQUIREMENT_PRIORITIES)[number];
export type QualityCategory = (typeof QUALITY_CATEGORIES)[number];

export type RequirementNode = z.infer<typeof RequirementNodeSchema>;
export type UseCaseNode = z.infer<typeof UseCaseNodeSchema>;
export type UserStoryNode = z.infer<typeof UserStoryNodeSchema>;
export type QuestionNode = z.infer<typeof QuestionNodeSchema>;
export type CodeRefNode = z.infer<typeof CodeRefNodeSchema>;
export type IssueNode = z.infer<typeof IssueNodeSchema>;
export type ProposalNode = z.infer<typeof ProposalNodeSchema>;

export type Node = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;

// ProjectMeta / Project は z.input 由来にする。
// 理由: ProjectMetaSchema.mcpServers は default [] を持つので
//       output 型では required、input 型では optional になる。
//       既存の YAML や呼び出しが mcpServers を持たないケースを許容するため input 側を採用。
//       読み取り時は z.parse で必ず default が解決され実値は McpServerConfig[]。
export type ProjectMeta = z.input<typeof ProjectMetaSchema>;
export type ProjectMetaPatch = z.input<typeof ProjectMetaPatchSchema>;
export type Project = z.input<typeof ProjectSchema>;

// UserStoryNode の補助型。
export type AcceptanceCriterion = NonNullable<UserStoryNode['acceptanceCriteria']>[number];
export type UserStoryTask = NonNullable<UserStoryNode['tasks']>[number];

// QuestionNode の補助型。
export type QuestionOption = NonNullable<QuestionNode['options']>[number];

// ADR-0005: proposal ノードを採用するときの遷移先に許される NodeType。
// proposal → proposal の遷移は意味が無いので除外する。
export type AdoptableType = Exclude<NodeType, 'proposal'>;

// AI エージェント名の集合。frontend / ai-engine / storage で共有する。
// 新しいエージェントを足すときは registry (ai-engine/src/agents/registry.ts) と
// ここの両方を更新する。
export const AGENT_NAMES = [
  'decompose-to-stories',
  'find-related-code',
  'analyze-impact',
  'extract-questions',
  'ingest-document',
] as const;
export type AgentName = (typeof AGENT_NAMES)[number];
