#!/bin/bash
# ハーネスエンジニアリング効果メトリクス収集
# 過去N日間のPR・CI・レビュー指摘を集計する

DAYS="${1:-30}"
REPO=$(gh repo view --json nameWithOwner -q '.nameWithOwner' 2>/dev/null || echo "")
if [ -z "$REPO" ]; then
  echo "ERROR: リポジトリ情報の取得に失敗しました。gh auth login を確認してください" >&2
  exit 1
fi

# 日付計算（Linux/macOS両対応）
SINCE=$(date -d "${DAYS} days ago" +%Y-%m-%d 2>/dev/null || date -v-"${DAYS}"d +%Y-%m-%d 2>/dev/null)

if [ -z "$SINCE" ]; then
  echo "日付計算に失敗しました"
  exit 1
fi

echo "=== ハーネスメトリクス（過去${DAYS}日: ${SINCE}〜） ==="
echo ""

# --- PRメトリクス ---
echo "## PRメトリクス"
# 変数代入自体は常に成功するため、|| でのフォールバックは機能しない。空チェックで対応
MERGED_PRS=$(gh pr list --repo "$REPO" --state merged --search "merged:>=${SINCE}" --json number --jq 'length' 2>/dev/null)
[ -z "$MERGED_PRS" ] && MERGED_PRS="取得失敗"
OPEN_PRS=$(gh pr list --repo "$REPO" --state open --json number --jq 'length' 2>/dev/null)
[ -z "$OPEN_PRS" ] && OPEN_PRS="取得失敗"
echo "  マージ済みPR: ${MERGED_PRS}件"
echo "  オープンPR: ${OPEN_PRS}件"
echo ""

# --- CI失敗率 ---
echo "## CI失敗率"
# --created で指定期間内に絞り、完了 run のみを分母にする
CI_JSON=$(gh run list --repo "$REPO" --created ">=${SINCE}T00:00:00Z" --limit 50 --json conclusion 2>/dev/null)
if [ -n "$CI_JSON" ]; then
  COMPLETED_RUNS=$(echo "$CI_JSON" | jq '[.[] | select(.conclusion != null and .conclusion != "")]')
  TOTAL_RUNS=$(echo "$COMPLETED_RUNS" | jq 'length')
  FAILED_RUNS=$(echo "$COMPLETED_RUNS" | jq '[.[] | select(.conclusion != "success" and .conclusion != "skipped")] | length')
  SUCCESS_RUNS=$(echo "$COMPLETED_RUNS" | jq '[.[] | select(.conclusion == "success")] | length')
  echo "  過去${DAYS}日 (完了 run のみ): 成功 ${SUCCESS_RUNS} / 失敗 ${FAILED_RUNS} / 合計 ${TOTAL_RUNS}"
  if [ "$TOTAL_RUNS" -gt 0 ]; then
    RATE=$(awk "BEGIN {printf \"%.1f\", $FAILED_RUNS * 100 / $TOTAL_RUNS}" 2>/dev/null) || RATE="計算失敗"
    echo "  失敗率: ${RATE}%"
  fi
else
  echo "  CI情報の取得に失敗しました"
fi
echo ""

# --- CodeRabbit指摘率 ---
echo "## CodeRabbit指摘（直近マージ済み10PR）"
TOTAL_CR_COMMENTS=0
PR_WITH_COMMENTS=0
CR_FETCH_FAILURES=0
MERGED_PR_NUMBERS=$(gh pr list --repo "$REPO" --state merged --search "merged:>=${SINCE}" --json number --jq '.[].number' --limit 10 2>/dev/null)
if [ -n "$MERGED_PR_NUMBERS" ]; then
  for pr in $MERGED_PR_NUMBERS; do
    # --paginate で全ページ取得、失敗/非数値は skip してカウントから除外する
    if ! CR_COUNT=$(gh api --paginate --slurp "repos/${REPO}/pulls/${pr}/comments" --jq 'map(.[] | select(.user.login == "coderabbitai[bot]")) | length' 2>/dev/null); then
      echo "  PR #${pr}: CodeRabbit指摘の取得に失敗しました" >&2
      CR_FETCH_FAILURES=$((CR_FETCH_FAILURES + 1))
      continue
    fi
    if ! [[ "$CR_COUNT" =~ ^[0-9]+$ ]]; then
      echo "  PR #${pr}: CodeRabbit指摘数の解析に失敗しました" >&2
      CR_FETCH_FAILURES=$((CR_FETCH_FAILURES + 1))
      continue
    fi
    if [ "$CR_COUNT" -gt 0 ]; then
      echo "  PR #${pr}: ${CR_COUNT}件の指摘"
      TOTAL_CR_COMMENTS=$((TOTAL_CR_COMMENTS + CR_COUNT))
      PR_WITH_COMMENTS=$((PR_WITH_COMMENTS + 1))
    fi
  done
  echo "  合計: ${TOTAL_CR_COMMENTS}件（直近10PR中${PR_WITH_COMMENTS}PRに指摘あり）"
  [ "$CR_FETCH_FAILURES" -gt 0 ] && echo "  取得失敗: ${CR_FETCH_FAILURES}PR" >&2
else
  echo "  マージ済みPRの取得に失敗しました"
fi
echo ""

# --- 手戻り指標 ---
echo "## 手戻り指標"
REVERT_COUNT=$(git log origin/main --oneline --since="$SINCE" --grep="revert" -i 2>/dev/null | wc -l | tr -d ' ')
FIXUP_COUNT=$(git log origin/main --oneline --since="$SINCE" --grep="^fix:" -i 2>/dev/null | wc -l | tr -d ' ')
echo "  revertコミット: ${REVERT_COUNT}件"
echo "  fixコミット: ${FIXUP_COUNT}件"
