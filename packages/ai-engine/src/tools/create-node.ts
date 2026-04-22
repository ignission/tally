import path from 'node:path';

import type { AdoptableType, AgentName, ProposalNode } from '@tally/core';
import { newQuestionOptionId, stripAiPrefix } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { AgentEvent } from '../stream';

// create_node: ツールハンドラ。AI は proposal しか作れない (ADR-0005 前提)。
// adoptAs は「採用されたら何になるか」を宣言。title に [AI] プレフィックスが無ければ自動付与。
// x/y 未指定時は呼び出し元が与える anchor 座標を基準に自動オフセット配置。
// coderef の場合は filePath を正規化し、近接する既存 coderef があれば重複としてガードする。

const ADOPTABLE_TYPES = [
  'requirement',
  'usecase',
  'userstory',
  'question',
  'coderef',
  'issue',
] as const satisfies readonly AdoptableType[];

export const CreateNodeInputSchema = z.object({
  adoptAs: z.enum(ADOPTABLE_TYPES),
  title: z.string().min(1),
  body: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  additional: z.record(z.unknown()).optional(),
});

export type CreateNodeInput = z.infer<typeof CreateNodeInputSchema>;

export interface CreateNodeDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  // anchor ノードの id。question 重複ガードで近傍を引くために使う。
  anchorId: string;
  // AI が生成した proposal に sourceAgentId として刻むエージェント名。
  // どの agent が作ったかを後から辿れるようにするため required。
  agentName: AgentName;
  // agent が探索対象とした codebase の id。coderef proposal 生成時に additional へ注入する。
  // codebase を読まない agent (extract-questions など) は省略可。
  codebaseId?: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

// filePath 近接判定の許容行数。`find-related-code` / `analyze-impact` は
// スキャン位置がブレやすく、同一箇所を複数 proposal として追加しがちなので
// ±10 行以内を重複とみなしてガードする。
const CODEREF_LINE_TOLERANCE = 10;

// "./src/a.ts" や "src//a.ts" を "src/a.ts" に正規化する。
// 比較・保存を揃えるため。
function normalizeFilePath(fp: string): string {
  const stripped = fp.startsWith('./') ? fp.slice(2) : fp;
  return path.posix.normalize(stripped);
}

async function findDuplicateCoderef(
  store: ProjectStore,
  filePath: string,
  startLine: number,
  codebaseId: string | undefined,
): Promise<{ id: string; startLine: number } | null> {
  const all = await store.listNodes();
  for (const n of all) {
    const rec = n as Record<string, unknown>;
    const type = rec.type as string | undefined;
    const adoptAs = rec.adoptAs as string | undefined;
    // 正規 coderef と、adoptAs=coderef の proposal の両方を対象にする。
    const isCoderef = type === 'coderef' || (type === 'proposal' && adoptAs === 'coderef');
    if (!isCoderef) continue;
    const fp = rec.filePath as string | undefined;
    const sl = rec.startLine as number | undefined;
    if (!fp || typeof sl !== 'number') continue;
    if (normalizeFilePath(fp) !== filePath) continue;
    // マルチコードベース対応: 同一 filePath でも codebaseId が異なれば別物として扱う。
    // codebaseId 未指定の旧 proposal (レガシー) や横断エージェントは従来通り全件比較する。
    const existingCb = rec.codebaseId as string | undefined;
    if (codebaseId !== undefined && existingCb !== undefined && existingCb !== codebaseId) {
      continue;
    }
    if (Math.abs(sl - startLine) <= CODEREF_LINE_TOLERANCE) {
      return { id: rec.id as string, startLine: sl };
    }
  }
  return null;
}

// adoptAs=question の options として有効な最小数。extract-questions の仕様上
// 「必ず 2〜4 個」とプロンプト指示しているが、AI が守らなかったとき proposal
// 採用後に decision を選べない question が出来てしまうのでサーバ側でも弾く。
const QUESTION_MIN_OPTIONS = 2;

