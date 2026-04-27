import type { ProjectStore } from '@tally/storage';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetGuardsForTest,
  type DuplicateGuard,
  type DuplicateGuardContext,
  dispatchDuplicateGuard,
  notifyCreated,
  registerGuard,
} from './index';

const fakeStore = {
  listNodes: async () => [],
  findRelatedNodes: async () => [],
} as unknown as ProjectStore;

const baseCtx: DuplicateGuardContext = {
  store: fakeStore,
  anchorId: '',
  sessionMemo: new Set<string>(),
};

beforeEach(() => {
  __resetGuardsForTest();
});

describe('dispatchDuplicateGuard', () => {
  it('登録された guard が無い adoptAs は null を返す', async () => {
    const result = await dispatchDuplicateGuard(
      'requirement',
      { title: 't', body: '', additional: undefined },
      baseCtx,
    );
    expect(result).toBeNull();
  });

  it('guard が DuplicateFound を返したら dispatcher も同じものを返す', async () => {
    const stubGuard: DuplicateGuard = {
      adoptAs: 'usecase',
      check: async () => ({ reason: '重複: stub' }),
    };
    registerGuard(stubGuard);
    const result = await dispatchDuplicateGuard(
      'usecase',
      { title: 't', body: '', additional: undefined },
      baseCtx,
    );
    expect(result?.reason).toBe('重複: stub');
  });

  it('複数 guard が同じ adoptAs に登録された場合、最初に重複を検知したものが返る', async () => {
    const guardA: DuplicateGuard = {
      adoptAs: 'userstory',
      check: async () => null,
    };
    const guardB: DuplicateGuard = {
      adoptAs: 'userstory',
      check: async () => ({ reason: 'B が検知' }),
    };
    registerGuard(guardA);
    registerGuard(guardB);
    const result = await dispatchDuplicateGuard(
      'userstory',
      { title: 't', body: '', additional: undefined },
      baseCtx,
    );
    expect(result?.reason).toBe('B が検知');
  });

  it('全 guard が null なら null を返す', async () => {
    const guardA: DuplicateGuard = {
      adoptAs: 'issue',
      check: async () => null,
    };
    const guardB: DuplicateGuard = {
      adoptAs: 'issue',
      check: async () => null,
    };
    registerGuard(guardA);
    registerGuard(guardB);
    const result = await dispatchDuplicateGuard(
      'issue',
      { title: 't', body: '', additional: undefined },
      baseCtx,
    );
    expect(result).toBeNull();
  });
});

describe('notifyCreated', () => {
  it('登録された guard の onCreated が呼ばれる', async () => {
    const calls: string[] = [];
    const guard: DuplicateGuard = {
      adoptAs: 'coderef',
      check: async () => null,
      onCreated: (input) => {
        calls.push(input.title);
      },
    };
    registerGuard(guard);
    notifyCreated('coderef', { title: 'T1', body: '', additional: undefined }, baseCtx);
    expect(calls).toEqual(['T1']);
  });

  it('onCreated が無い guard では何も起きない (例外も出ない)', async () => {
    const guard: DuplicateGuard = {
      adoptAs: 'question',
      check: async () => null,
    };
    registerGuard(guard);
    expect(() =>
      notifyCreated('question', { title: 'T2', body: '', additional: undefined }, baseCtx),
    ).not.toThrow();
  });

  it('登録 guard が無い adoptAs では何も起きない', () => {
    expect(() =>
      notifyCreated('coderef', { title: 'T3', body: '', additional: undefined }, baseCtx),
    ).not.toThrow();
  });
});
