import { describe, expect, it } from 'vitest';

import { stripAiPrefix } from './prefix';

describe('stripAiPrefix', () => {
  it('先頭の [AI] と前後空白を 1 回だけ除去する', () => {
    expect(stripAiPrefix('[AI] ストーリー分解案')).toBe('ストーリー分解案');
    expect(stripAiPrefix('  [AI]   案件')).toBe('案件');
    expect(stripAiPrefix('[AI]案件')).toBe('案件');
  });

  it('プレフィックスが無ければそのまま返す', () => {
    expect(stripAiPrefix('通常のタイトル')).toBe('通常のタイトル');
  });

  it('中盤の [AI] は消さない', () => {
    expect(stripAiPrefix('設計 [AI] レビュー')).toBe('設計 [AI] レビュー');
  });

  it('[AI] が連続していても 1 回のみ除去する', () => {
    expect(stripAiPrefix('[AI] [AI] タイトル')).toBe('[AI] タイトル');
  });
});
