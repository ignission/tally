import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import {
  type ChatBlock,
  type ChatMessage,
  type Node,
  newChatMessageId,
  newToolUseId,
} from '@tally/core';
import type { ChatStore, ProjectStore } from '@tally/storage';

import type { SdkLike } from './agent-runner';
import { buildMcpServers } from './mcp/build-mcp-servers';
import { redactMcpSecrets } from './mcp/redact';
import type { ChatEvent, SdkMessageLike } from './stream';
import { CreateEdgeInputSchema, createEdgeHandler } from './tools/create-edge';
import { CreateNodeInputSchema, createNodeHandler } from './tools/create-node';
import { FindRelatedInputSchema, findRelatedHandler } from './tools/find-related';
import { ListByTypeInputSchema, listByTypeHandler } from './tools/list-by-type';

// ChatRunner の依存。外部から差し込める SDK と 2 つの store を取る。
// threadId は ChatRunner インスタンスのライフタイム内で不変 (スレッド切替は別インスタンス)。
export interface ChatRunnerDeps {
  sdk: SdkLike;
  chatStore: ChatStore;
  projectStore: ProjectStore;
  projectDir: string;
  threadId: string;
}

// 外部 MCP の tool_result output を YAML に永続化するときの上限 (Task 13)。
// 大規模 epic 取り込み等で 1 ターンに 500KB+ 来うるので、永続化は 4KB に切る。
// メモリ内 (event) は full を流すので、UI セッション内では全文展開可能。
// リロード後は truncated 版だけ見える (dogfooding には十分)。
const TOOL_RESULT_PERSIST_LIMIT = 4096;

function truncateForPersistence(output: string): string {
  if (output.length <= TOOL_RESULT_PERSIST_LIMIT) return output;
  const head = output.slice(0, TOOL_RESULT_PERSIST_LIMIT);
  return `${head}\n... (truncated, ${output.length} chars total)`;
}

// SDK の assistant / user message から抽出する block の単純化形。
// Tally MCP の tool_use は MCP intercept 経路で処理されるので拾わない。
// 外部 MCP (mcp__tally__ 以外) の tool_use / tool_result は永続化と UI 通知のためここで拾う (Task 12)。
type ExtractedBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; output: string };

// MCP ツール名と、そのハンドラ (承認必要かどうか) を束ねるエントリ。
// 承認必須のツールは create_* 系 (書き込み)、承認不要は find_related / list_by_type (読み取り)。
export interface ToolEntry {
  name: string;
  requiresApproval: boolean;
  handler: (input: unknown) => Promise<{ ok: boolean; output: string }>;
}

// ChatRunner は 1 スレッド分の multi-turn 対話を駆動する。
// 各 user turn を `runUserTurn` で流し、tool_use 承認は外部から `approveTool` で通知する。
//
// 重要な設計判断:
// - SDK handler 経由の tool_use_id は使わず、ChatRunner が独自に生成した ui-toolUseId を
//   承認 UI / 永続化の主キーとする (tool-<nanoid>)。
// - assistant message 内の text block は turn 末にまとめて永続化 (ストリーミング送出は逐次)。
//   tool_use / tool_result は発生都度永続化 (クラッシュ耐性重視)。
// - tool 呼び出しは createSdkMcpServer で登録した MCP 経由でのみ行う。
//   MCP ハンドラ内で invokeInterceptedTool を呼び、pending → 承認 → 実行 → result を完結させる。
//   SDK 側から見ると通常の tool 呼び出し (同期的に output を返す) に見える。
export class ChatRunner {
  private readonly deps: ChatRunnerDeps;
  // 承認待ちの Promise resolver。ui-toolUseId → (approved) => void。
  private readonly pendingApprovals = new Map<string, (approved: boolean) => void>();

  constructor(deps: ChatRunnerDeps) {
    this.deps = deps;
  }

  // 外部 (WS / UI) から呼ぶ。該当 ui-toolUseId の待機 Promise を解決する。
  // 見つからなければ無視 (重複クリックや古い id は安全に no-op)。
  approveTool(toolUseId: string, approved: boolean): void {
    const resolver = this.pendingApprovals.get(toolUseId);
    if (resolver) {
      this.pendingApprovals.delete(toolUseId);
      resolver(approved);
    }
  }

