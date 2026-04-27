import { stripAiPrefix } from '@tally/core';

import type { DuplicateGuard } from './index';

// 既存 create-node.ts の question 用重複ガード (sessionQuestionKeys + findRelatedNodes) を移行。
//
// T1 fix の前提: chat 経由 (anchorId が空) ではこの guard は skip し、
// Task 9 の sourceUrl guard が代替で重複検知する。
//
// 比較方針:
// - title は stripAiPrefix で "[AI]" prefix を剥がしてから比較 (AI 提案と人間生成の混在対応)
// - 同セッション内の連続生成は sessionMemo (anchorId|normalizedTitle) で短絡防止
// - DB 側は anchor の近傍 (findRelatedNodes) を引き、同タイトルの正規 question or
//   proposal(adoptAs=question) があれば重複扱い
export const questionGuard: DuplicateGuard = {
  adoptAs: 'question',
  async check(input, ctx) {
    // T1: anchorId が空なら skip (chat 経路で findRelatedNodes('') は空配列)
    if (!ctx.anchorId) return null;

    const normalizedTitle = stripAiPrefix(input.title);
    const sessionKey = `${ctx.anchorId}|${normalizedTitle}`;
    if (ctx.sessionMemo.has(sessionKey)) {
      return {
        reason: `重複 (同一セッション内): anchor ${ctx.anchorId} に既に同タイトル question を生成済み`,
      };
    }

    const neighbors = await ctx.store.findRelatedNodes(ctx.anchorId);
    for (const n of neighbors) {
      const rec = n as unknown as { id: string; type: string; adoptAs?: string; title: string };
      const isQuestion =
        rec.type === 'question' || (rec.type === 'proposal' && rec.adoptAs === 'question');
      if (isQuestion && stripAiPrefix(rec.title) === normalizedTitle) {
        return {
          reason: `重複: anchor ${ctx.anchorId} に既に同タイトル question 候補 ${rec.id} が存在`,
        };
      }
    }
    return null;
  },
  onCreated(input, ctx) {
    // anchor 無し (chat) では memo しない (T1 fix の対称)
    if (!ctx.anchorId) return;
    const normalizedTitle = stripAiPrefix(input.title);
    ctx.sessionMemo.add(`${ctx.anchorId}|${normalizedTitle}`);
  },
};
