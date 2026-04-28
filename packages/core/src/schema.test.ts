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
  ProjectSchema,
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
  it('auth_request ブロック (pending)', () => {
    const r = ChatBlockSchema.safeParse({
      type: 'auth_request',
      mcpServerId: 'atlassian',
      mcpServerLabel: 'Atlassian',
      authUrl: 'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc',
      status: 'pending',
    });
    expect(r.success).toBe(true);
  });
  it('auth_request ブロック (failed + failureMessage)', () => {
    const r = ChatBlockSchema.safeParse({
      type: 'auth_request',
      mcpServerId: 'atlassian',
      mcpServerLabel: 'Atlassian',
      authUrl: 'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc',
      status: 'failed',
      failureMessage: 'invalid_grant',
    });
    expect(r.success).toBe(true);
  });
  it('auth_request の authUrl が URL でないと reject', () => {
    const r = ChatBlockSchema.safeParse({
      type: 'auth_request',
      mcpServerId: 'atlassian',
      mcpServerLabel: 'Atlassian',
      authUrl: 'not-a-url',
      status: 'pending',
    });
    expect(r.success).toBe(false);
  });
  // CodeRabbit 指摘 (PR #18): auth_request の status と failureMessage の整合を schema で固定。
  // failed なのに failureMessage 無し → reject。pending/completed に failureMessage が
  // 付いている → reject。
  it('auth_request: failed に failureMessage 無しは reject', () => {
    const r = ChatBlockSchema.safeParse({
      type: 'auth_request',
      mcpServerId: 'atlassian',
      mcpServerLabel: 'Atlassian',
      authUrl: 'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc',
      status: 'failed',
    });
    expect(r.success).toBe(false);
  });
  it('auth_request: pending に failureMessage 付きは reject', () => {
    const r = ChatBlockSchema.safeParse({
      type: 'auth_request',
      mcpServerId: 'atlassian',
      mcpServerLabel: 'Atlassian',
      authUrl: 'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc',
      status: 'pending',
      failureMessage: 'should not be here',
    });
    expect(r.success).toBe(false);
  });
  it('auth_request: completed に failureMessage 付きは reject', () => {
    const r = ChatBlockSchema.safeParse({
      type: 'auth_request',
      mcpServerId: 'atlassian',
      mcpServerLabel: 'Atlassian',
      authUrl: 'https://mcp.atlassian.com/v1/authorize?response_type=code&client_id=abc',
      status: 'completed',
      failureMessage: 'should not be here',
    });
    expect(r.success).toBe(false);
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
  // OAuth 2.1 採用後、Tally は url のみ持ち auth credentials は MCP/SDK に委譲する。
  // よって round-trip の最小形は id/name/kind/url/options のみ。
  it('atlassian round-trip (auth credentials は MCP/SDK 任せ、Tally は url のみ)', () => {
    const raw = {
      id: 'atlassian-cloud',
      name: 'Atlassian Cloud',
      kind: 'atlassian' as const,
      url: 'https://mcp.atlassian.example/v1/mcp',
      options: { maxChildIssues: 30, maxCommentsPerIssue: 5 },
    };
    const parsed = McpServerConfigSchema.parse(raw);
    expect(parsed).toEqual(raw);
  });

  it('options 未指定なら default が入る', () => {
    const parsed = McpServerConfigSchema.parse({
      id: 'a',
      name: 'A',
      kind: 'atlassian',
      url: 'https://x.test/mcp',
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
      }),
    ).toThrow();
  });

  it('auth フィールドが付いていても strict ではないので無視される (passthrough)', () => {
    // schema 上は auth キーを持たない。zod は default で strict ではないため余計なキーは drop。
    // OAuth 移行前の YAML が混入しても parse 自体は通すが、auth 情報は使われない。
    const parsed = McpServerConfigSchema.parse({
      id: 'a',
      name: 'A',
      kind: 'atlassian',
      url: 'https://x.test/mcp',
      auth: { type: 'pat', scheme: 'bearer', tokenEnvVar: 'JIRA_PAT' }, // 余計なキー
    } as Record<string, unknown>);
    expect((parsed as unknown as { auth?: unknown }).auth).toBeUndefined();
  });
});

