import { describe, expect, it } from 'vitest';

import {
  ChatBlockSchema,
  ChatMessageSchema,
  ChatThreadMetaSchema,
  ChatThreadSchema,
  CodeRefNodeSchema,
  EdgeSchema,
  NodeSchema,
  ProjectMetaPatchSchema,
  ProjectMetaSchema,
  ProposalNodeSchema,
  QuestionNodeSchema,
  RequirementNodeSchema,
  UserStoryNodeSchema,
} from './schema';

describe('NodeSchema (discriminated union)', () => {
  it('requirement ノード (kind/priority/qualityCategory) を受理する', () => {
    const raw = {
      id: 'req-expiry',
      type: 'requirement',
      x: 40,
      y: 480,
      title: '有効期限の管理',
      body: 'セキュリティのため招待リンクに有効期限を設けたい。',
      kind: 'non_functional',
      qualityCategory: 'security',
      priority: 'should',
    };
    const parsed = NodeSchema.parse(raw);
    expect(parsed.type).toBe('requirement');
    if (parsed.type === 'requirement') {
      expect(parsed.kind).toBe('non_functional');
      expect(parsed.qualityCategory).toBe('security');
      expect(parsed.priority).toBe('should');
    }
  });

  it('question ノードの decision: null を受理する (未決定)', () => {
    const raw = {
      id: 'q-link-expiry',
      type: 'question',
      x: 340,
      y: 440,
      title: '招待リンクの有効期限',
      body: 'どのくらいで失効させる?',
      options: [
        { id: 'opt_24h', text: '24時間', selected: false },
        { id: 'opt_7d', text: '7日間', selected: false },
      ],
      decision: null,
    };
    const parsed = QuestionNodeSchema.parse(raw);
    expect(parsed.decision).toBeNull();
    expect(parsed.options).toHaveLength(2);
  });

  it('未知の type は弾く', () => {
    const raw = {
      id: 'x',
      type: 'unknown',
      x: 0,
      y: 0,
      title: 't',
      body: 'b',
    };
    expect(() => NodeSchema.parse(raw)).toThrow();
  });

  it('requirement の priority に不正値を入れると弾く', () => {
    const raw = {
      id: 'req-1',
      type: 'requirement',
      x: 0,
      y: 0,
      title: 't',
      body: 'b',
      priority: 'urgent',
    };
    expect(() => RequirementNodeSchema.parse(raw)).toThrow();
  });

  it('userstory の points は正の整数のみ受理する', () => {
    const valid = {
      id: 'story-1',
      type: 'userstory',
      x: 0,
      y: 0,
      title: 't',
      body: 'b',
      points: 5,
    };
    expect(UserStoryNodeSchema.parse(valid).points).toBe(5);

    const invalid = { ...valid, points: -1 };
    expect(() => UserStoryNodeSchema.parse(invalid)).toThrow();

    const fractional = { ...valid, points: 1.5 };
    expect(() => UserStoryNodeSchema.parse(fractional)).toThrow();
  });
});

describe('EdgeSchema', () => {
  it('SysML 2.0 準拠の6種のみ受理する', () => {
    for (const type of ['satisfy', 'contain', 'derive', 'refine', 'verify', 'trace']) {
      expect(() => EdgeSchema.parse({ id: 'e1', from: 'a', to: 'b', type })).not.toThrow();
    }
    expect(() => EdgeSchema.parse({ id: 'e1', from: 'a', to: 'b', type: 'realizes' })).toThrow();
  });
});

describe('ProposalNodeSchema passthrough', () => {
  it('未知フィールド (filePath 等) を保持する', () => {
    const parsed = ProposalNodeSchema.parse({
      id: 'prop-1',
      type: 'proposal',
      x: 0,
      y: 0,
      title: '[AI] s',
      body: '',
      adoptAs: 'coderef',
      filePath: 'src/foo.ts',
      startLine: 10,
      endLine: 20,
    });
    expect((parsed as Record<string, unknown>).filePath).toBe('src/foo.ts');
    expect((parsed as Record<string, unknown>).startLine).toBe(10);
    expect((parsed as Record<string, unknown>).endLine).toBe(20);
  });
});

describe('ProjectMetaSchema', () => {
  it('description と codebasePath を省略できる', () => {
    const parsed = ProjectMetaSchema.parse({
      id: 'proj1',
      name: '招待機能',
      createdAt: '2026-04-18T10:00:00Z',
      updatedAt: '2026-04-18T10:00:00Z',
    });
    expect(parsed.description).toBeUndefined();
    expect(parsed.codebasePath).toBeUndefined();
  });

  it('空の name は弾く', () => {
    expect(() =>
      ProjectMetaSchema.parse({
        id: 'proj1',
        name: '',
        createdAt: '2026-04-18T10:00:00Z',
        updatedAt: '2026-04-18T10:00:00Z',
      }),
    ).toThrow();
  });
});

