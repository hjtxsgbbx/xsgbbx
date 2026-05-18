#!/usr/bin/env bash
# agent_1 Release Helper
# 自动化版本发布流程：更新版本号 → 生成 CHANGELOG → 创建 release 分支 → 提交

set -e

VERSION=${1:-}
if [ -z "$VERSION" ]; then
  echo "Usage: bash scripts/release.sh <version>"
  echo "Example: bash scripts/release.sh 1.1.0"
  exit 1
fi

CURRENT_BRANCH=$(git branch --show-current)
CURRENT_VERSION=$(node -p "require('./package.json').version")

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  agent_1 Release v$VERSION"
echo "  Current: v$CURRENT_VERSION → New: v$VERSION"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [ "$CURRENT_BRANCH" != "develop" ]; then
  echo ""
  echo "  ✗ Must be on 'develop' branch to start a release."
  echo "  Current branch: $CURRENT_BRANCH"
  exit 1
fi

echo ""
echo "  [1/6] Creating release branch..."
git checkout -b "release/v$VERSION"

echo "  [2/6] Updating version in package.json..."
node -e "
  const pkg = require('./package.json');
  pkg.version = '$VERSION';
  require('fs').writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo "  [3/6] Updating CHANGELOG.md date..."
sed -i "s/## \[$VERSION\] - .*/## [$VERSION] - $(date +%Y-%m-%d)/" CHANGELOG.md 2>/dev/null || true

echo "  [4/6] Running pre-release checks..."
npm run typecheck
npm test

echo "  [5/6] Committing release..."
git add package.json CHANGELOG.md
git commit -m "release: v$VERSION

- Bump version from $CURRENT_VERSION to $VERSION
- Update CHANGELOG.md"

echo "  [6/6] Release branch created!"
echo ""
echo "  Next steps:"
echo "  1. git push origin release/v$VERSION"
echo "  2. Create PR: release/v$VERSION → main"
echo "  3. After merge: git tag -a v$VERSION -m 'Release v$VERSION'"
echo "  4. git push origin v$VERSION"
echo "  5. Merge main back to develop"
echo ""