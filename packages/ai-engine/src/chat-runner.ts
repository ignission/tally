import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import {
  type ChatBlock,
  type ChatMessage,
  type Node,
  newChatMessageId,
  newToolUseId,
} from '@tally/core';
import type { ChatStore, ProjectStore } from '@tally/storage';

import type { SdkLike, SdkQueryHandle, SdkUserMessageLike } from './agent-runner';
import { AsyncIterableInput } from './async-input';
import { type AuthToolNameMatch, extractAuthUrl, parseAuthToolName } from './auth-detector';
import { buildMcpServers } from './mcp/build-mcp-servers';
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

// 最新の pending auth_request ブロックを探す (同一 mcpServerId 限定)。
// thread.messages を末尾から走査し、最初に見つかった pending を返す。
// 同一 server に対する直近の認証フローのみを更新対象にして、過去に completed/failed で
// 終わったブロックには触らない方針。
function findLatestPendingAuthRequest(
  messages: ChatMessage[],
  mcpServerId: string,
): {
  messageId: string;
  blockIndex: number;
  block: Extract<ChatBlock, { type: 'auth_request' }>;
} | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m) continue;
    for (let j = m.blocks.length - 1; j >= 0; j--) {
      const b = m.blocks[j];
      if (
        b &&
        b.type === 'auth_request' &&
        b.mcpServerId === mcpServerId &&
        b.status === 'pending'
      ) {
        return { messageId: m.id, blockIndex: j, block: b };
      }
    }
  }
  return null;
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

// 1 user turn の間だけ生きる mutable state (long-lived Query 化)。
// SDK ストリームから流れてくる SDK メッセージを「今どの assistant message に紐付けるか」
// 「どの queue に流すか」を解決するためのコンテキスト。
// turn と turn の間 (= ユーザーが次の user message を送るまで) は null。
interface TurnState {
  assistantMsgId: string;
  queue: EventQueue<ChatEvent>;
  textBuffer: string[];
  // OAuth 認証フロー検出用 stash (tool_use 受信 → tool_result 到達時に auth_request に変換)。
  stashedAuthUses: Map<string, { match: AuthToolNameMatch; mcpServerLabel: string }>;
  // 外部 MCP の id → name の即引き map (label 表示用、turn 中は不変)。
  externalConfigById: Map<string, string>;
  // 同 turn 中に観測した外部 MCP の tool_use の id 集合。tool_result が来た時、
  // ここに無い id は「内部 / 想定外」として無視する (CR 指摘 #19 2 周目)。
  externalToolUseIds: Set<string>;
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

  // long-lived SDK Query。1 ChatRunner = 1 sdk.query() = 1 subprocess に固定して
  // MCP HTTP transport の OAuth 状態 (PKCE / token) を turn 跨ぎで保持する。
  // null = まだ start していない。closed 状態になっても close() / 再 ensure で破棄して再開できる。
  private query: SdkQueryHandle | null = null;
  private input: AsyncIterableInput<SdkUserMessageLike> | null = null;
  private outputLoopDone: Promise<void> | null = null;
  private outputLoopFailed = false;
  // ensureQuery が並行で複数回 await されるのを防ぐ Promise キャッシュ
  // (codex 指摘: 再入で tearDownQuery → sdk.query が 2 度走り、最初の query / output loop が
  // 孤立してリークするのを回避)。完了時に null 化して次回の再起動を許す。
  private ensureQueryInflight: Promise<void> | null = null;

  // close() による明示シャットダウン中フラグ。runOutputLoop の正常 EOF を
  // 「明示 shutdown」と「予期しない subprocess 終了」で区別するために使う
  // (CR Major: 後者を chat_turn_ended で正常完了扱いせず agent_failed を出す)。
  private isClosing = false;

  // 現在進行中の turn。runUserTurn の入口で set、出口で null。
  // MCP ハンドラと出力ループはここから assistantMsgId / queue を読む。
  private currentTurn: TurnState | null = null;
  // ensureQuery が走った時に決まる、long-lived な externalConfig snapshot。
  // 再起動するまで mcpServers の入替えは反映しない。
  private cachedExternalConfigById: Map<string, string> | null = null;

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