  private awaitApproval(toolUseId: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.pendingApprovals.set(toolUseId, resolve);
    });
  }

  // user の 1 ターンを実行する。
  // 1) user message を append
  // 2) 空 assistant message を append (ID 確保)
  // 3) MCP サーバを組み立てて SDK に渡し、assistant stream を iterate
  // 4) text block は buffer + delta emit。tool_use は MCP ハンドラ内で承認 intercept される。
  // 5) turn 末に text blocks を assistant message 先頭に統合
  //
  // contextNodeIds: ユーザーが「@メンション」で添付したノード ID 配列 (issue #11)。
  // ProjectStore から該当ノードを引いて prompt の <context_nodes> ブロックに埋め込む。
  // 不在 ID は無視 (削除済みノード等)。永続化はせず、毎ターンの prompt prefix としてのみ使う。
  async *runUserTurn(userText: string, contextNodeIds: string[] = []): AsyncGenerator<ChatEvent> {
    const { sdk, chatStore, projectStore, projectDir, threadId } = this.deps;

    const thread = await chatStore.getChat(threadId);
    if (!thread) {
      yield { type: 'error', code: 'not_found', message: `thread: ${threadId}` };
      return;
    }

    // 1. user message append
    const userMsgId = newChatMessageId();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      blocks: [{ type: 'text', text: userText }],
      createdAt: new Date().toISOString(),
    };
    await chatStore.appendMessage(threadId, userMsg);
    yield { type: 'chat_user_message_appended', messageId: userMsgId };

    // 2. prompt を先に組む。user message 追加直後の履歴 (末尾が user) をスナップショットし、
    //    buildChatPrompt が <current_user_message> を末尾の user message として正しく抽出できる状態で呼ぶ。
    //    これは「<context_nodes> は今ターンの user 入力より前に置く」契約 (issue #11) を守るため必須。
    //    後続で空 assistant を append すると履歴末尾が assistant になってしまい、buildChatPrompt の
    //    `last?.role === 'user'` 判定が false に倒れる (= context_nodes が user 入力の後ろに並ぶバグ) ので、
    //    必ずこの順で snapshot → prompt 組立 → 空 assistant append の順を守る。
    const threadWithUser = await chatStore.getChat(threadId);
    const contextNodes = await loadContextNodes(projectStore, contextNodeIds);
    const prompt = buildChatPrompt(threadWithUser?.messages ?? [], contextNodes);
    const systemPrompt = buildChatSystemPrompt();

    // 3. 空の assistant message を append (後続の tool_use 即時永続化の親として必要)
    //    prompt スナップショット後に行うことで、上記 buildChatPrompt の前提が崩れないようにする。
    const assistantMsgId = newChatMessageId();
    await chatStore.appendMessage(threadId, {
      id: assistantMsgId,
      role: 'assistant',
      blocks: [],
      createdAt: new Date().toISOString(),
    });
    yield { type: 'chat_assistant_message_started', messageId: assistantMsgId };

    // 4. MCP 経由で呼ばれる tool ハンドラ内で invokeInterceptedTool を回す。
    //    MCP handler は SDK query を block するので、イベント emit は AsyncQueue 経由に分離する。
    //    さもないと deadlock (SDK が MCP 応答待ち / MCP が承認待ち / 承認は UI 経由で queue flush が必要)。
    const queue = new EventQueue<ChatEvent>();
    const tools = this.buildToolRegistry();
    const emit = (e: ChatEvent) => queue.push(e);
    const mcp = this.buildMcpServer(tools, emit, assistantMsgId);

    // 4b. プロジェクト設定の mcpServers[] を Tally MCP と合成する (Task 11)。
    //     毎ターン読むことで env / 設定変更がホットリロードされる。
    //     env 未設定 (PAT 等) は buildMcpServers が throw するので、ここで補足し
    //     error event を emit して early return する (sdk.query は呼ばない)。
    const projectMeta = await projectStore.getProjectMeta();
    const externalConfigs = projectMeta?.mcpServers ?? [];
    let mcpServers: Record<string, unknown>;
    let allowedTools: string[];
    try {
      const built = buildMcpServers({ tallyMcp: mcp, configs: externalConfigs });
      mcpServers = built.mcpServers;
      allowedTools = built.allowedTools;
    } catch (err) {
      yield {
        type: 'error',
        code: 'mcp_config_invalid',
        message: err instanceof Error ? err.message : String(err),
      };
      return;
    }

    const textBuffer: string[] = [];

    // 5. SDK query をバックグラウンドで走らせ、queue にイベントを push する。
    //    generator 側は queue をドレインして yield するだけ。
    const sdkDone = (async () => {
      try {
        const iter = sdk.query({
          prompt,
          options: {
            systemPrompt,
            mcpServers,
            tools: [],
            allowedTools,
            permissionMode: 'dontAsk',
            settingSources: [],
            cwd: projectDir,
            ...(process.env.CLAUDE_CODE_PATH
              ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH }
              : {}),
          },
        });

        for await (const msg of iter) {
          console.log(
            '[chat-runner] sdk msg:',
            JSON.stringify(redactMcpSecrets(msg)).slice(0, 200),
          );
          const blocks = extractAssistantBlocks(msg);
          for (const b of blocks) {
            if (b.type === 'text') {
              textBuffer.push(b.text);
              queue.push({ type: 'chat_text_delta', messageId: assistantMsgId, text: b.text });
            } else if (b.type === 'tool_use') {
              // 外部 MCP の tool_use: source='external' で永続化、承認 UI なし (Task 12)。
              await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
                type: 'tool_use',
                toolUseId: b.toolUseId,
                name: b.name,
                input: b.input,
                source: 'external',
              });
              queue.push({
                type: 'chat_tool_external_use',
                messageId: assistantMsgId,
                toolUseId: b.toolUseId,
                name: b.name,
                input: b.input,
              });
            } else if (b.type === 'tool_result') {
              // Task 13: 大規模 epic で tool_result が 500KB+ になり得るので、
              // YAML 永続化は 4KB に切り詰める。event はフル (UI はメモリ内で全文展開可)。
              await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
                type: 'tool_result',
                toolUseId: b.toolUseId,
                ok: b.ok,
                output: truncateForPersistence(b.output),
              });
              queue.push({
                type: 'chat_tool_external_result',
                messageId: assistantMsgId,
                toolUseId: b.toolUseId,
                ok: b.ok,
                output: b.output,
              });
            }
          }
        }

        // text blocks を assistant message の先頭に統合 (tool_use/result は intercept 経路で既に append 済み)
        if (textBuffer.length > 0) {
          const current = await chatStore.getChat(threadId);
          const target = current?.messages.find((m) => m.id === assistantMsgId);
          if (current && target) {
            const textBlocks: ChatBlock[] = textBuffer.map((t) => ({ type: 'text', text: t }));
            await chatStore.replaceMessageBlocks(threadId, assistantMsgId, [
              ...textBlocks,
              ...target.blocks,
            ]);
          }
        }

        queue.push({ type: 'chat_assistant_message_completed', messageId: assistantMsgId });
        queue.push({ type: 'chat_turn_ended' });
      } catch (err) {
        queue.push({ type: 'error', code: 'agent_failed', message: String(err) });
      } finally {
        queue.finish();
      }
    })();

    // 6. queue をドレイン。MCP handler から push される pending/result も含め全て通過する。
    while (true) {
      const evt = await queue.next();
      if (evt === null) break;
      yield evt;
    }

    await sdkDone; // バックグラウンドタスクの未捕捉エラーを顕在化
  }

  // 承認 intercept + 実ツール呼び出し。
  // 非同期進行を 2 段階で公開する:
  //   - pendingEmitted: pending event (または read-only の即 result) が emit された時点で解決
  //   - done: 実行まで含めて全完了した時点で解決。MCP ハンドラはこれを await して
  //           SDK に返す CallToolResult を組み立てる。
  //
  // `public` にしてあるのは MCP ハンドラ (同ファイル内) とテストから直接呼ぶため。
  public invokeInterceptedTool(opts: {
    entry: ToolEntry;
    input: unknown;
    emit: (e: ChatEvent) => void;
    assistantMsgId: string;
  }): { pendingEmitted: Promise<void>; done: Promise<{ ok: boolean; output: string }> } {
    const { entry, input, emit, assistantMsgId } = opts;
    const { chatStore, threadId } = this.deps;

    let resolvePending!: () => void;
    const pendingEmitted = new Promise<void>((resolve) => {
      resolvePending = resolve;
    });

    const done = (async (): Promise<{ ok: boolean; output: string }> => {
      // 承認不要ツール: 実行 → tool_use(approved) + tool_result を append、pending は発火しない。
      if (!entry.requiresApproval) {
        const uiId = newToolUseId();
        const res = await entry.handler(input);
        await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
          type: 'tool_use',
          toolUseId: uiId,
          name: entry.name,
          input,
          source: 'internal',
          approval: 'approved',
        });
        await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
          type: 'tool_result',
          toolUseId: uiId,
          ok: res.ok,
          output: res.output,
        });
        emit({
          type: 'chat_tool_result',
          messageId: assistantMsgId,
          toolUseId: uiId,
          ok: res.ok,
          output: res.output,
        });
        // read-only は pending 概念が無いので pendingEmitted も result 時点で同時解決する。
        resolvePending();
        return { ok: res.ok, output: res.output };
      }

      // 書き込み系: 承認必須。先に tool_use(pending) を永続化 → pending event emit →
      // resolvePending で generator にフラッシュを委ねる → 承認待ち → 実行 → tool_result。
      const uiToolUseId = newToolUseId();
      await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
        type: 'tool_use',
        toolUseId: uiToolUseId,
        name: entry.name,
        input,
        source: 'internal',
        approval: 'pending',
      });
      emit({
        type: 'chat_tool_pending',
        messageId: assistantMsgId,
        toolUseId: uiToolUseId,
        name: entry.name,
        input,
      });
      // pending event が sideEvents に積まれた段階で generator にフラッシュ機会を渡す。
      resolvePending();

      const approved = await this.awaitApproval(uiToolUseId);

      await chatStore.updateBlockApproval(
        threadId,
        assistantMsgId,
        uiToolUseId,
        approved ? 'approved' : 'rejected',
      );

      if (!approved) {
        const output = 'ユーザー却下';
        await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
          type: 'tool_result',
          toolUseId: uiToolUseId,
          ok: false,
          output,
        });
        emit({
          type: 'chat_tool_result',
          messageId: assistantMsgId,
          toolUseId: uiToolUseId,
          ok: false,
          output,
        });
        return { ok: false, output };
      }

      const res = await entry.handler(input);
      await chatStore.appendBlockToMessage(threadId, assistantMsgId, {
        type: 'tool_result',
        toolUseId: uiToolUseId,
        ok: res.ok,
        output: res.output,
      });
      emit({
        type: 'chat_tool_result',
        messageId: assistantMsgId,
        toolUseId: uiToolUseId,
        ok: res.ok,
        output: res.output,
      });
      return { ok: res.ok, output: res.output };
    })();

    // done が reject したときに pendingEmitted が未解決で残らないようにする
    // (外側が await pendingEmitted でハングするのを防ぐ)。
    done.catch(() => resolvePending());

    return { pendingEmitted, done };
  }

  // チャットで使う tool handler を 1 つの配列に束ねる。
  // create_node / create_edge は承認必須、find_related / list_by_type は承認不要。
  // chat では anchor 概念が無いので anchor は (0,0) / anchorId は空で固定する。
  // 既存 createNodeHandler は agentName を要求するが chat 文脈に正確な agent は無いので
  // 便宜上 'decompose-to-stories' (proposal 生成系のデフォルト) を流用する。
  //
  // `public` にしてあるのは MCP 構築とテストから直接参照するため。
  public buildToolRegistry(): ToolEntry[] {
    const { projectStore } = this.deps;
    // createNodeHandler / createEdgeHandler は内部で emit を呼ぶ (node_created / edge_created)
    // が、これは AgentEvent 用で chat には不要。no-op emit を渡す。
    const createNode = createNodeHandler({
      store: projectStore,
      emit: () => {},
      anchor: { x: 0, y: 0 },
      anchorId: '',
      agentName: 'decompose-to-stories',
    });
    const createEdge = createEdgeHandler({
      store: projectStore,
      emit: () => {},
    });
    const findRelated = findRelatedHandler({ store: projectStore });
    const listByType = listByTypeHandler({ store: projectStore });

    return [
      { name: 'mcp__tally__create_node', requiresApproval: true, handler: createNode },
      { name: 'mcp__tally__create_edge', requiresApproval: true, handler: createEdge },
      { name: 'mcp__tally__find_related', requiresApproval: false, handler: findRelated },
      { name: 'mcp__tally__list_by_type', requiresApproval: false, handler: listByType },
    ];
  }

  // 4 ツール分の MCP サーバを組み立てる。
  // 各ツールの handler は invokeInterceptedTool を起動 → done の {ok, output} を
  // CallToolResult (content + isError) に包んで SDK に返す。
  // SDK 視点では通常の tool_use → tool_result の往復。
  // 間に挟まる pending / result の ChatEvent は emit callback で直接 queue に流す
  // (sideEvents buffer にすると SDK block 中に flush できず deadlock するため)。
  private buildMcpServer(tools: ToolEntry[], emit: (e: ChatEvent) => void, assistantMsgId: string) {
    const find = (name: string): ToolEntry => {
      const t = tools.find((x) => x.name === name);
      if (!t) throw new Error(`tool not registered: ${name}`);
      return t;
    };

    const makeHandler = (name: string) => async (input: unknown) => {
      const entry = find(name);
      const { done } = this.invokeInterceptedTool({ entry, input, emit, assistantMsgId });
      const result = await done;
      return {
        content: [{ type: 'text' as const, text: result.output }],
        isError: !result.ok,
      };
    };

    return createSdkMcpServer({
      name: 'tally',
      version: '0.1.0',
      tools: [
        tool(
          'create_node',
          'Tally に新しい proposal ノードを作る。adoptAs は採用時に昇格する NodeType。',
          CreateNodeInputSchema.shape,
          makeHandler('mcp__tally__create_node'),
        ),
        tool(
          'create_edge',
          'Tally に新しいエッジを作る。from/to はノード ID、type は SysML 2.0 エッジ種別。',
          CreateEdgeInputSchema.shape,
          makeHandler('mcp__tally__create_edge'),
        ),
        tool(
          'find_related',
          '与えた node id に対して直接エッジで繋がったノード一覧を返す。',
          FindRelatedInputSchema.shape,
          makeHandler('mcp__tally__find_related'),
        ),
        tool(
          'list_by_type',
          '指定した NodeType のノードを全件返す。',
          ListByTypeInputSchema.shape,
          makeHandler('mcp__tally__list_by_type'),
        ),
      ],
    });
  }
}

