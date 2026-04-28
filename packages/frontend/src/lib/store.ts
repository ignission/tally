'use client';

import type { AgentEvent, ChatEvent } from '@tally/ai-engine';
import type {
  AdoptableType,
  AgentName,
  ChatMessage,
  ChatThreadMeta,
  Codebase,
  Edge,
  EdgeType,
  McpServerConfig,
  Node,
  NodeType,
  Project,
  ProjectMeta,
} from '@tally/core';
import { create } from 'zustand';

import {
  adoptProposal as adoptProposalApi,
  clearProjectBoard,
  createEdge,
  createNode,
  deleteChatThread as deleteChatThreadApi,
  deleteEdge as deleteEdgeApi,
  deleteNode as deleteNodeApi,
  patchProjectMeta as patchProjectMetaApi,
  updateEdge as updateEdgeApi,
  updateNode as updateNodeApi,
} from './api';
import { computeLayout, type LayoutDirection, type LayoutedPosition } from './layout';
import { type ChatHandle, openChat, startAgent } from './ws';

export type Selected = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

// ノード移動 Undo 履歴の最大保持数。
// issue #13 の要件「最大 3 回ほど操作が戻せると便利」に基づく。
// 容量を超えた古い履歴は破棄する (FIFO)。
export const MOVE_HISTORY_LIMIT = 3;

// ノード移動の履歴エントリ。移動前 (id, x, y) を記録する。
// Ctrl+Z 押下時にこの座標へ戻す。
export type MoveHistoryEntry = { id: string; x: number; y: number };

// ingest-document エージェントへの入力。paste = 貼り付けテキスト、docs-dir = プロジェクト内ディレクトリ走査。
export type IngestDocumentInput =
  | { source: 'paste'; text: string }
  | { source: 'docs-dir'; dirPath: string };

interface CanvasState {
  projectId: string | null;
  projectMeta: ProjectMeta | null;
  nodes: Record<string, Node>;
  edges: Record<string, Edge>;
  selected: Selected;

  // UI状態: ノードごとの展開状態 (アコーディオン)。
  // true = 展開 (body/footer 表示)、キー未設定 or false = 折りたたみ (タイトルのみ)。
  // デフォルトは折りたたみ。キャンバス上での「ノードのつながり」が見やすくなる。
  // セッション内のみ保持し YAML には永続化しない。
  expandedNodes: Record<string, boolean>;
  toggleNodeExpanded: (id: string) => void;
  expandAllNodes: () => void;
  collapseAllNodes: () => void;

  hydrate: (project: Project) => void;
  reset: () => void;
  select: (target: Selected) => void;

  moveNode: (id: string, x: number, y: number) => Promise<void>;
  // ノード移動の Undo 履歴 (FIFO スタック、最大 MOVE_HISTORY_LIMIT 件)。
  // moveNode 実行時に「移動前 (id, x, y)」を push し、undoMoveNode 時に pop する。
  // セッション内のみ保持し、永続化しない (リロードでクリア)。
  // ノード追加・エッジ操作・アコーディオン展開などは履歴に積まない。
  moveHistory: MoveHistoryEntry[];
  // 直近のノード移動を 1 件取り消す。履歴が空なら何もしない (resolve false)。
  // サーバ更新失敗時は履歴を巻き戻して例外を投げる呼び出し側に委ねる。
  undoMoveNode: () => Promise<boolean>;
  patchNode: <T extends NodeType>(
    id: string,
    patch: Partial<Omit<Extract<Node, { type: T }>, 'id' | 'type'>>,
  ) => Promise<void>;
  addNodeFromPalette: (type: NodeType, x: number, y: number) => Promise<Node>;
  removeNode: (id: string) => Promise<void>;

  connectEdge: (from: string, to: string, type: EdgeType) => Promise<Edge>;
  changeEdgeType: (id: string, type: EdgeType) => Promise<void>;
  removeEdge: (id: string) => Promise<void>;

  adoptProposal: (
    id: string,
    adoptAs: AdoptableType,
    additional?: Record<string, unknown>,
  ) => Promise<Node>;
  // 複数の proposal を adoptAs ヒントに従って一括採用する。
  // 対象は proposal 型で adoptAs を持つものだけ。1 件ずつ順次処理し、失敗は ids に残す。
  bulkAdoptProposals: (ids: string[]) => Promise<{ adopted: string[]; failed: string[] }>;