describe('McpServerConfigSchema hardening', () => {
  // hardening test の共通 valid base。テスト対象のフィールドだけを上書きする。
  const validBase = {
    id: 'atlassian',
    name: 'Atlassian',
    kind: 'atlassian' as const,
    url: 'https://mcp.atlassian.example/v1/mcp',
  };

  describe('url: https 強制 + loopback 例外', () => {
    it('https スキームは pass', () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, url: 'https://x.test/mcp' }),
      ).not.toThrow();
    });

    it('http://localhost は pass (セルフホスト MCP server 想定)', () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, url: 'http://localhost:9000/mcp' }),
      ).not.toThrow();
    });

    it('http://127.0.0.1 は pass', () => {
      expect(() =>
        McpServerConfigSchema.parse({ ...validBase, url: 'http://127.0.0.1:9000/mcp' }),
      ).not.toThrow();
    });

    it('http://example.com は fail (OAuth handshake / token を cleartext で運ばない)', () => {
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
});

describe('ProjectSchema.mcpServers', () => {
  it('mcpServers 未指定なら default の空配列', () => {
    const p = ProjectSchema.parse({
      id: 'p',
      name: 'P',
      codebases: [],
      createdAt: '2026-04-24T00:00:00Z',
      updatedAt: '2026-04-24T00:00:00Z',
      nodes: [],
      edges: [],
    });
    expect(p.mcpServers).toEqual([]);
  });

  it('mcpServers 指定で round-trip する', () => {
    const input = {
      id: 'p',
      name: 'P',
      codebases: [],
      createdAt: '2026-04-24T00:00:00Z',
      updatedAt: '2026-04-24T00:00:00Z',
      nodes: [],
      edges: [],
      mcpServers: [
        {
          id: 'atlassian',
          name: 'A',
          kind: 'atlassian' as const,
          url: 'https://x.test/mcp',
        },
      ],
    };
    const p = ProjectSchema.parse(input);
    expect(p.mcpServers).toHaveLength(1);
    expect(p.mcpServers[0]?.options.maxChildIssues).toBe(30);
    expect(p.mcpServers[0]?.id).toBe('atlassian');
  });
});

describe('ProjectMetaSchema.mcpServers', () => {
  it('ProjectMetaSchema にも mcpServers が乗る (project.yaml の meta との整合)', () => {
    const meta = ProjectMetaSchema.parse({
      id: 'p',
      name: 'P',
      codebases: [],
      createdAt: '2026-04-24T00:00:00Z',
      updatedAt: '2026-04-24T00:00:00Z',
      mcpServers: [
        {
          id: 'atlassian',
          name: 'A',
          kind: 'atlassian' as const,
          url: 'https://x.test/mcp',
        },
      ],
    });
    expect(meta.mcpServers).toHaveLength(1);
  });

  it('既存 YAML (mcpServers 無し) は default [] で読める (後方互換)', () => {
    const meta = ProjectMetaSchema.parse({
      id: 'p',
      name: 'P',
      codebases: [],
      createdAt: '2026-04-24T00:00:00Z',
      updatedAt: '2026-04-24T00:00:00Z',
    });
    expect(meta.mcpServers).toEqual([]);
  });
});

