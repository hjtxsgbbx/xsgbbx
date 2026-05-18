#!/usr/bin/env bash
# agent_1 Daily Standup Script (Bash / Linux/macOS)
# Enhanced with sprint status, CI check, and blocker tracking

STANDUP_DIR=".github/standups"
DATE=$(date +%Y-%m-%d)
STANDUP_FILE="$STANDUP_DIR/$DATE.md"
mkdir -p "$STANDUP_DIR"

echo ""
echo "================================================"
echo "  agent_1 Daily Standup — $DATE"
echo "================================================"
echo ""

echo "  📊 Sprint Status Summary"
echo "  ----------------------------------------"
if [ -f "sprints/sprint-001.json" ]; then
  TOTAL=$(node -p "JSON.parse(require('fs').readFileSync('sprints/sprint-001.json','utf8')).issues.length" 2>/dev/null || echo "?")
  DONE=$(node -p "JSON.parse(require('fs').readFileSync('sprints/sprint-001.json','utf8')).issues.filter(i=>i.status==='done').length" 2>/dev/null || echo "0")
  echo "  Tasks: $DONE/$TOTAL completed"
fi

echo ""
echo "  🔧 CI Pipeline Status"
echo "  ----------------------------------------"
echo "  Check: https://github.com/.../actions"
echo ""

echo "================================================"
echo "  What did you work on YESTERDAY?"
echo "================================================"
read -r -p "  > " YESTERDAY
YESTERDAY=${YESTERDAY:-"(not provided)"}

echo ""
echo "================================================"
echo "  What will you work on TODAY?"
echo "================================================"
read -r -p "  > " TODAY
TODAY=${TODAY:-"(not provided)"}

echo ""
echo "================================================"
echo "  Any BLOCKERS or impediments?"
echo "================================================"
read -r -p "  > " BLOCKER
BLOCKER=${BLOCKER:-"None"}

cat > "$STANDUP_FILE" <<EOF
# Daily Standup — $DATE

## Yesterday
$YESTERDAY

## Today
$TODAY

## Blockers
$BLOCKER

---
*Submitted: $(date +%H:%M)*
EOF

echo ""
echo "  ✅ Standup saved to: $STANDUP_FILE"
echo ""
echo "  Daily Checklist:"
echo "  ----------------------------------------"
echo "  [ ] Check CI pipeline status"
echo "  [ ] Review open PRs"
echo "  [ ] Check latest benchmark report"
echo "  [ ] Update sprint burndown"
echo "  [ ] Note any user feedback"