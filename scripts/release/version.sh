#!/usr/bin/env bash
# agent_1 Version Bump & Changelog Generator
# Usage: bash scripts/version.sh [major|minor|patch]

set -e

BUMP_TYPE=${1:-patch}

echo ""
echo "================================================"
echo "  agent_1 Version Manager"
echo "================================================"
echo ""

CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "  Current version: $CURRENT_VERSION"
echo "  Bump type:       $BUMP_TYPE"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

case $BUMP_TYPE in
  major) NEW_MAJOR=$((MAJOR + 1)); NEW_VERSION="$NEW_MAJOR.0.0" ;;
  minor) NEW_MINOR=$((MINOR + 1)); NEW_VERSION="$MAJOR.$NEW_MINOR.0" ;;
  patch|*) NEW_PATCH=$((PATCH + 1)); NEW_VERSION="$MAJOR.$MINOR.$NEW_PATCH" ;;
esac

echo "  New version:     $NEW_VERSION"
echo ""

read -p "  Proceed? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
  echo "  Cancelled."
  exit 0
fi

DATE=$(date +%Y-%m-%d)

CHANGELOG_ENTRY="## [$NEW_VERSION] - $DATE

### Added
- 

### Changed
- 

### Fixed
- 

### Deprecated
- 

### Removed
- 

### Security
- "

TEMP_CHANGELOG=$(mktemp)
echo "$CHANGELOG_ENTRY" > "$TEMP_CHANGELOG"

if [ -f CHANGELOG.md ]; then
  awk -v RS='' -v ORS='\n\n' 'NR==1{print; print ""} NR>1{print}' CHANGELOG.md > "${TEMP_CHANGELOG}.original"
  cat "$TEMP_CHANGELOG" "${TEMP_CHANGELOG}.original" > CHANGELOG.md
  rm "${TEMP_CHANGELOG}.original"
else
  echo "# Changelog" > CHANGELOG.md
  echo "" >> CHANGELOG.md
  cat "$TEMP_CHANGELOG" >> CHANGELOG.md
fi
rm "$TEMP_CHANGELOG"

node -e "
  const pkg = require('./package.json');
  pkg.version = '$NEW_VERSION';
  require('fs').writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

echo ""
echo "  Updated:"
echo "    - package.json → $NEW_VERSION"
echo "    - CHANGELOG.md (entry added)"
echo ""
echo "  Next steps:"
echo "    1. Edit CHANGELOG.md to fill in changes"
echo "    2. git add package.json CHANGELOG.md"
echo "    3. git commit -m \"chore(release): bump version to $NEW_VERSION\""
echo "    4. git tag \"v$NEW_VERSION\""
echo "    5. git push --tags"