  runningAgent: {
    agent: AgentName;
    inputNodeId: string;
    events: AgentEvent[];
  } | null;
  startDecompose: (ucNodeId: string) => Promise<void>;
  // codebaseId: フロントで選択された codebase の ID。省略時は codebases[0] を使う。
  startFindRelatedCode: (nodeId: string, codebaseId?: string) => Promise<void>;
  startAnalyzeImpact: (nodeId: string, codebaseId?: string) => Promise<void>;
  startExtractQuestions: (nodeId: string) => Promise<void>;
  startIngestDocument: (
    input: IngestDocumentInput,
  ) => Promise<{ ok: boolean; errorMessage?: string }>;
  patchProjectMeta: (patch: {
    name?: string;
    description?: string | null;
    codebases?: Codebase[];
    mcpServers?: McpServerConfig[];
  }) => Promise<void>;

  // Phase 6: チャットスレッド管理。
  // chatThreadList はプロジェクトの全スレッドメタ (updatedAt 降順)。
  // chatThreadMessages は「現在開いているスレッド」の messages。
  // 切替時は前スレッドの WS handle を close してから新スレッドを開く。
  chatThreadList: ChatThreadMeta[];
  activeChatThreadId: string | null;
  chatThreadMessages: ChatMessage[];
  chatThreadStreaming: boolean;

  loadChatThreads: () => Promise<void>;
  createChatThread: (title?: string) => Promise<string>;
  openChatThread: (threadId: string) => Promise<void>;
  closeChatThread: () => void;
  sendChatMessage: (text: string) => Promise<void>;
  approveChatTool: (toolUseId: string, approved: boolean) => void;

  // issue #11: チャットに「@メンション」のように添付するノード ID 群。
  // 順序保持 + 重複排除のため配列で持つ。スレッド切替・close で自動クリア
  // (永続化はしない / chats/<id>.yaml にも書かない)。
  chatContextNodeIds: string[];
  addChatContextNode: (nodeId: string) => void;
  removeChatContextNode: (nodeId: string) => void;
  clearChatContext: () => void;

  // 現在開いているスレッドを削除する。open 中なら閉じ、一覧からも除去。
  deleteChatThread: (threadId: string) => Promise<void>;
  // プロジェクトのノード/エッジ/チャットを全クリア (project.yaml は維持)。
  // 呼び出し側で確認ダイアログを出してから叩くこと。
  clearBoard: () => Promise<void>;

  // dagre で計算された座標リストを一括反映する。
  // direction: 'TB' = 上から下、'LR' = 左から右。
  autoLayout: (direction?: 'TB' | 'LR') => Promise<void>;
}

function byId<T extends { id: string }>(items: T[]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const item of items) out[item.id] = item;
  return out;
}

// issue #11: チャットコンテキストに添付できるノード数の上限。
// サーバ側 (packages/ai-engine/src/server.ts の MAX_CHAT_CONTEXT_NODES) と同じ値。
// クライアント側でも先回りで弾くことで、無駄な WS フレームを送らない & UI の意図を明示する。
const MAX_CHAT_CONTEXT_NODES = 20;

