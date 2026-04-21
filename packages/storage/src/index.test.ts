import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';

describe('@tally/storage', () => {
  it('パッケージ名を公開している', () => {
    expect(PACKAGE_NAME).toBe('@tally/storage');
  });
});
