#!/bin/bash
# 孤立ファイル・未使用コード検出スクリプト (tally 向け)
# packages/ 配下のモノレポ構造に合わせて各パッケージの src/ を探索
# 決定論的ルールで検出し、削除判断は人間が行う

PROJECT_ROOT="${1:-$(pwd)}"

# プロジェクトルートのバリデーション
if [ ! -d "$PROJECT_ROOT/packages" ]; then
  echo "ERROR: $PROJECT_ROOT はtally (pnpm workspaces) ルートではありません (packages/ が見つからない)" >&2
  exit 1
fi

FOUND=0
DUPES=0

echo "=== 孤立TypeScript/TSXファイル検出 (packages/*/src) ==="
echo "他ファイルからimportされていない.ts/.tsxファイルを検出"
echo ""

for pkg_dir in "$PROJECT_ROOT"/packages/*/src; do
  [ -d "$pkg_dir" ] || continue
  pkg_name=$(basename "$(dirname "$pkg_dir")")
  echo "--- packages/${pkg_name} ---"
  while IFS= read -r f; do
    basename=$(basename "$f" | sed 's/\.\(ts\|tsx\)$//')
    # エントリポイント・テスト・型宣言はスキップ
    case "$basename" in
      index|index.test|*.test|*.spec|page|layout|route|*.d) continue ;;
    esac
    # このファイル以外から参照されているか（パッケージ内探索）
    refs=$(grep -rlE "(from[[:space:]]+['\"].*/${basename}['\"]|import[[:space:]]+.*['\"].*/${basename})" "$pkg_dir" --include='*.ts' --include='*.tsx' 2>/dev/null | grep -v "^${f}$" | head -1)
    if [ -z "$refs" ]; then
      echo "  孤立候補: $f"
      FOUND=$((FOUND + 1))
    fi
  done < <(find "$pkg_dir" \( -name '*.ts' -o -name '*.tsx' \) \
    -not -name '*.test.ts' -not -name '*.test.tsx' \
    -not -name '*.spec.ts' -not -name '*.spec.tsx' \
    -not -path '*/node_modules/*' 2>/dev/null)
done

echo ""
echo "=== コード重複検出 (jscpd) ==="
echo "10行以上・70トークン以上の重複を検出 (テスト除外)"
echo ""

for pkg_dir in "$PROJECT_ROOT"/packages/*/src; do
  [ -d "$pkg_dir" ] || continue
  pkg_name=$(basename "$(dirname "$pkg_dir")")
  echo "--- packages/${pkg_name} ---"
  JSCPD_TMPDIR=$(mktemp -d)
  npx -y jscpd "$pkg_dir" --min-lines 10 --min-tokens 70 \
    --ignore "**/*.test.*,**/*.spec.*" --reporters json --output "$JSCPD_TMPDIR" >/dev/null 2>&1 || true
  if [ -f "$JSCPD_TMPDIR/jscpd-report.json" ]; then
    PKG_DUPES=$(jq '.statistics.total.clones // 0' "$JSCPD_TMPDIR/jscpd-report.json")
    PKG_DUP_LINES=$(jq '.statistics.total.duplicatedLines // 0' "$JSCPD_TMPDIR/jscpd-report.json")
    PKG_TOTAL_LINES=$(jq '.statistics.total.lines // 1' "$JSCPD_TMPDIR/jscpd-report.json")
    PKG_RATE=$(awk -v dup="$PKG_DUP_LINES" -v total="$PKG_TOTAL_LINES" 'BEGIN {printf "%.2f%%", dup * 100 / total}')
  else
    PKG_DUPES=0
    PKG_RATE="0%"
    echo "  WARNING: jscpd実行失敗またはレポート未生成" >&2
  fi
  # 一時ディレクトリ削除 (mktemp の固有ディレクトリのみ対象なので安全)
  rm -r "$JSCPD_TMPDIR" 2>/dev/null || true
  echo "  クローン: ${PKG_DUPES}件, 重複率: ${PKG_RATE}"
  DUPES=$((DUPES + PKG_DUPES))
done

echo ""
echo "=== 結果 ==="
echo "孤立候補: ${FOUND}件"
echo "コード重複: ${DUPES}件"
if [ "$FOUND" -eq 0 ] && [ "$DUPES" -eq 0 ]; then
  echo "問題は検出されませんでした"
fi
