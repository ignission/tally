import { describe, expect, it } from 'vitest';

import { EDGE_META, NODE_META, PACKAGE_NAME } from './index';

describe('@tally/core', () => {
  it('パッケージ名を公開している', () => {
    expect(PACKAGE_NAME).toBe('@tally/core');
  });

  it('NODE_META が 7 種揃っている', () => {
    expect(Object.keys(NODE_META).sort()).toEqual(
      ['coderef', 'issue', 'proposal', 'question', 'requirement', 'usecase', 'userstory'].sort(),
    );
  });

  it('EDGE_META が 6 種揃っている', () => {
    expect(Object.keys(EDGE_META).sort()).toEqual(
      ['contain', 'derive', 'refine', 'satisfy', 'trace', 'verify'].sort(),
    );
  });
});