  // 進行中の turn が異常終了したとき、pendingApprovals に残っている承認待ちを
  // 一括で否認 (false) する (CR Major)。これを呼ばないと、turn 失敗後に UI から
  // 承認が来ても create_node / create_edge 等の side effect が走ってしまう。
  private rejectAllPendingApprovals(): void {
    for (const resolver of this.pendingApprovals.values()) {
      try {
        resolver(false);
      } catch {
        /* swallow: resolver の throw は他の rejection に影響させない */
      }
    }
    this.pendingApprovals.clear();
  }

  // user の 1 ターンを実行する (long-lived Query 化版)。
  // - 1 ChatRunner = 1 sdk.query() = 1 subprocess に固定し、MCP HTTP transport の
  //   OAuth state (PKCE / token) を turn 跨ぎで保持する。
  // - 各 turn では (1) user/空 assistant message の永続化、(2) prompt 組み立て、
  //   (3) AsyncIterableInput への push でターン開始、(4) queue ドレインで進む。
  // - turn 並走は禁止 (codex 指摘): currentTurn が既に居れば error を返して即終了。
  //
  // contextNodeIds: ユーザーが「@メンション」で添付したノード ID 配列 (issue #11)。
  async *runUserTurn(userText: string, contextNodeIds: string[] = []): AsyncGenerator<ChatEvent> {
    const { chatStore, projectStore, threadId } = this.deps;

    // turn 並走禁止 (codex 指摘 Major 1)。currentTurn が既に居る = 前 turn が
    // まだ完了していない (UI がイベントをドレイン中) ので、新 turn を被せると
    // SDK 出力が前 turn の assistantMsgId に誤接続される。明示的に拒否する。
    if (this.currentTurn) {
      yield {
        type: 'error',
        code: 'turn_in_progress',
        message: '前のターンがまだ完了していません',
      };
      return;
    }

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
    //    buildChatPrompt が <current_user_message> を末尾の user message として正しく抽出できる
    //    状態で呼ぶ (issue #11 の <context_nodes> 配置契約)。
    const threadWithUser = await chatStore.getChat(threadId);
    const contextNodes = await loadContextNodes(projectStore, contextNodeIds);
    const prompt = buildChatPrompt(threadWithUser?.messages ?? [], contextNodes);

    // 3. 空の assistant message を append (後続の tool_use 即時永続化の親として必要)。
    //    long-lived 化では ensureQuery 内の出力ループが bg で即起動するため、append を
    //    ensureQuery 後に遅らせると「空 assistant 永続化前に SDK の result message が
    //    dispatch されて空 message のままになる」race が起きる。先に append しておく。
    const assistantMsgId = newChatMessageId();
    await chatStore.appendMessage(threadId, {
      id: assistantMsgId,
      role: 'assistant',
      blocks: [],
      createdAt: new Date().toISOString(),
    });
    yield { type: 'chat_assistant_message_started', messageId: assistantMsgId };

    // 4. turn state を組み立てる。runOutputLoop と MCP ハンドラはここから読む。
    //    ensureQuery より前に必ず set しておく — output loop が SDK メッセージを
    //    dispatch する瞬間に currentTurn が null だと取りこぼす (race)。
    const queue = new EventQueue<ChatEvent>();
    const turnState: TurnState = {
      assistantMsgId,
      queue,
      textBuffer: [],
      stashedAuthUses: new Map(),
      externalConfigById: this.cachedExternalConfigById ?? new Map(),
      externalToolUseIds: new Set(),
    };
    this.currentTurn = turnState;

    // currentTurn を立てた直後から全体を try/finally で囲み、appendMessage / input.push
    // 等の中間ステップで throw しても currentTurn が解放されることを保証する (CR Major)。
    try {
      // 5. SDK Query (long-lived) を必要なら起動する。
      try {
        await this.ensureQuery();
      } catch (err) {
        // 空 assistant message を「先に append」している関係で、ensureQuery 失敗時に
        // 空バブルが履歴に残ってしまう (CR Minor)。chatStore に message 単位の delete
        // API は無いので、エラー内容で blocks を埋める形にロールバックする。
        const message = err instanceof Error ? err.message : String(err);
        try {
          await chatStore.replaceMessageBlocks(threadId, assistantMsgId, [
            { type: 'text', text: `(MCP 設定エラー: ${message})` },
          ]);
        } catch {
          /* swallow: replace 自体が失敗しても error event は流すので致命的ではない */
        }
        yield {
          type: 'error',
          code: 'mcp_config_invalid',
          message,
        };
        return;
      }
      // ensureQuery が externalConfig を更新するので turnState の参照を最新へ差し替える。
      turnState.externalConfigById = this.cachedExternalConfigById ?? new Map();

      // 6. user message を SDK の input ストリームに push する。
      //    ensureQuery 成功後は this.input が必ず存在するはず (codex 指摘 Major 2:
      //    null チェックを invariant assertion で表明し、無音破棄 → ハングを防ぐ)。
      if (!this.input) {
        throw new Error('invariant: ensureQuery succeeded but input is null');
      }
      this.input.push({
        type: 'user',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
      });

      // 7. queue をドレイン。chat_turn_ended が来たら今 turn は終わり。
      while (true) {
        const evt = await queue.next();
        if (evt === null) break;
        yield evt;
        if (evt.type === 'chat_turn_ended') break;
      }
    } finally {
      this.currentTurn = null;
    }
  }

