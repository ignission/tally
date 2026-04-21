# ADR-0005: AI 提案（proposal）の採用フロー

- **日付**: 2026-04-19
- **ステータス**: Accepted

## コンテキスト

Phase 3 実装中に、AI 提案ノード（`type: 'proposal'`）を正規ノード（requirement / usecase / userstory / question / coderef / issue）へ昇格する「採用」操作の API / storage 契約が未定義であることが明らかになった。

既存コードの状況:

- `ProposalNodeSchema` には `adoptAs?: NodeType` と `sourceAgentId?: string` が定義されている
- ノード PATCH ルート（`/api/projects/:id/nodes/:nid`）は **`type` の変更を 400 で拒否**している（discriminated union の整合性を守る意図）
- `docs/02-domain-model.md` の「正規化の流れ」は「`type` が `proposal` → 指定された型に変更」「タイトルの `[AI]` プレフィックスを削除」「ボディ・属性はそのまま継承」と記述している

したがって、採用操作は「ID を保ちつつ `type` を書き換える」特殊操作である必要があるが、通常の PATCH 経路ではこれができない。

Phase 4 で AI エージェントが `proposal` ノードを大量に生成し、人間がそれを採用する UX が主要ループになるため、この契約を明確化する必要がある。

## 決定

**専用エンドポイント方式**を採用する。

### API

```
POST /api/projects/:projectId/nodes/:nodeId/adopt

Body:
{
  "adoptAs": "requirement" | "usecase" | "userstory" | "question" | "coderef" | "issue",
  "additional"?: { /* 採用先 type 固有の追加属性 */ }
}

Response 200:
{
  "id": "<同じ nodeId>",
  "type": "<adoptAs の値>",
  "x": <保持>,
  "y": <保持>,
  "title": "<[AI] プレフィックスを除去した値>",
  "body": "<保持>",
  /* 採用先 type の固有属性（additional から抜粋、必要なデフォルト付与） */
}

Response 400: 対象ノードが proposal 以外 (冪等性) / adoptAs 不正 / スキーマ違反
Response 404: プロジェクト or ノードが存在しない
```

### `adoptAs` の許可集合

`adoptAs` は **`proposal` 以外の `NodeType`** のみ受け付ける。`ProposalNodeSchema.adoptAs: z.enum(NODE_TYPES)` は `proposal` も技術的には含むが、API 層で除外する（proposal → proposal の変換は意味がないため）。

実装時は:

```typescript
type AdoptableType = Exclude<NodeType, 'proposal'>;
```

この型で入力を絞る。`schema.ts` 側も将来整理する場合は別 PR で（現状は YAGNI）。

### `additional` の型別要件

採用先 type ごとに必須フィールドの扱いを定義する:

| adoptAs | additional の要件 |
|---|---|
| `requirement` | 任意。kind / priority / qualityCategory が来れば検証、無ければ undefined |
| `usecase` | additional 不要（共通属性のみ） |
| `userstory` | 任意。acceptanceCriteria / tasks / points が来れば検証、無ければ undefined（空配列にはしない） |
| `question` | 任意。options / decision が来れば検証。UI から採用する場合は「論点は常に空の選択肢を 1 つ持つ」としたい場合があるが、**ADR 範囲外**とし UI 側のデフォルト（Task 9 の QuestionDetail が初期入力を促す）に委ねる |
| `coderef` | 任意。filePath / startLine / endLine が来れば検証 |
| `issue` | additional 不要 |

`additional` はまず `Record<string, unknown>` として受け取り、`transmuteNode` 内で「採用先 type の共通属性 + additional」をマージしてから `NodeSchema.parse` で検証する。

### Storage

`ProjectStore` に以下のメソッドを追加する:

```typescript
transmuteNode(
  id: string,
  newType: Exclude<NodeType, 'proposal'>,
  additional?: Record<string, unknown>,
): Promise<Node>
```

実装方針:

