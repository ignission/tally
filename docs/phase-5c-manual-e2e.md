# Phase 5c 手動 E2E 手順: extract-questions

Phase 5c で追加した `extract-questions` エージェントを実通信で確認する手順。Phase 5b (`docs/phase-5b-manual-e2e.md`) と同形式。

## 前提

- `claude login` 済み (ADR-0006 の Claude Code OAuth) もしくは `ANTHROPIC_API_KEY` を `.env` に設定
- `pnpm install && NODE_ENV=development pnpm -r test` が緑 (Phase 5c 完了時点 257 テスト)
- プロジェクトは任意のサンプル (例: `examples/sample-project`) を使う。**codebasePath 未設定**でも動くことを示すため、プロジェクト設定をクリアした状態から開始する

## シナリオ 1: codebasePath 未設定でも動く

1. `pnpm --filter frontend dev` で開発サーバ起動
2. サンプルプロジェクトを開く。ヘッダの歯車設定で codebasePath を**空にクリア** (未設定状態を作る)
3. 任意の UC ノードをクリック → 詳細ペインに 3 つの AI アクションボタンが並ぶこと
   - 「関連コードを探す」= **disabled**、tooltip に「codebasePath 未設定」
   - 「影響を分析する」= **disabled**、tooltip に「codebasePath 未設定」
   - 「論点を抽出」= **有効** (押せる)
4. 「論点を抽出」をクリック → 進捗パネルに thinking / tool_use (`mcp__tally__create_node` / `create_edge`) が流れる
5. 完了後、対象 UC の近くに紫色の破線 proposal ノードが 0〜5 個生える (生えない場合もあり得るが、0 件でも正常)

## シナリオ 2: 生成された question proposal の構造

1. 生えた proposal ノードを選択 → ProposalDetail が開く
2. タイトルは `[AI] <問い>` 形式 (疑問形 or 「〜を〜にするか」)
3. body に問いの背景 / 決めるべき理由 / 検討観点 (2〜4 行)
4. 採用先 select が `question` になっている (adoptAs='question')
5. 「採用する」ボタンを押す → proposal が正規 question ノード (オレンジ色の破線) に昇格
6. 昇格後の詳細で `options` が 2〜4 個、それぞれ `id` が `opt-xxxxxxxxxx` 形式 + text + `selected: false`
7. `decision` は null (未決定表示、破線スタイル維持)

## シナリオ 3: option を選択して決定、取り消し

1. 昇格後の question ノードで option を 1 つ選択 → 実線 + 「決定」バッジに切り替わる
2. 別の option を選び直す / 決定を取り消す → 破線に戻る (既存動作の回帰なし)

## シナリオ 4: 重複ガード

1. 同じ UC でもう一度「論点を抽出」をクリック
2. 1 回目で生成された question と**同タイトル**の proposal が再生成されない (サーバ側で reject、ストリームログに `重複: anchor <id> に既に同タイトル question 候補 <id> が存在` と出る)
3. **異なる UC / requirement / userstory** で実行した場合は同タイトルでも通ること (別 anchor の近傍を見るため)

## シナリオ 5: 他エージェントとの排他

1. `extract-questions` 実行中に他の AI アクションボタン (「関連コードを探す」等) が disabled になる
2. 完了後にボタン disabled が解除される

## シナリオ 6: anchor 型ガード

- issue / coderef / question / proposal のノードには「論点を抽出」ボタンが出ない (usecase / requirement / userstory の 3 detail にのみ配置されているため)
- UI から直接は叩けないが、WebSocket に直接 `{ agent: 'extract-questions', nodeId: <issue ノードの id> }` を送ると、サーバが `bad_request: extract-questions の対象外: issue` を返して拒否する (Task 3 の validateInput)

## 失敗時のトラブルシュート

- `not_authenticated`: `claude login` を再実行
- `未知の agent: extract-questions`: registry 登録が抜けている、Task 4 / `packages/ai-engine/src/agents/registry.ts` を確認
- `プロジェクト設定で codebasePath を指定してください`: extract-questions が requireCodebasePath=true 相当で動いている。Task 3 の `validateInput` で `{ requireCodebasePath: false }` が渡っているか確認
- proposal が生えない: Anthropic 側のレート制限 or プロンプト指示で 0 件返されただけの可能性 (生成サマリ行で「論点が見えない」と書かれていれば後者、正常)
- options が 0 件 or 1 件: プロンプトの「必ず 2〜4 個の options 候補を添える」指示が軽視されている。`docs/superpowers/specs/2026-04-20-phase5c-extract-questions-design.md` § 3.3 を再確認
