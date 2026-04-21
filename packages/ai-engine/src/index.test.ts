import { describe, expect, it } from 'vitest';

import { PACKAGE_NAME } from './index';

describe('@tally/ai-engine', () => {
  it('パッケージ名を公開している', () => {
    expect(PACKAGE_NAME).toBe('@tally/ai-engine');
  });
});
