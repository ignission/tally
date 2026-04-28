import type { ProjectStore } from '@tally/storage';
import { beforeEach, describe, expect, it } from 'vitest';

import { __resetGuardsForTest, type DuplicateGuardContext } from './index';
import { sourceUrlGuard } from './source-url';

function makeCtx(
  nodes: ReadonlyArray<Record<string, unknown>>,
  override: Partial<DuplicateGuardContext> = {},
): DuplicateGuardContext {
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

describe('sourceUrlGuard', () => {
  beforeEach(() => __resetGuardsForTest());

  it('adoptAs は "requirement"', () => {
    expect(sourceUrlGuard.adoptAs).toBe('requirement');
  });

  it('sourceUrl が additional に無ければ skip (null)', async () => {
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: undefined },
      makeCtx([]),
    );
    expect(res).toBeNull();
  });

  it('sourceUrl が空文字なら skip (null)', async () => {
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: '' } },
      makeCtx([]),
    );
    expect(res).toBeNull();
  });

  it('同 sourceUrl の正規 requirement が既にあれば重複', async () => {
    const ctx = makeCtx([{ id: 'r1', type: 'requirement', sourceUrl: 'https://jira.test/EPIC-1' }]);
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(res?.reason).toContain('r1');
    expect(res?.reason).toContain('https://jira.test/EPIC-1');
  });

  it('同 sourceUrl の proposal(adoptAs=requirement) も重複検知対象', async () => {
    const ctx = makeCtx([
      { id: 'p1', type: 'proposal', adoptAs: 'requirement', sourceUrl: 'https://jira.test/EPIC-1' },
    ]);
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(res?.reason).toContain('p1');
  });

  it('別 sourceUrl なら重複ではない', async () => {
    const ctx = makeCtx([{ id: 'r1', type: 'requirement', sourceUrl: 'https://jira.test/EPIC-1' }]);
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-2' } },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('他 type のノード (例 usecase) は無視', async () => {
    const ctx = makeCtx([{ id: 'u1', type: 'usecase', sourceUrl: 'https://jira.test/EPIC-1' }]);
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(res).toBeNull();
  });

  it('sessionMemo に記録済みなら重複 (連続生成防止)', async () => {
    const memo = new Set(['sourceUrl:https://jira.test/EPIC-1']);
    const ctx = makeCtx([], { sessionMemo: memo });
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(res?.reason).toContain('同一セッション');
  });

  it('chat 経路 (anchorId="") でも sourceUrl で重複検知 — T1 fix の核', async () => {
    const ctx = makeCtx(
      [{ id: 'r1', type: 'requirement', sourceUrl: 'https://jira.test/EPIC-1' }],
      { anchorId: '' },
    );
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(res?.reason).toContain('r1');
  });

  it('onCreated で sessionMemo にキーを追加', () => {
    const memo = new Set<string>();
    const ctx = makeCtx([], { sessionMemo: memo });
    sourceUrlGuard.onCreated?.(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(memo.has('sourceUrl:https://jira.test/EPIC-1')).toBe(true);
  });

  it('onCreated は sourceUrl が無いときは何もしない', () => {
    const memo = new Set<string>();
    const ctx = makeCtx([], { sessionMemo: memo });
    sourceUrlGuard.onCreated?.({ title: 'R', body: '', additional: undefined }, ctx);
    expect(memo.size).toBe(0);
  });

  it('onCreated は sourceUrl が空文字なら何もしない', () => {
    const memo = new Set<string>();
    const ctx = makeCtx([], { sessionMemo: memo });
    sourceUrlGuard.onCreated?.({ title: 'R', body: '', additional: { sourceUrl: '' } }, ctx);
    expect(memo.size).toBe(0);
  });

  // CodeRabbit 指摘 (PR #18): sourceUrl を生値のまま比較していたため、
  // 前後空白付き入力 (" https://... ") が同一 URL の重複検知をすり抜けていた。
  // trim 正規化を入れて、入力側も既存ノード側も揃えてから比較する。
  it('sourceUrl の前後空白は正規化して既存ノードと比較する (重複検知)', async () => {
    const ctx = makeCtx([{ id: 'r1', type: 'requirement', sourceUrl: 'https://jira.test/EPIC-1' }]);
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: '  https://jira.test/EPIC-1  ' } },
      ctx,
    );
    expect(res).not.toBeNull();
  });

  it('既存ノード側の sourceUrl に前後空白があっても正規化して比較する', async () => {
    const ctx = makeCtx([
      { id: 'r1', type: 'requirement', sourceUrl: '  https://jira.test/EPIC-1  ' },
    ]);
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: 'https://jira.test/EPIC-1' } },
      ctx,
    );
    expect(res).not.toBeNull();
  });

  it('sourceUrl が空白のみなら skip (null)', async () => {
    const res = await sourceUrlGuard.check(
      { title: 'R', body: '', additional: { sourceUrl: '   ' } },
      makeCtx([]),
    );
    expect(res).toBeNull();
  });

  it('onCreated でも trim した値が memo に入る', () => {
    const memo = new Set<string>();
    const ctx = makeCtx([], { sessionMemo: memo });
    sourceUrlGuard.onCreated?.(
      { title: 'R', body: '', additional: { sourceUrl: '  https://jira.test/EPIC-X  ' } },
      ctx,
    );
    expect(memo.has('sourceUrl:https://jira.test/EPIC-X')).toBe(true);
  });
});
