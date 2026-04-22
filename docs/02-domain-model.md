# 02. ドメインモデル

Tally のキャンバスは「ノード」と「エッジ」からなる有向グラフで表現される。本ドキュメントでは両者の意味論を定義する。

## ノード型

| 型 ID | UI表示 | 色 | 用途 |
|---|---|---|---|
| `requirement` | 要求 | 青 #5b8def | ビジネス側・顧客側から来る「なぜ作るのか」 |
| `usecase` | UC | 緑 #4caf7a | 目的達成のための一連の相互作用 |
| `userstory` | ストーリー | 水色 #3fb8c9 | 実装1スプリント分の価値単位 |
| `question` | 論点 | オレンジ #e07a4a | **まだ決めていない設計判断**（選択肢付き） |
| `coderef` | コード | グレー #8b8b8b | 既存コードベースの特定部位への参照 |
| `issue` | 課題 | 黄 #d9a441 | 解決すべき問題、TODO |
| `proposal` | AI提案 | 紫 #a070c8 | AI生成の叩き台（破線、採用で昇格） |

### ノードの共通属性

```typescript
interface Node {
  id: string;
  type: NodeType;
  x: number;
  y: number;
  title: string;
  body: string;
}
```

### 型固有の属性

#### requirement（要求）

規格対応用の拡張属性を持つ（現時点では UI 未表示）。

```typescript
interface RequirementExtensions {
  kind?: 'functional' | 'non_functional' | null;
  qualityCategory?: /* ISO 25010 のカテゴリ */ null;
  priority?: 'must' | 'should' | 'could' | 'wont' | null;
}
```

#### userstory（ストーリー）

```typescript
interface UserStoryExtensions {
  acceptanceCriteria?: { id: string; text: string; done: boolean }[];
  tasks?: { id: string; text: string; done: boolean }[];
  points?: number; // フィボナッチ: 1, 2, 3, 5, 8, 13
}
```

本文は「〇〇として／〜したい／なぜなら〜」形式（Mike Cohn スタイル）を想定。

#### question（論点）

```typescript
interface QuestionExtensions {
  options?: { id: string; text: string; selected: boolean }[];
  decision?: string | null; // 選ばれた option の id
}
```

`decision === null` なら未決定、そうでなければ決定済み。UI では破線と実線で切り替わる。

`extract-questions` エージェント (Phase 5c) が proposal として生成する。proposal 時点で `options` 候補 (2〜4 個) を含み、`decision` は null。人間が採用後に決定する。

#### coderef（コード参照）

```typescript
interface CodeRefExtensions {
  filePath?: string;
  startLine?: number;
  endLine?: number;
  summary?: string;  // 現状要約 (AI 生成時の初期値)
  impact?: string;   // 実装で変わる方向性 (analyze-impact 由来)
}
```

#### proposal（AI提案）

```typescript
interface ProposalExtensions {
  adoptAs?: NodeType; // 採用時にどの型に昇格するか
  sourceAgentId?: string; // どのエージェントが生成したか
}
```

## エッジ型（SysML 2.0 準拠）

内部識別子は SysML 2.0 の要求関係ステレオタイプに準拠する。UI 表示は日本語。

| 内部ID | UI表示 | 用途 | 線種 |
|---|---|---|---|
| `satisfy` | 充足 | 上位要求を下位要素が満たす（要求 → UC） | 実線 |
| `contain` | 分解 | 親子構造（UC → ストーリー） | 長短破線 |
| `derive` | 派生 | 導出関係（ストーリー → コード、要素 → 課題） | 破線 |
| `refine` | 詳細化 | より具体的に説明する、または影響する | 点線 |
| `verify` | 検証 | テストが要素を検証する | 破点線 |
| `trace` | 関連 | 上記に当てはまらない弱い関連（汎用） | 細かい点線 |

### 使い分けのガイドライン

- **迷ったら `trace`**：後から具体化する前提で OK
- **要求→UC/ストーリー**：`satisfy`
- **UC→ストーリー**：`contain`（親子の分解）
- **AI提案の派生**：`derive`
- **コードへの参照**：通常 `derive` または `refine`
- **課題の導出**：`derive`
- **テスト連携**（将来）：`verify`

### エッジの向き

矢印は常に「上流→下流」の方向。要求が UC を持つ、UC がストーリーを持つ、ストーリーがコードを指す、という流れ。

## 色とスタイルの意味

- **実線**：確定済み
- **破線**：未確定・AI提案・未決定論点
- **半透明**：決定済み論点（少しフェードして過去の判断を示す）

## 正規化の流れ

AI提案（proposal）から正規ノードへの昇格フロー。

```
[AI提案] ──採用──→ [正規ノード]
 紫・破線              型に応じた色・実線
```

採用時：
1. `type` が `proposal` → 指定された型（adoptAs の値、またはユーザー選択）に変更
2. タイトルの `[AI]` プレフィックスを削除
3. ボディ・属性はそのまま継承

## プロジェクト

複数のノード・エッジを束ねる単位。

```typescript
interface Codebase {
  id: string;
  label: string;
  path: string; // AI が探索する Git リポジトリの絶対パス
}

interface Project {
  id: string;
  name: string;
  description?: string;
  codebases: Codebase[]; // 紐付けられた Git リポジトリ（複数可）
  nodes: Node[];
  edges: Edge[];
  createdAt: string;
  updatedAt: string;
}
```

## 永続化形式

プロジェクトは任意のディレクトリ（projectDir）直下に YAML ファイルとして保存する。`.tally/` サブディレクトリは設けない。

```
~/.local/share/tally/projects/taskflow-invite/  # projectDir の例
├── project.yaml         # メタデータ（codebases[] を含む）
├── nodes/
│   ├── req-invite.yaml
│   ├── uc-send-invite.yaml
│   └── ...
├── edges/
│   └── edges.yaml
└── chats/
    └── <thread-id>.yaml
```

既知プロジェクトの一覧は `$TALLY_HOME/registry.yaml`（デフォルト: `~/.local/share/tally/registry.yaml`）で管理する。

詳細は ADR-0008（プロジェクト独立化）、ADR-0009（レジストリ）、ADR-0010（`codebases[]`）を参照。旧 ADR-0003 は Superseded。

## 参考資料

- [SysML 2.0 公式](https://www.omg.org/spec/SysML/2.0/)
- [Mike Cohn "User Stories Applied"](https://www.mountaingoatsoftware.com/books/user-stories-applied)
- [Gherkin（Given/When/Then）](https://cucumber.io/docs/gherkin/)
- [ISO/IEC 25010](https://iso25000.com/index.php/en/iso-25000-standards/iso-25010)
- [IEEE/ISO/IEC 29148](https://www.iso.org/standard/72089.html)
