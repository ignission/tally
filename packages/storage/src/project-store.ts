import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  EdgeSchema,
  NodeSchema,
  ProjectMetaSchema,
  newEdgeId,
  newNodeId,
  stripAiPrefix,
} from '@tally/core';
import type { AdoptableType, Edge, Node, NodeType, Project, ProjectMeta } from '@tally/core';
import { z } from 'zod';

import { nodeFileName, resolveTallyPaths } from './paths';
import { readYaml, writeYaml } from './yaml';

// edges.yaml は「複数エッジを1ファイル」(ADR-0003)。ルートキー edges: の下に配列を置く。
const EdgesFileSchema = z.object({
  edges: z.array(EdgeSchema),
});

// Node の discriminated union を各メンバーに分配した上で id を剥がす。
// これにより addNode 側の引数で型ごとの固有属性 (kind / options 等) がそのまま型推論される。
export type NodeDraft = Node extends infer N ? (N extends Node ? Omit<N, 'id'> : never) : never;
export type NodePatch = Node extends infer N
  ? N extends Node
    ? Partial<Omit<N, 'id' | 'type'>> & { type?: never }
    : never
  : never;

export interface ProjectStore {
  getProjectMeta(): Promise<ProjectMeta | null>;
  loadProject(): Promise<Project | null>;
  saveProjectMeta(meta: ProjectMeta): Promise<void>;

  listNodes(): Promise<Node[]>;
  getNode(id: string): Promise<Node | null>;
  addNode<D extends NodeDraft>(draft: D): Promise<Extract<Node, { type: D['type'] }>>;
  updateNode<T extends NodeType = NodeType>(
    id: string,
    patch: Partial<Omit<Extract<Node, { type: T }>, 'id' | 'type'>> & Record<string, unknown>,
  ): Promise<Extract<Node, { type: T }>>;
  deleteNode(id: string): Promise<void>;
  transmuteNode(
    id: string,
    newType: AdoptableType,
    additional?: Record<string, unknown>,
  ): Promise<Node>;

  findNodesByType<T extends NodeType>(type: T): Promise<Extract<Node, { type: T }>[]>;
  findRelatedNodes(id: string): Promise<Node[]>;

  listEdges(): Promise<Edge[]>;
  addEdge(draft: Omit<Edge, 'id'>): Promise<Edge>;
  updateEdge(id: string, patch: Partial<Omit<Edge, 'id'>>): Promise<Edge>;
  deleteEdge(id: string): Promise<void>;
}

// .tally/ ディレクトリ配下のファイルシステム実装。
export class FileSystemProjectStore implements ProjectStore {
  private readonly paths: ReturnType<typeof resolveTallyPaths>;

  constructor(workspaceRoot: string) {
    this.paths = resolveTallyPaths(workspaceRoot);
  }

  async getProjectMeta(): Promise<ProjectMeta | null> {
    return readYaml(this.paths.projectFile, ProjectMetaSchema);
  }

  async loadProject(): Promise<Project | null> {
    const meta = await this.getProjectMeta();
    if (!meta) return null;
    const [nodes, edges] = await Promise.all([this.listNodes(), this.listEdges()]);
    return { ...meta, nodes, edges };
  }

  async saveProjectMeta(meta: ProjectMeta): Promise<void> {
    await writeYaml(this.paths.projectFile, meta);
  }

  async listNodes(): Promise<Node[]> {
    let entries: string[];
    try {
      entries = await fs.readdir(this.paths.nodesDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    const yamlFiles = entries.filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
    const nodes = await Promise.all(
      yamlFiles.map(async (file) => {
        const node = await readYaml(path.join(this.paths.nodesDir, file), NodeSchema);
        if (!node) throw new Error(`ノードファイルが読み込めない: ${file}`);
        return node;
      }),
    );
    // ファイルシステム順を決定論的にするため id でソート。
    return nodes.sort((a, b) => a.id.localeCompare(b.id));
  }

  async getNode(id: string): Promise<Node | null> {
    return readYaml(path.join(this.paths.nodesDir, nodeFileName(id)), NodeSchema);
  }

  async addNode<D extends NodeDraft>(draft: D): Promise<Extract<Node, { type: D['type'] }>> {
    const candidate = {
      // ProposalNodeSchema の passthrough により NodeDraft['type'] の union narrowing が崩れるため、NodeType へ明示キャストする
      id: newNodeId(draft.type as NodeType),
      ...draft,
    };
    const validated = NodeSchema.parse(candidate) as Extract<Node, { type: D['type'] }>;
    await writeYaml(path.join(this.paths.nodesDir, nodeFileName(validated.id)), validated);
    return validated;
  }

  async updateNode<T extends NodeType = NodeType>(
    id: string,
    patch: Partial<Omit<Extract<Node, { type: T }>, 'id' | 'type'>> & Record<string, unknown>,
  ): Promise<Extract<Node, { type: T }>> {
    const current = await this.getNode(id);
    if (!current) throw new Error(`存在しないノード: ${id}`);
    // null は optional フィールドの「削除」シグナル。
    // これ以外は通常のマージ。id / type は不変。
    const next: Record<string, unknown> = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'type') continue;
      if (v === null) {
        delete next[k];
      } else {
        next[k] = v;
      }
    }
    const validated = NodeSchema.parse(next) as Extract<Node, { type: T }>;
    await writeYaml(path.join(this.paths.nodesDir, nodeFileName(id)), validated);
    return validated;
  }

