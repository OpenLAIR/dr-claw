#!/bin/bash

# Merge latest code while preserving disable-delete feature
# Usage: ./scripts/merge-with-disable-delete.sh

set -e  # Exit on error

echo "🔄 Merging latest code with disable-delete feature..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if we're in the right directory
if [ ! -f "package.json" ] || [ ! -d ".git" ]; then
    echo -e "${RED}❌ Error: Not in dr-claw root directory${NC}"
    exit 1
fi

# Step 1: Create temporary branch and save modifications
echo -e "${BLUE}1️⃣  Saving disable-delete modifications to temp branch...${NC}"
git checkout -b temp-disable-delete 2>/dev/null || git checkout temp-disable-delete

git add server/index.js src/components/sidebar/view/subcomponents/SidebarProjectItem.tsx 2>/dev/null || true

if git diff --cached --quiet; then
    echo "✓ No changes to commit (disable-delete already applied)"
else
    git commit -m "chore: disable project deletion to prevent accidental data loss" || true
fi
echo ""

# Step 2: Update main branch
echo -e "${BLUE}2️⃣  Updating main branch from origin...${NC}"
git checkout main
git restore package-lock.json 2>/dev/null || true
git pull origin main
echo ""

# Step 3: Re-apply disable-delete changes
echo -e "${BLUE}3️⃣  Re-applying disable-delete changes...${NC}"
if git cherry-pick temp-disable-delete 2>/dev/null; then
    echo "✓ Successfully cherry-picked disable-delete commit"
else
    echo "⚠️  Cherry-pick encountered conflicts or commit already applied"
fi
echo ""

# Step 4: Cleanup temporary branch
echo -e "${BLUE}4️⃣  Cleaning up temporary branch...${NC}"
git branch -D temp-disable-delete
echo ""

# Step 5: Verify
echo -e "${BLUE}5️⃣  Verifying merge...${NC}"
git log --oneline -3
echo ""

# Final status
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMITS_AHEAD=$(git rev-list --count origin/main..HEAD)

if [ "$CURRENT_BRANCH" = "main" ] && git status --porcelain | grep -q ""; then
    echo -e "${RED}❌ Working directory has uncommitted changes${NC}"
    exit 1
elif [ "$CURRENT_BRANCH" = "main" ]; then
    echo -e "${GREEN}✅ Merge successful!${NC}"
    echo ""
    echo -e "${BLUE}📌 Next steps:${NC}"
    echo "1. Restart backend: npm run dev (Ctrl+C and restart)"
    echo "2. (Optional) Update dependencies: npm install"
    echo ""
    echo -e "${GREEN}✨ Your disable-delete feature is preserved!${NC}"
else
    echo -e "${RED}❌ Not on main branch${NC}"
    exit 1
fi