1. 現ノードを読み込み（存在チェック → なければ `Error('存在しないノード: ${id}')` を throw、API 層で 404 にマップ）
2. 元ノードが `proposal` でない場合は `Error('proposal 以外は採用対象外: ${current.type}')` を throw（API 層で 400 にマップ、**冪等性の代わりに明示的な失敗**を返す。既に採用済みのノードに対する再採用は意味が変わるため、"OK" ではなく "400 Already Adopted" 相当とする）
3. 共通属性（`id`, `x`, `y`, `title`, `body`）を継承
4. `title` の先頭 `[AI]` プレフィックスを削除（正規表現 `^\s*\[AI\]\s*`）
5. `sourceAgentId` / `adoptAs` は破棄（proposal 固有属性）
6. `additional` から採用先 type の固有属性を受け取り、マージしてから `NodeSchema.parse` で検証
7. YAML ファイル（`<id>.yaml`）を単一書き込みで上書き（ID 不変なので同一ファイル）

エッジは自動的に維持される（`edges.yaml` の `from` / `to` が旧 ID を参照、採用後も同 ID なので参照が生きる）。

### 冪等性と競合

- **冪等性なし**（意図的）: 同一 proposal への `POST /adopt` 2 回目は 400 を返す。単純な「既に採用済み」ガードだが、クライアント側で "二重送信対策" は必要（Task 6 の楽観更新と同じ扱い）
- **競合時の挙動**: 複数タブから同時に `POST /adopt` が来た場合、YAML ファイル上書きが直列化されるため後発が上書きする。ただし両方とも `current.type === 'proposal'` チェックを通ってしまうと、後発は既に別 type になったノードを「再採用」しようとし、`parse` で不整合が起きる可能性がある。実装では **書き込み前にもう一度ファイルを読み直し、`type === 'proposal'` を確認してから書く**（read-check-write）。Phase 3 の単一ユーザー前提では競合は稀だが、Phase 6 の Yjs 導入前提で正確な契約を固めておく

### Frontend store

Zustand に `adoptProposal(id, adoptAs, additional?)` を追加:

```typescript
adoptProposal: async (id, adoptAs, additional) => {
  // 非楽観: POST 応答を待って本物の Node で置き換える (Type が変わるため楽観は複雑)
  const adopted = await adoptProposalApi(pid, id, adoptAs, additional);
  set({ nodes: { ...get().nodes, [id]: adopted } });
  return adopted;
}
```

既存 `patchNode` との対称性より **非楽観**を推奨。採用は意図的な操作で、直後の表示がサーバ応答由来であることが重要（`[AI]` プレフィックス除去結果などが一致する）。

### UI

`ProposalDetail`（Phase 4 で実装予定）に「採用」ボタンを置く。クリック時:

1. `adoptAs` を選ぶ小さなセレクタを表示（デフォルトは `node.adoptAs` の値）
2. 採用ボタンで `adoptProposal(node.id, adoptAs)` を呼ぶ
3. 楽観更新はしない（type 変化が絡むため、失敗時のロールバックが複雑）

### トレース情報

採用後の正規ノードには `sourceAgentId` は **残さない**（proposal 固有属性として破棄）。監査が必要な場合は Git history（`.tally/nodes/<id>.yaml` の変更履歴）で追える。将来要求が出たら `adoptedFrom?: { proposalId: string; sourceAgentId: string; adoptedAt: string }` を通常 Node に追加する ADR を別途書く。

## 理由

1. **ID 不変**: エッジ（`from` / `to` で ID を参照）を壊さない。Phase 3 で確立した「PATCH は ID を変えない」原則（ADR なし、edges/updateEdge で実装済み）と整合
2. **通常の PATCH 経路を汚染しない**: `type` 不変ルールは discriminated union の整合性を守る上で重要。例外を PATCH に入れず、専用エンドポイントで意味論を分離
3. **中間状態の最小化**: ファイル書き込みは `<id>.yaml` の単一上書きで完了する。delete+re-add 案の「削除成功・追加失敗で孤児エッジ発生」のような中間状態が存在しない（YAML 永続化では真の分散トランザクションは不要）
4. **スキーマ検証が単一入り口**: `NodeSchema.parse` 1 回で終わる。delete+re-add 方式だと削除と追加を別に検証する必要がある
5. **将来の拡張性**: 採用時に追加の変換ロジック（例：UC 採用時に自動で AC スケルトンを生成）を `transmuteNode` に閉じ込めやすい

