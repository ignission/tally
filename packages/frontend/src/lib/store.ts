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
import { openChat, startAgent, type ChatHandle } from './ws';

export type Selected = { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null;

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

  hydrate: (project: Project) => void;
  reset: () => void;
  select: (target: Selected) => void;

  moveNode: (id: string, x: number, y: number) => Promise<void>;
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
  startFindRelatedCode: (nodeId: string) => Promise<void>;
  startAnalyzeImpact: (nodeId: string) => Promise<void>;
  startExtractQuestions: (nodeId: string) => Promise<void>;
  startIngestDocument: (
    input: IngestDocumentInput,
  ) => Promise<{ ok: boolean; errorMessage?: string }>;
  patchProjectMeta: (patch: {
    name?: string;
    description?: string | null;
    codebases?: Codebase[];
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

// Phase 3: 可変ストア。楽観的更新 + 失敗時ロールバックで YAML と同期する。
export const useCanvasStore = create<CanvasState>((set, get) => {
  // Phase 6: 現在開いているチャットスレッドの WS handle。
  // スレッド切替・close で明示的に破棄する。
  let chatHandle: ChatHandle | null = null;

  // 共通: WS イベントループを抽象化したヘルパー。
  // startDecompose / startFindRelatedCode で共有する。
  // create クロージャ内に置くことで set/get を自然にキャプチャする。
  async function runAgentWS(agent: AgentName, nodeId: string): Promise<void> {
    const pid = get().projectId;
    if (!pid) throw new Error('projectId is not set');
    set({ runningAgent: { agent, inputNodeId: nodeId, events: [] } });
    const handle = startAgent({ agent, projectId: pid, input: { nodeId } });
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
            if (b.type === 'tool_use' && b.toolUseId === evt.toolUseId && b.approval === 'pending') {
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
    runningAgent: null,
    chatThreadList: [],
    activeChatThreadId: null,
    chatThreadMessages: [],
    chatThreadStreaming: false,

    hydrate: (project) => {
      const { nodes, edges, ...meta } = project;
      set({
        projectId: project.id,
        projectMeta: meta,
        nodes: byId(nodes),
        edges: byId(edges),
        selected: null,
      });
    },

    reset: () =>
      set({
        projectId: null,
        projectMeta: null,
        nodes: {},
        edges: {},
        selected: null,
        runningAgent: null,
      }),

    select: (target) => set({ selected: target }),

    moveNode: async (id, x, y) => {
      const pid = get().projectId;
      if (!pid) throw new Error('projectId is not set');
      const prev = get().nodes[id];
      if (!prev) throw new Error(`unknown node: ${id}`);
      // NOTE(phase3): 同一ノードへの並行リクエストは後勝ち。失敗ロールバックが
      // 後続操作の楽観更新を巻き戻す可能性があるが、単一ユーザー前提のため許容。
      // 楽観更新: ドラッグ中の UI を即座に反映する。
      set({ nodes: { ...get().nodes, [id]: { ...prev, x, y } } });
      try {
        await updateNodeApi(pid, id, { x, y });
      } catch (err) {
        // サーバ側の YAML は変わっていないので、元の座標へ戻す。
        set({ nodes: { ...get().nodes, [id]: prev } });
        throw err;
      }
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
      set({ nodes: { ...get().nodes, [created.id]: created } });
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
      const prevSelected = get().selected;
      const selectedPointsToThis =
        (prevSelected?.kind === 'node' && prevSelected.id === id) ||
        (prevSelected?.kind === 'edge' && prevSelected.id in removedEdges);
      set({
        nodes: remainingNodes,
        edges: remainingEdges,
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
    startFindRelatedCode: (nodeId) => runAgentWS('find-related-code', nodeId),

    // analyze-impact エージェントを起動する。coderef/issue proposal を生成する。
    startAnalyzeImpact: (nodeId) => runAgentWS('analyze-impact', nodeId),

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
      set({ activeChatThreadId: null, chatThreadMessages: [], chatThreadStreaming: false });
    },

    // user 入力を WS に送る。楽観的に user メッセージをローカルにも積み、streaming フラグを立てる。
    // サーバ側は chat_user_message_appended で append 完了を通知するが、UI は楽観分で十分。
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
      chatHandle.sendUserMessage(text);
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
        selected: null,
        chatThreadList: [],
        activeChatThreadId: null,
        chatThreadMessages: [],
        chatThreadStreaming: false,
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