  // SDK query を 1 度だけ立ち上げ、出力ループをバックグラウンドで走らせる。
  // close() / iter 終端 / 例外で query が死んでいる場合は次回呼び出しで再起動する。
  // 並行呼び出しは Promise キャッシュで直列化する (codex 指摘 Major 3: 再入で
  // tearDownQuery → sdk.query が 2 度走り、最初の query / output loop が孤立して
  // リークするのを回避)。
  // throw する条件: project mcpServers の設定不正 (URL 無効等) — 上位で error event 化される。
  private ensureQuery(): Promise<void> {
    if (this.query && !this.outputLoopFailed) return Promise.resolve();
    if (this.ensureQueryInflight) return this.ensureQueryInflight;
    const p = this.startQueryInternal().finally(() => {
      this.ensureQueryInflight = null;
    });
    this.ensureQueryInflight = p;
    return p;
  }

  private async startQueryInternal(): Promise<void> {
    // 既存が死んでいるなら片付けてから作り直す。
    this.tearDownQuery();

    const { sdk, projectStore, projectDir } = this.deps;
    const projectMeta = await projectStore.getProjectMeta();
    const externalConfigs = projectMeta?.mcpServers ?? [];

    const externalConfigById = new Map<string, string>();
    for (const c of externalConfigs) externalConfigById.set(c.id, c.name);
    this.cachedExternalConfigById = externalConfigById;

    const tools = this.buildToolRegistry();
    // long-lived Query では MCP handler が「いつどの assistantMsgId に emit するか」を
    // currentTurn から動的解決する。Builder には turn 越境した値を渡さず、
    // currentTurn 経由で参照させる。
    const mcp = this.buildMcpServer(tools);
    const built = buildMcpServers({ tallyMcp: mcp, configs: externalConfigs });

    const input = new AsyncIterableInput<SdkUserMessageLike>();
    this.input = input;

    const query = sdk.query({
      prompt: input.iterable(),
      options: {
        systemPrompt: buildChatSystemPrompt(),
        mcpServers: built.mcpServers,
        tools: [],
        allowedTools: built.allowedTools,
        permissionMode: 'dontAsk',
        settingSources: [],
        cwd: projectDir,
        ...(process.env.CLAUDE_CODE_PATH
          ? { pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_PATH }
          : {}),
      },
    });
    this.query = query;
    this.outputLoopFailed = false;
    this.outputLoopDone = this.runOutputLoop(query);
  }