  async deleteNode(id: string): Promise<void> {
    const filePath = path.join(this.paths.nodesDir, nodeFileName(id));
    try {
      await fs.unlink(filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    // 付随するエッジも除去する (参照整合性)。
    const edges = await this.listEdges();
    const remaining = edges.filter((e) => e.from !== id && e.to !== id);
    if (remaining.length !== edges.length) {
      await this.writeEdges(remaining);
    }
  }

  async transmuteNode(
    id: string,
    newType: AdoptableType,
    additional: Record<string, unknown> = {},
  ): Promise<Node> {
    const current = await this.getNode(id);
    if (!current) throw new Error(`存在しないノード: ${id}`);
    if (current.type !== 'proposal') {
      throw new Error(`proposal 以外は採用対象外: ${current.type}`);
    }
    // read-check-write: 競合時に「採用済みノードを再採用」してしまわないように
    // 書き込み直前にもう一度ファイルから読み直し、type='proposal' を再確認する。
    const reread = await this.getNode(id);
    if (!reread || reread.type !== 'proposal') {
      throw new Error(`proposal 以外は採用対象外: ${reread?.type ?? 'deleted'}`);
    }
    const common = {
      id: reread.id,
      x: reread.x,
      y: reread.y,
      title: stripAiPrefix(reread.title),
      body: reread.body,
    };
    // additional は任意型のフィールドを持つ。undefined 値はキーごとスキップ。
    const merged: Record<string, unknown> = { ...common, type: newType };
    for (const [k, v] of Object.entries(additional)) {
      if (v === undefined) continue;
      merged[k] = v;
    }
    const validated = NodeSchema.parse(merged);
    await writeYaml(path.join(this.paths.nodesDir, nodeFileName(id)), validated);
    return validated;
  }

  async findNodesByType<T extends NodeType>(type: T): Promise<Extract<Node, { type: T }>[]> {
    const all = await this.listNodes();
    return all.filter((n): n is Extract<Node, { type: T }> => n.type === type);
  }

  async findRelatedNodes(id: string): Promise<Node[]> {
    const edges = await this.listEdges();
    const neighborIds = new Set<string>();
    for (const e of edges) {
      if (e.from === id) neighborIds.add(e.to);
      if (e.to === id) neighborIds.add(e.from);
    }
    if (neighborIds.size === 0) return [];
    const nodes = await this.listNodes();
    return nodes.filter((n) => neighborIds.has(n.id));
  }

  async listEdges(): Promise<Edge[]> {
    const data = await readYaml(this.paths.edgesFile, EdgesFileSchema);
    return data?.edges ?? [];
  }

  async addEdge(draft: Omit<Edge, 'id'>): Promise<Edge> {
    const edge: Edge = EdgeSchema.parse({ id: newEdgeId(), ...draft });
    const edges = await this.listEdges();
    edges.push(edge);
    await this.writeEdges(edges);
    return edge;
  }

  async updateEdge(id: string, patch: Partial<Omit<Edge, 'id'>>): Promise<Edge> {
    const edges = await this.listEdges();
    const idx = edges.findIndex((e) => e.id === id);
    if (idx < 0) throw new Error(`存在しないエッジ: ${id}`);
    // id は patch 側で書き換えさせない。from/to の不変性は呼び出し側 (route) で担保する。
    const { id: _ignored, ...safePatch } = patch as Partial<Edge>;
    const next = EdgeSchema.parse({ ...edges[idx], ...safePatch });
    const nextEdges = edges.slice();
    nextEdges[idx] = next;
    await this.writeEdges(nextEdges);
    return next;
  }

  async deleteEdge(id: string): Promise<void> {
    const edges = await this.listEdges();
    const remaining = edges.filter((e) => e.id !== id);
    if (remaining.length === edges.length) return;
    await this.writeEdges(remaining);
  }

  private async writeEdges(edges: Edge[]): Promise<void> {
    await writeYaml(this.paths.edgesFile, { edges });
  }
}
