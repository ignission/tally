# Tally

> 既存システムの機能追加を、視覚的に要件定義するためのAIネイティブな思考環境

## 名前の由来

**Tally** は航空戦闘における無線用語で「**目標視認確認**」を意味します。パイロットが「Tally!」と報告する瞬間は、散らばった情報の中から確かな存在を発見し、認識を共有する瞬間です。

このツールの中核もまた発見の連続です。既存コードから関連モジュールを**発見**し、要件の中から未決定の論点を**発見**し、AIからの提案を吟味して採用に値するものを**発見**する。動詞としての tally には「照合する・対応付ける」の意味もあり、要求とコードを照合しながら思考を重ねていく作業とも響き合います。

## これは何

Tally は「**要求から設計までの思考プロセス**」をキャンバス上で行うためのツールです。要件定義の工程で生じる以下の課題を解決することを目指しています。

- 文字ばかりのドキュメントが頭に入ってこない
- 要件の粒度と書き方が統一されない
- 俯瞰して見るための図を描いてもしっくりこない
- 課題管理と要件定義書が別々で行き来が面倒
- 既存コードを読みながら新機能を設計する作業が非効率

Tally では、要求・ユースケース・ユーザーストーリー・論点・既存コード・課題を**同じキャンバス上のノード**として扱い、相互の関係を SysML 準拠のエッジで接続します。さらに Claude Agent SDK を内蔵し、既存コードベースを読みながら要件の詳細化・論点抽出・影響分析を AI に支援させます。

## 特徴

- **ノードに型がある**：要求/UC/ストーリー/論点/コード/課題/AI提案の7種
- **SysML 2.0 準拠のエッジ**：satisfy / contain / derive / refine / verify / trace
- **論点ノード**：「まだ決めていない設計判断」を一等地で扱う（選択肢候補付き）
- **AI提案の分離**：AIが生成した内容は破線のproposalノード、人間が採用して正規化
- **既存コード参照**：リポジトリと紐付けて、AIが関連コードを探索
- **YAML永続化**：プロジェクトは任意のディレクトリに保存、Git管理・バージョン追跡できる
- **Claude Agent SDK 内蔵**：コード読解・自律的ツール呼び出しが最初から動く

## スクリーンショット

> プロトタイプ画面の例（架空プロジェクト「TaskFlow 招待機能追加」）
>
> _TODO: プロトタイプが動いたら画像を追加_

## 状態

**Phase 5 完了 / プロジェクトストレージ再設計実装済み** (2026-04-21 時点): AI Engine 基盤・全 AI アクション・チャットパネルが動作。ストレージ設計を刷新（ADR-0008/0009/0010）し、プロジェクト = 任意のディレクトリ、レジストリ管理、`codebases[]` 配列による複数コードベース対応が完了。

詳細は [ロードマップ](docs/04-roadmap.md) を参照。

## 起動方法

### 前提

- Node.js 20+
- pnpm 9+
- `claude` CLI (Claude Code) インストール済み + `claude login` 済み
  - ADR-0006 により、Tally は Claude Code の OAuth トークンを暗黙利用する
  - API キーで動かしたい場合は `.env` に `ANTHROPIC_API_KEY` を設定

### セットアップ

```bash
pnpm install
cp .env.example .env  # 必要なら編集
```

### 開発サーバ起動

```bash
pnpm dev
```

- frontend: http://localhost:3321
- ai-engine: ws://localhost:3322/agent

`pnpm dev` は `pnpm -r --parallel dev` を呼び、frontend (Next.js dev) と ai-engine (tsx watch) を並列起動する。

### 利用フロー (要点)

1. ブラウザで http://localhost:3321 を開く
2. 「+ 新規プロジェクト」でフォルダ選択ダイアログから保存先を選ぶ（`~/.local/share/tally/projects/<名前>/` が提案される）
3. 任意で 1 つ以上の「コードベース」（AI が探索する対象リポジトリ）を追加して「作成」
4. UC ノードを選択 → DetailSheet の「ストーリー分解」ボタンを押下
5. AgentProgressPanel に進捗が流れ、破線の proposal ノードが生成される
6. 各 proposal を選択 → 「採用する」で userstory に昇格

または `examples/sample-project` をプロジェクトディレクトリとして読み込むとデモが確認できる。

### 外部 MCP (Atlassian) の OAuth セットアップ

ADR-0011 で Tally は OAuth 2.1 フローをプロセス内で完結させる設計に統一した。Atlassian MCP を使う場合は以下の手順:

1. **OAuth client を Atlassian で発行**: developer.atlassian.com → OAuth 2.0 (3LO) アプリを新規作成。redirect URI は loopback (`http://127.0.0.1:<port>/callback`) を登録する。Atlassian の developer console は redirect URI を完全一致で検証するため、Tally を一度起動して認証ボタンを押すと表示される **実際のポート番号** をコピーして登録する必要がある (例: `http://127.0.0.1:54801/callback`)。今後 Atlassian が「loopback を port 任意で許可」する仕様改定 (RFC 8252) に追従するまでの暫定運用。詳細は [Atlassian OAuth 2.1 docs](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/) を参照
2. **Tally の Project Settings を開く** (歯車アイコン) → 「MCP サーバーを追加」
3. **id / name / url / OAuth Client ID** を入力して **保存** (id は `atlassian` を推奨。`mcp__<id>__*` の wildcard が AI tool 名に展開されるため)
4. 保存後に同じ行に表示される **「🔓 認証 (新規タブ)」ボタン** をクリック → 別タブで Atlassian の認可画面が開く → 承認すると自動でカードが「認証済」に切り替わる
5. Chat で `@JIRA EPIC-1` のように外部 MCP ツールを呼べるようになる

トークン期限は `buildMcpServers` が透過的に refresh する (5 分以内に切れる場合 `refresh_token` を使って自動更新)。refresh が失敗した場合 (token revoked 等) は再度 Settings から認証する必要がある。token は `<projectDir>/oauth/<mcpServerId>.yaml` に file mode 600 で保存される (ADR-0011)。

## ドキュメント

実装に着手する前に、最低でも以下を読んでください。

- [コンセプト](docs/01-concept.md)：何を解決するツールか
- [ドメインモデル](docs/02-domain-model.md)：ノード型・エッジ型の意味論
- [アーキテクチャ](docs/03-architecture.md)：システム構成
- [ロードマップ](docs/04-roadmap.md)：実装の段階
- [ADR](docs/adr/)：重要な設計判断の記録

## Claude Code による実装

このプロジェクトは [Claude Code](https://claude.com/product/claude-code) による実装を前提に設計されています。

1. リポジトリをクローンして Claude Code を起動
2. `CLAUDE.md` を読ませて開発コンテキストを把握させる
3. `docs/04-roadmap.md` の Phase 1 から順に実装

## ライセンス

MIT

## 作者

西立野 (Ignission)