  // SDK query から流れてくる SDKMessage を進行中 turn の queue に振り分ける。
  // turn 終端は SDKResultMessage (type: 'result') の到達で判定し、chat_turn_ended を emit する。
  // iter が終わった (= subprocess 死亡 / close()) ときは進行中 turn にもエラーを通知して終わらせる。
  private async runOutputLoop(query: SdkQueryHandle): Promise<void> {
    try {
      for await (const msg of query) {
        // SDK メッセージの全文を log すると OAuth callback URL の code/state や
        // 外部 MCP の出力 (Jira 本文等) がサーバーログに残る (CR Major)。
        // type だけ出して、content / result は redactMcpSecrets でも完全に落とせない
        // ため出さない。詳細デバッグが必要な場合は環境変数で切替可能にする想定。
        const mt = (msg as unknown as { type?: string }).type;
        if (mt) console.log('[chat-runner] sdk msg type:', mt);
        await this.dispatchSdkMessage(msg);
      }
    } catch (err) {
      this.outputLoopFailed = true;
      const turn = this.currentTurn;
      if (turn) {
        turn.queue.push({ type: 'error', code: 'agent_failed', message: String(err) });
        turn.queue.push({ type: 'chat_turn_ended' });
        turn.queue.finish();
      }
      // 異常終了後に古い承認が UI から来ても side effect を走らせないため、
      // pendingApprovals を一括 reject する (CR Major)。
      this.rejectAllPendingApprovals();
      return;
    }
    // iter 正常終端 (close 等)。query が死んだ印として outputLoopFailed を立て、
    // 次回 ensureQuery で作り直させる。進行中 turn が残っていれば打ち切る。
    // 明示 shutdown (close()) と予期しない subprocess 終了を区別する (CR Major):
    // 前者は normal turn end、後者は agent_failed を emit してから turn を閉じる。
    this.outputLoopFailed = true;
    const turn = this.currentTurn;
    if (turn) {
      if (!this.isClosing) {
        turn.queue.push({
          type: 'error',
          code: 'agent_failed',
          message: 'SDK output stream ended unexpectedly',
        });
      }
      turn.queue.push({ type: 'chat_turn_ended' });
      turn.queue.finish();
    }
    // 予期しない終了 / 明示 shutdown のいずれでも、残っている承認待ちは無効化する。
    this.rejectAllPendingApprovals();
  }

