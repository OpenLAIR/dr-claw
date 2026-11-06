---
name: aris-research-lit
description: Search and analyze research papers, find related work, summarize key ideas. Use when user says "find papers", "related work", "literature review", "what does this paper say", or needs to understand academic papers.
argument-hint: "[paper-topic-or-url]"
allowed-tools: Bash(*), Read, Glob, Grep, WebSearch, WebFetch, Write, Agent, mcp__zotero__*, mcp__obsidian-vault__*
license: MIT
metadata:
  author: wanshuiyin/ARIS
  version: "1.0.0"
---

# Research Literature Review

Research topic: $ARGUMENTS

## Constants

- **PAPER_LIBRARY** — Local directory containing user's paper collection (PDFs). Check these paths in order:
  1. `papers/` in the current project directory
  2. `literature/` in the current project directory
  3. Custom path specified by user in `CLAUDE.md` under `## Paper Library`
- **MAX_LOCAL_PAPERS = 20** — Maximum number of local PDFs to scan (read first 3 pages each). If more are found, prioritize by filename relevance to the topic.
- **ARXIV_DOWNLOAD = false** — When `true`, download top 3-5 most relevant arXiv PDFs to PAPER_LIBRARY after search. When `false` (default), only fetch metadata (title, abstract, authors) via arXiv API — no files are downloaded.
- **ARXIV_MAX_DOWNLOAD = 5** — Maximum number of PDFs to download when `ARXIV_DOWNLOAD = true`.

> 💡 Overrides:
> - `/aris-research-lit "topic" — paper library: ~/my_papers/` — custom local PDF path
> - `/aris-research-lit "topic" — sources: zotero, local` — only search Zotero + local PDFs
> - `/aris-research-lit "topic" — sources: zotero` — only search Zotero
> - `/aris-research-lit "topic" — sources: web` — only search the web (skip all local)
> - `/aris-research-lit "topic" — sources: web, semantic-scholar` — also search Semantic Scholar for published venue papers (IEEE, ACM, etc.)
> - `/aris-research-lit "topic" — arxiv download: true` — download top relevant arXiv PDFs
> - `/aris-research-lit "topic" — arxiv download: true, max download: 10` — download up to 10 PDFs

## Data Sources

This skill checks multiple sources **in priority order**. All are optional — if a source is not configured or not requested, skip it silently.

### Source Selection

Parse `$ARGUMENTS` for a `— sources:` directive:
- **If `— sources:` is specified**: Only search the listed sources (comma-separated). Valid values: `zotero`, `obsidian`, `local`, `web`, `aris-semantic-scholar`, `all`.
- **If not specified**: Default to `all` — search every available source in priority order (`aris-semantic-scholar` is **excluded** from `all`; it must be explicitly listed).

Examples:
```
/aris-research-lit "diffusion models"                                    → all (default, no S2)
/aris-research-lit "diffusion models" — sources: all                     → all (default, no S2)
/aris-research-lit "diffusion models" — sources: zotero                  → Zotero only
/aris-research-lit "diffusion models" — sources: zotero, web             → Zotero + web
/aris-research-lit "diffusion models" — sources: local                   → local PDFs only
/aris-research-lit "topic" — sources: obsidian, local, web               → skip Zotero
/aris-research-lit "topic" — sources: web, semantic-scholar              → web + S2 API (IEEE/ACM venue papers)
/aris-research-lit "topic" — sources: all, semantic-scholar              → all + S2 API
```

### Source Table

| Priority | Source | ID | How to detect | What it provides |
|----------|--------|----|---------------|-----------------|
| 1 | **Zotero** (via MCP) | `zotero` | Try calling any `mcp__zotero__*` tool — if unavailable, skip | Collections, tags, annotations, PDF highlights, BibTeX, semantic search |
| 2 | **Obsidian** (via MCP) | `obsidian` | Try calling any `mcp__obsidian-vault__*` tool — if unavailable, skip | Research notes, paper summaries, tagged references, wikilinks |
| 3 | **Local PDFs** | `local` | `Glob: papers/**/*.pdf, literature/**/*.pdf` | Raw PDF content (first 3 pages) |
| 4 | **Web search** | `web` | Always available (WebSearch) | arXiv, Semantic Scholar, Google Scholar |
| 5 | **Semantic Scholar API** | `aris-semantic-scholar` | `$ARIS_INFRA/tools/semantic_scholar_fetch.py` exists | Published venue papers (IEEE, ACM, Springer) with structured metadata: citation counts, venue info, TLDR. **Only runs when explicitly requested** via `— sources: semantic-scholar` or `— sources: web, semantic-scholar` |

> **Graceful degradation**: If no MCP servers are configured, the skill works exactly as before (local PDFs + web search). Zotero and Obsidian are pure additions.

## Workflow

### Step 0a: Search Zotero Library (if available)

**Skip this step entirely if Zotero MCP is not configured.**