describe('ChatBlockSchema.tool_use.source', () => {
  it('source 未指定の古いデータが "internal" に defaults', () => {
    const b = ChatBlockSchema.parse({
      type: 'tool_use',
      toolUseId: 'tu-1',
      name: 'mcp__tally__create_node',
      input: { x: 1 },
      approval: 'approved',
    });
    expect(b.type).toBe('tool_use');
    if (b.type === 'tool_use') expect(b.source).toBe('internal');
  });

  it('source = "external" は承認不要 (approval optional)', () => {
    const b = ChatBlockSchema.parse({
      type: 'tool_use',
      toolUseId: 'tu-2',
      name: 'mcp__atlassian__jira_get_issue',
      input: { issueKey: 'EPIC-1' },
      source: 'external',
    });
    if (b.type === 'tool_use') {
      expect(b.source).toBe('external');
      expect(b.approval).toBeUndefined();
    }
  });

  it('source = "external" + approval 指定もできる (任意で記録可)', () => {
    const b = ChatBlockSchema.parse({
      type: 'tool_use',
      toolUseId: 'tu-3',
      name: 'mcp__atlassian__jira_search',
      input: {},
      source: 'external',
      approval: 'approved',
    });
    if (b.type === 'tool_use') {
      expect(b.source).toBe('external');
      expect(b.approval).toBe('approved');
    }
  });

  it('source = "internal" で approval 無しは fail', () => {
    expect(() =>
      ChatBlockSchema.parse({
        type: 'tool_use',
        toolUseId: 'tu-4',
        name: 'mcp__tally__create_node',
        input: {},
        source: 'internal',
      }),
    ).toThrow();
  });

  it('source 未指定 (= internal default) で approval 無しは fail', () => {
    expect(() =>
      ChatBlockSchema.parse({
        type: 'tool_use',
        toolUseId: 'tu-5',
        name: 'mcp__tally__create_node',
        input: {},
      }),
    ).toThrow();
  });

  it('既存の internal + approval=pending/approved/rejected は引き続き valid', () => {
    for (const a of ['pending', 'approved', 'rejected'] as const) {
      const b = ChatBlockSchema.parse({
        type: 'tool_use',
        toolUseId: `tu-${a}`,
        name: 'mcp__tally__create_node',
        input: {},
        approval: a,
      });
      if (b.type === 'tool_use') {
        expect(b.source).toBe('internal');
        expect(b.approval).toBe(a);
      }
    }
  });

  it('source の不正値 (例 "auto") は fail', () => {
    expect(() =>
      ChatBlockSchema.parse({
        type: 'tool_use',
        toolUseId: 'tu-bad',
        name: 'mcp__tally__create_node',
        input: {},
        source: 'auto',
        approval: 'approved',
      }),
    ).toThrow();
  });
});

describe('RequirementNodeSchema.sourceUrl', () => {
  it('sourceUrl 未指定は optional (既存互換)', () => {
    const n = RequirementNodeSchema.parse({
      id: 'n',
      type: 'requirement',
      x: 0,
      y: 0,
      title: 'R',
      body: '',
    });
    expect(n.sourceUrl).toBeUndefined();
  });

  it('sourceUrl 指定で保持', () => {
    const n = RequirementNodeSchema.parse({
      id: 'n',
      type: 'requirement',
      x: 0,
      y: 0,
      title: 'R',
      body: '',
      sourceUrl: 'https://jira.test/browse/EPIC-1',
    });
    expect(n.sourceUrl).toBe('https://jira.test/browse/EPIC-1');
  });

  it('sourceUrl が URL でないと fail', () => {
    expect(() =>
      RequirementNodeSchema.parse({
        id: 'n',
        type: 'requirement',
        x: 0,
        y: 0,
        title: 'R',
        body: '',
        sourceUrl: 'not a url',
      }),
    ).toThrow();
  });

  it('sourceUrl が http:// なら fail (https 強制、UI link でも cleartext は禁止)', () => {
    expect(() =>
      RequirementNodeSchema.parse({
        id: 'n',
        type: 'requirement',
        x: 0,
        y: 0,
        title: 'R',
        body: '',
        sourceUrl: 'http://jira.test/browse/EPIC-1',
      }),
    ).toThrow();
  });

  it('sourceUrl が https:// なら pass', () => {
    const n = RequirementNodeSchema.parse({
      id: 'n',
      type: 'requirement',
      x: 0,
      y: 0,
      title: 'R',
      body: '',
      sourceUrl: 'https://jira.test/browse/EPIC-1',
    });
    expect(n.sourceUrl).toBe('https://jira.test/browse/EPIC-1');
  });

  it('sourceUrl が ftp:// なら fail', () => {
    expect(() =>
      RequirementNodeSchema.parse({
        id: 'n',
        type: 'requirement',
        x: 0,
        y: 0,
        title: 'R',
        body: '',
        sourceUrl: 'ftp://jira.test/EPIC-1',
      }),
    ).toThrow();
  });
});
