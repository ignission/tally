import { z } from 'zod';

// ----------------------------------------------------------------------------
// 列挙
// ----------------------------------------------------------------------------

export const NODE_TYPES = [
  'requirement',
  'usecase',
  'userstory',
  'question',
  'coderef',
  'issue',
  'proposal',
] as const;

export const EDGE_TYPES = ['satisfy', 'contain', 'derive', 'refine', 'verify', 'trace'] as const;

// ISO/IEC 25010 の品質カテゴリ。将来 UI から触る可能性を残すため型で保持する。
export const QUALITY_CATEGORIES = [
  'functionalSuitability',
  'performanceEfficiency',
  'compatibility',
  'usability',
  'reliability',
  'security',
  'maintainability',
  'portability',
] as const;

export const REQUIREMENT_KINDS = ['functional', 'non_functional'] as const;
export const REQUIREMENT_PRIORITIES = ['must', 'should', 'could', 'wont'] as const;

// ----------------------------------------------------------------------------
// 共通属性
// ----------------------------------------------------------------------------

const baseNodeShape = {
  id: z.string().min(1),
  x: z.number(),
  y: z.number(),
  title: z.string(),
  body: z.string(),
};

// ----------------------------------------------------------------------------
// 型固有のノードスキーマ
// ----------------------------------------------------------------------------

export const RequirementNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('requirement'),
  kind: z.enum(REQUIREMENT_KINDS).optional(),
  qualityCategory: z.enum(QUALITY_CATEGORIES).optional(),
  priority: z.enum(REQUIREMENT_PRIORITIES).optional(),
});

export const UseCaseNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('usecase'),
});

const AcceptanceCriterionSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  done: z.boolean(),
});

const TaskItemSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  done: z.boolean(),
});

export const UserStoryNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('userstory'),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).optional(),
  tasks: z.array(TaskItemSchema).optional(),
  points: z.number().int().positive().optional(),
});

const QuestionOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string(),
  selected: z.boolean(),
});

export const QuestionNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('question'),
  options: z.array(QuestionOptionSchema).optional(),
  decision: z.string().nullable().optional(),
});

export const CodeRefNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('coderef'),
  filePath: z.string().optional(),
  startLine: z.number().int().nonnegative().optional(),
  endLine: z.number().int().nonnegative().optional(),
  summary: z.string().optional(),
  // analyze-impact 由来のみ記入 (find-related-code は書かない)。spec §1 の棲み分け契約。
  impact: z.string().optional(),
});

export const IssueNodeSchema = z.object({
  ...baseNodeShape,
  type: z.literal('issue'),
});

export const ProposalNodeSchema = z
  .object({
    ...baseNodeShape,
    type: z.literal('proposal'),
    adoptAs: z.enum(NODE_TYPES).optional(),
    sourceAgentId: z.string().optional(),
  })
  .passthrough();

export const NodeSchema = z.discriminatedUnion('type', [
  RequirementNodeSchema,
  UseCaseNodeSchema,
  UserStoryNodeSchema,
  QuestionNodeSchema,
  CodeRefNodeSchema,
  IssueNodeSchema,
  ProposalNodeSchema,
]);

// ----------------------------------------------------------------------------
// エッジスキーマ
// ----------------------------------------------------------------------------

export const EdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(EDGE_TYPES),
});

// ----------------------------------------------------------------------------
// プロジェクトスキーマ
// ----------------------------------------------------------------------------

// .tally/project.yaml に対応する meta のみのスキーマ。
// ノード・エッジはファイル分割で永続化するため、ここには含めない。
export const ProjectMetaSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  codebasePath: z.string().optional(),
  // 複数リポジトリにまたがる機能用。AI エージェントは primary (codebasePath) を
  // cwd にして、ここに列挙されたパスも読み取り対象に含める。
  additionalCodebasePaths: z.array(z.string().min(1)).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

// 実行時に Project 全体を扱う際の合成スキーマ (メモリ上表現)。
export const ProjectSchema = ProjectMetaSchema.extend({
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});

// PATCH /api/projects/:id の body スキーマ。
// .strict() で未知フィールドは 400 に倒す (将来追加するフィールドは明示登録が必要)。
// null は「そのキーを削除」シグナルとしてサーバに渡す (updateNode の更新慣例と合わせる)。
export const ProjectMetaPatchSchema = z
  .object({
    codebasePath: z.union([z.string(), z.null()]).optional(),
    // [] を渡せば全削除、省略なら変更しない。null は渡せない (削除は [])。
    additionalCodebasePaths: z.array(z.string().min(1)).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// チャットスキーマ (Phase 6)
// ---------------------------------------------------------------------------

export const ChatBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z.object({
    type: z.literal('tool_use'),
    toolUseId: z.string().min(1),
    name: z.string().min(1),
    input: z.unknown(),
    approval: z.enum(['pending', 'approved', 'rejected']),
  }),
  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string().min(1),
    ok: z.boolean(),
    output: z.string(),
  }),
]);

export const ChatMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant']),
  blocks: z.array(ChatBlockSchema),
  createdAt: z.string().min(1),
});

export const ChatThreadMetaSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export const ChatThreadSchema = ChatThreadMetaSchema.extend({
  messages: z.array(ChatMessageSchema),
});

export type ChatBlock = z.infer<typeof ChatBlockSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatThread = z.infer<typeof ChatThreadSchema>;
export type ChatThreadMeta = z.infer<typeof ChatThreadMetaSchema>;
