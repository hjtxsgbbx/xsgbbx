#!/usr/bin/env bash
# agent_1 User Feedback Processor
# 从 GitHub Issues 收集用户反馈，生成汇总报告

set -e

FEEDBACK_DIR=".github/feedback"
DATE=$(date +%Y-%m-%d)
REPORT_FILE="${FEEDBACK_DIR}/feedback-report-${DATE}.md"

mkdir -p "$FEEDBACK_DIR"

gather_feedback() {
  echo "  Gathering user feedback from GitHub Issues..."
  echo ""

  if command -v gh &> /dev/null; then
    gh issue list --label "feedback" --state "open" --limit 20 \
      --json title,url,createdAt,labels \
      --jq '.[] | "- [\(.title)](\(.url)) (since \(.createdAt))"' \
      2>/dev/null | head -20
  else
    echo "  (gh CLI not installed. Install: https://cli.github.com/)"
    echo "  Please manually review GitHub Issues with label 'feedback'"
    echo "  URL: https://github.com/agent_1/agent_1/issues?q=label:feedback"
  fi
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  agent_1 User Feedback Report Generator"
echo "  Date: $DATE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cat > "$REPORT_FILE" << HEADER
# User Feedback Report - $DATE

> 自动生成 | 来源: GitHub Issues | 标签: feedback

---

## 一、待处理反馈

HEADER

echo "## 一、待处理反馈" >> "$REPORT_FILE"
echo "" >> "$REPORT_FILE"
gather_feedback >> "$REPORT_FILE" 2>&1 || echo "  (no feedback found or gh CLI unavailable)" >> "$REPORT_FILE"

cat >> "$REPORT_FILE" << SECTION

---

## 二、反馈分类统计

| 类别 | 数量 | 处理状态 |
|------|------|----------|
| 功能建议 | | |
| 体验优化 | | |
| 性能问题 | | |
| Bug 报告 | | |
| 文档改进 | | |

---

## 三、优先级建议

| 反馈 | 优先级 | 目标 Sprint | 处理人 |
|------|--------|-------------|--------|
| | | | |

---

## 四、反馈趋势

| 指标 | 本月 | 上月 | 变化 |
|------|------|------|------|
| 总反馈数 | | | |
| 已解决数 | | | |
| 平均响应时间 | | | |
| NPS 评分 | | | |

---

*报告生成时间: $(date) | 下次更新: $(date -d '+7 days' +%Y-%m-%d 2>/dev/null || echo 'next week')*
SECTION

echo ""
echo "  Report generated: $REPORT_FILE"
echo ""
echo "  Next steps:"
echo "  1. Review the report"
echo "  2. Prioritize feedback for next Sprint Planning"
echo "  3. Assign feedback items to team members"