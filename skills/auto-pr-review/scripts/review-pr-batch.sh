#!/usr/bin/env bash
# Batch review all open, non-draft PRs.
# Designed to be called from crontab on Mac Mini.
# Usage: review-pr-batch.sh [--force]
# Exit codes from review-pr.sh: 0 = reviewed, 2 = skipped, 1 = error
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

MAX_PRS="${MAX_PRS:-10}"
FORCE_FLAG=""
if [ "${1:-}" = "--force" ]; then
  FORCE_FLAG="--force"
fi

echo "========================================"
echo "auto-pr-review batch run: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "Repo: $REPO_ROOT"
echo "Max PRs: $MAX_PRS"
echo "========================================"

# Detect default branch: try gh API first, then git, then fallback "main"
git fetch origin > /dev/null 2>&1
DEFAULT_BRANCH=$(gh api repos/{owner}/{repo} --jq '.default_branch' 2>/dev/null \
  || git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' \
  || echo "main")
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

echo "Default branch: $DEFAULT_BRANCH (current: $CURRENT_BRANCH)"

if [ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]; then
  echo "Switching to $DEFAULT_BRANCH..."
  git checkout "$DEFAULT_BRANCH" > /dev/null 2>&1 || {
    echo "ERROR: Could not checkout $DEFAULT_BRANCH"
    exit 1
  }
fi

# Ensure clean tree before starting
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "ERROR: Working tree is dirty. Cannot run batch review."
  exit 1
fi

# Get open, non-draft PRs
PR_NUMBERS=$(gh pr list --state open --json number,isDraft \
  --jq '[.[] | select(.isDraft == false) | .number] | sort | .[]' 2>/dev/null || echo "")

if [ -z "$PR_NUMBERS" ]; then
  echo "No open PRs to review."
  exit 0
fi

# Count and report
PR_COUNT=$(echo "$PR_NUMBERS" | wc -l | tr -d ' ')
echo "Found $PR_COUNT open PR(s)$([ "$PR_COUNT" -gt "$MAX_PRS" ] && echo ", processing max $MAX_PRS")"

REVIEWED=0
SKIPPED=0
ERRORS=0
PROCESSED=0

for PR in $PR_NUMBERS; do
  if [ "$PROCESSED" -ge "$MAX_PRS" ]; then
    REMAINING=$((PR_COUNT - PROCESSED))
    echo "Reached max PR limit ($MAX_PRS), $REMAINING PR(s) deferred."
    break
  fi

  echo ""
  echo "--- Processing PR #${PR} ---"

  # Ensure clean tree between PRs (previous review may have left state)
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    echo "WARNING: Dirty tree detected between PRs, resetting..."
    git checkout -- . 2>/dev/null || true
    git clean -fd 2>/dev/null || true
  fi

  # Ensure we're back on default branch
  CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
  if [ "$CURRENT" != "$DEFAULT_BRANCH" ]; then
    git checkout "$DEFAULT_BRANCH" > /dev/null 2>&1 || true
  fi

  bash "$REPO_ROOT/skills/auto-pr-review/scripts/review-pr.sh" "$PR" $FORCE_FLAG
  EXIT_CODE=$?

  case "$EXIT_CODE" in
    0)
      REVIEWED=$((REVIEWED + 1))
      ;;
    2)
      SKIPPED=$((SKIPPED + 1))
      ;;
    *)
      ERRORS=$((ERRORS + 1))
      echo "ERROR: review-pr.sh failed for PR #${PR} (exit $EXIT_CODE)"
      ;;
  esac

  PROCESSED=$((PROCESSED + 1))

  # Clean up work dir after each PR
  rm -rf "/tmp/auto-pr-review/${PR}" 2>/dev/null || true
done

echo ""
echo "========================================"
echo "Batch complete: reviewed=$REVIEWED, skipped=$SKIPPED, errors=$ERRORS (of $PROCESSED processed)"
echo "========================================"
