#!/usr/bin/env bash
# Pre-check analysis: decide if a PR warrants the full build/test/agent pipeline.
# Outputs "review" or "skip" to $WORK_DIR/precheck.txt
set -euo pipefail

PR_NUMBER="${1:?Usage: precheck-pr.sh <pr-number>}"
WORK_DIR="${2:?Usage: precheck-pr.sh <pr-number> <work-dir>}"

# Configurable thresholds
MAX_TRIVIAL_LINES="${MAX_TRIVIAL_LINES:-5}"

# Get diff file list and stats
FILES=$(gh pr diff "$PR_NUMBER" --name-only 2>/dev/null || echo "")
ADDITIONS=$(gh pr view "$PR_NUMBER" --json additions --jq '.additions' 2>/dev/null || echo "0")
DELETIONS=$(gh pr view "$PR_NUMBER" --json deletions --jq '.deletions' 2>/dev/null || echo "0")

if [ -z "$FILES" ]; then
  echo "review" > "$WORK_DIR/precheck.txt"
  echo "review"
  exit 0
fi

TOTAL_LINES=$(( ${ADDITIONS:-0} + ${DELETIONS:-0} ))
FILE_COUNT=$(echo "$FILES" | wc -l | tr -d ' ')

# Save file list for later use
echo "$FILES" > "$WORK_DIR/changed-files.txt"
echo "$TOTAL_LINES" > "$WORK_DIR/total-lines.txt"

# --- Skip rules ---

# Rule 1: Docs-only (all files are .md, .txt, .mdx, LICENSE, NOTICE)
# Exception: SKILL.md files are functional metadata, not just docs
DOCS_ONLY=true
while IFS= read -r f; do
  case "$f" in
    */SKILL.md) DOCS_ONLY=false; break ;;  # SKILL.md = functional, not trivial docs
    */CLAUDE.md) DOCS_ONLY=false; break ;; # CLAUDE.md = agent config, not trivial docs
    *.md|*.txt|*.mdx|LICENSE|NOTICE|*.rst) ;;
    *) DOCS_ONLY=false; break ;;
  esac
done <<< "$FILES"

if [ "$DOCS_ONLY" = true ]; then
  echo "skip" > "$WORK_DIR/precheck.txt"
  echo "skip:docs_only"
  exit 0
fi

# Rule 2: Lockfile-only
LOCKFILE_ONLY=true
while IFS= read -r f; do
  case "$f" in
    package-lock.json|yarn.lock|pnpm-lock.yaml) ;;
    *) LOCKFILE_ONLY=false; break ;;
  esac
done <<< "$FILES"

if [ "$LOCKFILE_ONLY" = true ]; then
  echo "skip" > "$WORK_DIR/precheck.txt"
  echo "skip:lockfile_only"
  exit 0
fi

# Rule 3: Config-only (non-CI config files)
CONFIG_ONLY=true
while IFS= read -r f; do
  case "$f" in
    .env.example|.gitignore|.editorconfig|.prettierrc*|.eslintrc*|.nvmrc|.node-version) ;;
    # CI files should NOT be skipped
    .github/*) CONFIG_ONLY=false; break ;;
    *) CONFIG_ONLY=false; break ;;
  esac
done <<< "$FILES"

if [ "$CONFIG_ONLY" = true ]; then
  echo "skip" > "$WORK_DIR/precheck.txt"
  echo "skip:config_only"
  exit 0
fi

# Rule 4: Tiny change (very few lines AND only non-critical files)
if [ "$TOTAL_LINES" -le "$MAX_TRIVIAL_LINES" ] && [ "$FILE_COUNT" -le 2 ]; then
  # Check if all files are low-risk (not server routes, not components)
  ALL_LOW_RISK=true
  while IFS= read -r f; do
    case "$f" in
      server/routes/*|src/components/*|src/hooks/*|src/contexts/*) ALL_LOW_RISK=false; break ;;
    esac
  done <<< "$FILES"

  if [ "$ALL_LOW_RISK" = true ]; then
    echo "skip" > "$WORK_DIR/precheck.txt"
    echo "skip:tiny_change"
    exit 0
  fi
fi

# Default: review
echo "review" > "$WORK_DIR/precheck.txt"
echo "review"
