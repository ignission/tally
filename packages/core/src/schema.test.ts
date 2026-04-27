import { describe, expect, it } from 'vitest';

import {
  ChatBlockSchema,
  ChatMessageSchema,
  ChatThreadMetaSchema,
  ChatThreadSchema,
  CodebaseSchema,
  CodeRefNodeSchema,
  EdgeSchema,
  McpServerConfigSchema,
  NodeSchema,
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

describe('CodebaseSchema', () => {
  it('id / label / path を必須で受け入れる', () => {
    const input = { id: 'frontend', label: 'TaskFlow Web', path: '/abs/path' };
    expect(CodebaseSchema.parse(input)).toEqual(input);
  });

  it('id が空文字は拒否', () => {
    expect(() => CodebaseSchema.parse({ id: '', label: 'x', path: '/abs' })).toThrow();
  });

  it('id は kebab-case 英小文字 32 字以内', () => {
    expect(() => CodebaseSchema.parse({ id: 'Frontend', label: 'x', path: '/abs' })).toThrow();
    expect(() => CodebaseSchema.parse({ id: 'a'.repeat(33), label: 'x', path: '/abs' })).toThrow();
    expect(CodebaseSchema.parse({ id: 'a', label: 'x', path: '/abs' }).id).toBe('a');
  });
});

describe('ProjectMetaSchema (刷新後)', () => {
  it('codebases: Codebase[] を必須で受け入れる (空配列可)', () => {
    const meta = {
      id: 'proj-abc',
      name: 'p',
      codebases: [],
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    };
    expect(ProjectMetaSchema.parse(meta).codebases).toEqual([]);
  });

  it('codebasePath / additionalCodebasePaths を受け入れない', () => {
    const meta = {
      id: 'proj-abc',
      name: 'p',
      codebases: [],
      codebasePath: '/x',
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    };
    const parsed = ProjectMetaSchema.parse(meta);
    expect('codebasePath' in parsed).toBe(false);
  });

  it('codebases[].id の重複を拒否', () => {
    const meta = {
      id: 'proj-abc',
      name: 'p',
      codebases: [
        { id: 'dup', label: 'A', path: '/a' },
        { id: 'dup', label: 'B', path: '/b' },
      ],
      createdAt: '2026-04-21T00:00:00Z',
      updatedAt: '2026-04-21T00:00:00Z',
    };
    expect(() => ProjectMetaSchema.parse(meta)).toThrow(/codebases\[\]\.id/);
  });
});

describe('CodeRefNodeSchema (codebaseId 必須化)', () => {
  const base = { id: 'c-1', x: 0, y: 0, title: 't', body: 'b', type: 'coderef' as const };

  it('codebaseId 必須', () => {
    expect(() => CodeRefNodeSchema.parse(base)).toThrow();
  });

  it('codebaseId があれば合格', () => {
    expect(CodeRefNodeSchema.parse({ ...base, codebaseId: 'frontend' }).codebaseId).toBe(
      'frontend',
    );
  });

  it('codebaseId が空文字は拒否', () => {
    expect(() => CodeRefNodeSchema.parse({ ...base, codebaseId: '' })).toThrow();
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
      codebaseId: 'frontend',
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
      codebaseId: 'frontend',
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

describe('McpServerConfigSchema', () => {
  it('Cloud (basic) auth の round-trip が通る', () => {
    const raw = {
      id: 'atlassian-cloud',
      name: 'Atlassian Cloud',
      kind: 'atlassian' as const,
      url: 'https://mcp.atlassian.example/v1/mcp',
      auth: {
        type: 'pat' as const,
        scheme: 'basic' as const,
        emailEnvVar: 'ATLASSIAN_EMAIL',
        tokenEnvVar: 'ATLASSIAN_API_TOKEN',
      },
      options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
    };
    const parsed = McpServerConfigSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  it('Server/DC (bearer) auth の round-trip が通る', () => {
    const raw = {
      id: 'atlassian-onprem',
      name: 'Atlassian On-Prem',
      kind: 'atlassian' as const,
      url: 'https://jira.example.com/mcp',
      auth: {
        type: 'pat' as const,
        scheme: 'bearer' as const,
        tokenEnvVar: 'JIRA_PAT',
      },
      options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
    };
    const parsed = McpServerConfigSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  it('basic で emailEnvVar 無しは fail', () => {
    expect(() =>
      McpServerConfigSchema.parse({
        id: 'a',
        name: 'A',
        kind: 'atlassian',
        url: 'https://x.test/mcp',
        auth: { type: 'pat', scheme: 'basic', tokenEnvVar: 'T' },
      }),
    ).toThrow();
  });

  it('options 未指定なら default が入る', () => {
    const parsed = McpServerConfigSchema.parse({
      id: 'a',
      name: 'A',
      kind: 'atlassian',
      url: 'https://x.test/mcp',
      auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'X_PAT' },
    });
    expect(parsed.options.maxChildIssues).toBe(30);
    expect(parsed.options.maxCommentsPerIssue).toBe(5);
  });

  it('url が URL でないと fail', () => {
    expect(() =>
      McpServerConfigSchema.parse({
        id: 'a',
        name: 'A',
        kind: 'atlassian',
        url: 'not a url',
        auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'X' },
      }),
    ).toThrow();
  });
});

describe('McpServerConfigSchema hardening', () => {
  // hardening test の共通 valid base。テスト対象のフィールドだけを上書きする。
  const validBase = {
    id: 'atlassian',
    name: 'Atlassian',
    kind: 'atlassian' as const,
    url: 'https://mcp.atlassian.example/v1/mcp',
    auth: {
      type: 'pat' as const,
      scheme: 'bearer' as const,
      tokenEnvVar: 'JIRA_PAT',
    },
  };

  describe('url: https 強制 + loopback 例外', () => {
    it('https スキームは pass', () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, url: 'https://x.test/mcp' }),
      ).not.toThrow();
    });

    it('http://localhost は pass (sooperset セルフホスト想定)', () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, url: 'http://localhost:9000/mcp' }),
      ).not.toThrow();
    });

    it('http://127.0.0.1 は pass', () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, url: 'http://127.0.0.1:9000/mcp' }),
      ).not.toThrow();
    });

    it('http://example.com は fail (cleartext で credential が漏れる)', () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, url: 'http://example.com/mcp' }),
      ).toThrow();
    });

    it('ftp:// は fail', () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, url: 'ftp://x.test/mcp' }),
      ).toThrow();
    });
  });

  describe('id: charset 制約 (CodebaseSchema.id と同じ regex)', () => {
    it("'atlassian' は pass", () => {
      expect(() => McpServerConfigSchema.parse({ ...validBase, id: 'atlassian' })).not.toThrow();
    });

    it("'atlassian-cloud' は pass", () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, id: 'atlassian-cloud' }),
      ).not.toThrow();
    });

    it("'a' は pass (1 文字)", () => {
      expect(() => McpServerConfigSchema.parse({ ...validBase, id: 'a' })).not.toThrow();
    });

    it("'Atlassian' は fail (大文字)", () => {
      expect(() => McpServerConfigSchema.parse({ ...validBase, id: 'Atlassian' })).toThrow();
    });

    it("'1abc' は fail (数字始まり)", () => {
      expect(() => McpServerConfigSchema.parse({ ...validBase, id: '1abc' })).toThrow();
    });

    it("'a_b' は fail (アンダースコア含む)", () => {
      expect(() => McpServerConfigSchema.parse({ ...validBase, id: 'a_b' })).toThrow();
    });

    it("'a.b' は fail (ドット含む)", () => {
      expect(() => McpServerConfigSchema.parse({ ...validBase, id: 'a.b' })).toThrow();
    });

    it('33 文字は fail (上限超過)', () => {
      expect(() => McpServerConfigSchema.parse({ ...validBase, id: 'a'.repeat(33) })).toThrow();
    });
  });

  describe('emailEnvVar / tokenEnvVar: env var 名 regex', () => {
    const baseBasic = {
      ...validBase,
      auth: {
        type: 'pat' as const,
        scheme: 'basic' as const,
        emailEnvVar: 'ATLASSIAN_EMAIL',
        tokenEnvVar: 'ATLASSIAN_API_TOKEN',
      },
    };

    it("'ATLASSIAN_PAT' は pass", () => {
      expect(() =>
        McpServerConfigSchema.parse({
          ...validBase,
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'ATLASSIAN_PAT' },
        }),
      ).not.toThrow();
    });

    it("'JIRA_PAT_1' は pass (数字含む OK)", () => {
      expect(() =>
        McpServerConfigSchema.parse({
          ...validBase,
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT_1' },
        }),
      ).not.toThrow();
    });

    it("'A' は pass (1 文字大文字)", () => {
      expect(() =>
        McpServerConfigSchema.parse({
          ...validBase,
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'A' },
        }),
      ).not.toThrow();
    });

    it("'lowercase' は fail", () => {
      expect(() =>
        McpServerConfigSchema.parse({
          ...validBase,
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'lowercase' },
        }),
      ).toThrow();
    });

    it("'foo@bar.com' は fail (実値混入を防ぐ)", () => {
      expect(() =>
        McpServerConfigSchema.parse({
          ...baseBasic,
          auth: {
            type: 'pat',
            scheme: 'basic',
            emailEnvVar: 'foo@bar.com',
            tokenEnvVar: 'ATLASSIAN_API_TOKEN',
          },
        }),
      ).toThrow();
    });

    it("'1ABC' は fail (数字始まり)", () => {
      expect(() =>
        McpServerConfigSchema.parse({
          ...validBase,
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: '1ABC' },
        }),
      ).toThrow();
    });

    it("'' (空文字) は fail", () => {
      expect(() =>
        McpServerConfigSchema.parse({
          ...validBase,
          auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: '' },
        }),
      ).toThrow();
    });

    it('basic auth の emailEnvVar も同じ regex を要求', () => {
      expect(() =>
        McpServerConfigSchema.parse({
          ...baseBasic,
          auth: {
            type: 'pat',
            scheme: 'basic',
            emailEnvVar: 'lowercase',
            tokenEnvVar: 'ATLASSIAN_API_TOKEN',
          },
        }),
      ).toThrow();
    });
  });
});