// --- helpers ---

// 非同期イベントキュー: push (producer 複数可) と next (consumer 1 つ前提) を提供。
// chat-runner では SDK/MCP (producer) と generator (consumer) を分離するために使う。
// finish() 後の push は無視、buffer 残りを drain しきったら next は null を返す。
class EventQueue<T> {
  private buf: T[] = [];
  private waiter: ((v: T | null) => void) | null = null;
  private finished = false;

  push(value: T): void {
    if (this.finished) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(value);
      return;
    }
    this.buf.push(value);
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(null);
    }
  }

  async next(): Promise<T | null> {
    if (this.buf.length > 0) return this.buf.shift() ?? null;
    if (this.finished) return null;
    return new Promise<T | null>((resolve) => {
      this.waiter = resolve;
    });
  }
}

function buildChatSystemPrompt(): string {
  return [
    'あなたは Tally の対話アシスタントです。',
    'ユーザーと対話しながら、キャンバスに requirement / usecase / userstory / question / issue / coderef',
    'の proposal ノードを生やし、必要に応じて satisfy / contain / derive / refine エッジを張ります。',
    '',
    '重要な方針:',
    '- 一度にノードを作りすぎない。ユーザーの意図を確認してから小刻みに create_node を呼ぶ。',
    '- create_node / create_edge は必ずユーザー承認を経る (サーバ側で承認 UI を挟む)。',
    '- 迷ったら質問する。勝手に決めない。',
    '- 既存ノード把握したい時は list_by_type / find_related を使う (承認不要)。',
    '',
    'コンテキストノード (issue #11):',
    '- prompt 内の <context_nodes> はユーザーが明示的に「このノードについて話したい」と添付したノード。',
    '- 深掘り・分割・方針変更の依頼は、その文脈ノードの id / type / title / body を踏まえて応答する。',
    '- ノードの「更新」「削除」は AI が直接行えない。代替の proposal を新たに create_node し、',
    '  ユーザーが採用するかを判断する設計 (ADR-0005)。',
  ].join('\n');
}

