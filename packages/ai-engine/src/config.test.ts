import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

describe('loadConfig', () => {
  it('デフォルト PORT は 5050 (4000/4001 は ark 等と衝突するため避ける)', () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(5050);
  });

  it('AI_ENGINE_PORT を解釈する', () => {
    const cfg = loadConfig({ AI_ENGINE_PORT: '4321' });
    expect(cfg.port).toBe(4321);
  });

  it('不正な PORT は Error', () => {
    expect(() => loadConfig({ AI_ENGINE_PORT: 'abc' })).toThrow();
  });
});
