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
  // 外部 MCP (Atlassian 等) から取り込んだ場合の元情報 URL。Phase 6+ で UI から開けるようにする予定。
  // UI link 経由で credential が漏れる構図を排除するため https-only。
  // McpServerConfig.url と異なり loopback 例外は不要 (Jira issue URL に loopback はあり得ない)。
  sourceUrl: z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          return new URL(u).protocol === 'https:';
        } catch {
          return false;
        }
      },
      { message: 'sourceUrl は https で始まる必要があります' },
    )
    .optional(),
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
  codebaseId: z.string().min(1),
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

export const CodebaseSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u, {
    message: 'codebase id は先頭英小文字 + 英小文字/数字/ハイフン、32 字以内',
  }),
  label: z.string().min(1),
  path: z.string().min(1),
});

export type Codebase = z.infer<typeof CodebaseSchema>;

// codebases[].id の重複を検出して issue を積む。superRefine の共通ロジック。
function checkUniqueCodebaseIds(
  codebases: { id: string }[] | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!codebases) return;
  const seen = new Set<string>();
  for (const c of codebases) {
    if (seen.has(c.id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `codebases[].id 重複: ${c.id}`,
        path: ['codebases'],
      });
      return;
    }
    seen.add(c.id);
  }
}

// ---------------------------------------------------------------------------
// MCP サーバー設定スキーマ (Atlassian MCP 連携)
// ---------------------------------------------------------------------------
// 注: ProjectMetaSchema / ProjectSchema が McpServerConfigSchema を参照するため、
//     宣言順序として MCP セクションを Project 系より前に置く。
//
// 認証方針 (Premise 9 撤回後):
// MCP プロトコルの OAuth 2.1 を採用し、Tally は credentials を一切扱わない。
// - 401 を受けたら Claude Agent SDK が WWW-Authenticate から OAuth metadata を取り、
//   ブラウザ経由 (or device flow) で auth、token 管理は SDK 側で完結する。
// - Tally は url のみ持ち、Authorization header は組み立てない。
// - PAT / API key を Tally のメモリ・ログ・ファイルに残さない。
// 既存の sooperset/mcp-atlassian (PAT 認証) を使う場合はその MCP server 自身が
// 起動時 env で credentials を持つ前提 (Tally は header passthrough しない)。

// options は未指定時に {} を default として与え、内側で各フィールドの default を発火させる。
// zod v4 では outer .default(value) が parse 前に value をそのまま流すため、
// 入力と同じ経路でフィールド default を解決するには .default({}) → inner default の 2 段構え。
const McpServerOptionsSchema = z
  .object({
    maxChildIssues: z.number().int().positive().default(30),
    maxCommentsPerIssue: z.number().int().nonnegative().default(5),
  })
  .default(() => ({ maxChildIssues: 30, maxCommentsPerIssue: 5 }));

// MCP サーバー id は SDK の wildcard `mcp__<id>__*` の id 部分に embed されるため、
// tool 名 matching が壊れないよう CodebaseSchema.id と同じ charset 制約を採用。
const McpServerIdRegex = /^[a-z][a-z0-9-]{0,31}$/u;

