# @tally/storage

プロジェクトデータの永続化層。`.tally/` ディレクトリ配下の YAML ファイルを読み書きする。

## 責務

- プロジェクト・ノード・エッジの CRUD
- YAML ファイルの読み書き（バリデーション付き）
- ファイル監視（外部変更の反映）
- `ProjectStore` インターフェースによる抽象化（将来 DB に差し替え可能）

## 技術選定

- **`js-yaml`**: YAML パース/生成
- **`zod`** (via `@tally/core`): スキーマバリデーション
- **`chokidar`**: ファイル監視（Phase 3 以降）

ADR-0003 参照。

## ディレクトリ構造

```
src/
├── project-store.ts        # ProjectStore インターフェース実装
├── yaml.ts                 # YAML ユーティリティ
├── paths.ts                # .tally/ ディレクトリのパス解決
├── watcher.ts              # ファイル監視 (Phase 3)
└── index.ts                # 公開API
```

## ディレクトリ構造（永続化対象）

```
<workspace_root>/
└── .tally/
    ├── project.yaml
    ├── nodes/
    │   ├── req-<id>.yaml
    │   ├── uc-<id>.yaml
    │   ├── story-<id>.yaml
    │   ├── q-<id>.yaml
    │   ├── code-<id>.yaml
    │   ├── issue-<id>.yaml
    │   └── prop-<id>.yaml
    └── edges/
        └── edges.yaml
```

## ProjectStore インターフェース

```typescript
interface ProjectStore {
  // Project
  listProjects(): Promise<Project[]>;
  getProject(id: string): Promise<Project | null>;
  createProject(project: Omit<Project, 'id'>): Promise<Project>;
  updateProject(id: string, patch: Partial<Project>): Promise<Project>;
  deleteProject(id: string): Promise<void>;

  // Node
  addNode(projectId: string, node: Omit<Node, 'id'>): Promise<Node>;
  updateNode(projectId: string, nodeId: string, patch: Partial<Node>): Promise<Node>;
  deleteNode(projectId: string, nodeId: string): Promise<void>;
  findNodesByType(projectId: string, type: NodeType): Promise<Node[]>;
  findRelatedNodes(projectId: string, nodeId: string): Promise<Node[]>;

  // Edge
  addEdge(projectId: string, edge: Omit<Edge, 'id'>): Promise<Edge>;
  deleteEdge(projectId: string, edgeId: string): Promise<void>;
}
```

AI Engine から呼び出されるため、`@tally/storage` は AI Engine の依存にもなる。

## テスト

各 CRUD 操作について、実際のファイルシステム（tmp ディレクトリ）でテスト。

```bash
pnpm --filter @tally/storage test
```
