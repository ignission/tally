# ADR-0004: Lint/Format ツールとして Biome を採用

- **日付**: 2026-04-18
- **ステータス**: Accepted

## コンテキスト

Phase 0 のセットアップで Lint と Format のツール選定が必要になった。ロードマップ
（docs/04-roadmap.md Phase 0）当初の記述は「ESLint + Prettier + Vitest」だった。

モノレポ（pnpm workspaces、TS + React + Node.js 混在）での要件:

- TypeScript / JSX / JSON / YAML を一貫したルールで扱えること
- パッケージ間で設定を極力共有できること
- 起動が速く、pre-commit やエディタ連携が軽量なこと
- 学習コスト / 設定ファイルの複雑さが小さいこと

## 決定

**Biome** を単一ツールとして採用する。ESLint / Prettier は導入しない。

- Lint と Format を Biome で統一
- ルート `biome.json` に共通ルールを定義し、各パッケージは基本的にルート設定を継承
- `package.json` の scripts:
  - `pnpm lint` → `biome check .`
  - `pnpm format` → `biome format --write .`
  - `pnpm check` → `biome check --write .`（lint + format の自動修正）

## 理由

1. **単一バイナリで Lint + Format が完結**：ツールチェーンの依存と設定の重複を減らせる
2. **高速**：Rust 実装で起動・実行とも ESLint の数十倍速い。モノレポ全体を秒で回せる
3. **設定が軽量**：`biome.json` 1ファイルで TS/JSX/JSON の既定ルールが揃う
4. **Next.js 15 との互換性**：Next.js 公式 ESLint プラグインの恩恵は失うが、Biome で代替可能なルールが大半。不足分は将来必要に応じて ESLint を併用する ADR を追加する

## 影響

### メリット

- 開発体験が軽く、CI も短縮できる
- ルール追加時に ESLint プラグインエコシステムを調べる手間がない
- Prettier との差分調整が不要

### デメリット / 制約

- **Next.js 公式 ESLint プラグイン (`eslint-config-next`) が使えない**：
  `@next/next/no-img-element` などの Next 固有ルールの静的チェックが当面ない
- Biome は比較的若いツール。ESLint ほど成熟したカスタムルールエコシステムはない
- `eslint-plugin-react-hooks` のような型外の静的解析は Biome の対応ルール次第

### 将来の拡張余地

- Biome で検出できない Next.js 固有の問題が蓄積した場合、`eslint-config-next` を
  最小構成で併用する（別 ADR を書く）
- `eslint-plugin-jsx-a11y` 相当のアクセシビリティルールが足りないと判断された場合も同様

## 考慮した他の選択肢

1. **ESLint + Prettier（当初のロードマップ）**: 実績は豊富だが設定ファイルが 2 系統になり、Prettier と ESLint の競合調整が必要。採用せず
2. **ESLint のみ（Prettier なし）**: フォーマット揺らぎが出やすい。採用せず
3. **Rome**: Biome の前身。開発停止。採用不可
4. **dprint**: Format 専用。Lint が別になる。採用せず

## ロードマップへの影響

- `docs/04-roadmap.md` Phase 0 タスクの「ESLint + Prettier + Vitest の設定」を
  「Biome + Vitest の設定」に修正する

## 参考

- [Biome 公式](https://biomejs.dev/)
- [Biome vs ESLint+Prettier](https://biomejs.dev/blog/biome-wins-prettier-challenge/)
