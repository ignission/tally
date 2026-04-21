import { describe, expect, it } from 'vitest';

import type { UserStoryNode } from '../types';
import { computeStoryProgress, isStoryComplete } from './story';

function makeStory(overrides: Partial<UserStoryNode> = {}): UserStoryNode {
  return {
    id: 'story-1',
    type: 'userstory',
    x: 0,
    y: 0,
    title: 's',
    body: 'b',
    ...overrides,
  };
}

describe('computeStoryProgress', () => {
  it('AC とタスクの進捗を独立に返す', () => {
    const s = makeStory({
      acceptanceCriteria: [
        { id: 'a1', text: 't', done: true },
        { id: 'a2', text: 't', done: false },
      ],
      tasks: [
        { id: 't1', text: 't', done: true },
        { id: 't2', text: 't', done: true },
      ],
    });
    const p = computeStoryProgress(s);
    expect(p.acceptance).toEqual({ total: 2, done: 1, ratio: 0.5 });
    expect(p.tasks).toEqual({ total: 2, done: 2, ratio: 1 });
  });

  it('空なら total=0, ratio=0', () => {
    const p = computeStoryProgress(makeStory());
    expect(p.acceptance).toEqual({ total: 0, done: 0, ratio: 0 });
    expect(p.tasks).toEqual({ total: 0, done: 0, ratio: 0 });
  });
});

describe('isStoryComplete', () => {
  it('AC とタスクがすべて done なら完了', () => {
    const s = makeStory({
      acceptanceCriteria: [{ id: 'a1', text: 't', done: true }],
      tasks: [{ id: 't1', text: 't', done: true }],
    });
    expect(isStoryComplete(s)).toBe(true);
  });

  it('どれか未完了なら未完了', () => {
    const s = makeStory({
      acceptanceCriteria: [{ id: 'a1', text: 't', done: false }],
      tasks: [{ id: 't1', text: 't', done: true }],
    });
    expect(isStoryComplete(s)).toBe(false);
  });

  it('中身が空のストーリーは未完了扱い', () => {
    expect(isStoryComplete(makeStory())).toBe(false);
  });
});