  // 1 つの SDKMessage を処理する。turn が無ければ捨てる。
  private async dispatchSdkMessage(msg: SdkMessageLike): Promise<void> {
    const turn = this.currentTurn;
    if (!turn) return;
    const { chatStore, threadId } = this.deps;
    const { assistantMsgId, queue, textBuffer, stashedAuthUses } = turn;
    // ensureQuery 完了直後に SDK が即 yield する test mock のような race ケースで
    // turn.externalConfigById が初期値 (空 Map) のまま読まれることがあるので、
    // 最新の cachedExternalConfigById を優先する (load 後に turn は再代入されるが
    // dispatch のタイミング差で古い参照を保持する可能性がある)。
    const externalConfigById = this.cachedExternalConfigById ?? turn.externalConfigById;

    // result message: turn 終了
    const m = msg as unknown as { type?: string; subtype?: string };
    if (m.type === 'result') {
      // text blocks を assistant message の先頭に統合 (tool_use/result は intercept 経路で既に append 済み)
      if (textBuffer.length > 0) {
        const current = await chatStore.getChat(threadId);
        const target = current?.messages.find((m2) => m2.id === assistantMsgId);
        if (current && target) {
          const textBlocks: ChatBlock[] = textBuffer.map((t) => ({ type: 'text', text: t }));
          await chatStore.replaceMessageBlocks(threadId, assistantMsgId, [
            ...textBlocks,
            ...target.blocks,
          ]);
        }
      } else {
        // text 出力なし。complete_authentication 専用 turn 等で blocks が 0 件の
        // まま残ると UI に空アシスタント bubble が蓄積するため、プレースホルダを置く。
        const current = await chatStore.getChat(threadId);
        const target = current?.messages.find((m2) => m2.id === assistantMsgId);
        if (target && target.blocks.length === 0) {
          await chatStore.replaceMessageBlocks(threadId, assistantMsgId, [
            { type: 'text', text: '(認証処理を完了しました)' },
          ]);
        }
      }
      queue.push({ type: 'chat_assistant_message_completed', messageId: assistantMsgId });
      queue.push({ type: 'chat_turn_ended' });
      return;
    }

    const blocks = extractAssistantBlocks(msg);
    for (const b of blocks) {
      if (b.type === 'text') {
        textBuffer.push(b.text);
        queue.push({ type: 'chat_text_delta', messageId: assistantMsgId, text: b.text });
      } else if (b.type === 'tool_use') {
        const authMatch = parseAuthToolName(b.name);
        if (authMatch) {
          const label = externalConfigById.get(authMatch.mcpServerId) ?? authMatch.mcpServerId;
          stashedAuthUses.set(b.toolUseId, { match: authMatch, mcpServerLabel: label });
          continue;
        }
        // 外部 MCP の tool_use: source='external' で永続化、承認 UI なし (Task 12)。
        turn.externalToolUseIds.add(b.toolUseId);
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
        const stash = stashedAuthUses.get(b.toolUseId);
        if (stash) {
          stashedAuthUses.delete(b.toolUseId);
          await this.handleAuthToolResult({
            match: stash.match,
            mcpServerLabel: stash.mcpServerLabel,
            result: { ok: b.ok, output: b.output },
            assistantMsgId,
            emit: (e) => queue.push(e),
          });
          continue;
        }
        // 同 turn 中に観測した外部 tool_use の id のみ external として扱う (CR 指摘 #19 2 周目)。
        if (!turn.externalToolUseIds.has(b.toolUseId)) continue;
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

  private tearDownQuery(): void {
    try {
      this.input?.close();
    } catch {
      /* swallow: close は idempotent */
    }
    try {
      this.query?.close?.();
    } catch {
      /* swallow */
    }
    this.input = null;
    this.query = null;
    // outputLoopDone は close() 側が join で待つために退避してから tearDownQuery を
    // 呼ぶので、ここで null 化しても安全 (codex 指摘 Minor: close() の順序問題対応)。
    this.outputLoopDone = null;
  }

  // ChatRunner 終了時 (WS close 等) に SDK subprocess を片付ける。
  // outputLoopDone は tearDownQuery で null 化されるため、先に退避してから join する
  // (codex 指摘の致命 Minor: close() 順序問題)。
  // isClosing フラグで runOutputLoop に「明示 shutdown」を伝え、EOF を agent_failed
  // としては emit させない (CR Major)。
  async close(): Promise<void> {
    this.isClosing = true;
    // 進行中の startQueryInternal を待ってから tearDown する (CR Major)。
    // close() が startQueryInternal の途中 (await projectStore.getProjectMeta() 等) で
    // 走ると、shutdown 後に sdk.query() が作られて subprocess が孤立する race を防ぐ。
    if (this.ensureQueryInflight) {
      try {
        await this.ensureQueryInflight;
      } catch {
        /* swallow: starter の例外は ensureQuery 呼び出し側で観測される */
      }
    }
    const pendingLoop = this.outputLoopDone;
    this.tearDownQuery();
    if (pendingLoop) {
      try {
        await pendingLoop;
      } catch {
        /* swallow */
      }
    }
  }

  // 外部 MCP の OAuth コールバック URL を受け取り、対応 server の complete_authentication
  // のみを ephemeral に実行する。UI から構造化送信された mcpServerId を prompt と
  // allowedTools の両方に固定することで、(1) callback URL の code/state を chat 履歴に
  // 永続化しない、(2) 別 server の complete_authentication を呼ばせない、(3) 他の
  // ツール実行 (create_node 等) を許さない、の 3 点を同時に満たす (PR-B CR Major)。
  //
  // 通常 turn (runUserTurn) を再利用しないのは、user message の永続化と通常の
  // assistant message ループ全体を回避するため。auth_request ブロックの更新は
  // handleAuthToolResult が過去 message の最新 pending を探して書き換える経路で行う。
  //
  // SDK 制約上、complete_authentication tool 自体は agent loop 経由でしか呼べないため、
  // sdk.query は呼ぶが allowedTools = [対象 tool 1 件] で他を遮断する。
  async *runOAuthCallback(mcpServerId: string, callbackUrl: string): AsyncGenerator<ChatEvent> {
    // turn 並走禁止 (long-lived runUserTurn と同じガード)。
    if (this.currentTurn) {
      yield {
        type: 'error',
        code: 'turn_in_progress',
        message: '前のターンがまだ完了していません',
      };
      return;
    }

    const { chatStore, projectStore, threadId } = this.deps;
    const projectMeta = await projectStore.getProjectMeta();
    const targetConfig = projectMeta?.mcpServers?.find((s) => s.id === mcpServerId);
    if (!targetConfig) {
      yield {
        type: 'error',
        code: 'mcp_server_not_found',
        message: `MCP server "${mcpServerId}" not found in project config`,
      };
      return;
    }

    const assistantMsgId = newChatMessageId();
    const queue = new EventQueue<ChatEvent>();
    const turnState: TurnState = {
      assistantMsgId,
      queue,
      textBuffer: [],
      stashedAuthUses: new Map(),
      externalConfigById:
        this.cachedExternalConfigById ?? new Map([[mcpServerId, targetConfig.name]]),
      externalToolUseIds: new Set(),
    };
    this.currentTurn = turnState;

    // currentTurn を立てた直後から全体を try/finally で囲み、appendMessage 等の
    // 中間ステップで throw しても currentTurn が解放されることを保証する (CR Major)。
    // 解放しないと以後 turn_in_progress で次の turn を受け付けられない。
    try {
      // long-lived query 上で動かす (OAuth state を turn 跨ぎで保持するため)。
      try {
        await this.ensureQuery();
      } catch (err) {
        yield {
          type: 'error',
          code: 'mcp_config_invalid',
          message: err instanceof Error ? err.message : String(err),
        };
        return;
      }
      turnState.externalConfigById = this.cachedExternalConfigById ?? new Map();

      // ephemeral: user message は chatStore に append しない (callback URL の code/state
      // を chat 履歴に残さない)。空 assistant message だけは tool_use/tool_result の親
      // として必要なので append し、turn 末で「(認証処理を完了しました)」プレースホルダで
      // 埋める (dispatchSdkMessage の result 処理が自動で実行する)。
      await chatStore.appendMessage(threadId, {
        id: assistantMsgId,
        role: 'assistant',
        blocks: [],
        createdAt: new Date().toISOString(),
      });
      yield { type: 'chat_assistant_message_started', messageId: assistantMsgId };

      if (!this.input) {
        throw new Error('invariant: ensureQuery succeeded but input is null');
      }

      // 構造化 prompt: AI に必ず指定 server の complete_authentication を呼ばせる。
      // long-lived query では allowedTools が固定 (ensureQuery 起動時に決まる) なので
      // 単一 tool への制約はかけられないが、prompt 指示で実用上はモデルが従う。
      const prompt = [
        'OAuth コールバック URL を受信しました。',
        `mcp__${mcpServerId}__complete_authentication ツールを呼び、`,
        '以下の callback URL で認証を完了してください:',
        callbackUrl,
        '',
        '他の MCP server の complete_authentication ツールや、',
        '別の作業ツール (create_node 等) は呼ばないでください。',
      ].join('\n');

      this.input.push({
        type: 'user',
        message: { role: 'user', content: prompt },
        parent_tool_use_id: null,
      });

      while (true) {
        const evt = await queue.next();
        if (evt === null) break;
        yield evt;
        if (evt.type === 'chat_turn_ended') break;
      }
    } finally {
      this.currentTurn = null;
    }
  }

  // OAuth 認証系 tool_use/tool_result ペアを auth_request ブロックに変換する。
  // - authenticate: tool_result.output から auth URL を抽出して新規 pending ブロックを append
  // - complete_authentication: 同 mcpServerId の最新 pending ブロックを completed/failed に更新
  // どちらの場合も chat_auth_request イベントを emit する (UI が card を再描画するための合図)。
  // tool_result の ok=false や URL 抽出失敗時は failed として扱い、UI に message を出す。
  private async handleAuthToolResult(opts: {
    match: AuthToolNameMatch;
    mcpServerLabel: string;
    result: { ok: boolean; output: string };
    assistantMsgId: string;
    emit: (e: ChatEvent) => void;
  }): Promise<void> {
    const { match, mcpServerLabel, result, assistantMsgId, emit } = opts;
    const { chatStore, threadId } = this.deps;

    if (match.kind === 'authenticate') {
      const authUrl = result.ok ? extractAuthUrl(result.output) : null;
      if (!authUrl) {
        const failureMessage = result.ok
          ? 'authenticate tool_result から URL を抽出できませんでした'
          : result.output.slice(0, 256);
        const placeholderUrl = 'https://invalid.invalid/?auth_url_unavailable';
        const block: ChatBlock = {
          type: 'auth_request',
          mcpServerId: match.mcpServerId,
          mcpServerLabel,
          authUrl: placeholderUrl,
          status: 'failed',
          failureMessage,
        };
        await chatStore.appendBlockToMessage(threadId, assistantMsgId, block);
        emit({
          type: 'chat_auth_request',
          messageId: assistantMsgId,
          mcpServerId: match.mcpServerId,
          mcpServerLabel,
          authUrl: placeholderUrl,
          status: 'failed',
          failureMessage,
        });
        return;
      }
      const block: ChatBlock = {
        type: 'auth_request',
        mcpServerId: match.mcpServerId,
        mcpServerLabel,
        authUrl,
        status: 'pending',
      };
      await chatStore.appendBlockToMessage(threadId, assistantMsgId, block);
      emit({
        type: 'chat_auth_request',
        messageId: assistantMsgId,
        mcpServerId: match.mcpServerId,
        mcpServerLabel,
        authUrl,
        status: 'pending',
      });
      return;
    }

    // complete_authentication: 最新 pending ブロックを更新する。
    const thread = await chatStore.getChat(threadId);
    if (!thread) return;
    const found = findLatestPendingAuthRequest(thread.messages, match.mcpServerId);
    if (!found) {
      // 対応する pending が無い (履歴外で auth 済 / 別 thread で auth 済 / 重複呼び出し)。
      // 失敗時は新規 failed ブロックで残す。成功時はサイレント (ノイズ防止)。
      if (!result.ok) {
        const failureMessage = result.output.slice(0, 256);
        const placeholderUrl = 'https://invalid.invalid/?orphan_complete_failed';
        const block: ChatBlock = {
          type: 'auth_request',
          mcpServerId: match.mcpServerId,
          mcpServerLabel,
          authUrl: placeholderUrl,
          status: 'failed',
          failureMessage,
        };
        await chatStore.appendBlockToMessage(threadId, assistantMsgId, block);
        emit({
          type: 'chat_auth_request',
          messageId: assistantMsgId,
          mcpServerId: match.mcpServerId,
          mcpServerLabel,
          authUrl: placeholderUrl,
          status: 'failed',
          failureMessage,
        });
      }
      return;
    }
    const updated: ChatBlock = result.ok
      ? { ...found.block, status: 'completed' }
      : {
          ...found.block,
          status: 'failed',
          failureMessage: result.output.slice(0, 256),
        };
    await chatStore.updateMessageBlock(threadId, found.messageId, found.blockIndex, updated);
    if (updated.status === 'failed' && updated.failureMessage) {
      emit({
        type: 'chat_auth_request',
        messageId: found.messageId,
        mcpServerId: match.mcpServerId,
        mcpServerLabel,
        authUrl: found.block.authUrl,
        status: 'failed',
        failureMessage: updated.failureMessage,
      });
    } else {
      emit({
        type: 'chat_auth_request',
        messageId: found.messageId,
        mcpServerId: match.mcpServerId,
        mcpServerLabel,
        authUrl: found.block.authUrl,
        status: 'completed',
      });
    }
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
  private buildMcpServer(tools: ToolEntry[]) {
    const find = (name: string): ToolEntry => {
      const t = tools.find((x) => x.name === name);
      if (!t) throw new Error(`tool not registered: ${name}`);
      return t;
    };

    // long-lived Query では SDK が tool を呼ぶタイミングが turn 中。currentTurn から
    // assistantMsgId / emit を動的解決することで、1 度作った MCP サーバを turn 跨ぎで
    // 使い回せる (codex 指摘対応: turn 中に currentTurn は不変なので race なし)。
    const makeHandler = (name: string) => async (input: unknown) => {
      const entry = find(name);
      const turn = this.currentTurn;
      if (!turn) {
        return {
          content: [{ type: 'text' as const, text: 'no active chat turn' }],
          isError: true,
        };
      }
      const emit = (e: ChatEvent) => turn.queue.push(e);
      const { done } = this.invokeInterceptedTool({
        entry,
        input,
        emit,
        assistantMsgId: turn.assistantMsgId,
      });
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

// XML element 内テキスト用のエスケープ。`<` `>` `&` の最低限のみ。
// tool_result.output (外部 MCP の生出力) や tool_use.input の JSON 文字列を
// XML 要素本体に埋め込む際に使う。
//
// 注: JSON.stringify は `<` `>` `&` をエスケープしない (escape するのは `"` `\`
// と control chars のみ)。input オブジェクトに `</tool_use>` 等が含まれる
// ケースに備え、JSON 文字列にも本関数を適用する必要がある。
function escapeXmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// XML 属性値用のエスケープ。`"` も含めてエスケープする (属性は二重引用符で囲むため)。
// toolUseId / name / role などの動的値を attr に埋め込むときに使う。
function escapeXmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// チャット履歴を単一 prompt にエンコードする。
// 各 block を順に replay する:
// - text: そのまま (assistant / user の自然言語)
// - tool_use: <tool_use id="..." name="..." source="..."> ... </tool_use>
// - tool_result: <tool_result id="..." ok="..."> ... </tool_result>
//
// T4 fix (Task 14): 旧版は text block だけ replay していたが、これだと AI が
// 2 ターン目以降で前ターンの外部 MCP tool_result (= Jira 等の読み取り内容) を忘れてしまい、
// multi-turn 対話が成立しなかった。tool_use / tool_result も replay することで
// 「@JIRA EPIC-1 を読んで → 続けて子チケット STORY-2 も見て」が動く。
//
// contextNodes: 今ターンで参照するコンテキストノード (issue #11)。
// 履歴より下、current_user_message より上に <context_nodes> として埋め込む。
export function buildChatPrompt(messages: ChatMessage[], contextNodes: Node[] = []): string {
  const lines: string[] = [];
  const last = messages[messages.length - 1];
  const past = last?.role === 'user' ? messages.slice(0, -1) : messages;

  if (past.length > 0) {
    lines.push('<conversation_history>');
    for (const m of past) {
      // block が 1 つも無い空 message は省く (空 assistant の preliminary append 等)
      if (m.blocks.length === 0) continue;
      lines.push(`<message role="${escapeXmlAttr(m.role)}">`);
      for (const b of m.blocks) {
        if (b.type === 'text') {
          // text 本文も `<` `>` `&` を escape する。assistant / user 自由入力なので
          // `</message>` 等の文字列が混入しうる (CR 指摘 #19 2 周目)。
          lines.push(escapeXmlText(b.text));
        } else if (b.type === 'tool_use') {
          // source は default 'internal'。external も含めて全部 replay する
          // (AI に「外部 source を読んだ」事実を context として伝えるため)
          const sourceAttr = b.source === 'external' ? ' source="external"' : '';
          // input は JSON.stringify 後に XML エスケープ。`<` `>` `&` は JSON 文字列内では
          // 生のまま残るので、XML タグへの埋め込みでは構造を壊しうる (codex 指摘の前提誤り)。
          lines.push(
            `<tool_use id="${escapeXmlAttr(b.toolUseId)}" name="${escapeXmlAttr(b.name)}"${sourceAttr}>${escapeXmlText(JSON.stringify(b.input))}</tool_use>`,
          );
        } else if (b.type === 'tool_result') {
          lines.push(
            `<tool_result id="${escapeXmlAttr(b.toolUseId)}" ok="${b.ok}">${escapeXmlText(b.output)}</tool_result>`,
          );
        }
      }
      lines.push('</message>');
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
      .map((b) => escapeXmlText(b.text));
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