// ProjectStore から context node を引いて、存在するものだけ返す。
// 順序は入力配列に従う。重複 ID は最初の 1 件のみ残す。
async function loadContextNodes(store: ProjectStore, ids: readonly string[]): Promise<Node[]> {
  if (ids.length === 0) return [];
  const seen = new Set<string>();
  const out: Node[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const node = await store.getNode(id);
    if (node) out.push(node);
  }
  return out;
}

// Node を AI 向けにテキスト表現する。冗長な座標 (x/y) は省き、
// 思考に効く属性 (id/type/title/body と型固有の補助) のみを並べる。
// JSON.stringify は読みづらいので key: value の素朴な行で並べる。
export function formatNodeForContext(node: Node): string {
  const lines: string[] = [];
  lines.push(`id: ${node.id}`);
  lines.push(`type: ${node.type}`);
  if (node.title) lines.push(`title: ${node.title}`);
  if (node.body) lines.push(`body: ${node.body}`);
  if (node.type === 'requirement') {
    if (node.kind) lines.push(`kind: ${node.kind}`);
    if (node.priority) lines.push(`priority: ${node.priority}`);
    if (node.qualityCategory) lines.push(`qualityCategory: ${node.qualityCategory}`);
  } else if (node.type === 'userstory') {
    if (node.points) lines.push(`points: ${node.points}`);
    if (node.acceptanceCriteria && node.acceptanceCriteria.length > 0) {
      lines.push('acceptanceCriteria:');
      for (const ac of node.acceptanceCriteria) {
        lines.push(`  - [${ac.done ? 'x' : ' '}] ${ac.text}`);
      }
    }
    if (node.tasks && node.tasks.length > 0) {
      lines.push('tasks:');
      for (const t of node.tasks) {
        lines.push(`  - [${t.done ? 'x' : ' '}] ${t.text}`);
      }
    }
  } else if (node.type === 'question') {
    if (node.options && node.options.length > 0) {
      lines.push('options:');
      for (const o of node.options) {
        const mark = o.selected ? '*' : '-';
        lines.push(`  ${mark} ${o.text} (id=${o.id})`);
      }
    }
    if (node.decision) lines.push(`decision: ${node.decision}`);
  } else if (node.type === 'coderef') {
    if (node.filePath) lines.push(`filePath: ${node.filePath}`);
    if (typeof node.startLine === 'number') lines.push(`startLine: ${node.startLine}`);
    if (typeof node.endLine === 'number') lines.push(`endLine: ${node.endLine}`);
    if (node.summary) lines.push(`summary: ${node.summary}`);
    if (node.impact) lines.push(`impact: ${node.impact}`);
  } else if (node.type === 'proposal') {
    // 未採用の AI 提案であることを AI 側に明示する。
    // sourceAgentId は AI にとって意味の無い内部属性なので渡さない (codex セカンドオピニオン #16)。
    // adoptAs は「採用時にどの正規 type に昇格するか」のヒントとして残す (ADR-0005)。
    lines.push('note: このノードは未採用の AI 提案です (人間の採用操作で正規ノードに昇格)');
    if (node.adoptAs) lines.push(`adoptAs: ${node.adoptAs}`);
  }
  return lines.join('\n');
}

