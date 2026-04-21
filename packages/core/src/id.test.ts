import { describe, expect, it } from 'vitest';

import {
  newChatId,
  newChatMessageId,
  newEdgeId,
  newNodeId,
  newProjectId,
  newQuestionOptionId,
  newToolUseId,
} from './id';

describe('newNodeId', () => {
  it('型プレフィックス付きの ID を返す', () => {
    expect(newNodeId('requirement')).toMatch(/^req-[a-zA-Z0-9]{10}$/);
    expect(newNodeId('question')).toMatch(/^q-[a-zA-Z0-9]{10}$/);
    expect(newNodeId('coderef')).toMatch(/^code-[a-zA-Z0-9]{10}$/);
    expect(newNodeId('proposal')).toMatch(/^prop-[a-zA-Z0-9]{10}$/);
  });

  it('連続呼び出しで衝突しない', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      ids.add(newNodeId('usecase'));
    }
    expect(ids.size).toBe(1000);
  });
});

describe('newEdgeId / newProjectId', () => {
  it('それぞれ専用プレフィックスを返す', () => {
    expect(newEdgeId()).toMatch(/^e-[a-zA-Z0-9]{10}$/);
    expect(newProjectId()).toMatch(/^proj-[a-zA-Z0-9]{10}$/);
  });
});

describe('newQuestionOptionId', () => {
  it('opt- プレフィックス + 10 文字 (英数字) を返す', () => {
    const id = newQuestionOptionId();
    expect(id.startsWith('opt-')).toBe(true);
    expect(id.length).toBe(4 + 10);
    expect(id.slice(4)).toMatch(/^[A-Za-z0-9]+$/);
  });

  it('連続呼び出しでほぼ衝突しない (10 回生成が全て異なる)', () => {
    const ids = new Set(Array.from({ length: 10 }, () => newQuestionOptionId()));
    expect(ids.size).toBe(10);
  });
});

describe('newChatId / newChatMessageId / newToolUseId', () => {
  it('chat- / msg- / tool- プレフィックス + 10 文字サフィックス', () => {
    expect(newChatId()).toMatch(/^chat-[a-zA-Z0-9]{10}$/);
    expect(newChatMessageId()).toMatch(/^msg-[a-zA-Z0-9]{10}$/);
    expect(newToolUseId()).toMatch(/^tool-[a-zA-Z0-9]{10}$/);
  });

  it('連続呼び出しで衝突しない (10 件)', () => {
    const ids = new Set(Array.from({ length: 10 }, () => newChatId()));
    expect(ids.size).toBe(10);
  });
});
