import { describe, expect, it } from 'vitest';

import type { QuestionNode } from '../types';
import { getSelectedOption, isDecided } from './question';

function makeQuestion(overrides: Partial<QuestionNode>): QuestionNode {
  return {
    id: 'q-1',
    type: 'question',
    x: 0,
    y: 0,
    title: 'title',
    body: 'body',
    options: [
      { id: 'a', text: 'A', selected: false },
      { id: 'b', text: 'B', selected: false },
    ],
    decision: null,
    ...overrides,
  };
}

describe('isDecided / getSelectedOption', () => {
  it('decision が null なら未決定', () => {
    const q = makeQuestion({ decision: null });
    expect(isDecided(q)).toBe(false);
    expect(getSelectedOption(q)).toBeNull();
  });

  it('decision が undefined (プロパティなし) でも未決定', () => {
    const q = makeQuestion({});
    (q as { decision?: unknown }).decision = undefined;
    expect(isDecided(q)).toBe(false);
  });

  it('存在する option ID を指していれば決定済み', () => {
    const q = makeQuestion({ decision: 'b' });
    expect(isDecided(q)).toBe(true);
    expect(getSelectedOption(q)?.text).toBe('B');
  });

  it('存在しない option ID は未決定扱い (不整合 YAML を弾く)', () => {
    const q = makeQuestion({ decision: 'zzz' });
    expect(isDecided(q)).toBe(false);
    expect(getSelectedOption(q)).toBeNull();
  });

  it('options が空でも落ちない', () => {
    const q = makeQuestion({ options: [], decision: 'a' });
    expect(isDecided(q)).toBe(false);
  });
});
