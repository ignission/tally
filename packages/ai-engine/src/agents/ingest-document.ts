import { promises as fs } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

import type { AgentDefinition } from './registry';

export type IngestDocumentInput =
  | { source: 'paste'; text: string }
  | { source: 'docs-dir'; dirPath: string };

export interface IngestDocumentPromptInput {
  input: IngestDocumentInput;
}

// ingest-document のプロンプト。paste モードは Phase 5d と同じ。docs-dir モードは
// AI が指定ディレクトリ配下の *.md を Glob + Read で走査し req/UC を抽出する。
export function buildIngestDocumentPrompt(args: IngestDocumentPromptInput): {
  systemPrompt: string;
  userPrompt: string;
} {
  if (args.input.source === 'paste') {
    return buildPastePrompt(args.input.text);
  }
  return buildDocsDirPrompt(args.input.dirPath);
}

function buildPastePrompt(text: string): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'あなたは Tally の要求書取り込みアシスタントです。',
    'ユーザーから提供された要求書テキストを読み、',
    'プロジェクト初期の骨格となる requirement と usecase を proposal として生成します。',
    '',
    '手順:',
    '1. 要求書テキストを最初から最後まで読み、全体像を把握する。',
    '2. 「何を達成したいか」(ビジネス目標・顧客要望) を 3〜8 個の requirement proposal として抽出する。',
    '3. 各要求を達成するためのユーザー操作・システム相互作用を 3〜15 個の usecase proposal として抽出する。',
    '4. requirement → usecase の関係を satisfy エッジで張る (1 つの UC は 1〜2 個の requirement を満たす想定)。',
    '5. 最後に「何を読み、何を抽出したか」を 3〜5 行で日本語要約する。',
    '',
    '出力規約:',
    '- create_node(adoptAs="requirement", title="[AI] <短い要求>", body="<要求の意図、背景>")',
    '  座標は指定不要 (サーバ側で自動配置)',
    '- create_node(adoptAs="usecase", title="[AI] <UC 名>", body="<UC のトリガ / 主な流れ / 終了条件>")',
    '- create_edge(type="satisfy", from=<requirement id>, to=<usecase id>)',
    '  (SysML 2.0 の satisfy: 上位要求を下位 UC が満たす。矢印は要求 → UC)',
    '',
    '個数目安:',
    '- requirement: 3〜8 件',
    '- usecase: 3〜15 件',
    '- 要求書の密度が低ければ少なめで可。無理に増やさない。',
    '',
    'ツール使用方針: mcp__tally__* のみ使用する (テキストは既に本メッセージに含まれているためファイル読み込みは不要)。',
  ].join('\n');

  const userPrompt = [
    '以下は要求書のテキストです。読み込んで requirement と usecase proposal を生成してください。',
    '',
    '---',
    text,
    '---',
  ].join('\n');

  return { systemPrompt, userPrompt };
}

function buildDocsDirPrompt(dirPath: string): { systemPrompt: string; userPrompt: string } {
  const systemPrompt = [
    'あなたは Tally の要求書取り込みアシスタント (ディレクトリ版) です。',
    '指定されたディレクトリ配下の Markdown ファイル群を読み、',
    'プロジェクトの骨格となる requirement と usecase を proposal として生成します。',
    '',
    '手順:',
    `1. Glob("${dirPath}/**/*.md") で Markdown を列挙する (10〜50 ファイル想定)。`,
    '2. 各ファイルを Read で読み、システム全体が実現している / 実現しようとしている機能を把握する。',
    '3. 「何を達成したいか」(ビジネス目標・顧客要望) を 5〜15 個の requirement proposal として抽出する。',
    '4. 各要求を達成する機能を 10〜30 個の usecase proposal として抽出する。',
    '5. requirement → usecase の関係を satisfy エッジで張る (1 つの UC は 1〜2 個の requirement を満たす想定)。',
    '6. 最後に「読んだファイル数」「抽出した req/UC 数」「大まかな領域分類」を 4〜6 行で日本語要約する。',
    '',
    '出力規約:',
    '- create_node(adoptAs="requirement", title="[AI] <短い要求>", body="<要求の意図、背景>")',
    '- create_node(adoptAs="usecase", title="[AI] <UC 名>", body="<UC のトリガ / 主な流れ / 終了条件>")',
    '- create_edge(type="satisfy", from=<requirement id>, to=<usecase id>)',
    '',
    '個数目安:',
    '- requirement: 5〜15 件 (上限)',
    '- usecase: 10〜30 件 (上限)',
    '- 情報が薄ければ少なくて構わない。',
    '',
    'ツール使用方針: Glob / Read / mcp__tally__* のみ使用。Bash / Edit / Write は使わない。',
    '- Markdown 以外のファイル (image / binary) は読まない。',
    `- ${dirPath} の外には Glob しない (指定ディレクトリに閉じる)。`,
  ].join('\n');

  const userPrompt = [
    '以下のディレクトリを走査し、requirement と usecase proposal を生成してください。',
    '',
    `対象ディレクトリ: ${dirPath} (workspaceRoot からの相対)`,
  ].join('\n');

  return { systemPrompt, userPrompt };
}

const IngestDocumentInputSchema = z.discriminatedUnion('source', [
  z.object({
    source: z.literal('paste'),
    text: z.string().min(1).max(50_000),
  }),
  z.object({
    source: z.literal('docs-dir'),
    dirPath: z.string().min(1).max(500),
  }),
]);

export const ingestDocumentAgent: AgentDefinition<IngestDocumentInput> = {
  name: 'ingest-document',
  inputSchema: IngestDocumentInputSchema,
  async validateInput({ workspaceRoot }, input) {
    if (input.source === 'paste') {
      return { ok: true };
    }
    const resolved = path.resolve(workspaceRoot, input.dirPath);
    const rel = path.relative(workspaceRoot, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return {
        ok: false,
        code: 'bad_request',
        message: `dirPath が workspaceRoot 配下ではない: ${input.dirPath}`,
      };
    }
    try {
      const st = await fs.stat(resolved);
      if (!st.isDirectory()) {
        return {
          ok: false,
          code: 'bad_request',
          message: `dirPath がディレクトリではない: ${input.dirPath}`,
        };
      }
    } catch {
      return {
        ok: false,
        code: 'not_found',
        message: `dirPath が存在しない: ${input.dirPath}`,
      };
    }
    return { ok: true, cwd: workspaceRoot };
  },
  buildPrompt: ({ input }) => {
    const typed = input as IngestDocumentInput;
    return buildIngestDocumentPrompt({ input: typed });
  },
  allowedTools: [
    'mcp__tally__create_node',
    'mcp__tally__create_edge',
    'mcp__tally__find_related',
    'mcp__tally__list_by_type',
    'Read',
    'Glob',
  ],
};
