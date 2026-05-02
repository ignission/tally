import type { AgentName } from '@tally/core';
import type { OAuthStore, ProjectStore } from '@tally/storage';

import { AGENT_REGISTRY } from './agents/registry';
import { buildMcpServers } from './mcp/build-mcp-servers';
import type { AgentEvent, SdkMessageLike } from './stream';
import { sdkMessageToAgentEvent } from './stream';
import { buildTallyMcpServer } from './tools';

export interface StartRequest {
  type: 'start';
  agent: AgentName;
  projectId: string;
  input: unknown;
}

// Streaming input mode 用の最小 SDKUserMessage 形状 (実 SDK の SDKUserMessage を duck-type 化)。
// MCP HTTP transport の OAuth 状態を turn 跨ぎで保持したい場合は、
// 1 query に AsyncIterable<SdkUserMessageLike> を渡し続ける必要がある。
export interface SdkUserMessageLike {
  type: 'user';
  message: { role: 'user'; content: string };
  parent_tool_use_id: null;
  session_id?: string;
}

// SDK Query は AsyncIterable<SdkMessageLike> + 任意の close() を持つハンドル。
// 実 SDK の Query 型 (interrupt / setMcpServers / streamInput / close) のうち、
// chat-runner が触るのは close のみなので最小化して受ける。
export interface SdkQueryHandle extends AsyncIterable<SdkMessageLike> {
  close?(): void;
}

// Agent SDK との結合点だけ抽象化する。query は AsyncIterable<SdkMessageLike> を返すこと。
// 実 SDK の厳密な型 (Options, SDKMessage) に合わせず duck typing で受けるのは、
// テスト時に mockSdk を差し込めるようにするため。
// SDK 実体のシグネチャは `query({ prompt, options })` なので、systemPrompt / mcpServers /
// allowedTools / cwd / settingSources / permissionMode はすべて options 内に入れる必要がある。
export interface SdkLike {
  query(opts: {
    // 単発 (agent-runner) は文字列、chat (multi-turn) は AsyncIterable で push 流す。
    prompt: string | AsyncIterable<SdkUserMessageLike>;
    options?: {
      systemPrompt?: string;
      mcpServers?: Record<string, unknown>;
      // tools: SDK における「built-in ツール (Bash/Read/Glob/Grep/Edit/Write 等) の
      // 使用可能リスト」。[] なら built-in 完全オフ。これが実質的な whitelist。
      // MCP ツール (mcp__tally__*) はここでは指定せず mcpServers で供給する。
      tools?: string[];
      // allowedTools は「自動承認リスト」。block list ではない。
      // MCP ツールを含めて自動承認させるためここに並べる。
      allowedTools?: string[];
      disallowedTools?: string[];
      cwd?: string;
      // 横断機能用: cwd 以外に filesystem tools (Read/Glob/Grep) が走査してよいディレクトリ群。
      // Claude Agent SDK の additionalDirectories オプションに対応。
      additionalDirectories?: string[];
      settingSources?: string[];
      permissionMode?: 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk';
      // SDK が bundle 内 native binary を探すが、OS/libc mismatch (musl vs glibc) で
      // 解決に失敗するケースがある。明示的にシステムの claude CLI パスを渡すと回避できる。
      pathToClaudeCodeExecutable?: string;
    };
  }): SdkQueryHandle;
}

export interface RunAgentDeps {
  sdk: SdkLike;
  store: ProjectStore;
  // ADR-0011 PR-E4: 外部 MCP の Authorization header 注入用に、buildMcpServers が
  // FileSystemOAuthStore.read を叩く。agent-runner は per-request に store を渡される。
  oauthStore: OAuthStore;
  projectDir: string;
  req: StartRequest;
}

