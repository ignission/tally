# Dogfood Log — Atlassian MCP C フェーズ

> **目的**: 10 個の Jira エピックで C フェーズ Success Criteria を測定し、A フェーズの ingest-jira-epic agent プロンプト設計の入力を作る。

## Setup

### MCP サーバー起動 (sooperset/mcp-atlassian)

```bash
# uvx 経由
uvx mcp-atlassian --transport streamable-http --port 9000

# または Docker
docker run -p 9000:9000 ghcr.io/sooperset/mcp-atlassian:latest \
  --transport streamable-http --port 9000
```

### .env 設定

Cloud (Atlassian Cloud) の場合 (Basic auth):
```bash
ATLASSIAN_EMAIL=your-email@example.com
ATLASSIAN_API_TOKEN=your-api-token
```

Server / DC (オンプレ Jira) の場合 (Bearer auth):
```bash
JIRA_PAT=your-personal-access-token
```

### Tally プロジェクト設定

プロジェクト設定ダイアログ → MCP サーバーを追加:
- ID: `atlassian`
- 名前: `Atlassian Cloud` (任意)
- URL: `http://localhost:9000/mcp`
- スキーム: Bearer or Basic
- envVar: `ATLASSIAN_EMAIL` / `ATLASSIAN_API_TOKEN` (basic) or `JIRA_PAT` (bearer)

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