// チャット履歴を単一 prompt にエンコードする。
// tool_use / tool_result は冗長なので省き、text block だけを role 付きで並べる。
// 最後の user message は current として別タグに出し、モデルの「今答えるべきもの」を明示する。
//
// contextNodes: 今ターンで参照するコンテキストノード (issue #11)。
// 履歴より下、current_user_message より上に <context_nodes> として埋め込む。
// 履歴に積まないのは「ターンごとに添付し直しできる軽量な参照」という UX 設計のため。
export function buildChatPrompt(messages: ChatMessage[], contextNodes: Node[] = []): string {
  const lines: string[] = [];
  const last = messages[messages.length - 1];
  const past = last?.role === 'user' ? messages.slice(0, -1) : messages;

  if (past.length > 0) {
    lines.push('<conversation_history>');
    for (const m of past) {
      const texts = m.blocks
        .filter((b): b is Extract<ChatBlock, { type: 'text' }> => b.type === 'text')
        .map((b) => b.text);
      if (texts.length > 0) {
        lines.push(`<message role="${m.role}">`);
        lines.push(texts.join('\n'));
        lines.push('</message>');
      }
    }
    lines.push('</conversation_history>');
  }

  if (contextNodes.length > 0) {
    lines.push('<context_nodes>');
    for (const node of contextNodes) {
      lines.push('<node>');
      lines.push(formatNodeForContext(node));
      lines.push('</node>');
    }
    lines.push('</context_nodes>');
  }

  if (last && last.role === 'user') {
    const texts = last.blocks
      .filter((b): b is Extract<ChatBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text);
    lines.push('<current_user_message>');
    lines.push(texts.join('\n'));
    lines.push('</current_user_message>');
  }

  return lines.join('\n');
}