## 影響

### メリット

- Phase 4 の AI 出力 → 採用フローが単純になる
- エッジが壊れないので `derive` / `refine` 関係が維持される
- REST 的に「POST /adopt」は意味が明確

### デメリット / 制約

- エンドポイントが増える（`POST /adopt`）
- `transmuteNode` 実装時に「proposal の固有属性を落とす」ロジックを書き切る必要あり
- UI 側で採用前の `adoptAs` 選択 UI が必要（MVP では proposal 側に付与された値をデフォルトで採用し、ユーザーが変えたければプルダウン）

### 将来の拡張余地

- `POST /adopt` のバッチ版 `POST /adopt-many` — 複数 proposal を一括採用
- `adoptedFrom` フィールドを通常 Node に追加し、AI 生成履歴を YAML に明示的に残す
- `Undo` 操作（採用取り消し）— proposal に戻す `transmuteNode(id, 'proposal', ...)` は可能だが、sourceAgentId 等が失われているため再構築不可。Phase 6 以降の Undo/Redo スタックで吸収

## 考慮した他の選択肢

### 選択肢 1: delete → re-add

現行 PATCH の type 拒否から自然に導かれる挙動。クライアントが `DELETE` + `POST` を 2 リクエストで実行。

- ✗ ID が変わるため接続エッジが孤児化する
- ✗ 原子性なし（削除成功・追加失敗の中間状態）
- **採用せず**

### 選択肢 2: PATCH で条件付き type 変更を許可

`type: 'proposal'` → 他 type への遷移のみ許可する条件を PATCH に追加。

- ✗ PATCH のセマンティクスが複雑化（一般の type 変更は不許可、proposal からのみ許可という例外）
- ✗ discriminated union 検証が 1 パスでは不足、2 段階検証が必要
- ✗ レビュー時に「この PATCH は type を変えるか？」を毎回考える負担
- **採用せず**

### 選択肢 3: 採用 = ノード新規作成 + proposal 削除を 1 トランザクションで

`POST /adopt` は同じだが、内部では新 ID を採番して元 proposal を削除する。

- ✗ エッジ `from`/`to` の更新が必要になる（ID 付替え）
- ✗ storage にトランザクション相当の仕組みが必要
- ✗ ID 履歴が分断される（Git history が追いにくい）
- **採用せず**（決定案の方が単純）

## 監査要件（非目標）

採用操作の監査ログは **Git history を正とする**。`.tally/nodes/<id>.yaml` の変更差分に、proposal から別 type への変化が記録される。別途監査テーブルや JSON ログは持たない。より厳密な監査が要求されたら ADR-00XX で別途検討する（この ADR の範囲外）。

## 実装スケジュール

Phase 4 の AI Engine 基盤実装と並行して着手する:

1. **Phase 4 初期**: `transmuteNode` / `adoptProposal` API / storage 実装（この ADR に沿って）+ 単体テスト
2. **Phase 4 中期**: `ProposalDetail` UI を追加、採用ボタン配線
3. **Phase 4 後期**: AI エージェント `decompose-to-stories` の出力（proposal 群）を実運用で採用する手動 E2E 確認

**Phase 4 では実装しない**（将来 ADR 化が要れば別途）:

- バッチ採用（複数 proposal を一括）
- Undo（採用取り消し）
- 採用時の自動補助（UC 採用時に AC スケルトン自動生成、等）

## 参考

- [ADR-0001: SysML 2.0 準拠](./0001-sysml-alignment.md) — エッジ種別の不変性
- `docs/02-domain-model.md` — 「正規化の流れ」節
- `docs/04-roadmap.md` — Phase 4 以降
- `packages/core/src/schema.ts` — `ProposalNodeSchema`
