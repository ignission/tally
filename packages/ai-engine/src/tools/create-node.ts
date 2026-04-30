import path from 'node:path';

import type { AdoptableType, AgentName, ProposalNode } from '@tally/core';
import { newQuestionOptionId } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import {
  type DuplicateGuardContext,
  dispatchDuplicateGuard,
  notifyCreated,
} from '../duplicate-guards/index';
import type { AgentEvent } from '../stream';

// create_node: ツールハンドラ。AI は proposal しか作れない (ADR-0005 前提)。
// adoptAs は「採用されたら何になるか」を宣言。title に [AI] プレフィックスが無ければ自動付与。
// x/y 未指定時は呼び出し元が与える anchor 座標を基準に自動オフセット配置。
//
// 重複検知は duplicate-guards/ の strategy map に委譲 (Task 6-9 で抽出)。
// ここでは「保存内容の整合性」だけ責任を持つ:
//   - coderef の filePath 正規化と codebaseId 注入 (DB に書く値そのものを揃える)
//   - question の options 正規化と min 2 検証 (採用後 decision 不能を防ぐ)
//   - dispatcher 呼び出し → addNode → notifyCreated

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
  additional: z.record(z.string(), z.unknown()).optional(),
});

export type CreateNodeInput = z.infer<typeof CreateNodeInputSchema>;

export interface CreateNodeDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  // anchor ノードの id。question 重複ガードで近傍を引くために使う。chat 経路は空文字。
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

// adoptAs=question の options として有効な最小数。extract-questions の仕様上
// 「必ず 2〜4 個」とプロンプト指示しているが、AI が守らなかったとき proposal
// 採用後に decision を選べない question が出来てしまうのでサーバ側でも弾く。
const QUESTION_MIN_OPTIONS = 2;

// 保存前の filePath 正規化 (guard 内の正規化とは独立、保存内容の整合性のため必須)。
// "./src/a.ts" や "src//a.ts" を "src/a.ts" に揃えて DB に書く。
function normalizeFilePathForStorage(fp: string): string {
  const stripped = fp.startsWith('./') ? fp.slice(2) : fp;
  return path.posix.normalize(stripped);
}

export function createNodeHandler(deps: CreateNodeDeps) {
  // 複数ノードが同じ anchor で作られたときに重ならないよう、呼び出しごとにオフセットをずらす。
  // agent セッション毎に独立させるため handler closure で保持。
  let nextOffsetIndex = 0;
  // duplicate-guards の sessionMemo (anchorId|title など、guard 実装が定義するキー)。
  // handler closure で持ち、同一エージェントセッション内の重複を短絡防止する。
  const sessionMemo = new Set<string>();

  return async (input: unknown): Promise<ToolResult> => {
    const parsed = CreateNodeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const { adoptAs, title, body, x, y, additional } = parsed.data;

    let normalizedAdditional = additional;

    // coderef: filePath 正規化 + codebaseId 注入。
    // 保存値の正規化なので guard 委譲とは別に必須 (DB に "./" 付きを書かない)。
    if (adoptAs === 'coderef') {
      const base = additional ?? {};
      const withCb: Record<string, unknown> =
        deps.codebaseId !== undefined && base.codebaseId === undefined
          ? { ...base, codebaseId: deps.codebaseId }
          : { ...base };
      const fp = withCb.filePath;
      if (typeof fp === 'string' && fp.length > 0) {
        withCb.filePath = normalizeFilePathForStorage(fp);
      }
      normalizedAdditional = withCb;
    }

    // adoptAs=question: options の正規化 + 有効数チェック。
    // AI は { text } だけ渡す (仕様)。id / selected 指定があっても上書きする (信頼境界)。
    // options < 2 件の proposal は「決定不能な question」になるのでサーバ側で弾く。
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
    }

    // 重複ガード: dispatcher に委譲 (coderef / question / source-url の guard が登録済み)。
    // 重複あれば early return、無ければ addNode に進む。
    // codebaseId は exactOptionalPropertyTypes 対応で条件付きで含める。
    const guardCtx: DuplicateGuardContext = {
      store: deps.store,
      anchorId: deps.anchorId,
      sessionMemo,
      ...(deps.codebaseId !== undefined ? { codebaseId: deps.codebaseId } : {}),
    };
    const guardInput = { title, body, additional: normalizedAdditional };
    const dup = await dispatchDuplicateGuard(adoptAs, guardInput, guardCtx);
    if (dup) return { ok: false, output: dup.reason };

    // 共通: ensureTitle / placement / addNode
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

      // 生成成功後、guard に通知 (sessionMemo の更新など)。失敗時は通知しない (Set 汚染回避)。
      notifyCreated(adoptAs, guardInput, guardCtx);

      return { ok: true, output: JSON.stringify(created) };
    } catch (err) {
      return { ok: false, output: `addNode failed: ${String(err)}` };
    }
  };
}
