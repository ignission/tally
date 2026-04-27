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

### Epic 1: PMDEV-165【L1】ホーム画面+認証 (proof-of-concept、2026-04-27)

> **注**: これは **Tally dev server で実機 dogfood する前の事前 PoC**。Claude が atlassian plugin tool 経由で context を取り、「もし Tally AI agent が同じ context で論点抽出したら」のシミュレーション出力を記録。実装が完成したら同じエピックで実機 dogfood し、ここの「期待値」と比べる。

- **エピック概要**: バイヤー向けの認証機能 (FUNC-022〜026: ログイン / パスワード再発行 / 自動ログイン記憶 / 新規会員登録 / 退会) と、ホーム画面 (FUNC-060: トップページ / FUNC-016: ゲスト/ログイン差分表示)
- **URL**: https://ignission.atlassian.net/browse/PMDEV-165
- **規模**: 子チケット **50+** 件 (Tally Premise 7 の `maxChildIssues=30` を超過)、ステータス進行中

#### シミュレーション (Claude as Tally AI agent)

PMDEV-165 description + 子チケット summary 50 件を context に「未決定の設計判断 (論点)」を抽出。各論点は Tally の `question` proposal 形式 (title / body / options[] / sourceRefs[]):

**論点 1: ログインセッションの「ログイン状態を保持する」既定状態**
- body: FUNC-022/024 で `JWTトークンをHttpOnly Cookieに保存（有効期限7日）` と `「ログイン状態を保持する」が機能する` の AC があるが、**この checkbox の初期値**が決まっていない。チェック ON 既定なら離脱が増えにくいが UX として強制感、OFF 既定だと再ログイン頻度が上がりリテンション低下。
- options:
  - チェック ON 既定 (UX 簡略、長期 cookie 7 日保持)
  - チェック OFF 既定 (短期 session cookie、明示同意)
  - そもそも checkbox を出さない (常に 7 日保持 / なし)
- sourceRefs: FUNC-022, FUNC-024

**論点 2: パスワード再発行メールの送信元アドレス / 文言所有権**
- body: FUNC-023「メールアドレス入力でCognito経由の再発行メールが送信される」だけ書かれているが、**送信元 (no-reply@?)、件名 / 本文の文言、ブランディング、Cognito default テンプレ vs カスタム**が決まっていない。法務 / マーケ含めた決断が要る。
- options:
  - Cognito default テンプレ (Amazon SES) で MVP
  - SES + カスタムテンプレ (ブランド整える、デザイン依頼必要)
  - 第三者メール SaaS 経由 (SendGrid 等、cost / deliverability)
- sourceRefs: FUNC-023, PMDEV-176 [SRE] メール基盤

**論点 3: ゲストの価格・在庫を「非表示」とは具体的に何か**
- body: FUNC-016「未ログイン（ゲスト）状態では商品の価格・在庫情報が非表示になる」とあるが、**ぼかし / プレースホルダ / 「ログインしてご確認ください」誘導 / 完全に隠す**のどれか未決定。商品ヒーロー画像で価格訴求できないと SEO / 流入時の最初の印象が弱い。
- options:
  - 完全非表示 (空のスペース)
  - 「会員登録/ログインして表示」CTA で置換 (推奨? CV 期待)
  - ぼかし表示 (具体額を ××× 等)
- sourceRefs: FUNC-016, FUNC-060

**論点 4: 退会後のデータ保持期間 / 法的要件**
- body: FUNC-026「退会処理でCognitoユーザーが無効化・削除される」だが、**注文履歴 / 請求書 / GDPR 的な個人データ保持期間 / soft delete か hard delete か**が決まっていない。日本の電帳法 (請求書 7 年) と矛盾する可能性。
- options:
  - Cognito user は即削除、注文 / 請求は anonymize で保持
  - Cognito user は soft delete (再開可能)、注文 / 請求は実名保持 (法定期間)
  - 退会時に user に「データ削除 / 保持」選択させる (GDPR の権利)
- sourceRefs: FUNC-026

**論点 5: パフォーマンス基準 "3 秒以内" の計測条件**
- body: 「ページ初期表示が3秒以内に完了する（dev環境）」と「Core Web Vitalsの基準を満たす」がある。**dev 環境の 3 秒** はネットワーク条件 / キャッシュ状態 / 同時接続数によって大きく揺れる。Core Web Vitals (LCP 2.5s 等) の方が標準的だが、dev 環境では本番回線で測れない。
- options:
  - dev 3 秒 + Core Web Vitals = 二重基準 (dev は緩い目安、本番は CWV)
  - Core Web Vitals 一本化 (dev 環境では参考、staging で測定)
  - 削除 (dev 3 秒は意味薄、CWV のみ採用)
- sourceRefs: FUNC-060 パフォーマンス節

**論点 6: サプライヤー初回ログインのパスワード変更 UX (子チケット由来)**
- body: PMDEV-264 [FE] サプライヤー初回ログイン時のパスワード変更画面 / PMDEV-266 NEW_PASSWORD_REQUIRED チャレンジで 500 エラー (バグ完了)。**初回パスワード生成方式** (招待メールに 1 回限り URL / 初期パスを発行 / 完全自由設定) と **強度ポリシー** が docs に書かれていない。
- options:
  - 招待メール内 1 回限り URL (Cognito の admin invitation flow)
  - 招待時に初期 12 文字 random pwd を発行 (メール本文に platintext = リスク)
  - サプライヤーが自由設定 (招待メール内のリンクから直接 sign-up)
- sourceRefs: PMDEV-264, PMDEV-266

**シミュレーション結果**:
- 生成 question proposal: 6 件 (target 3+ クリア)
- うち「気づかなかった論点」候補 (人間が epic だけ読んでは見落とす): 論点 4 (退会後の法定保持) / 論点 5 (パフォーマンス基準二重) — **2 件以上** (target 3 件には惜しい、実機で深堀れば届きそう)
- AI が子チケット 50 件全部読むと context が爆発する想定。Premise 7 の `maxChildIssues=30` での切り捨ては必要だが、**重要な子チケットの抽出ロジック** (例: status='完了' は除外、bug type は context 寄与低、最新更新優先 等) が dogfood で見えそう

#### 実機 dogfood 時の確認事項

- [ ] Tally Chat で同じ epic を投げ、上記 6 論点と類似の output が出るか
- [ ] 子チケット 50 件 → AI 動作 (context 爆発する? truncate される?)
- [ ] multi-turn で「PMDEV-264 をもっと深く」と聞いたら過去 context を覚えているか
- [ ] 同 sourceUrl 2 度目取り込みの重複ガード発動

---

(Epic 2-10 を同フォーマットで、実機 dogfood 時に追記)

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