describe('ProjectMetaPatchSchema', () => {
  it('codebasePath: string を受理する', () => {
    const r = ProjectMetaPatchSchema.safeParse({ codebasePath: '../backend' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.codebasePath).toBe('../backend');
  });

  it('codebasePath: null を削除シグナルとして受理する', () => {
    const r = ProjectMetaPatchSchema.safeParse({ codebasePath: null });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.codebasePath).toBeNull();
  });

  it('空オブジェクトも受理する (no-op patch)', () => {
    const r = ProjectMetaPatchSchema.safeParse({});
    expect(r.success).toBe(true);
  });

  it('未知フィールドは strict で弾く', () => {
    const r = ProjectMetaPatchSchema.safeParse({ name: 'x' });
    expect(r.success).toBe(false);
  });

  it('codebasePath に number は受理しない', () => {
    const r = ProjectMetaPatchSchema.safeParse({ codebasePath: 42 });
    expect(r.success).toBe(false);
  });
});

describe('CodeRefNodeSchema summary/impact', () => {
  it('summary と impact を持つ coderef をパースできる', () => {
    const parsed = CodeRefNodeSchema.parse({
      id: 'cref-1',
      type: 'coderef',
      x: 0,
      y: 0,
      title: 'src/a.ts:10',
      body: '何かの説明',
      filePath: 'src/a.ts',
      startLine: 10,
      endLine: 20,
      summary: '招待の送信ロジック',
      impact: 'テンプレ差し替えが必要',
    });
    expect(parsed.summary).toBe('招待の送信ロジック');
    expect(parsed.impact).toBe('テンプレ差し替えが必要');
  });

  it('summary と impact は optional (従来の coderef も読める)', () => {
    const parsed = CodeRefNodeSchema.parse({
      id: 'cref-2',
      type: 'coderef',
      x: 0,
      y: 0,
      title: 's',
      body: '',
    });
    expect(parsed.summary).toBeUndefined();
    expect(parsed.impact).toBeUndefined();
  });
});

describe('ChatBlockSchema', () => {
  it('text ブロック', () => {
    expect(ChatBlockSchema.safeParse({ type: 'text', text: 'hi' }).success).toBe(true);
  });
  it('tool_use ブロック (approval pending)', () => {
    expect(
      ChatBlockSchema.safeParse({
        type: 'tool_use',
        toolUseId: 'tool-1',
        name: 'mcp__tally__create_node',
        input: { adoptAs: 'requirement', title: 'X', body: '' },
        approval: 'pending',
      }).success,
    ).toBe(true);
  });
  it('tool_result ブロック', () => {
    expect(
      ChatBlockSchema.safeParse({
        type: 'tool_result',
        toolUseId: 'tool-1',
        ok: true,
        output: '{}',
      }).success,
    ).toBe(true);
  });
  it('不正な type は reject', () => {
    expect(ChatBlockSchema.safeParse({ type: 'other', text: 'x' }).success).toBe(false);
  });
});

describe('ChatMessageSchema', () => {
  it('user text メッセージ', () => {
    const msg = {
      id: 'msg-1',
      role: 'user',
      blocks: [{ type: 'text', text: '要求追加' }],
      createdAt: '2026-04-20T00:00:00Z',
    };
    expect(ChatMessageSchema.safeParse(msg).success).toBe(true);
  });
  it('role が system は reject (永続化しない)', () => {
    const msg = {
      id: 'msg-1',
      role: 'system',
      blocks: [],
      createdAt: '2026-04-20T00:00:00Z',
    };
    expect(ChatMessageSchema.safeParse(msg).success).toBe(false);
  });
});

describe('ChatThreadSchema / ChatThreadMetaSchema', () => {
  it('最小のスレッドをパース', () => {
    expect(
      ChatThreadSchema.safeParse({
        id: 'chat-1',
        projectId: 'proj-1',
        title: 'test',
        messages: [],
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      }).success,
    ).toBe(true);
  });
  it('Meta は messages を持たない', () => {
    expect(
      ChatThreadMetaSchema.safeParse({
        id: 'chat-1',
        projectId: 'proj-1',
        title: 'test',
        createdAt: '2026-04-20T00:00:00Z',
        updatedAt: '2026-04-20T00:00:00Z',
      }).success,
    ).toBe(true);
  });
});