export function createNodeHandler(deps: CreateNodeDeps) {
  // 複数ノードが同じ anchor で作られたときに重ならないよう、呼び出しごとにオフセットをずらす。
  // agent セッション毎に独立させるため handler closure で保持。
  let nextOffsetIndex = 0;
  // 同一セッション内で作成済みの question を「anchorId|正規化タイトル」の Set で記録する。
  // findRelatedNodes は edge 経由で近傍を引くため、「create_node × 2 → create_edge × 2」の
  // 順にモデルが呼んだとき 1 件目の edge 作成前は 2 件目の findRelatedNodes が 1 件目を
  // 拾えず重複が素通りする。セッション内 Set と併用して防ぐ。
  const sessionQuestionKeys = new Set<string>();
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = CreateNodeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const { adoptAs, title, body, x, y, additional } = parsed.data;

    // coderef のとき filePath を正規化して additional に戻し、さらに近接 coderef を探して重複ガード。
    // deps.codebaseId があれば additional に必ず注入し、adopt 時に codebaseId 必須検証が通るようにする。
    let normalizedAdditional = additional;
    if (adoptAs === 'coderef') {
      const base = additional ?? {};
      const withCb: Record<string, unknown> =
        deps.codebaseId !== undefined && base.codebaseId === undefined
          ? { ...base, codebaseId: deps.codebaseId }
          : { ...base };
      const fp = withCb.filePath;
      if (typeof fp === 'string' && fp.length > 0) {
        const normalized = normalizeFilePath(fp);
        withCb.filePath = normalized;
        const sl = withCb.startLine;
        if (typeof sl === 'number') {
          const activeCbId =
            typeof withCb.codebaseId === 'string' ? (withCb.codebaseId as string) : undefined;
          const dup = await findDuplicateCoderef(deps.store, normalized, sl, activeCbId);
          if (dup) {
            return {
              ok: false,
              output: `重複: ${dup.id} と近接 (filePath=${normalized}, startLine 差=${Math.abs(dup.startLine - sl)})`,
            };
          }
        }
      }
      normalizedAdditional = withCb;
    }

    // adoptAs=question: options の正規化 + 有効数チェック + anchor 重複ガード。
    // AI は { text } だけ渡す (仕様)。id / selected 指定があっても上書きする (信頼境界)。
    // options < 2 件の proposal は「決定不能な question」になるのでサーバ側で弾く。
    // sessionKey は addNode 成功後に set へ追加する (失敗時の汚染回避)。
    let sessionKey: string | null = null;
    if (adoptAs === 'question') {
      const rawOptions = additional?.options;
      const normalizedOptions = Array.isArray(rawOptions)
        ? rawOptions
            .map((opt) => {
              const text =
                typeof opt === 'object' && opt !== null && 'text' in opt
                  ? String((opt as { text: unknown }).text ?? '')
                  : String(opt ?? '');
              return { id: newQuestionOptionId(), text: text.trim(), selected: false };
            })
            .filter((o) => o.text.length > 0)
        : [];
      if (normalizedOptions.length < QUESTION_MIN_OPTIONS) {
        return {
          ok: false,
          output: `options は最低 ${QUESTION_MIN_OPTIONS} 個の非空 text を要求します (受け取り: ${normalizedOptions.length} 個)`,
        };
      }
      normalizedAdditional = {
        ...(additional ?? {}),
        options: normalizedOptions,
        decision: null,
      };

      // anchor の近傍に同タイトル question (正規 or proposal) があれば重複として弾く。
      // 比較は [AI] 接頭辞を剥がして揃える。
      const normalizedTitle = stripAiPrefix(title);
      sessionKey = `${deps.anchorId}|${normalizedTitle}`;
      if (sessionQuestionKeys.has(sessionKey)) {
        return {
          ok: false,
          output: `重複 (同一セッション内): anchor ${deps.anchorId} に既に同タイトル question を生成済み`,
        };
      }
      const neighbors = await deps.store.findRelatedNodes(deps.anchorId);
      const dup = neighbors.find((n) => {
        const rec = n as unknown as { type: string; adoptAs?: string; title: string };
        const isQuestion =
          rec.type === 'question' || (rec.type === 'proposal' && rec.adoptAs === 'question');
        return isQuestion && stripAiPrefix(rec.title) === normalizedTitle;
      });
      if (dup) {
        return {
          ok: false,
          output: `重複: anchor ${deps.anchorId} に既に同タイトル question 候補 ${(dup as { id: string }).id} が存在`,
        };
      }
    }

    const ensuredTitle = title.startsWith('[AI]') ? title : `[AI] ${title}`;
    const idx = nextOffsetIndex++;
    const placedX = x ?? deps.anchor.x + 260 + idx * 20;
    const placedY = y ?? deps.anchor.y + idx * 120;

    try {
      const created = (await deps.store.addNode({
        ...(normalizedAdditional ?? {}),
        type: 'proposal',
        x: placedX,
        y: placedY,
        title: ensuredTitle,
        body,
        adoptAs,
        sourceAgentId: deps.agentName,
      } as Parameters<typeof deps.store.addNode>[0])) as ProposalNode;
      deps.emit({ type: 'node_created', node: created });
      if (sessionKey) sessionQuestionKeys.add(sessionKey);
      return { ok: true, output: JSON.stringify(created) };
    } catch (err) {
      return { ok: false, output: `addNode failed: ${String(err)}` };
    }
  };
}
