# ADR-0002: Claude Agent SDK を AI エンジン基盤として採用

- **日付**: 2026-04-18
- **ステータス**: Accepted

## コンテキスト

Tally の中核機能である「既存コードベースを読みながら要件を組み立てる」を実現するには、以下が必要。

1. Claude API との対話
2. ツール実行ループ（Claude がツール呼び出し、結果を返す）
3. ファイルシステム操作（Read/Glob/Grep/Edit）
4. コンテキスト管理（長時間対話の圧縮）
5. エラーハンドリング、リトライ

これらを自前実装するか、既存の基盤を使うかの判断が必要。

## 決定

[Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk) を採用する。

### 理由

- Claude Code と同じエージェントループ、コンテキスト管理、ツール実行を利用できる
- 組み込みツール（Read, Glob, Grep, Edit, Bash 等）が最初から動く
- カスタムツール機構（`@tool` デコレータ / `createSdkMcpServer`）で Tally 固有操作を追加できる
- 自前実装すると数ヶ月かかる機能が即座に使える
- TypeScript / Python 両対応

### TypeScript を選択

フロントエンドと言語を揃え、型定義を `packages/core` で共有するため TypeScript を選ぶ。

## 影響

### メリット

- AI エンジンの実装工数が大幅に削減
- Claude Code と同品質のコード読解能力を享受
- MCP サーバー対応が容易

### デメリット / 制約

- **プロプライエタリライセンス**（`@anthropic-ai/claude-agent-sdk`）：OSS として公開する際、このライブラリに依存することを README で明記する
- **Claude 専用**：ローカル LLM や他社 LLM を使いたい場合、別途抽象化層が必要
- **認証は API キー必須**：エンドユーザーが自分で API キーを用意する必要がある

> **注**: この条項は ADR-0006 で更新された。実運用では Claude Code の OAuth トークンを利用し、`ANTHROPIC_API_KEY` はフォールバックとする方針に切り替え済み。

## 考慮した他の選択肢

1. **素の Anthropic Client SDK で自前実装**：ツールループ・コンテキスト管理を全部書く必要あり、工数大きすぎ
2. **LangChain / LangGraph**：より汎用だが、コード読解特化のツールが弱い
3. **最初から抽象化層を作る**：過剰設計、YAGNI 違反

## 将来の拡張余地

ローカル LLM 対応が強く求められた場合、AI エンジン層を抽象化して差し替え可能にする。その際は別途 ADR を作成。

## 参考

- [Agent SDK overview](https://docs.claude.com/en/api/agent-sdk)
- [Building agents with the Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)
