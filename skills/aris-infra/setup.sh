#!/usr/bin/env bash
# ARIS One-Click Setup Script
# Usage: bash skills/aris-infra/setup.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo ""
echo -e "${BLUE}╔══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   ARIS - Auto Research in Sleep Setup    ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Step 1: Check prerequisites ──
echo -e "${YELLOW}[1/4] Checking prerequisites...${NC}"

if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ Python 3 not found. Please install Python 3.10+${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Python $(python3 --version | cut -d' ' -f2)${NC}"

if ! command -v claude &>/dev/null; then
  echo -e "${RED}✗ Claude Code CLI not found. Please install it first.${NC}"
  exit 1
fi
echo -e "${GREEN}  ✓ Claude Code CLI${NC}"

# ── Step 2: Install Python dependencies ──
echo ""
echo -e "${YELLOW}[2/4] Installing Python dependencies...${NC}"
pip3 install -q httpx arxiv requests 2>/dev/null && echo -e "${GREEN}  ✓ httpx, arxiv, requests${NC}" || echo -e "${YELLOW}  ⚠ pip install failed (non-critical, some tools may not work)${NC}"

# ── Step 3: Symlink skills to ~/.claude/skills/ ──
echo ""
echo -e "${YELLOW}[3/4] Registering ARIS skills...${NC}"
mkdir -p "$HOME/.claude/skills"
count=0
for dir in "$PROJECT_DIR"/skills/aris-*/; do
  name=$(basename "$dir")
  target="$HOME/.claude/skills/$name"
  if [ ! -e "$target" ]; then
    ln -s "$dir" "$target"
    count=$((count + 1))
  fi
done
existing=$(ls -d "$HOME/.claude/skills"/aris-* 2>/dev/null | wc -l | tr -d ' ')
echo -e "${GREEN}  ✓ ${existing} ARIS skills available (${count} newly linked)${NC}"

# ── Step 4: Configure MCP Server ──
echo ""
echo -e "${YELLOW}[4/4] Configuring MCP reviewer server...${NC}"
echo ""
echo "  ARIS needs an external LLM for cross-model review."
echo "  Choose a reviewer backend:"
echo ""
echo "    1) Codex (capability-gated)     — Recommended, requires OPENAI_API_KEY"
echo "    2) Generic LLM Chat    — Any OpenAI-compatible API"
echo "    3) Gemini               — Google Gemini API"
echo "    4) Skip                 — Configure later via /aris-infra"
echo ""
read -r -p "  Select [1-4]: " choice

case "$choice" in
  1)
    if ! command -v codex &>/dev/null; then
      echo -e "  ${YELLOW}Installing Codex CLI...${NC}"
      npm install -g @openai/codex 2>/dev/null
    fi
    if claude mcp list 2>/dev/null | grep -q "codex"; then
      echo -e "  ${GREEN}✓ Codex MCP already registered${NC}"
    else
      claude mcp add codex -s user -- python3 "$SCRIPT_DIR/mcp-servers/codex-exec/server.py"
      echo -e "  ${GREEN}✓ Codex MCP registered${NC}"
    fi
    if [ -z "$OPENAI_API_KEY" ]; then
      echo ""
      echo -e "  ${YELLOW}⚠ OPENAI_API_KEY not set in environment.${NC}"
      echo "  Add to your shell profile:"
      echo "    export OPENAI_API_KEY=sk-..."
    else
      echo -e "  ${GREEN}✓ OPENAI_API_KEY detected${NC}"
    fi
    ;;
  2)
    server_py="$SCRIPT_DIR/mcp-servers/llm-chat/server.py"
    if claude mcp list 2>/dev/null | grep -q "llm-chat"; then
      echo -e "  ${GREEN}✓ llm-chat MCP already registered${NC}"
    else
      claude mcp add llm-chat -s user -- python3 "$server_py"
      echo -e "  ${GREEN}✓ llm-chat MCP registered${NC}"
    fi
    echo ""
    echo -e "  ${YELLOW}Set these environment variables:${NC}"
    echo "    export LLM_API_KEY=your-key"
    echo "    export LLM_BASE_URL=https://api.openai.com/v1"
    echo "    export LLM_MODEL=gpt-4o"
    ;;
  3)
    server_py="$SCRIPT_DIR/mcp-servers/gemini-review/server.py"
    if claude mcp list 2>/dev/null | grep -q "gemini-review"; then
      echo -e "  ${GREEN}✓ gemini-review MCP already registered${NC}"
    else
      claude mcp add gemini-review -s user -- python3 "$server_py"
      echo -e "  ${GREEN}✓ gemini-review MCP registered${NC}"
    fi
    if [ -z "$GEMINI_API_KEY" ] && [ -z "$GOOGLE_API_KEY" ]; then
      echo ""
      echo -e "  ${YELLOW}⚠ GEMINI_API_KEY not set in environment.${NC}"
      echo "  Add to your shell profile:"
      echo "    export GEMINI_API_KEY=your-key"
    else
      echo -e "  ${GREEN}✓ Gemini API key detected${NC}"
    fi
    ;;
  4)
    echo -e "  ${YELLOW}Skipped. Run /aris-infra in Chat to configure later.${NC}"
    ;;
  *)
    echo -e "  ${YELLOW}Invalid choice. Skipped. Run /aris-infra in Chat to configure later.${NC}"
    ;;
esac

# ── Done ──
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║            Setup Complete!               ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════╝${NC}"
echo ""
echo "  Usage in Chat:"
echo ""
echo -e "    ${BLUE}/aris-research-pipeline \"your topic\"${NC}  — Full end-to-end pipeline"
echo -e "    ${BLUE}/aris-idea-discovery \"topic\"${NC}          — Just find ideas"
echo -e "    ${BLUE}/aris-auto-review-loop${NC}                — Cross-model review"
echo -e "    ${BLUE}/aris-paper-writing${NC}                   — Write paper"
echo ""
echo "  Note: Restart Claude Code session after setup for MCP to take effect."
echo ""

echo "  Workflow M: /aris-meta-optimize proposes; /aris-meta-apply is separately human-invoked."
echo "  Logging and corpus-write guard are OFF by default; this script does not enable them."
echo "  For explicit project-only preview/merge, see docs/aris-self-evolution.md."
