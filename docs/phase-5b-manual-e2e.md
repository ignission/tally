# Phase 5b: analyze-impact 手動 E2E 手順

Phase 5b の手動検証手順。CI ではなく、Claude Agent SDK との実通信を含むため人手で実行する。

## 前提

- Phase 5a の手動 E2E (`docs/phase-5a-manual-e2e.md`) を実施済み
- `examples/taskflow-backend/` が存在 (Phase 5a で用意済み)
- Claude Code OAuth 認証済み

## 手順

1. `pnpm --filter ai-engine dev` と `pnpm --filter frontend dev` を並行起動
2. ブラウザで sample-project を開く
3. ヘッダ歯車 → codebasePath が `../taskflow-backend` に設定済みであることを確認
4. UC `uc-send-invite` を選択
5. まず「関連コードを探す」を実行 → coderef proposal が 2-3 件生成された状態にする
6. 同 UC で「影響を分析する」ボタンを押す

## 期待結果

AgentProgressPanel に以下のストリームが流れる:

- `thinking`
- `tool_use(mcp__tally__find_related)` で既存 coderef を取得
- `tool_use(mcp__tally__list_by_type)` で重複確認
- `tool_use(Glob / Grep / Read)` でコード探索
- `node_created` coderef proposal × 0-5 (重複は create_node のサーバ側ガードで弾かれる)
- `node_created` issue proposal × 0-5
- `edge_created` anchor → proposal の derive × N
- `result` で 3-4 行の日本語要約

Canvas には以下が反映される:

- 新規 coderef proposal (既存 filePath と重複しないもの) が破線で配置
- issue proposal が破線で配置
- anchor から各 proposal に derive エッジ

proposal のデータ検証:

- coderef proposal の body 冒頭に「影響: 〜」が含まれる
- coderef proposal の additional に `summary` / `impact` / `filePath` / `startLine` / `endLine` が含まれる
- `sourceAgentId: analyze-impact` が YAML (`.tally/nodes/*.yaml`) に刻まれる
- issue proposal を 1 件採用 → 黄色の issue ノードに昇格

## UX 誘導の検証

- find-related-code 未実行の UC で `AnalyzeImpactButton` の tooltip が「まず『関連コードを探す』で既存コードを紐づけると精度が上がります」になる
- find-related-code 実行後は tooltip が通常文言「実装時に変更が必要な既存コードと課題を洗い出します」に切り替わる
- いずれの状態でもボタンは disabled にはならない (codebasePath 未設定 / 他エージェント実行中を除く)

## 境界テスト

影響の薄い孤立 requirement に analyze-impact を実行 → 0 件で正常終了、result 要約に「特に影響なし」相当のメッセージ。

## 重複ガードの検証

テスト用に、同じ filePath + 近い startLine (±10 行以内) を指す AI 生成をわざと誘発する状況 (関連コード → 影響分析を連続実行) を再現。create_node が `{ok: false, output: '重複: ...'}` を返し、同一箇所の coderef が 2 つ以上作られないことを確認する。

## 完了条件

- 上記手順が手動で動作する
- `pnpm -r test` 全緑
- `pnpm -r typecheck` 全緑
- `pnpm -r biome` 緑

以上が Phase 5b 完了の条件。