// SDK から流れてくる assistant message + user message (tool_result を含む) から block 抽出。
// 拾うもの:
// - assistant.text (existing 動作維持)
// - tool_use で name が mcp__tally__ で始まらないもの (= 外部 MCP、Task 12)
// - tool_result 全部 (外部 MCP の応答、user message に含まれる)
//
// Tally MCP (mcp__tally__*) の tool_use は createSdkMcpServer の intercept 経路で
// invokeInterceptedTool が処理するので、ここで拾うと二重処理になる。よって除外。
// 実行時 duck typing (agent-runner.ts の sdkMessageToAgentEvent と同じパターン)。
function extractAssistantBlocks(msg: SdkMessageLike): ExtractedBlock[] {
  const m = msg as unknown as { type?: string; message?: { content?: unknown[] } };
  if ((m.type !== 'assistant' && m.type !== 'user') || !m.message?.content) return [];
  const out: ExtractedBlock[] = [];
  for (const block of m.message.content) {
    const b = block as {
      type?: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      tool_use_id?: string;
      content?: unknown;
      is_error?: boolean;
    };
    if (b.type === 'text' && typeof b.text === 'string' && m.type === 'assistant') {
      out.push({ type: 'text', text: b.text });
    } else if (
      b.type === 'tool_use' &&
      typeof b.id === 'string' &&
      typeof b.name === 'string' &&
      !b.name.startsWith('mcp__tally__')
    ) {
      out.push({
        type: 'tool_use',
        toolUseId: b.id,
        name: b.name,
        input: b.input,
      });
    } else if (b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
      // content は string or [{type:'text', text:'...'}] で来る (SDK 仕様)。string 化する。
      let outputText = '';
      if (typeof b.content === 'string') {
        outputText = b.content;
      } else if (Array.isArray(b.content)) {
        outputText = b.content
          .map((c: { type?: string; text?: string }) =>
            c.type === 'text' && typeof c.text === 'string' ? c.text : '',
          )
          .join('');
      }
      out.push({
        type: 'tool_result',
        toolUseId: b.tool_use_id,
        ok: b.is_error !== true,
        output: outputText,
      });
    }
  }
  return out;
}