Try calling a Zotero MCP tool (e.g., search). If it succeeds:

1. **Search by topic**: Use the Zotero search tool to find papers matching the research topic
2. **Read collections**: Check if the user has a relevant collection/folder for this topic
3. **Extract annotations**: For highly relevant papers, pull PDF highlights and notes — these represent what the user found important
4. **Export BibTeX**: Get citation data for relevant papers (useful for `/aris-paper-write` later)
5. **Compile results**: For each relevant Zotero entry, extract:
   - Title, authors, year, venue
   - User's annotations/highlights (if any)
   - Tags the user assigned
   - Which collection it belongs to

> 📚 Zotero annotations are gold — they show what the user personally highlighted as important, which is far more valuable than generic summaries.

### Step 0b: Search Obsidian Vault (if available)

**Skip this step entirely if Obsidian MCP is not configured.**

Try calling an Obsidian MCP tool (e.g., search). If it succeeds:

1. **Search vault**: Search for notes related to the research topic
2. **Check tags**: Look for notes tagged with relevant topics (e.g., `#diffusion-models`, `#paper-review`)
3. **Read research notes**: For relevant notes, extract the user's own summaries and insights
4. **Follow links**: If notes link to other relevant notes (wikilinks), follow them for additional context
5. **Compile results**: For each relevant note:
   - Note title and path
   - User's summary/insights
   - Links to other notes (research graph)
   - Any frontmatter metadata (paper URL, status, rating)

> 📝 Obsidian notes represent the user's **processed understanding** — more valuable than raw paper content for understanding their perspective.

### Step 0c: Scan Local Paper Library

Before searching online, check if the user already has relevant papers locally:

1. **Locate library**: Check PAPER_LIBRARY paths for PDF files
   ```
   Glob: papers/**/*.pdf, literature/**/*.pdf
   ```

2. **De-duplicate against Zotero**: If Step 0a found papers, skip any local PDFs already covered by Zotero results (match by filename or title).

3. **Filter by relevance**: Match filenames and first-page content against the research topic. Skip clearly unrelated papers.

4. **Summarize relevant papers**: For each relevant local PDF (up to MAX_LOCAL_PAPERS):
   - Read first 3 pages (title, abstract, intro)
   - Extract: title, authors, year, core contribution, relevance to topic
   - Flag papers that are directly related vs tangentially related

5. **Build local knowledge base**: Compile summaries into a "papers you already have" section. This becomes the starting point — external search fills the gaps.

