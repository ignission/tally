# Phase 4 手動 E2E テスト手順

このドキュメントは Phase 4 (AI Engine 基盤) の動作を実環境で確認するための手順書です。CI では `ANTHROPIC_API_KEY` / OAuth トークンを使わないため、Phase 4 の完了条件である「Claude と実際に通信して proposal を生成する」フローはここでしか検証できません。

## 前提

- macOS / Linux で作業
- Node.js 20+、pnpm 9+
- `claude` CLI (Claude Code) インストール済み + `claude login` 済み
  - 確認コマンド: `claude whoami`
- API キー運用にする場合は `.env` に `ANTHROPIC_API_KEY` を設定 (ADR-0006 参照)
- `examples/sample-project/` に UC ノードが 1 つ以上含まれていること (初期状態で含まれるはず)

## 起動

```bash
pnpm install
pnpm dev
```

- frontend: http://localhost:3000
- ai-engine: ws://localhost:4000/agent

起動ログで frontend と ai-engine の両方が立ち上がったことを確認する。ai-engine のポートが衝突していたら `AI_ENGINE_PORT` を `.env` で変更。

## 正常系: UC 分解 → 採用

1. ブラウザで http://localhost:3000 を開く
2. プロジェクト一覧から `examples/sample-project` に対応するプロジェクトをクリックして入る
3. Canvas 上の UC ノードをクリックして選択する
4. 画面右の DetailSheet 最下部の「AI アクション」節にある **ストーリー分解** ボタンを押下
5. 画面右下に AgentProgressPanel が現れ、以下のイベントが順に流れることを確認:
   - `▶ start decompose-to-stories`
   - `分解します` 等の thinking テキスト (複数回の可能性あり)
   - `🛠  mcp__tally__...` の tool_use エントリ
   - `← <id> ok` の tool_result
   - `✓ node prop-xxx` と `✓ edge e-xxx` が proposal 数だけ繰り返される
   - `✅ done: ...` 最後に要約
6. Canvas 上に UC ノードから破線の derive エッジで繋がった紫色 (proposal) のノードが 1〜7 個生成されていることを確認
7. ブラウザをリロードし、proposal ノードが YAML に保存されていることを確認 (リロード後も残っていれば OK)
8. proposal ノードを 1 つ選択 → DetailSheet の「採用先」セレクタで `userstory` を選び「採用する」ボタンを押下
9. タイトルから `[AI] ` プレフィックスが消え、ノードが水色 (userstory) の実線表示に切り替わることを確認
10. ターミナルで `git diff examples/sample-project/.tally/` を実行し、`nodes/*.yaml` の type が proposal → userstory に書き換わっていることを確認

## 異常系: 認証エラー

1. `claude logout` で OAuth を解除 (または `.env` に不正な `ANTHROPIC_API_KEY` を設定)
2. `pnpm dev` を再起動
3. 正常系の手順 3-4 を実行 (UC 選択 → ストーリー分解)
4. AgentProgressPanel に `❌ not_authenticated: ...` が表示されることを確認
5. エラーメッセージ内に `claude login` への誘導文言が含まれていれば OK

## 後片付け

- 生成した proposal / userstory を破棄したい場合:
  - Canvas 上で選択 → 「ノードを削除」ボタン
  - または `examples/sample-project/.tally/` 配下を `git checkout -- examples/sample-project/.tally/` で元に戻す

## 完了条件 (ロードマップ Phase 4)

- [ ] UC ノードで「ストーリー分解」ボタンを押すと破線 proposal が生える
- [ ] 生成中の進捗がリアルタイムに表示される
- [ ] 生成後にキャンバスが自動更新される (リロード不要)
- [ ] 認証未設定時に適切なエラー (`not_authenticated`) が UI に表示される

上記 4 項目すべてが手動 E2E で確認できたら Phase 4 完了。

## トラブルシューティング

| 症状 | 対処 |
|---|---|
| `ws://localhost:4000/agent` に接続できない | ai-engine が起動しているか `lsof -i :4000` で確認。ポート衝突なら `AI_ENGINE_PORT` を変更 |
| `not_authenticated` エラーが出続ける | `claude login` を再実行、または `.env` の API キーを確認 |
| proposal が生成されない | ai-engine のログで SDK 例外を確認。SDK バージョンが古い場合は `pnpm update -F @tally/ai-engine @anthropic-ai/claude-agent-sdk` |
| 進捗パネルが表示されない | ブラウザ DevTools Console で WS 接続エラーを確認。`NEXT_PUBLIC_AI_ENGINE_URL` を `.env.local` で明示してみる |

## 参考

- ADR-0002 (Agent SDK 採用)
- ADR-0005 (proposal 採用フロー)
- ADR-0006 (Claude Code OAuth)
- `docs/04-roadmap.md` Phase 4
- `docs/superpowers/specs/2026-04-19-phase4-ai-engine-design.md`
