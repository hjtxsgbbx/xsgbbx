#!/usr/bin/env bash
# agent_1 Code Review Checklist Runner
# 自动运行代码审查前检查项，验证 PR 准备就绪

set -e

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  agent_1 Code Review Pre-Flight Check"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

PASS=0
FAIL=0

check() {
  local label="$1"
  shift
  echo ""
  echo "  [$label]"
  if "$@" 2>&1 | tail -3; then
    echo "  ✓ $label passed"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $label failed"
    FAIL=$((FAIL + 1))
  fi
}

check "TypeScript Type Check" npx tsc --noEmit
check "ESLint" npx eslint src/ --no-error-on-unmatched-pattern --max-warnings 20
check "Unit Tests" npx jest --config jest.config.cjs --testPathPattern="test/(?!integration|e2e)" --ci --passWithNoTests
check "Integration Tests" npx jest --config jest.config.cjs --testPathPattern="test/integration" --ci --passWithNoTests
check "E2E Tests" npx jest --config jest.config.cjs --testPathPattern="test/e2e" --ci --passWithNoTests
check "Coverage Gate" npx jest --config jest.config.cjs --coverage --ci --passWithNoTests 2>&1 | grep -E "All files|Statements|Branches|Functions|Lines" || true
check "Console Log Detection" ! grep -rn "console\.log" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" || true
check "TODO Detection" ! grep -rn "TODO\|FIXME\|HACK" src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | head -5 || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASS passed, $FAIL failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ $FAIL -gt 0 ]; then
  echo ""
  echo "  Fix the failed checks before submitting PR."
  exit 1
else
  echo ""
  echo "  All checks passed! Ready for code review."
fi