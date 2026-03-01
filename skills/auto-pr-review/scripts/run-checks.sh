#!/usr/bin/env bash
# Run mechanical checks: npm ci, typecheck, build, Playwright E2E.
# Captures exit codes and logs for each step.
set -uo pipefail

WORK_DIR="${1:?Usage: run-checks.sh <work-dir>}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

if [ ! -f "$REPO_ROOT/package.json" ]; then
  echo "ERROR: No package.json found at $REPO_ROOT"
  exit 1
fi

# Timeouts (seconds)
NPM_CI_TIMEOUT="${NPM_CI_TIMEOUT:-300}"
TYPECHECK_TIMEOUT="${TYPECHECK_TIMEOUT:-120}"
BUILD_TIMEOUT="${BUILD_TIMEOUT:-180}"
PLAYWRIGHT_TIMEOUT="${PLAYWRIGHT_TIMEOUT:-300}"

# macOS-compatible timeout: use gtimeout (brew install coreutils) or perl fallback
run_with_timeout() {
  local timeout_secs="$1"
  shift
  if command -v gtimeout > /dev/null 2>&1; then
    gtimeout "$timeout_secs" "$@"
  elif command -v timeout > /dev/null 2>&1; then
    timeout "$timeout_secs" "$@"
  else
    # Perl-based fallback for macOS without coreutils
    perl -e '
      alarm shift @ARGV;
      $SIG{ALRM} = sub { kill 9, $pid; exit 124 };
      $pid = fork;
      if ($pid == 0) { exec @ARGV; exit 127 }
      waitpid $pid, 0;
      exit ($? >> 8);
    ' "$timeout_secs" "$@"
  fi
}

echo "=== run-checks: Starting mechanical checks ==="

# Step 1: npm ci
echo "--- Step 1/4: npm ci ---"
run_with_timeout "$NPM_CI_TIMEOUT" npm ci --prefix "$REPO_ROOT" \
  > "$WORK_DIR/npm-ci.log" 2>&1
EXIT_CODE=$?
echo "$EXIT_CODE" > "$WORK_DIR/npm-ci.exit"
echo "npm ci exit: $EXIT_CODE"

if [ "$EXIT_CODE" -ne 0 ]; then
  echo "WARNING: npm ci failed (exit $EXIT_CODE), continuing..."
fi

# Step 2: typecheck
echo "--- Step 2/4: typecheck ---"
run_with_timeout "$TYPECHECK_TIMEOUT" npm run typecheck --prefix "$REPO_ROOT" \
  > "$WORK_DIR/typecheck.log" 2>&1 || true
EXIT_CODE=$?
echo "$EXIT_CODE" > "$WORK_DIR/typecheck.exit"
echo "typecheck exit: $EXIT_CODE"

# Step 3: build
echo "--- Step 3/4: build ---"
run_with_timeout "$BUILD_TIMEOUT" npm run build --prefix "$REPO_ROOT" \
  > "$WORK_DIR/build.log" 2>&1 || true
EXIT_CODE=$?
echo "$EXIT_CODE" > "$WORK_DIR/build.exit"
echo "build exit: $EXIT_CODE"

# Step 4: Playwright E2E tests with JSON reporter
echo "--- Step 4/4: Playwright E2E ---"
mkdir -p "$WORK_DIR/test-results"

# Check if Playwright browsers are installed
if ! npx playwright install --dry-run chromium > /dev/null 2>&1; then
  echo "WARNING: Playwright browsers may not be installed. Run: npx playwright install chromium"
fi

# Run playwright with JSON output to stdout, HTML report to work dir
run_with_timeout "$PLAYWRIGHT_TIMEOUT" npx playwright test \
  --reporter=json \
  --output="$WORK_DIR/test-results" \
  > "$WORK_DIR/results.json" 2>"$WORK_DIR/playwright.stderr" || true
EXIT_CODE=$?
echo "$EXIT_CODE" > "$WORK_DIR/playwright.exit"
echo "playwright exit: $EXIT_CODE"

# Validate JSON output (ESM-compatible)
if [ -f "$WORK_DIR/results.json" ] && [ -s "$WORK_DIR/results.json" ]; then
  if ! node --input-type=module -e "
    import { readFileSync } from 'fs';
    JSON.parse(readFileSync('$WORK_DIR/results.json', 'utf8'));
  " 2>/dev/null; then
    echo "WARNING: Playwright JSON output is invalid, saving raw output"
    mv "$WORK_DIR/results.json" "$WORK_DIR/results.json.raw"
    echo '{"suites":[],"errors":[]}' > "$WORK_DIR/results.json"
  fi
else
  echo "WARNING: No Playwright JSON output, creating empty result"
  echo '{"suites":[],"errors":[]}' > "$WORK_DIR/results.json"
fi

echo "=== run-checks: Complete ==="
