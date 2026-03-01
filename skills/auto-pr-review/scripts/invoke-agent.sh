#!/usr/bin/env bash
# Invoke Claude agent via cliwrapper to write an intelligent PR review comment.
# Falls back to static template if cliwrapper is unavailable.
set -uo pipefail

PR_NUMBER="${1:?Usage: invoke-agent.sh <pr-number>}"
WORK_DIR="${2:?Usage: invoke-agent.sh <pr-number> <work-dir>}"
SKILL_DIR="${3:?Usage: invoke-agent.sh <pr-number> <work-dir> <skill-dir>}"

CLIWRAPPER_PORT="${CLIWRAPPER_PORT:-8001}"
CLIWRAPPER_URL="http://127.0.0.1:${CLIWRAPPER_PORT}/v1/chat/completions"
CLIWRAPPER_MODEL="${CLIWRAPPER_MODEL:-claude-code}"
CLIWRAPPER_TIMEOUT="${CLIWRAPPER_TIMEOUT:-120}"

PR_TYPE=$(cat "$WORK_DIR/pr-type.txt" 2>/dev/null || echo "backend")
PR_SHA=$(cat "$WORK_DIR/pr-sha.txt" 2>/dev/null || echo "unknown")
REPORT=$(cat "$WORK_DIR/report.json" 2>/dev/null || echo "{}")

# Get the PR diff (truncate to ~50KB to stay within token limits)
DIFF=$(gh pr diff "$PR_NUMBER" 2>/dev/null | head -c 50000 || echo "")

# Choose prompt template
if [ "$PR_TYPE" = "backend" ]; then
  TEMPLATE_FILE="$SKILL_DIR/resources/agent-prompt-backend.md"
else
  TEMPLATE_FILE="$SKILL_DIR/resources/agent-prompt-ui.md"
fi

if [ ! -f "$TEMPLATE_FILE" ]; then
  echo "ERROR: Template file not found: $TEMPLATE_FILE"
  echo "Falling back to static template..."
  # Jump to fallback
  node "$SKILL_DIR/scripts/format-fallback.js" \
    --report "$WORK_DIR/report.json" \
    --template "$SKILL_DIR/resources/comment-template.md" \
    --pr-number "$PR_NUMBER" \
    --pr-sha "$PR_SHA" \
    --output "$WORK_DIR/comment.md"
  exit $?
fi

TEMPLATE=$(cat "$TEMPLATE_FILE")

# Build the full prompt by appending data
PROMPT="${TEMPLATE}

---
PR Number: ${PR_NUMBER}
PR SHA: ${PR_SHA}
PR Type: ${PR_TYPE}

## Test Report
\`\`\`json
${REPORT}
\`\`\`

## PR Diff
\`\`\`diff
${DIFF}
\`\`\`
"

# Check if cliwrapper is available
if curl -s --connect-timeout 3 "http://127.0.0.1:${CLIWRAPPER_PORT}/v1/models" > /dev/null 2>&1; then
  echo "cliwrapper available on port ${CLIWRAPPER_PORT}, invoking agent..."

  # Call cliwrapper API
  RESPONSE=$(curl -s --max-time "$CLIWRAPPER_TIMEOUT" "$CLIWRAPPER_URL" \
    -H "Content-Type: application/json" \
    -d "$(jq -n \
      --arg model "$CLIWRAPPER_MODEL" \
      --arg prompt "$PROMPT" \
      '{
        model: $model,
        messages: [{role: "user", content: $prompt}],
        stream: false
      }')" 2>/dev/null || echo "")

  if [ -n "$RESPONSE" ]; then
    COMMENT=$(echo "$RESPONSE" | jq -r '.choices[0].message.content // empty' 2>/dev/null || echo "")

    if [ -n "$COMMENT" ]; then
      echo "$COMMENT" > "$WORK_DIR/comment.md"
      echo "Agent comment generated successfully"
      exit 0
    fi
  fi

  echo "WARNING: cliwrapper returned empty response, falling back to static template"
else
  echo "cliwrapper not available on port ${CLIWRAPPER_PORT}, using static template"
fi

# Fallback: generate comment from static template
echo "Generating fallback comment from static template..."
node "$SKILL_DIR/scripts/format-fallback.js" \
  --report "$WORK_DIR/report.json" \
  --template "$SKILL_DIR/resources/comment-template.md" \
  --pr-number "$PR_NUMBER" \
  --pr-sha "$PR_SHA" \
  --output "$WORK_DIR/comment.md"