// Phase 3: 可変ストア。楽観的更新 + 失敗時ロールバックで YAML と同期する。
export const useCanvasStore = create<CanvasState>((set, get) => {
  // Phase 6: 現在開いているチャットスレッドの WS handle。
  // スレッド切替・close で明示的に破棄する。
  let chatHandle: ChatHandle | null = null;

  // 共通: WS イベントループを抽象化したヘルパー。
  // startDecompose / startFindRelatedCode で共有する。
  // create クロージャ内に置くことで set/get を自然にキャプチャする。
  // codebaseId: フロントで選択された codebase の ID。省略時は ai-engine が codebases[0] を使う。
  async function runAgentWS(agent: AgentName, nodeId: string, codebaseId?: string): Promise<void> {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    set({ runningAgent: { agent, inputNodeId: nodeId, events: [] } });
    const input: Record<string, string> = { nodeId };
    if (codebaseId) input.codebaseId = codebaseId;
    const handle = startAgent({ agent, projectId: pid, input });
    try {
      for await (const evt of handle.events) {
        const cur = get().runningAgent;
        if (cur) set({ runningAgent: { ...cur, events: [...cur.events, evt] } });
        if (evt.type === 'node_created') {
          set({ nodes: { ...get().nodes, [evt.node.id]: evt.node } });
        } else if (evt.type === 'edge_created') {
          set({ edges: { ...get().edges, [evt.edge.id]: evt.edge } });
        }
      }
    } finally {
      // done/error 到達または WS 切断で runningAgent をクリアする。
      set({ runningAgent: null });
    }
  }

  // anchor ノード id を持たないエージェント (ingest-document など) 用のバリアント。
  // 既存 runAgentWS と本体ロジックは同じだが、input の形を呼び出し側に委ねる。
  // error イベントの有無を返すため Promise<{ ok: boolean; errorMessage?: string }>。
  // 呼び出し側 (ダイアログ等) が失敗時に入力を保持するか判断するために使う。
  async function runAgentWithInput(
    agent: AgentName,
    input: unknown,
    displayInputLabel: string,
  ): Promise<{ ok: boolean; errorMessage?: string }> {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    set({ runningAgent: { agent, inputNodeId: displayInputLabel, events: [] } });
    const handle = startAgent({ agent, projectId: pid, input });
    let firstError: string | null = null;
    try {
      for await (const evt of handle.events) {
        const cur = get().runningAgent;
        if (cur) set({ runningAgent: { ...cur, events: [...cur.events, evt] } });
        if (evt.type === 'node_created') {
          set({ nodes: { ...get().nodes, [evt.node.id]: evt.node } });
        } else if (evt.type === 'edge_created') {
          set({ edges: { ...get().edges, [evt.edge.id]: evt.edge } });
        } else if (evt.type === 'error' && firstError === null) {
          firstError = evt.message;
        }
      }
    } finally {
      set({ runningAgent: null });
    }
    return firstError === null ? { ok: true } : { ok: false, errorMessage: firstError };
  }

  // ChatEvent を受けて chatThreadMessages / nodes を更新する。
  // assistant message 開始 → text delta 連結 → tool_use pending → tool_result 反映、
  // create_node/create_edge 系の tool_result (JSON 文字列) はキャンバスにも反映する。
  function applyChatEvent(evt: ChatEvent): void {
    if (evt.type === 'chat_user_message_appended') {
      // ユーザー文字列は sendChatMessage 側で楽観的に追加する方式にせず、
      // サーバ永続化結果の取得を省略する。MVP ではイベントはメタ情報扱いで state には反映しない。
      return;
    }
    if (evt.type === 'chat_assistant_message_started') {
      set({
        chatThreadMessages: [
          ...get().chatThreadMessages,
          {
            id: evt.messageId,
            role: 'assistant',
            blocks: [],
            createdAt: new Date().toISOString(),
          },
        ],
      });
      return;
    }
    if (evt.type === 'chat_text_delta') {
      set({
        chatThreadMessages: get().chatThreadMessages.map((m) => {
          if (m.id !== evt.messageId) return m;
          // 末尾が text ブロックなら連結、そうでなければ新規 text block を追加する。
          const last = m.blocks[m.blocks.length - 1];
          if (last && last.type === 'text') {
            const updated = { ...last, text: last.text + evt.text };
            return { ...m, blocks: [...m.blocks.slice(0, -1), updated] };
          }
          return { ...m, blocks: [...m.blocks, { type: 'text', text: evt.text }] };
        }),
      });
      return;
    }
    if (evt.type === 'chat_tool_pending') {
      set({
        chatThreadMessages: get().chatThreadMessages.map((m) => {
          if (m.id !== evt.messageId) return m;
          return {
            ...m,
            blocks: [
              ...m.blocks,
              {
                type: 'tool_use',
                toolUseId: evt.toolUseId,
                name: evt.name,
                input: evt.input,
                source: 'internal',
                approval: 'pending',
              },
            ],
          };
        }),
      });
      return;
    }
    if (evt.type === 'chat_tool_result') {
      set({
        chatThreadMessages: get().chatThreadMessages.map((m) => {
          if (m.id !== evt.messageId) return m;
          // 対応する pending tool_use の approval を更新 + tool_result ブロック追加。
          const blocks = m.blocks.map((b) => {
            if (
              b.type === 'tool_use' &&
              b.toolUseId === evt.toolUseId &&
              b.approval === 'pending'
            ) {
              return { ...b, approval: evt.ok ? ('approved' as const) : ('rejected' as const) };
            }
            return b;
          });
          return {
            ...m,
            blocks: [
              ...blocks,
              {
                type: 'tool_result',
                toolUseId: evt.toolUseId,
                ok: evt.ok,
                output: evt.output,
              },
            ],
          };
        }),
      });
      // create_node / create_edge の tool_result は JSON 文字列で Node/Edge を含む。
      // キャンバスに反映するため軽くパースを試みる (失敗は無視)。
      if (evt.ok) {
        try {
          const parsed = JSON.parse(evt.output) as unknown;
          if (parsed && typeof parsed === 'object' && 'id' in parsed && 'type' in parsed) {
            const obj = parsed as { id: string; type: string; from?: unknown; to?: unknown };
            if (typeof obj.from === 'string' && typeof obj.to === 'string') {
              // edge
              set({ edges: { ...get().edges, [obj.id]: parsed as Edge } });
            } else {
              // node
              set({ nodes: { ...get().nodes, [obj.id]: parsed as Node } });
            }
          }
        } catch {
          // find_related / list_by_type などの非 JSON 結果は無視する。
        }
      }
      return;
    }
    // Task 12/18: 外部 MCP の tool_use を source='external' で append。承認 UI は出さない。
    if (evt.type === 'chat_tool_external_use') {
      set({
        chatThreadMessages: get().chatThreadMessages.map((m) => {
          if (m.id !== evt.messageId) return m;
          return {
            ...m,
            blocks: [
              ...m.blocks,
              {
                type: 'tool_use',
                toolUseId: evt.toolUseId,
                name: evt.name,
                input: evt.input,
                source: 'external',
              },
            ],
          };
        }),
      });
      return;
    }
    // Task 12/18: 外部 MCP の tool_result を append。
    // event はフル output (Task 13 の truncate は永続化のみ)。UI セッション内では全文閲覧可。
    if (evt.type === 'chat_tool_external_result') {
      set({
        chatThreadMessages: get().chatThreadMessages.map((m) => {
          if (m.id !== evt.messageId) return m;
          return {
            ...m,
            blocks: [
              ...m.blocks,
              {
                type: 'tool_result',
                toolUseId: evt.toolUseId,
                ok: evt.ok,
                output: evt.output,
              },
            ],
          };
        }),
      });
      return;
    }
    // OAuth 2.1 認証要求/状態更新。pending は新規 auth_request ブロックを append、
    // completed/failed は同 mcpServerId の最新 pending ブロックを in-place で更新する。
    // これは chat-runner が永続化側で行う処理と整合させるための鏡映ロジック。
    if (evt.type === 'chat_auth_request') {
      set({
        chatThreadMessages: get().chatThreadMessages.map((m) => {
          // pending: 該当 messageId に新規 append
          if (evt.status === 'pending') {
            if (m.id !== evt.messageId) return m;
            return {
              ...m,
              blocks: [
                ...m.blocks,
                {
                  type: 'auth_request',
                  mcpServerId: evt.mcpServerId,
                  mcpServerLabel: evt.mcpServerLabel,
                  authUrl: evt.authUrl,
                  status: 'pending',
                },
              ],
            };
          }
          // completed/failed: 同 mcpServerId の pending ブロックを更新 (どのメッセージに属していても)。
          // 同 server の pending は最新 1 件しか存在しないので最初に見つけたものを書き換える。
          let updated = false;
          const blocks = m.blocks.map((b) => {
            if (
              !updated &&
              b.type === 'auth_request' &&
              b.mcpServerId === evt.mcpServerId &&
              b.status === 'pending'
            ) {
              updated = true;
              return {
                ...b,
                status: evt.status,
                ...(evt.status === 'failed' && evt.failureMessage
                  ? { failureMessage: evt.failureMessage }
                  : {}),
              };
            }
            return b;
          });
          if (!updated) return m;
          return { ...m, blocks };
        }),
      });
      return;
    }
    if (evt.type === 'chat_assistant_message_completed') {
      return;
    }
    if (evt.type === 'chat_turn_ended') {
      set({ chatThreadStreaming: false });
      return;
    }
    if (evt.type === 'error') {
      // MVP: エラーは stream を止めず console に残す (UI でのエラー表示は後続タスク)。
      // eslint-disable-next-line no-console
      console.error('chat error', evt);
      return;
    }
  }

  return {
    projectId: null,
    projectMeta: null,
    nodes: {},
    edges: {},
    selected: null,
    expandedNodes: {},
    moveHistory: [],
    runningAgent: null,
    chatThreadList: [],
    activeChatThreadId: null,
    chatThreadMessages: [],
    chatThreadStreaming: false,
    chatContextNodeIds: [],

    hydrate: (project) => {
      const { nodes, edges, ...meta } = project;
      set({
        projectId: project.id,
        projectMeta: meta,
        nodes: byId(nodes),
        edges: byId(edges),
        selected: null,
        // プロジェクト切替時は全ノード折りたたみで開始する (つながり重視の初期表示)。
        expandedNodes: {},
        // プロジェクト切替時は移動履歴もリセット (別プロジェクトの座標を戻すと壊れる)。
        moveHistory: [],
        // プロジェクト切替時は context もクリア (別プロジェクトのノード id は無効)。
        chatContextNodeIds: [],
      });
    },

    reset: () =>
      set({
        projectId: null,
        projectMeta: null,
        nodes: {},
        edges: {},
        selected: null,
        expandedNodes: {},
        moveHistory: [],
        runningAgent: null,
        chatContextNodeIds: [],
      }),

    select: (target) => set({ selected: target }),

    // 個別ノードの展開状態をトグル。未登録キーは折りたたみ扱いのため true に切り替える。
    toggleNodeExpanded: (id) => {
      const cur = get().expandedNodes;
      if (cur[id]) {
        // 折りたたむ: キー自体を削除して Record を小さく保つ。
        const { [id]: _omit, ...rest } = cur;
        set({ expandedNodes: rest });
      } else {
        set({ expandedNodes: { ...cur, [id]: true } });
      }
    },

    expandAllNodes: () => {
      const all: Record<string, boolean> = {};
      for (const id of Object.keys(get().nodes)) all[id] = true;
      set({ expandedNodes: all });
    },

    collapseAllNodes: () => set({ expandedNodes: {} }),

    moveNode: async (id, x, y) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const prev = get().nodes[id];
      if (!prev) throw new Error(`unknown node: ${id}`);
      // 同じ座標へのドラッグ (= 実質クリックで動いていない) は履歴に積まない。
      // ドラッグ操作直後 onNodeDragStop が同位置で呼ばれても無視する。
      const moved = prev.x !== x || prev.y !== y;
      // NOTE(phase3): 同一ノードへの並行リクエストは後勝ち。失敗ロールバックが
      // 後続操作の楽観更新を巻き戻す可能性があるが、単一ユーザー前提のため許容。
      // 楽観更新: ドラッグ中の UI を即座に反映する。
      set({ nodes: { ...get().nodes, [id]: { ...prev, x, y } } });
      // Undo 履歴に「移動前」を push (FIFO、容量超過は古いものを捨てる)。
      // 楽観更新と一緒のタイミングで積むことで、サーバ失敗時のロールバックでも履歴の整合は取れる
      // (履歴に積んだエントリは「現在の prev 座標」を指すため)。
      // 失敗時に丸ごと復元できるよう push 前のスナップショット (histBefore) を保持する。
      const histBefore = get().moveHistory;
      if (moved) {
        const appended = [...histBefore, { id, x: prev.x, y: prev.y }];
        // 古い履歴から落とす。slice で「末尾 LIMIT 件」を取り出すことで mutation を避ける。
        const next =
          appended.length > MOVE_HISTORY_LIMIT
            ? appended.slice(appended.length - MOVE_HISTORY_LIMIT)
            : appended;
        set({ moveHistory: next });
      }
      try {
        await updateNodeApi(pid, id, { x, y });
      } catch (err) {
        // サーバ側の YAML は変わっていないので、元の座標へ戻す。
        set({ nodes: { ...get().nodes, [id]: prev } });
        // 履歴も push 前のスナップショットへ丸ごと戻す。
        // slice(0, -1) では LIMIT 超過で押し出された旧 head が復元できないため
        // histBefore 自体を再代入する。
        if (moved) {
          set({ moveHistory: histBefore });
        }
        throw err;
      }
    },

    undoMoveNode: async () => {
      const pid = get().projectId;
      if (!pid) return false;
      // 履歴の末尾が「すでに削除されたノード」を指していた場合は黙って捨て、
      // 次の有効なエントリで Undo を続行する。1 回の Ctrl+Z で 1 回成功するか
      // 履歴が空になるまで進める。
      // ループ中は hist (ローカル) のみを更新し、最後に 1 回だけ store に書き戻す
      // (途中の暫定 set による render 揺れを避ける)。楽観 nodes 更新だけは別 set。
      let hist = [...get().moveHistory];
      while (hist.length > 0) {
        const last = hist[hist.length - 1];
        if (!last) {
          hist = hist.slice(0, -1);
          continue;
        }
        const cur = get().nodes[last.id];
        if (!cur) {
          // ノードが削除済み → このエントリは復元不可能なので捨てて次へ。
          hist = hist.slice(0, -1);
          continue;
        }
        // 履歴を 1 件巻き戻し、楽観的に元座標へ戻す。
        // moveNode を再利用すると新たな履歴が積まれて Undo が無限にループするため、
        // ここでは直接 set + API 呼び出しする。
        const restored = { ...cur, x: last.x, y: last.y };
        const prevState = cur;
        hist = hist.slice(0, -1);
        // 楽観 nodes 更新と確定済み履歴 (skip 含む) を 1 回でまとめて反映する。
        set({
          nodes: { ...get().nodes, [last.id]: restored },
          moveHistory: hist,
        });
        try {
          await updateNodeApi(pid, last.id, { x: last.x, y: last.y });
          return true;
        } catch (err) {
          // サーバ更新が失敗したら UI も履歴も元に戻す (整合性優先)。
          // skip した削除済みエントリも含めて巻き戻すと「不可能な復元先」を
          // 残してしまうため、巻き戻すのは「実際に試行したエントリ」だけ。
          // つまり [...hist, last] を再現する。
          set({
            nodes: { ...get().nodes, [last.id]: prevState },
            moveHistory: [...hist, last],
          });
          throw err;
        }
      }
      // skip の結果として履歴が空になった場合も含め、何も Undo できなかった。
      // skip で捨てたエントリは store に書き戻す必要があるためここで反映する
      // (このパスは loop 内で set されないので、最終 1 回の set として残す)。
      set({ moveHistory: hist });
      return false;
    },

    patchNode: async (id, patch) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const prev = get().nodes[id];
      if (!prev) throw new Error(`unknown node: ${id}`);
      // 楽観更新: フィールド入力の即時反映用。
      // prev の具体型 (typeof prev) を維持して spread する。patch は type を含まないため、
      // discriminated union の判別フィールドは不変で、別 type に変質する経路はない。
      const next = { ...prev, ...patch } as typeof prev;
      set({ nodes: { ...get().nodes, [id]: next } });
      try {
        // サーバから返った最新値で上書き (updatedAt などサーバ側が決める値を信頼する)。
        const updated = await updateNodeApi(pid, id, patch);
        set({ nodes: { ...get().nodes, [id]: updated } });
      } catch (err) {
        set({ nodes: { ...get().nodes, [id]: prev } });
        throw err;
      }
    },

    addNodeFromPalette: async (type, x, y) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      // タイトル・ボディは空で作成し、詳細シートから編集させる。
      // id はサーバ側で採番するため、レスポンスを待ってから挿入する。
      const created = await createNode(pid, {
        type,
        x,
        y,
        title: '',
        body: '',
      } as Omit<Node, 'id'>);
      set({
        nodes: { ...get().nodes, [created.id]: created },
        // 新規ノードは空なので折りたたんだままだと存在が分かりづらい。展開状態で挿入する。
        expandedNodes: { ...get().expandedNodes, [created.id]: true },
      });
      return created;
    },

    removeNode: async (id) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const prevNode = get().nodes[id];
      if (!prevNode) return;
      // 付随エッジもクライアント側で同時に消す (サーバの deleteNode も参照整合性で削除する)。
      const prevEdges = get().edges;
      const remainingEdges: Record<string, Edge> = {};
      const removedEdges: Record<string, Edge> = {};
      for (const [eid, e] of Object.entries(prevEdges)) {
        if (e.from === id || e.to === id) removedEdges[eid] = e;
        else remainingEdges[eid] = e;
      }
      // Biome の noDelete 回避のため destructuring で除外する。
      const { [id]: _removedNode, ...remainingNodes } = get().nodes;
      const { [id]: _removedExpanded, ...remainingExpanded } = get().expandedNodes;
      const prevSelected = get().selected;
      const selectedPointsToThis =
        (prevSelected?.kind === 'node' && prevSelected.id === id) ||
        (prevSelected?.kind === 'edge' && prevSelected.id in removedEdges);
      set({
        nodes: remainingNodes,
        edges: remainingEdges,
        expandedNodes: remainingExpanded,
        selected: selectedPointsToThis ? null : prevSelected,
      });
      try {
        await deleteNodeApi(pid, id);
      } catch (err) {
        // ロールバック: ノードもエッジも戻し、選択状態も復元する。
        set({
          nodes: { ...get().nodes, [id]: prevNode },
          edges: { ...get().edges, ...removedEdges },
          selected: prevSelected,
        });
        throw err;
      }
    },

    connectEdge: async (from, to, type) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      // エッジ id はサーバ採番 (種別 + 連番) なのでレスポンスを待って挿入する。
      const created = await createEdge(pid, { from, to, type });
      set({ edges: { ...get().edges, [created.id]: created } });
      return created;
    },

    changeEdgeType: async (id, type) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const prev = get().edges[id];
      if (!prev) throw new Error(`unknown edge: ${id}`);
      // 楽観更新: 同じ id のまま type だけ差し替える。
      set({ edges: { ...get().edges, [id]: { ...prev, type } } });
      try {
        // storage.updateEdge 経由で id は不変なので、単純な上書きで十分。
        const updated = await updateEdgeApi(pid, id, type);
        set({ edges: { ...get().edges, [id]: updated } });
      } catch (err) {
        set({ edges: { ...get().edges, [id]: prev } });
        throw err;
      }
    },

    removeEdge: async (id) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const prev = get().edges[id];
      if (!prev) return;
      const { [id]: _removed, ...rest } = get().edges;
      const sel = get().selected;
      const wasSelected = sel?.kind === 'edge' && sel.id === id;
      set({ edges: rest, selected: wasSelected ? null : sel });
      try {
        await deleteEdgeApi(pid, id);
      } catch (err) {
        // ロールバック: エッジと選択を復元する。
        set({ edges: { ...get().edges, [id]: prev }, selected: sel });
        throw err;
      }
    },

    adoptProposal: async (id, adoptAs, additional) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      // 非楽観: type 変化が絡むため、応答を待ってから置き換える。
      // 失敗時は例外を呼び出し元に伝え、ノードは元の proposal のまま残す。
      const adopted = await adoptProposalApi(pid, id, adoptAs, additional);
      set({ nodes: { ...get().nodes, [id]: adopted } });
      return adopted;
    },

    bulkAdoptProposals: async (ids) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const adopted: string[] = [];
      const failed: string[] = [];
      // 順次処理: 一度に並列化するとバックエンド YAML の書き込み競合を引く可能性がある。
      for (const id of ids) {
        const n = get().nodes[id];
        // adoptAs === 'proposal' は AdoptableType 対象外なのでここで弾く。
        if (!n || n.type !== 'proposal' || !n.adoptAs || n.adoptAs === 'proposal') {
          failed.push(id);
          continue;
        }
        const adoptAs = n.adoptAs;
        try {
          const a = await adoptProposalApi(pid, id, adoptAs);
          set({ nodes: { ...get().nodes, [id]: a } });
          adopted.push(id);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('bulkAdoptProposals: failed for', id, err);
          failed.push(id);
        }
      }
      return { adopted, failed };
    },

    // 既存の startDecompose を runAgentWS ベースに置き換え。
    startDecompose: (ucNodeId) => runAgentWS('decompose-to-stories', ucNodeId),

    // find-related-code エージェントを起動する。同じ WS ヘルパーを共有する。
    startFindRelatedCode: (nodeId, codebaseId) =>
      runAgentWS('find-related-code', nodeId, codebaseId),

    // analyze-impact エージェントを起動する。coderef/issue proposal を生成する。
    startAnalyzeImpact: (nodeId, codebaseId) => runAgentWS('analyze-impact', nodeId, codebaseId),

    // extract-questions エージェントを起動する。codebasePath 不要でグラフ文脈のみから
    // question proposal (選択肢候補つき) を生成する。
    startExtractQuestions: (nodeId) => runAgentWS('extract-questions', nodeId),

    // ingest-document エージェントを起動する。paste (貼り付け) と docs-dir (ディレクトリ走査)
    // の両モードをサポート。displayInputLabel は進捗パネル向けに短縮化。
    startIngestDocument: (input) => {
      const label =
        input.source === 'paste'
          ? input.text.length > 40
            ? `${input.text.slice(0, 40)}…`
            : input.text
          : `docs-dir:${input.dirPath}`;
      return runAgentWithInput('ingest-document', input, label);
    },

    // ProjectMeta の部分更新 (codebases 全置換など)。サーバ応答で state を上書きする。
    patchProjectMeta: async (patch) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const updated = await patchProjectMetaApi(pid, patch);
      set({ projectMeta: updated });
    },

    // チャットスレッド一覧をサーバから取得。updatedAt 降順でサーバが並べる前提。
    loadChatThreads: async () => {
      const pid = get().projectId;
      if (!pid) return;
      const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/chats`);
      if (!res.ok) throw new Error(`API GET /api/projects/${pid}/chats ${res.status}`);
      const body = (await res.json()) as { threads: ChatThreadMeta[] };
      set({ chatThreadList: body.threads });
    },

    // 新規スレッドを作成して list 先頭に追加。返す id は呼び出し側で openChatThread 用に使う。
    createChatThread: async (title) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const res = await fetch(`/api/projects/${encodeURIComponent(pid)}/chats`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(title ? { title } : {}),
      });
      if (!res.ok) throw new Error(`API POST /api/projects/${pid}/chats ${res.status}`);
      const thread = (await res.json()) as ChatThreadMeta;
      set({ chatThreadList: [thread, ...get().chatThreadList] });
      return thread.id;
    },

    // スレッドを開く: 既存 handle を破棄 → 詳細 fetch → state セット → WS 接続 → event loop 起動。
    openChatThread: async (threadId) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      if (chatHandle) {
        chatHandle.close();
        chatHandle = null;
      }
      const res = await fetch(
        `/api/projects/${encodeURIComponent(pid)}/chats/${encodeURIComponent(threadId)}`,
      );
      if (!res.ok) throw new Error(`API GET thread ${res.status}`);
      const thread = (await res.json()) as { messages: ChatMessage[] };
      set({
        activeChatThreadId: threadId,
        chatThreadMessages: thread.messages,
        chatThreadStreaming: false,
        // スレッド切替時は context もリセット (前スレッドの添付を引きずらない)。
        chatContextNodeIds: [],
      });
      const handle = openChat({ projectId: pid, threadId });
      chatHandle = handle;
      // event ループは fire-and-forget。close 時に events が finish して自然終了する。
      void (async () => {
        try {
          for await (const evt of handle.events) {
            applyChatEvent(evt);
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('chat loop error', err);
        }
      })();
    },

    closeChatThread: () => {
      if (chatHandle) {
        chatHandle.close();
        chatHandle = null;
      }
      set({
        activeChatThreadId: null,
        chatThreadMessages: [],
        chatThreadStreaming: false,
        chatContextNodeIds: [],
      });
    },

    // issue #11: チャット添付ノードの操作。
    // add: 重複なら no-op、存在しないノード id でも UI 側でフィルタするので許容。
    // 上限 (MAX_CHAT_CONTEXT_NODES) を超える場合も no-op。サーバ側でも同じ値で弾くが、
    // クライアントで先に弾くことで送信前に状態を一致させる。
    addChatContextNode: (nodeId) => {
      const cur = get().chatContextNodeIds;
      if (cur.includes(nodeId)) return;
      if (cur.length >= MAX_CHAT_CONTEXT_NODES) return;
      set({ chatContextNodeIds: [...cur, nodeId] });
    },
    removeChatContextNode: (nodeId) => {
      set({ chatContextNodeIds: get().chatContextNodeIds.filter((id) => id !== nodeId) });
    },
    clearChatContext: () => set({ chatContextNodeIds: [] }),

    // user 入力を WS に送る。楽観的に user メッセージをローカルにも積み、streaming フラグを立てる。
    // サーバ側は chat_user_message_appended で append 完了を通知するが、UI は楽観分で十分。
    // issue #11: chatContextNodeIds を WS フレームに同梱して AI に渡す。
    // 送信後はキャンバス側で別ノードを取り上げ直しがち、かつ「同じノードを連続で参照したい」
    // ケースもあるため、自動クリアはしない。明示的に削除/clear を呼ぶ運用。
    sendChatMessage: async (text) => {
      if (!chatHandle) throw new Error('chat thread is not opened');
      const userMsg: ChatMessage = {
        id: `msg-local-${Date.now().toString(36)}`,
        role: 'user',
        blocks: [{ type: 'text', text }],
        createdAt: new Date().toISOString(),
      };
      set({
        chatThreadMessages: [...get().chatThreadMessages, userMsg],
        chatThreadStreaming: true,
      });
      // 削除済みノード id (キャンバスから消えたもの) はサーバが getNode で弾くが、
      // クライアント側でも一応フィルタして無駄なペイロードを送らない。
      const ctxIds = get().chatContextNodeIds.filter((id) => id in get().nodes);
      chatHandle.sendUserMessage(text, ctxIds);
    },

    approveChatTool: (toolUseId, approved) => {
      if (!chatHandle) return;
      chatHandle.approveTool(toolUseId, approved);
    },

    deleteChatThread: async (threadId) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      // 削除対象が開いてるスレッドなら先に close する。
      if (get().activeChatThreadId === threadId) {
        if (chatHandle) {
          chatHandle.close();
          chatHandle = null;
        }
        set({
          activeChatThreadId: null,
          chatThreadMessages: [],
          chatThreadStreaming: false,
          chatContextNodeIds: [],
        });
      }
      await deleteChatThreadApi(pid, threadId);
      set((s) => ({
        chatThreadList: s.chatThreadList.filter((t) => t.id !== threadId),
      }));
    },

    clearBoard: async () => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      // 開いてるチャットは切る
      if (chatHandle) {
        chatHandle.close();
        chatHandle = null;
      }
      await clearProjectBoard(pid);
      set({
        nodes: {},
        edges: {},
        expandedNodes: {},
        selected: null,
        chatThreadList: [],
        activeChatThreadId: null,
        chatThreadMessages: [],
        chatThreadStreaming: false,
        chatContextNodeIds: [],
      });
    },

    autoLayout: async (direction: LayoutDirection = 'TB') => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const nodes = Object.values(get().nodes);
      const edges = Object.values(get().edges);
      if (nodes.length === 0) return;

      const positions = computeLayout(nodes, edges, direction);

      // 楽観更新: 全ノードを新座標で一括書き換え。
      const prevNodes = get().nodes;
      const nextNodes: Record<string, Node> = { ...prevNodes };
      const changed: LayoutedPosition[] = [];
      for (const p of positions) {
        const prev = prevNodes[p.id];
        if (!prev) continue;
        if (prev.x === p.x && prev.y === p.y) continue;
        nextNodes[p.id] = { ...prev, x: p.x, y: p.y };
        changed.push(p);
      }
      if (changed.length === 0) return;
      set({ nodes: nextNodes });

      // サーバ永続化は並列。1 件失敗しても他はそのまま (原子性より応答性優先)。
      const results = await Promise.allSettled(
        changed.map((p) => updateNodeApi(pid, p.id, { x: p.x, y: p.y })),
      );
      const rejected = results.filter((r) => r.status === 'rejected');
      if (rejected.length > 0) {
        // eslint-disable-next-line no-console
        console.error('autoLayout: some updates failed', rejected);
      }
    },
  };
});
