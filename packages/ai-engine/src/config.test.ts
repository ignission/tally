import { describe, expect, it } from 'vitest';

import { loadConfig } from './config';

describe('loadConfig', () => {
  it('デフォルト PORT は 3322 (3321 frontend の隣、他プロジェクトと衝突しがちな 3000/4000/4001/5050 を避ける)', () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(3322);
  });

  it('AI_ENGINE_PORT を解釈する', () => {
    const cfg = loadConfig({ AI_ENGINE_PORT: '4321' });
    expect(cfg.port).toBe(4321);
  });

  it('不正な PORT は Error', () => {
    expect(() => loadConfig({ AI_ENGINE_PORT: 'abc' })).toThrow();
  });
});
