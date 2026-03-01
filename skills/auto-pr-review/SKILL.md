---
name: auto-pr-review
description: >-
  Automatically review GitHub pull requests by running Playwright E2E tests,
  typecheck, and build checks on a local Mac Mini. Uses a hybrid script + agent
  approach: scripts handle mechanical checks (free), a Claude agent via cliwrapper
  writes intelligent review comments. Includes pre-check analysis to skip trivial PRs.
  Use when asked to "review a PR", "run PR checks", "auto-review open PRs",
  "test this PR", "check PR #N", or "set up PR auto-review cron".
---

# Auto PR Review — Execution Rules

## Goal & Scope

Run automated quality checks (build, typecheck, E2E tests) against a pull request
branch and post a structured review comment summarizing findings. Uses a hybrid
architecture: scripts for mechanical checks, Claude agent for intelligent analysis.

**Never** merge, approve, or reject — only comment with analysis.

## Audience & Tone

Developers submitting PRs who want fast, automated feedback before human review.
Comments should be actionable, concise, and constructive.

## Required Algorithm

### 1. DETERMINE TARGET
- If user specifies a PR number: use that PR
- If user says "review open PRs": run batch mode on all non-draft open PRs
- If no PR specified and on a PR branch: detect via `gh pr view --json number`

### 2. SINGLE PR REVIEW (`scripts/review-pr.sh <number> [--force]`)

#### 2a. Safety Checks
- Verify clean working tree: `git status --porcelain`
- Verify `gh auth status` succeeds
- Record current branch for restore

#### 2b. Idempotency Check
```bash
PR_SHA=$(gh pr view <number> --json headRefOid --jq '.headRefOid')
EXISTING=$(gh pr view <number> --json comments \
  --jq "[.comments[].body | select(contains(\"<!-- auto-pr-review:${PR_SHA} -->\"))] | length")
```
If already reviewed at this SHA: **silently exit 0** (no comment, no action).

#### 2c. Pre-check Analysis (`scripts/precheck-pr.sh`)
Quick diff analysis to skip trivial PRs:
- Skip if: <= 5 lines AND only docs/comments
- Skip if: only lockfile changes
- Skip if: only `.md`/`.txt` files
- `--force` flag bypasses pre-check

If skipped: post lightweight "trivial change" comment and exit.

#### 2d. Classify PR (`scripts/classify-pr.sh`)
Based on changed file paths:
- **ui**: `src/components/`, `src/*.tsx`, `src/*.css`, `src/hooks/`, `src/contexts/`, `public/`
- **backend**: `server/`, `shared/`, config files
- **mixed**: both UI + backend files

#### 2e. Mechanical Checks (`scripts/run-checks.sh`)
Runs in order, captures exit codes + logs for each:
1. `npm ci`
2. `npm run typecheck`
3. `npm run build`
4. `npx playwright test --reporter=json`

#### 2f. Parse Results (`scripts/parse-results.js`)
Playwright JSON + exit codes → `report.json` with structured status and failures.

#### 2g. Agent Review (`scripts/invoke-agent.sh`)
Invoke Claude agent via cliwrapper (port 8001):
- **UI/mixed PRs**: full review (diff + screenshots + test results + UX analysis)
- **Backend PRs**: light review (diff + test results + code quality)
- **Fallback**: static `comment-template.md` if cliwrapper unavailable

#### 2h. Post Comment
```bash
gh pr comment <number> --body-file comment.md
```

#### 2i. Cleanup
Restore original branch, remove temp files. Uses `trap cleanup EXIT`.

### 3. BATCH MODE (`scripts/review-pr-batch.sh`)
```bash
gh pr list --state open --json number,isDraft \
  --jq '.[] | select(.isDraft == false) | .number'
```
Iterates open non-draft PRs (max 10), calls `review-pr.sh` for each.

### 4. CRON SETUP (Mac Mini)
```bash
# Every 30 minutes:
*/30 * * * * cd /path/to/vibelab-public && \
  PATH="/opt/homebrew/bin:/usr/local/bin:$PATH" \
  bash skills/auto-pr-review/scripts/review-pr-batch.sh \
  >> /tmp/auto-pr-review-cron.log 2>&1
```

## Quality Checklist
- [ ] Never force-push, merge, or approve
- [ ] Working tree restored to original branch after every PR
- [ ] Temp files cleaned up
- [ ] Comment includes sentinel for idempotency
- [ ] Already-reviewed PRs silently ignored
- [ ] Pre-check correctly identifies trivial PRs
- [ ] Agent fallback works when cliwrapper is down

## Failure Modes & Recovery

**npm ci fails:** Post comment noting install failure; skip tests; continue.
**Typecheck/build fails:** Record failure; still attempt E2E; include in report.
**Playwright timeout:** 5-min global timeout; capture partial results.
**gh auth not configured:** Abort with clear message.
**Dirty working tree:** Abort; do not stash automatically.
**cliwrapper unavailable:** Fall back to static comment-template.md.

## Security & Privacy
- Never print or store API keys
- Read-only git operations (checkout --detach)
- Only `gh pr comment` — no approve/reject/merge
- Temp files in /tmp, cleaned on exit
- `--force` required to bypass pre-check

## Limits
- NEVER merge, approve, or reject a PR
- NEVER force-push or modify the PR branch
- NEVER post duplicate comments (idempotency enforced)
- Maximum 10 PRs per batch run
- Does not review draft PRs unless `--force`