> 📚 If no local papers are found, skip to Step 1. If the user has a comprehensive local collection, the external search can be more targeted (focus on what's missing).

### Step 1: Search (external)
- Use WebSearch to find recent papers on the topic
- Check arXiv, Semantic Scholar, Google Scholar
- Focus on papers from last 2 years unless studying foundational work
- **De-duplicate**: Skip papers already found in Zotero, Obsidian, or local library

**arXiv API search** (always runs, no download by default):

Locate the ARIS helper bundle once (reused below for Semantic Scholar and the research wiki):

```bash
# Locate the ARIS helper bundle (skills/aris-infra in Dr. Claw; it sits next to
# this skill's own folder). Non-fatal: the steps below fall back when it is missing.
ARIS_INFRA="${ARIS_INFRA:-}"
if [ ! -f "$ARIS_INFRA/tools/research_wiki.py" ]; then
  ARIS_INFRA=""
  for candidate in \
    "${CLAUDE_SKILL_DIR:-/nonexistent}/../aris-infra" \
    ".claude/skills/aris-infra" \
    ".agents/skills/library/aris-infra" \
    "skills/aris-infra" \
    "${HOME:-/nonexistent}/.claude/skills/aris-infra"; do
    if [ -f "$candidate/tools/research_wiki.py" ]; then ARIS_INFRA="$candidate"; break; fi
  done
fi
if [ -z "$ARIS_INFRA" ]; then
  # Project skill links point into the bundled skills folder, so ../aris-infra
  # resolves through any linked aris-* skill even when aris-infra is not linked.
  for linked in .claude/skills/aris-* .agents/skills/aris-* .agents/skills/library/aris-* .gemini/skills/aris-*; do
    if [ -f "$linked/../aris-infra/tools/research_wiki.py" ]; then ARIS_INFRA="$linked/../aris-infra"; break; fi
  done
fi
```

If `ARIS_INFRA` is still empty, it is the `aris-infra` folder beside this skill's
own folder: set it to that absolute path.

Then search arXiv directly:
```bash
SCRIPT="$ARIS_INFRA/tools/arxiv_fetch.py"
[ -n "$ARIS_INFRA" ] && [ -f "$SCRIPT" ] || SCRIPT=""

# Search arXiv API for structured results (title, abstract, authors, categories)
python3 "$SCRIPT" search "QUERY" --max 10
```

If `arxiv_fetch.py` is not found, fall back to WebSearch for arXiv (same as before).

The arXiv API returns structured metadata (title, abstract, full author list, categories, dates) — richer than WebSearch snippets. Merge these results with WebSearch findings and de-duplicate.

**Semantic Scholar API search** (only when `aris-semantic-scholar` is in sources):

When the user explicitly requests `— sources: semantic-scholar` (or `— sources: web, semantic-scholar`), search for published venue papers beyond arXiv:

```bash
S2_SCRIPT="$ARIS_INFRA/tools/semantic_scholar_fetch.py"

# Search for published CS/Engineering papers with quality filters
python3 "$S2_SCRIPT" search "QUERY" --max 10 \
  --fields-of-study "Computer Science,Engineering" \
  --publication-types "JournalArticle,Conference"
```

If `semantic_scholar_fetch.py` is not found, skip silently.

**Why use Semantic Scholar?** Many IEEE/ACM journal papers are NOT on arXiv. S2 fills the gap for published venue-only papers with citation counts and venue metadata.

**De-duplication between arXiv and S2**: Match by arXiv ID (S2 returns `externalIds.ArXiv`):
- If a paper appears in both: check S2's `venue`/`publicationVenue` — if it has been published in a journal/conference (e.g. IEEE TWC, JSAC), use S2's metadata (venue, citationCount, DOI) as the authoritative version, since the published version supersedes the preprint. Keep the arXiv PDF link for download.
- If the S2 match has no venue (still just a preprint indexed by S2): keep the arXiv version as-is.
- S2 results without `externalIds.ArXiv` are **venue-only papers** not on arXiv — these are the unique value of this source.

**Optional PDF download** (only when `ARXIV_DOWNLOAD = true`):

After all sources are searched and papers are ranked by relevance:
```bash
# Download top N most relevant arXiv papers
python3 "$SCRIPT" download ARXIV_ID --dir papers/
```
- Only download papers ranked in the top ARXIV_MAX_DOWNLOAD by relevance
- Skip papers already in the local library
- 1-second delay between downloads (rate limiting)
- Verify each PDF > 10 KB

### Step 2: Analyze Each Paper
For each relevant paper (from all sources), extract:
- **Problem**: What gap does it address?
- **Method**: Core technical contribution (1-2 sentences)
- **Results**: Key numbers/claims
- **Relevance**: How does it relate to our work?
- **Source**: Where we found it (Zotero/Obsidian/local/web) — helps user know what they already have vs what's new

### Step 3: Synthesize
- Group papers by approach/theme
- Identify consensus vs disagreements in the field
- Find gaps that our work could fill
- If Obsidian notes exist, incorporate the user's own insights into the synthesis

### Step 4: Output
Present as a structured literature table:

```
| Paper | Venue | Method | Key Result | Relevance to Us | Source |
|-------|-------|--------|------------|-----------------|--------|
```

Plus a narrative summary of the landscape (3-5 paragraphs).

If Zotero BibTeX was exported, include a `references.bib` snippet for direct use in paper writing.

### Step 5: Save (if requested)
- Save paper PDFs to `literature/` or `papers/`
- Update related work notes in project memory
- If Obsidian is available, optionally create a literature review note in the vault

### Step 6: Update Research Wiki (if active)

**This step is optional and automatic.** Skip entirely if `research-wiki/` does not exist in the project.

```
if research-wiki/ directory exists:
    for each top relevant paper found (up to 8-12):
        1. Generate slug: python3 "$ARIS_INFRA/tools/research_wiki.py" slug "<title>" --author "<last>" --year <year>
        2. Create page: research-wiki/papers/<slug>.md with structured schema
           (node_id, title, authors, year, venue, tags, one-line thesis, problem/gap,
            method, key results, limitations, reusable ingredients, open questions)
        3. Add edges to graph/edges.jsonl for relationships to existing wiki papers:
           python3 "$ARIS_INFRA/tools/research_wiki.py" add_edge research-wiki/ --from "paper:<slug>" --to "<target>" --type <type> --evidence "<text>"
        4. Update gap_map.md if new gaps are identified
    Rebuild query pack:
        python3 "$ARIS_INFRA/tools/research_wiki.py" rebuild_query_pack research-wiki/
    Log:
        python3 "$ARIS_INFRA/tools/research_wiki.py" log research-wiki/ "research-lit ingested N papers"
else:
    skip — no wiki, no action, no error
```

## Key Rules
- Always include paper citations (authors, year, venue)
- Distinguish between peer-reviewed and preprints
- Be honest about limitations of each paper
- Note if a paper directly competes with or supports our approach
- **Never fail because a MCP server is not configured** — always fall back gracefully to the next data source
- Zotero/Obsidian tools may have different names depending on how the user configured the MCP server (e.g., `mcp__zotero__search` or `mcp__zotero-mcp__search_items`). Try the most common patterns and adapt.
