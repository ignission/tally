import path from 'node:path';

import type { DuplicateGuard } from './index';

// 既存 create-node.ts の findDuplicateCoderef ロジックを移行 (動作不変)。
// `find-related-code` / `analyze-impact` はスキャン位置がブレやすいので、
// 同一 filePath で ±10 行以内の近接 coderef を重複扱いする。
const CODEREF_LINE_TOLERANCE = 10;

// "./src/a.ts" や "src//a.ts" を "src/a.ts" に正規化する。
function normalizeFilePath(fp: string): string {
  const stripped = fp.startsWith('./') ? fp.slice(2) : fp;
  return path.posix.normalize(stripped);
}

export const coderefGuard: DuplicateGuard = {
  adoptAs: 'coderef',
  async check(input, ctx) {
    const additional = input.additional ?? {};
    const fp = additional.filePath;
    const sl = additional.startLine;
    if (typeof fp !== 'string' || typeof sl !== 'number') return null;

    const normalized = normalizeFilePath(fp);
    // input 側の codebaseId 優先、無ければ ctx の codebaseId を使う
    const inputCb =
      typeof additional.codebaseId === 'string' ? (additional.codebaseId as string) : undefined;
    const activeCbId = inputCb ?? ctx.codebaseId;

    const all = await ctx.store.listNodes();
    for (const n of all) {
      const rec = n as Record<string, unknown>;
      const type = rec.type as string | undefined;
      const adoptAs = rec.adoptAs as string | undefined;
      // 正規 coderef と adoptAs=coderef proposal の両方を対象
      const isCoderef = type === 'coderef' || (type === 'proposal' && adoptAs === 'coderef');
      if (!isCoderef) continue;
      const existingFp = rec.filePath as string | undefined;
      const existingSl = rec.startLine as number | undefined;
      if (!existingFp || typeof existingSl !== 'number') continue;
      if (normalizeFilePath(existingFp) !== normalized) continue;
      // マルチコードベース: 両方が codebaseId を持ち、かつ異なれば別物扱い。
      // 一方でも undefined なら従来通り全件比較 (legacy migration 対応)。
      const existingCb = rec.codebaseId as string | undefined;
      if (activeCbId !== undefined && existingCb !== undefined && existingCb !== activeCbId) {
        continue;
      }
      if (Math.abs(existingSl - sl) <= CODEREF_LINE_TOLERANCE) {
        const id = rec.id as string;
        return {
          reason: `重複: ${id} と近接 (filePath=${normalized}, startLine 差=${Math.abs(existingSl - sl)})`,
        };
      }
    }
    return null;
  },
};