export const McpServerConfigSchema = z.object({
  id: z.string().regex(McpServerIdRegex, {
    message: 'mcp server id は先頭英小文字 + 英小文字/数字/ハイフン、32 字以内',
  }),
  name: z.string().min(1),
  kind: z.literal('atlassian'),
  // OAuth 2.1 / その他 credential は MCP プロトコル経由で SDK が処理する。
  // ここでは url のみを持ち、cleartext を防ぐため https のみ許可
  // (開発・テスト用の loopback (localhost / 127.0.0.1 / ::1) のみ http: を例外的に許容)。
  url: z
    .string()
    .url()
    .refine(
      (u) => {
        try {
          const parsed = new URL(u);
          if (parsed.protocol === 'https:') return true;
          if (
            parsed.protocol === 'http:' &&
            (parsed.hostname === 'localhost' ||
              parsed.hostname === '127.0.0.1' ||
              parsed.hostname === '::1' ||
              parsed.hostname === '[::1]')
          ) {
            return true;
          }
          return false;
        } catch {
          return false;
        }
      },
      { message: 'url は https で始まる必要があります (loopback の http は例外的に許容)' },
    ),
  options: McpServerOptionsSchema,
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

// .tally/project.yaml に対応する meta のみのスキーマ。
// ノード・エッジはファイル分割で永続化するため、ここには含めない。
export const ProjectMetaSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    // 0 件以上。code ノードが存在するときは最低 1 件必要（整合性は storage 層で検証）。
    codebases: z.array(CodebaseSchema),
    // Atlassian 等の MCP サーバー設定。既存 YAML (フィールド無し) は default [] で読み込める。
    mcpServers: z.array(McpServerConfigSchema).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .superRefine((meta, ctx) => checkUniqueCodebaseIds(meta.codebases, ctx));

// 実行時に Project 全体を扱う際の合成スキーマ (メモリ上表現)。
export const ProjectSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    codebases: z.array(CodebaseSchema),
    // Atlassian 等の MCP サーバー設定。ProjectMetaSchema と整合。
    mcpServers: z.array(McpServerConfigSchema).default([]),
    createdAt: z.string(),
    updatedAt: z.string(),
    nodes: z.array(NodeSchema),
    edges: z.array(EdgeSchema),
  })
  .superRefine((p, ctx) => checkUniqueCodebaseIds(p.codebases, ctx));

// PATCH /api/projects/:id の body スキーマ。codebases / mcpServers は全置換のみ (部分更新はしない)。
export const ProjectMetaPatchSchema = z
  .object({
    name: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    codebases: z.array(CodebaseSchema).optional(),
    mcpServers: z.array(McpServerConfigSchema).optional(),
  })
  .strict()
  .superRefine((patch, ctx) => checkUniqueCodebaseIds(patch.codebases, ctx));

// ---------------------------------------------------------------------------
// チャットスキーマ (Phase 6)
// ---------------------------------------------------------------------------

export const ChatBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('text'), text: z.string() }),
  z
    .object({
      type: z.literal('tool_use'),
      toolUseId: z.string().min(1),
      name: z.string().min(1),
      input: z.unknown(),
      // 'internal' = Tally MCP (人間承認が必要)、'external' = Atlassian 等の外部 MCP (承認概念なし)。
      // 既存 YAML (source 無し) は default 'internal' で読めるよう後方互換を保つ。
      source: z.enum(['internal', 'external']).default('internal'),
      approval: z.enum(['pending', 'approved', 'rejected']).optional(),
    })
    .refine((b) => b.source === 'external' || b.approval !== undefined, {
      message: 'internal tool_use には approval が必要',
    }),
  z.object({
    type: z.literal('tool_result'),
    toolUseId: z.string().min(1),
    ok: z.boolean(),
    output: z.string(),
  }),
  // 外部 MCP (Atlassian 等) の OAuth 2.1 認証フローを 1 等地で扱うブロック。
  // SDK の `mcp__<id>__authenticate` tool_use を生のまま並べると UX が破綻する
  // (URL がプレーンテキスト + redirect 先 localhost:XXXXX が即死) ため、検出して
  // この auth_request に置き換える。status は同 thread 内の complete_authentication で更新。
  // mcpServerLabel は project.mcpServers[].label 由来 (label 未設定なら id を表示)。
  z.object({
    type: z.literal('auth_request'),
    mcpServerId: z.string().min(1),
    mcpServerLabel: z.string().min(1),
    authUrl: z.string().url(),
    status: z.enum(['pending', 'completed', 'failed']),
    // 失敗時にエラーメッセージを残す。pending/completed では undefined。
    failureMessage: z.string().optional(),
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
