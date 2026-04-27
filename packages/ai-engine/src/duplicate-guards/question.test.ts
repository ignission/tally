import type { ProjectStore } from '@tally/storage';
import { beforeEach, describe, expect, it } from 'vitest';

import { __resetGuardsForTest, type DuplicateGuardContext } from './index';
import { questionGuard } from './question';

function makeCtx(
  neighbors: ReadonlyArray<Record<string, unknown>>,
  override: Partial<DuplicateGuardContext> = {},
): DuplicateGuardContext {
  const ctx: DuplicateGuardContext = {
    store: {
      listNodes: async () => [],
      findRelatedNodes: async () => neighbors as never,
    } as unknown as ProjectStore,
    anchorId: 'anchor-1',
    sessionMemo: new Set<string>(),
    ...override,
  };
  return ctx;
}

describe('questionGuard', () => {
  beforeEach(() => __resetGuardsForTest());

  it('adoptAs は "question"', () => {
    expect(questionGuard.adoptAs).toBe('question');
  });

  it('anchorId が空なら skip (null を返す) — T1 fix の前提', async () => {
    const ctx = makeCtx([], { anchorId: '' });
    const res = await questionGuard.check(
      { title: '[AI] Q', body: '', additional: undefined },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('同 anchor に同タイトル正規 question が既にあれば重複', async () => {
    const ctx = makeCtx([{ id: 'q1', type: 'question', title: 'どうするか' }]);
    const res = await questionGuard.check(
      { title: '[AI] どうするか', body: '', additional: undefined },
      ctx,
    );
    expect(res?.reason).toContain('q1');
    expect(res?.reason).toContain('anchor-1');
  });

  it('同 anchor に同タイトル proposal (adoptAs=question) が既にあれば重複', async () => {
    const ctx = makeCtx([
      { id: 'p1', type: 'proposal', adoptAs: 'question', title: '[AI] どうするか' },
    ]);
    const res = await questionGuard.check(
      { title: 'どうするか', body: '', additional: undefined },
      ctx,
    );
    expect(res?.reason).toContain('p1');
  });

  it('[AI] prefix の有無を吸収して比較する', async () => {
    const ctx = makeCtx([{ id: 'q1', type: 'question', title: '[AI] どうするか' }]);
    const res = await questionGuard.check(
      { title: 'どうするか', body: '', additional: undefined },
      ctx,
    );
    expect(res?.reason).toContain('q1');
  });

  it('sessionMemo に同 anchor+title が記録済みなら重複 (同セッション内の連続生成防止)', async () => {
    const ctx = makeCtx([], { sessionMemo: new Set(['anchor-1|どうするか']) });
    const res = await questionGuard.check(
      { title: '[AI] どうするか', body: '', additional: undefined },
      ctx,
    );
    expect(res?.reason).toContain('同一セッション');
    expect(res?.reason).toContain('anchor-1');
  });

  it('別タイトルなら重複ではない', async () => {
    const ctx = makeCtx([{ id: 'q1', type: 'question', title: 'どうするか' }]);
    const res = await questionGuard.check(
      { title: '[AI] 別の論点', body: '', additional: undefined },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('近傍に他 type のノード (例 usecase) は無視', async () => {
    const ctx = makeCtx([{ id: 'u1', type: 'usecase', title: 'どうするか' }]);
    const res = await questionGuard.check(
      { title: '[AI] どうするか', body: '', additional: undefined },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('onCreated が anchorId+title を sessionMemo に追加', () => {
    const memo = new Set<string>();
    const ctx = makeCtx([], { sessionMemo: memo });
    questionGuard.onCreated?.({ title: '[AI] 新しい論点', body: '', additional: undefined }, ctx);
    expect(memo.has('anchor-1|新しい論点')).toBe(true);
  });

  it('onCreated は anchorId が空なら何もしない', () => {
    const memo = new Set<string>();
    const ctx = makeCtx([], { anchorId: '', sessionMemo: memo });
    questionGuard.onCreated?.({ title: '[AI] X', body: '', additional: undefined }, ctx);
    expect(memo.size).toBe(0);
  });
});
