# ADR-0007: Agent SDK のツール制約を options.tools + permissionMode で実現する

- **日付**: 2026-04-19
- **ステータス**: Accepted
- **関連**: ADR-0002 (Agent SDK 採用) / `docs/superpowers/specs/2026-04-19-phase5a-find-related-code-design.md`

## コンテキスト

Phase 5a で `find-related-code` エージェントを追加する際、「Edit / Write / Bash は使わせない」要件があった。初期実装は Claude Agent SDK の `options.allowedTools` にホワイトリスト 7 項目を渡すだけで十分だと仮定していた。

Phase 5a 完了後の手動 E2E で、想定外のツール呼び出しが観測された:

```
🛠 ToolSearch {...}
🛠 Bash {"command":"pwd && ls"}
🛠 Bash {"command":"ls -R src | head -100"}
🛠 Bash {"command":"ls -la src/"}
```

`allowedTools` に Bash も ToolSearch も入れていないのに、SDK が実行を許可していた。cwd が codebase に固定されていたため実害はなかったが、読み取り専用モード基盤の前提が崩れていた。

SDK の型定義 (`@anthropic-ai/claude-agent-sdk/sdk.d.ts`) を精読したところ、`Options` の各フィールドの意味が以下のとおり判明した:

| フィールド | 実際の意味 |
|---|---|
| `allowedTools` | **自動承認 (auto-approve) リスト**。プロンプト無しで実行される対象を列挙する |
| `disallowedTools` | 明示的に禁止するリスト。モデルから隠される |
| `tools` | **built-in ツール (Bash/Read/Glob/Grep/Edit/Write 等) の使用許可リスト**。空配列なら built-in 全オフ、`['Read','Glob','Grep']` のように列挙すればそれだけに制限される。<br>MCP ツールはここでは指定しない (`mcpServers` 経由で注入済み) |
| `permissionMode` | `'default'` / `'acceptEdits'` / `'bypassPermissions'` / `'plan'` / `'dontAsk'`。<br>`'dontAsk'`: 承認されていないツールは拒否 |
| `settingSources` | `[]` なら `~/.claude/settings.json` 等を読み込まない |

つまり「agent ごとの厳格な whitelist」を成立させるには `allowedTools` 単独では不足で、`tools` と `permissionMode` の組み合わせが必要。

## 決定

全エージェントの SDK 呼び出しで、次の 4 フィールドを常にセットする:

1. `tools`: **registry 宣言の `allowedTools` から `mcp__` 接頭辞を持たない要素だけを抽出**して渡す。built-in ツールの実質的 whitelist。
2. `allowedTools`: registry 宣言の `allowedTools` をそのまま渡す (MCP も built-in も含む)。自動承認のため。
3. `permissionMode: 'dontAsk'`: 承認外は拒否 (プロンプト UI は WS セッションに存在しないため)。
4. `settingSources: []`: 外部 (`~/.claude/settings.json` 等) の許可設定を持ち込まない。

### エージェント別の適用結果

| agent | `tools` | `allowedTools` |
|---|---|---|
| `decompose-to-stories` | `[]` (built-in 全オフ) | 4 件の `mcp__tally__*` |
| `find-related-code` | `['Read','Glob','Grep']` | 上記 4 件 + `Read` / `Glob` / `Grep` |

### 実装の単一入口

built-in とそれ以外の振り分けは registry のエージェント定義ではなく **`agent-runner` 側で `mcp__` 接頭辞を見て分離**する。これにより、新しいエージェントを追加する際の `allowedTools` 宣言が 1 箇所で済み、built-in 分リストの二重管理を避けられる。

```typescript
const builtInTools = def.allowedTools.filter((t) => !t.startsWith('mcp__'));
```

## 理由

1. **`allowedTools` 単独では whitelist にならない**: SDK 仕様 (上記表) と E2E 実測 (Bash が通った) の双方で確認済み
2. **`tools` を設定しないと built-in は preset 扱いで全部使える**: `options.tools` 未指定の既定は `{ type: 'preset'; preset: 'claude_code' }` 相当
3. **`permissionMode: 'dontAsk'` は WS コンテキスト向きの選択**: `'default'` だとプロンプト待ちになるが、バックグラウンドジョブとして動く ai-engine に応答 UI はない。`'dontAsk'` で "未承認は拒否" を明示
4. **`settingSources: []` との併用で外部許可ルートも遮断**: ユーザー個別の `~/.claude/settings.json` にある permission ルールが Tally のエージェント実行に混入するのを防ぐ
5. **registry ≒ 単一真実源**: 各 agent definition の `allowedTools` を唯一の依拠点にすることで、built-in と MCP のリストを二重宣言しなくて済む

## 結果

Phase 5a 実装と E2E の往復で確認:

- 修正前の E2E: `ToolSearch` / `Bash` が複数回呼ばれる
- 修正後の E2E: `Glob` / `Grep` / `Read` / `mcp__tally__*` のみが呼ばれ、それ以外はモデルから完全に見えなくなった
- テスト (`agent-runner.test.ts`): `options.tools` に build-in whitelist が、`options.permissionMode` に `'dontAsk'` が渡ることを mock で検証

## 代替案と却下理由

- **`disallowedTools: ['Bash','Edit','Write','TodoWrite','WebFetch','WebSearch',...]`**: ブロック対象を全列挙する必要があり保守不能。新しい built-in ツールが SDK に追加されるたびに追従が必要
- **`canUseTool` コールバックで動的判定**: 柔軟だが、registry の静的宣言で済む要件に対して過剰。性能コストも発生
- **`allowedTools` のみで済ませる (現状維持)**: SDK 実仕様で成立しないことが E2E で証明されたため却下

## 将来の拡張

- 新しいエージェントを追加するときは、`AgentDefinition.allowedTools` に「使いたいツールを MCP / built-in 問わず全列挙」すれば `agent-runner` が自動的に分離して SDK に渡す
- built-in ツールを何も使わない純粋な「書き込み専用」エージェントは `allowedTools` に `mcp__tally__*` だけ並べれば `tools: []` になる
- 将来 `canUseTool` で行単位の監査ログが欲しくなったら、本 ADR を改訂して導入する
