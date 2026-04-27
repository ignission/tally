# Dogfood Log — Atlassian MCP C フェーズ

> **目的**: 10 個の Jira エピックで C フェーズ Success Criteria を測定し、A フェーズの ingest-jira-epic agent プロンプト設計の入力を作る。

## Setup

### MCP サーバーの選択肢

#### (A) Atlassian 公式 Rovo MCP — OAuth 2.1 (推奨)

- URL: `https://mcp.atlassian.com/v1/mcp`
- 認証: ユーザーが初回 Tally Chat 利用時に Claude Agent SDK が WWW-Authenticate を解釈し、
  ブラウザ経由で OAuth 2.1 を実行。token は SDK が管理し、Tally process には保存されない。
- 制約: Atlassian Cloud 専用 (Server/DC 非対応)。

#### (B) sooperset/mcp-atlassian — credentials は MCP server 側で管理

```bash
# Cloud に対する Basic auth で起動 (token は MCP server プロセスに留まる)
JIRA_USERNAME=you@example.com JIRA_API_TOKEN=xxx \
  uvx mcp-atlassian --transport streamable-http --port 9000

# Server/DC に対する Bearer auth で起動
JIRA_PERSONAL_TOKEN=xxx JIRA_URL=https://jira.your-company.example \
  uvx mcp-atlassian --transport streamable-http --port 9000
```

または Docker:
```bash
docker run -p 9000:9000 -e JIRA_PERSONAL_TOKEN=xxx -e JIRA_URL=... \
  ghcr.io/sooperset/mcp-atlassian:latest --transport streamable-http --port 9000
```

**Tally は (A)/(B) いずれの場合も credentials を一切持ちません。** Tally プロセスから PAT/API key
が漏れる経路が無いことが Premise 9 撤回後の設計です。

### Tally プロジェクト設定

プロジェクト設定ダイアログ → MCP サーバーを追加:
- ID: `atlassian`
- 名前: `Atlassian Cloud` (任意)
- URL: 上の (A) なら `https://mcp.atlassian.com/v1/mcp`、(B) なら `http://localhost:9000/mcp`
  (loopback の http はテスト用に許容)

### 初回 OAuth フロー (ケース A)

1. Tally Chat で `@JIRA EPIC-XXX 読んで論点出して` を投げる
2. SDK が 401 を受けて WWW-Authenticate から OAuth metadata を取得
3. ブラウザが開き Atlassian で auth、token は SDK 内部に保存
4. 自動で再リクエストが走り、tool 呼び出しが成功する
5. 以降は token が refresh される間、再認証は不要

## Epic 1-10

各エピックについて以下の項目を記録する。

### Epic N: <JIRA-KEY>

- **エピック概要** (1 行):
- **規模**: 子チケット ___ 件、コメント総数 ___ 件
- **Turn 1**: `@JIRA <JIRA-KEY> を読んで論点を出して`
  - 所要時間: ___ 秒 (target: 90 秒以内)
  - 生成 question proposal: ___ 個 (target: 3 個以上)
  - 採用: ___ 個、却下: ___ 個
  - 採用判断の理由 (採用/却下それぞれ箇条書き):
- **Turn 2 (multi-turn test)**: `続けて子チケット <STORY-KEY> も読んで論点を追加して`
  - AI が前ターンの Epic 内容を覚えているか: YES / NO
  - 生成 question proposal: ___ 個
  - 採用: ___ 個
- **「気づかなかった論点」判定**: YES / NO
  - YES なら具体内容:
- **重複ガード動作**: 同 URL 2 度目取り込み → sourceUrl guard 発動: YES / NO

---

(Epic 2-10 を同フォーマットで)

## 集計

### 量的基準

- 合計生成 question proposal: ___ 個
- 合計採用数: ___ 個
- **採用率**: ___ % (target: **50%+**)
- 90 秒以内に proposal 3 個以上の Epic 数: ___ / 10 (target: **10/10**)

### 質的基準

- 「気づかなかった論点」合計: ___ 件 (target: **3+**)
  - 該当 Epic 一覧:
- multi-turn が機能した Epic: ___ / 10 (target: **10/10**)

### システム動作

- 重複ガード発動数 / 試行数: ___ / ___
- env 未設定エラーで blocked になった回数: ___
- MCP 接続エラーの種類:

## 観察メモ (A フェーズ ingest-jira-epic 設計の入力)

### プロンプト改善点

(AI が安定して論点を出すために、どんな指示が効いたか)

### tool 呼び出しパターン

(AI がどの順で `jira_get_issue` / `jira_get_epic_issues` / `jira_search` 等を呼んだか)

### レイテンシ分布

(エピックサイズと所要時間の相関)

### 失敗パターン

- 接続失敗:
- rate limit:
- タイムアウト:
- AI が無限ループ:

### A フェーズ仕様への提案

(C で見えた「AI に必須で指示すべき事項」「制限すべき事項」を箇条書き)

---

## 完了判定

C フェーズ Success Criteria:
- [ ] 90 秒以内に question proposal 3 個以上 (10 epic 全部)
- [ ] 採用率 50%+
- [ ] 「気づかなかった論点」3+ 件
- [ ] multi-turn での context 保持が動作

満たせば → A フェーズ (ingest-jira-epic agent + 専用 UI + ADR) へ。
満たさなければ → 観察結果をもとに plan を再調整。