// 指定された StartRequest を実行し、進捗を AgentEvent として順次 yield する。
// 事前バリデーション (agent 名 / 入力 schema / ノード存在 / ノード型 / codebases[0] 等) は
// registry のエージェント定義に委ねてから SDK を起動する。
// SDK 呼び出し中に MCP ツールハンドラが emit した side events (node_created など) は
// 次の SDK メッセージを受け取るタイミングで合流して flush する。
export async function* runAgent(deps: RunAgentDeps): AsyncGenerator<AgentEvent> {
  const { sdk, store, oauthStore, projectDir, req } = deps;
  yield { type: 'start', agent: req.agent, input: req.input };

  const def = AGENT_REGISTRY[req.agent];
  if (!def) {
    yield { type: 'error', code: 'bad_request', message: `未知の agent: ${req.agent}` };
    return;
  }

  const parsed = def.inputSchema.safeParse(req.input);
  if (!parsed.success) {
    yield { type: 'error', code: 'bad_request', message: `入力が不正: ${parsed.error.message}` };
    return;
  }

  // AGENT_REGISTRY[req.agent] は AgentName ごとの AgentDefinition の union となり、
  // validateInput の input 型は各エージェント入力型の intersection になる。
  // 実際には req.agent に対応する def の inputSchema で既に safeParse 済みのため unknown 経由でキャストする。
  const vr = await def.validateInput({ store, projectDir }, parsed.data as unknown as never);
  if (!vr.ok) {
    yield { type: 'error', code: vr.code, message: vr.message };
    return;
  }
  const anchor = vr.anchor;
  const cwd = vr.cwd;
  const additionalCwds = vr.additionalCwds;
  const codebaseId = vr.codebaseId;

  const sideEvents: AgentEvent[] = [];
  const mcp = buildTallyMcpServer({
    store,
    emit: (e) => sideEvents.push(e),
    anchor: anchor ? { x: anchor.x, y: anchor.y } : { x: 0, y: 0 },
    anchorId: anchor?.id ?? '',
    agentName: req.agent,
    ...(vr.codebaseId !== undefined ? { codebaseId: vr.codebaseId } : {}),
  });

  const prompt = def.buildPrompt({
    ...(anchor !== undefined ? { anchor } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(additionalCwds !== undefined ? { additionalCwds } : {}),
    ...(codebaseId !== undefined ? { codebaseId } : {}),
    input: parsed.data,
  });
  try {
    // Task 15: プロジェクト設定の mcpServers[] を毎ターン読み込み、buildMcpServers で
    // Tally MCP と外部 MCP (Atlassian 等) を合成する。chat-runner と同じ utility を共有。
    // env 未設定時は throw → catch で error event に流す。
    const projectMeta = await store.getProjectMeta();
    const externalConfigs = projectMeta?.mcpServers ?? [];
    const { mcpServers, allowedTools: externalAllowed } = await buildMcpServers({
      tallyMcp: mcp,
      configs: externalConfigs,
      oauthStore,
    });

    // built-in ツールは mcp__ プレフィックスを持たないもの (Read / Glob / Grep など)。
    // options.tools = 実質的な built-in 使用可能リスト。[] を渡せば Bash/Edit/Write 等すべてオフ。
    const builtInTools = def.allowedTools.filter((t) => !t.startsWith('mcp__'));
    // agent 固有の allowedTools (Tally MCP の具体 tool 名 + built-in) に、外部 MCP の wildcard
    // (mcp__<id>__*) を合流。tally の wildcard は agent 側に既に具体名で並んでいるので除外して dedup。
    const finalAllowedTools = [
      ...def.allowedTools,
      ...externalAllowed.filter((t) => t !== 'mcp__tally__*'),
    ];

    const iter = sdk.query({
      prompt: prompt.userPrompt,
      options: {
        systemPrompt: prompt.systemPrompt,
        mcpServers,
        // built-in ツールは registry で宣言した範囲のみ許可。
        // これで find-related-code に Bash / Edit / Write 等が使われなくなる。
        tools: builtInTools,
        // MCP ツール (mcp__tally__* + 外部 MCP wildcard) を自動承認する。
        allowedTools: finalAllowedTools,
        // 承認リスト外は拒否。built-in 側は tools で絞っているので二重ガード。
        permissionMode: 'dontAsk',
        // cwd は find-related-code のコード探索スコープ。未指定エージェントは SDK デフォルト。
        ...(cwd !== undefined ? { cwd } : {}),
        // 横断機能用: additionalCwds も filesystem tools から読める状態にする。
        ...(additionalCwds !== undefined ? { additionalDirectories: additionalCwds } : {}),
        // 外部設定 (~/.claude/settings.json 等) は読み込まず、agent ごとの allowedTools を
        // 厳格な whitelist として運用する。
        settingSources: [],
        // SDK bundled binary が OS/libc に合わない (musl arm64 が glibc 環境に入る等) ときの
        // フォールバック。CLAUDE_CODE_PATH 環境変数で system claude CLI を指す。
        ...(process.env.CLAUDE_CODE_PATH
          ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH }
          : {}),
      },
    });
    for await (const msg of iter) {
      while (sideEvents.length > 0) {
        const e = sideEvents.shift();
        if (e) yield e;
      }
      for (const evt of sdkMessageToAgentEvent(msg)) {
        yield evt;
      }
    }
    while (sideEvents.length > 0) {
      const e = sideEvents.shift();
      if (e) yield e;
    }
  } catch (err) {
    yield {
      type: 'error',
      code: 'agent_failed',
      message: String(err),
    };
  }
}
