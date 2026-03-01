#!/usr/bin/env bash
# Classify a PR as ui, backend, or mixed based on changed file paths.
# Outputs classification to $WORK_DIR/pr-type.txt
set -euo pipefail

PR_NUMBER="${1:?Usage: classify-pr.sh <pr-number>}"
WORK_DIR="${2:?Usage: classify-pr.sh <pr-number> <work-dir>}"

# Use cached file list if available
if [ -f "$WORK_DIR/changed-files.txt" ]; then
  FILES=$(cat "$WORK_DIR/changed-files.txt")
else
  FILES=$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null || echo "")
fi

if [ -z "$FILES" ]; then
  echo "backend" > "$WORK_DIR/pr-type.txt"
  echo "backend"
  exit 0
fi

HAS_UI=false
HAS_BACKEND=false

while IFS= read -r f; do
  case "$f" in
    # UI files
    src/components/*|src/hooks/*|src/contexts/*|src/types/*|src/utils/*|src/lib/*)
      HAS_UI=true ;;
    src/*.tsx|src/*.ts|src/*.jsx|src/*.css)
      HAS_UI=true ;;
    public/*)
      HAS_UI=true ;;
    src/i18n/*)
      HAS_UI=true ;;
    index.html|tailwind.config.*|postcss.config.*|vite.config.*)
      HAS_UI=true ;;

    # Backend files
    server/*|shared/*)
      HAS_BACKEND=true ;;

    # Build/config — classify as backend
    package.json|tsconfig.json|playwright.config.*)
      HAS_BACKEND=true ;;

    # Test files — classify based on path
    test/*)
      HAS_UI=true ;;  # E2E tests are UI-related

    # Skills and other files — classify as backend
    skills/*)
      HAS_BACKEND=true ;;
  esac
done <<< "$FILES"

if [ "$HAS_UI" = true ] && [ "$HAS_BACKEND" = true ]; then
  RESULT="mixed"
elif [ "$HAS_UI" = true ]; then
  RESULT="ui"
else
  RESULT="backend"
fi

echo "$RESULT" > "$WORK_DIR/pr-type.txt"
echo "$RESULT"
