import type { ProjectStore } from '@tally/storage';
import { beforeEach, describe, expect, it } from 'vitest';

import { coderefGuard } from './coderef';
import { __resetGuardsForTest, type DuplicateGuardContext } from './index';

function makeCtx(
  nodes: ReadonlyArray<Record<string, unknown>>,
  override: Partial<DuplicateGuardContext> = {},
): DuplicateGuardContext {
  // 注: exactOptionalPropertyTypes のため codebaseId は明示 undefined にせず、
  // override で指定された場合のみ広げる。
  return {
    store: {
      listNodes: async () => nodes as never,
      findRelatedNodes: async () => [],
    } as unknown as ProjectStore,
    anchorId: '',
    sessionMemo: new Set<string>(),
    ...override,
  };
}

describe('coderefGuard', () => {
  beforeEach(() => __resetGuardsForTest());

  it('adoptAs は "coderef"', () => {
    expect(coderefGuard.adoptAs).toBe('coderef');
  });

  it('同一 filePath + 近接 startLine (±10) で重複検知', async () => {
    const ctx = makeCtx([
      { id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb1' },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T',
        body: '',
        additional: { filePath: 'src/a.ts', startLine: 105, codebaseId: 'cb1' },
      },
      ctx,
    );
    expect(res?.reason).toContain('重複');
    expect(res?.reason).toContain('n1');
  });

  it('11 行以上離れていれば重複ではない', async () => {
    const ctx = makeCtx([
      { id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb1' },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T',
        body: '',
        additional: { filePath: 'src/a.ts', startLine: 112, codebaseId: 'cb1' },
      },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('codebaseId が異なれば別物扱い (重複ではない)', async () => {
    const ctx = makeCtx([
      { id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb1' },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T',
        body: '',
        additional: { filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb2' },
      },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('input の codebaseId が無くても ctx.codebaseId が使われる', async () => {
    const ctx = makeCtx(
      [{ id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb1' }],
      { codebaseId: 'cb1' },
    );
    const res = await coderefGuard.check(
      {
        title: 'T',
        body: '',
        additional: { filePath: 'src/a.ts', startLine: 100 },
      },
      ctx,
    );
    expect(res?.reason).toContain('重複');
  });

  it('既存 codebaseId が undefined でも横断的に重複扱い (legacy migration 対応)', async () => {
    const ctx = makeCtx([
      { id: 'n_legacy', type: 'coderef', filePath: 'src/a.ts', startLine: 100 },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T',
        body: '',
        additional: { filePath: 'src/a.ts', startLine: 100, codebaseId: 'cb1' },
      },
      ctx,
    );
    expect(res?.reason).toContain('重複');
  });

  it('filePath が "./" 付きでも正規化して判定', async () => {
    const ctx = makeCtx([{ id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100 }]);
    const res = await coderefGuard.check(
      {
        title: 'T',
        body: '',
        additional: { filePath: './src/a.ts', startLine: 100 },
      },
      ctx,
    );
    expect(res?.reason).toContain('重複');
  });

  it('proposal (adoptAs="coderef") も重複検知の対象', async () => {
    const ctx = makeCtx([
      {
        id: 'p1',
        type: 'proposal',
        adoptAs: 'coderef',
        filePath: 'src/a.ts',
        startLine: 100,
      },
    ]);
    const res = await coderefGuard.check(
      {
        title: 'T',
        body: '',
        additional: { filePath: 'src/a.ts', startLine: 100 },
      },
      ctx,
    );
    expect(res?.reason).toContain('p1');
  });

  it('filePath / startLine が input に無ければ skip (null)', async () => {
    const ctx = makeCtx([{ id: 'n1', type: 'coderef', filePath: 'src/a.ts', startLine: 100 }]);
    const res = await coderefGuard.check({ title: 'T', body: '', additional: undefined }, ctx);
    expect(res).toBeNull();
  });
});
