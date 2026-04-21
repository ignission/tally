# ADR-0001: エッジ種別の命名を SysML 2.0 に準拠させる

- **日付**: 2026-04-18
- **ステータス**: Accepted

## コンテキスト

Tally のエッジには複数の関係種別がある。初期実装では独自命名（`realizes`, `decomposes`, `depends`, `impacts`）を使っていたが、以下の問題がある。

- 業界標準の語彙と一致せず、他ツールとの連携時に再マッピングが必要
- 外部に説明する際の共通言語がない
- OSS として公開する際の技術的信頼性に関わる

## 決定

エッジ種別の**内部識別子**を SysML 2.0 の要求関係ステレオタイプに準拠させる。

| 旧（独自） | 新（SysML準拠） |
|---|---|
| realizes | satisfy |
| decomposes | contain |
| depends | derive |
| impacts | refine |
| （新規） | verify |
| （新規） | trace |

**UI 表示のラベルは日本語のまま**。エンドユーザーが日常業務で使いやすい言葉を維持する。

- satisfy → 充足
- contain → 分解
- derive → 派生
- refine → 詳細化
- verify → 検証
- trace → 関連

## 影響

- JSON/YAML でのデータ形式に SysML 準拠の識別子が使われる
- 将来 ReqIF や SysML v2 Textual Notation へのエクスポートが素直に書ける
- ドキュメントでは「内部ID (表示ラベル)」の形で併記する必要がある

## 考慮した他の選択肢

1. **独自命名を維持**：外部連携で損する、却下
2. **UI ラベルも英語に揃える**：現場での使いやすさを損なう、却下

## 参考

- [SysML 2.0 仕様](https://www.omg.org/spec/SysML/2.0/)
