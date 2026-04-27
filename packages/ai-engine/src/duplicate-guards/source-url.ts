import type { DuplicateGuard } from './index';

// sourceUrl ベースの重複検知。
//
// T1 fix の核: anchor 不要 → chat (anchorId='') でも動く。
// 既存 question guard は anchorId に依存して findRelatedNodes 経由で動くが、
// chat 経路では anchorId が空文字で findRelatedNodes('') が空配列を返すため重複ガードが dead。
// sourceUrl は anchor 概念がないので、グラフ全件スキャンで重複検知する。
//
// 対象:
// - 正規 requirement (`type === 'requirement'`)
// - adoptAs=requirement の proposal (`type === 'proposal' && adoptAs === 'requirement'`)
//
// memo キー: `sourceUrl:${url}` (anchor 非依存、グラフ横断で一意)
const SESSION_KEY_PREFIX = 'sourceUrl:';

export const sourceUrlGuard: DuplicateGuard = {
  adoptAs: 'requirement',
  async check(input, ctx) {
    const sourceUrl = input.additional?.sourceUrl;
    if (typeof sourceUrl !== 'string' || sourceUrl.length === 0) return null;

    const sessionKey = `${SESSION_KEY_PREFIX}${sourceUrl}`;
    if (ctx.sessionMemo.has(sessionKey)) {
      return {
        reason: `重複 (同一セッション内): sourceUrl ${sourceUrl} を既に生成済み`,
      };
    }

    const all = await ctx.store.listNodes();
    for (const n of all) {
      const rec = n as Record<string, unknown>;
      const type = rec.type as string | undefined;
      const adoptAs = rec.adoptAs as string | undefined;
      const isRequirement =
        type === 'requirement' || (type === 'proposal' && adoptAs === 'requirement');
      if (!isRequirement) continue;
      const existingUrl = rec.sourceUrl as string | undefined;
      if (existingUrl === sourceUrl) {
        const id = rec.id as string;
        return {
          reason: `重複: sourceUrl ${sourceUrl} は既に node ${id} が保持`,
        };
      }
    }
    return null;
  },
  onCreated(input, ctx) {
    const sourceUrl = input.additional?.sourceUrl;
    if (typeof sourceUrl === 'string' && sourceUrl.length > 0) {
      ctx.sessionMemo.add(`${SESSION_KEY_PREFIX}${sourceUrl}`);
    }
  },
};
