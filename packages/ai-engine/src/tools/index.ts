import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { AgentName } from '@tally/core';
import type { ProjectStore } from '@tally/storage';

import type { AgentEvent } from '../stream';

import { CreateEdgeInputSchema, createEdgeHandler } from './create-edge';
import { CreateNodeInputSchema, createNodeHandler } from './create-node';
import { FindRelatedInputSchema, findRelatedHandler } from './find-related';
import { ListByTypeInputSchema, listByTypeHandler } from './list-by-type';

export interface TallyToolDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
  anchor: { x: number; y: number };
  // anchor ノードの id。create_node の question 重複ガードで近傍を引くために必要。
  anchorId: string;
  // 誰 (どの AI エージェント) が生成した proposal かを刻むため、
  // create_node に agentName を受け渡す。
  agentName: AgentName;
}

// Agent SDK の in-process MCP サーバとして Tally ツールを束ねる。
// SDK が tool input を zod スキーマで検証してからハンドラに渡す。
// ハンドラの戻り値は MCP の CallToolResult 形式 (content + isError) に変換する。
export function buildTallyMcpServer(deps: TallyToolDeps) {
  const createNode = createNodeHandler(deps);
  const createEdge = createEdgeHandler(deps);
  const findRelated = findRelatedHandler({ store: deps.store });
  const listByType = listByTypeHandler({ store: deps.store });

  return createSdkMcpServer({
    name: 'tally',
    version: '0.1.0',
    tools: [
      tool(
        'create_node',
        'Tally に新しい proposal ノードを作る。adoptAs は採用時に昇格する NodeType。',
        CreateNodeInputSchema.shape,
        async (input) => {
          const res = await createNode(input);
          return {
            content: [{ type: 'text', text: res.output }],
            isError: !res.ok,
          };
        },
      ),
      tool(
        'create_edge',
        'Tally に新しいエッジを作る。from/to はノード ID、type は SysML 2.0 エッジ種別。',
        CreateEdgeInputSchema.shape,
        async (input) => {
          const res = await createEdge(input);
          return {
            content: [{ type: 'text', text: res.output }],
            isError: !res.ok,
          };
        },
      ),
      tool(
        'find_related',
        '与えた node id に対して直接エッジで繋がったノード一覧を返す。',
        FindRelatedInputSchema.shape,
        async (input) => {
          const res = await findRelated(input);
          return {
            content: [{ type: 'text', text: res.output }],
            isError: !res.ok,
          };
        },
      ),
      tool(
        'list_by_type',
        '指定した NodeType のノードを全件返す。',
        ListByTypeInputSchema.shape,
        async (input) => {
          const res = await listByType(input);
          return {
            content: [{ type: 'text', text: res.output }],
            isError: !res.ok,
          };
        },
      ),
    ],
  });
}
