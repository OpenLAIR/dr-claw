---
name: managing-obsidian-notes
description: >-
  CRUD operations for Obsidian vault notes using the Obsidian CLI. Use when asked to "create a note",
  "add a folder", "update notes", "organize notes", "save to obsidian", "open in obsidian", or manage
  any Obsidian/markdown note structure. Handles folder-with-index-file pattern, wikilinks, tags,
  frontmatter, and Obsidian-specific syntax. Requires Obsidian v1.8+ with CLI enabled.
---

# Managing Obsidian Notes — Execution Rules

## Goal & Scope
Perform Create, Read, Update, Delete operations on Obsidian vault notes using the Obsidian CLI,
following consistent patterns and Obsidian best practices.

## Audience & Tone
Users with Obsidian vaults who want consistent note organization. Technical, concise.

## Setup & Onboarding

Follow these steps in order. Skip any step where the check already passes.

### Step 1: Check if Obsidian App is Installed

```bash
ls /Applications/Obsidian.app 2>/dev/null && echo "APP_OK" || echo "APP_MISSING"
```

If `APP_MISSING`, guide the user:

> **Obsidian is not installed.** Let's set it up:
>
> **macOS:**
> ```bash
> brew install --cask obsidian
> ```
> Or download from [obsidian.md/download](https://obsidian.md/download)
>
> **Linux:**
> ```bash
> # Snap
> sudo snap install obsidian --classic
> # Or AppImage from obsidian.md/download
> ```
>
> **Windows:**
> Download installer from [obsidian.md/download](https://obsidian.md/download)
>
> After installing, **open Obsidian once** to complete initial setup, then continue.

### Step 2: Check CLI Availability

```bash
Obsidian version 2>/dev/null && echo "CLI_OK" || echo "CLI_MISSING"
```

If `CLI_MISSING` but app is installed:

> **Obsidian CLI needs to be enabled:**
>
> 1. Open Obsidian
> 2. Go to **Settings → General**
> 3. Scroll down and enable **"Enable CLI"**
> 4. **Restart Obsidian** (quit and reopen)
> 5. Run `Obsidian version` to verify
>
> The CLI requires Obsidian v1.8+. If you don't see the option, update Obsidian first.

**Important:** Obsidian must be running for the CLI to work. The CLI talks to the app process.

### Step 3: Vault Discovery

Check if the user has any vaults:

```bash
Obsidian vaults verbose
```

**If vaults exist:** Ask the user which one to use. Store the vault name for the session.

**If no vaults exist:** Guide vault creation:

> **No vaults found.** Let's create one:
>
> 1. Open Obsidian
> 2. Click **"Create new vault"**
> 3. Name it (e.g. "research", "notes", or your project name)
> 4. Choose a location (default is fine, or pick a cloud-synced folder)
> 5. Click **Create**
>
> Then run `Obsidian vaults verbose` again and tell me the vault name.

**Store the vault name for the session** — don't ask again after the first command.

### Step 4: Vault Structure Bootstrap

After discovering the vault, check if it has structure:

```bash
Obsidian vault=<name> folders
```

If the vault is **empty or flat** (no folders, or only `.obsidian/` and `.trash/`), offer to
bootstrap a research-friendly structure.

> Your vault is empty. I can set up a starter structure designed for research and project work.
> It follows a lightweight PARA-inspired layout:
>
> ```
> <vault>/
> ├── Home.md              ← Dashboard with quick links
> ├── Projects/            ← Active research projects (one folder per project)
> ├── Areas/               ← Ongoing responsibilities (teaching, advising, admin)
> ├── Resources/           ← Reference material, learning notes, how-tos
> │   ├── Papers/          ← Paper reading notes
> │   └── Learning/        ← Tutorials, courses, concepts
> ├── Archive/             ← Completed/inactive projects and notes
> ├── Inbox/               ← Quick capture — sort later
> ├── Templates/           ← Reusable note templates
> └── Attachments/         ← Images, PDFs, media
> ```
>
> Want me to create this?

If the user agrees, create the scaffold:

```bash
# Home — vault dashboard
Obsidian vault=<name> create name="Home" content="# Home\n\nDashboard for your research vault.\n\n## Navigation\n- [[Projects/Projects|Projects]] — active research\n- [[Areas/Areas|Areas]] — ongoing responsibilities\n- [[Resources/Resources|Resources]] — reference material\n- [[Inbox/Inbox|Inbox]] — quick capture\n- [[Archive/Archive|Archive]] — completed work\n\n## Recent Projects\n\n## Quick Notes\n" silent

# Projects hub
Obsidian vault=<name> create name="Projects" folder="Projects" content="# Projects\n\nOne folder per active research project.\n\n## Active\n\n## On Hold\n\n---\nSee [[Archive/Archive|Archive]] for completed projects.\n" silent

# Areas hub
Obsidian vault=<name> create name="Areas" folder="Areas" content="# Areas\n\nOngoing responsibilities with no end date.\n\n## Research\n\n## Teaching\n\n## Service\n" silent

# Resources hub
Obsidian vault=<name> create name="Resources" folder="Resources" content="# Resources\n\nReference material and learning notes.\n\n- [[Resources/Papers/Papers|Papers]] — reading notes\n- [[Resources/Learning/Learning|Learning]] — tutorials & concepts\n" silent

# Papers subfolder
Obsidian vault=<name> create name="Papers" folder="Resources/Papers" content="# Papers\n\nReading notes and paper summaries. One note per paper.\n\n## By Topic\n\n## Recent\n" silent

# Learning subfolder
Obsidian vault=<name> create name="Learning" folder="Resources/Learning" content="# Learning\n\nConcepts, tutorials, courses, and study notes.\n" silent

# Archive
Obsidian vault=<name> create name="Archive" folder="Archive" content="# Archive\n\nCompleted or paused projects and old notes.\nMove items here instead of deleting.\n" silent

# Inbox
Obsidian vault=<name> create name="Inbox" folder="Inbox" content="# Inbox\n\nQuick capture — review and sort weekly.\n" silent

# Templates folder (empty index)
Obsidian vault=<name> create name="Templates" folder="Templates" content="# Templates\n\nReusable note templates.\n" silent

# Attachments folder marker
Obsidian vault=<name> create name="Attachments" folder="Attachments" content="# Attachments\n\nImages, PDFs, and media files.\nSet this as the attachment folder in Settings → Files & Links.\n" silent
```

Then create starter templates:

```bash
# Project template
Obsidian vault=<name> create name="Project Template" folder="Templates" content="# {{title}}\n\n> [!info] Created {{date}}\n\n## Goal\n\n## Pages\n- [[system-design]]\n- [[progress]]\n- [[key-links]]\n- [[experiment-log]]\n\n## Related Papers\n\n## Notes\n" silent

# Paper note template
Obsidian vault=<name> create name="Paper Template" folder="Templates" content="---\ntitle: \"{{title}}\"\nauthors: \"\"\nyear: \nvenue: \"\"\nurl: \"\"\ntags: [paper]\n---\n\n# {{title}}\n\n## Key Contributions\n\n## Method\n\n## Results\n\n## Relevance\n" silent

# Meeting note template
Obsidian vault=<name> create name="Meeting Template" folder="Templates" content="# Meeting: {{title}}\n\n**Date:** {{date}}\n**Attendees:**\n\n## Agenda\n\n## Notes\n\n## Action Items\n- [ ] \n" silent
```

Finally, open Home:
```bash
sleep 1 && Obsidian vault=<name> open newtab file="Home"
```

Tell the user:
> Vault is ready! I set up a PARA-style structure:
> - **Projects/** — create a subfolder for each research project
> - **Resources/Papers/** — one note per paper you read
> - **Inbox/** — quick capture, sort weekly
> - **Templates/** — I added templates for projects, papers, and meetings
>
> Tip: In Obsidian Settings → Templates, set the template folder to `Templates/`.

### Per-Project Folder Structure

When the user starts a new research project, create a dedicated project folder:

```bash
# Project index (minimal — just links)
Obsidian vault=<name> create name="<ProjectName>" folder="Projects/<ProjectName>" content="# <ProjectName>\n\n> [!info] Created YYYY-MM-DD\n\n## Pages\n- [[system-design]]\n- [[progress]]\n- [[key-links]]\n- [[experiment-log]]\n\n## Related Papers\n" silent

# System design doc
Obsidian vault=<name> create name="system-design" folder="Projects/<ProjectName>" content="# System Design\n\n## Architecture\n\n## Key Decisions\n" silent

# Progress tracker
Obsidian vault=<name> create name="progress" folder="Projects/<ProjectName>" content="# Progress\n\n## Timeline\n\n### YYYY-MM-DD\n- Project started\n" silent

# Key links (repo, server, docs)
Obsidian vault=<name> create name="key-links" folder="Projects/<ProjectName>" content="# Key Links\n\n| Resource | Link |\n|----------|------|\n| GitHub | |\n| Server | |\n| Paper | |\n| Data | |\n" silent

# Experiment log
Obsidian vault=<name> create name="experiment-log" folder="Projects/<ProjectName>" content="# Experiment Log\n\nAppend entries as experiments run.\n" silent
```

Set properties on the project index:
```bash
Obsidian vault=<name> property:set name="created" value="YYYY-MM-DD" file="<ProjectName>"
Obsidian vault=<name> property:set name="status" value="active" file="<ProjectName>"
Obsidian vault=<name> property:set name="tags" value="project" file="<ProjectName>"
```

Then add it to the Projects hub and open:
```bash
Obsidian vault=<name> append file="Projects" content="\n- [[Projects/<ProjectName>|<ProjectName>]]"
sleep 1 && Obsidian vault=<name> open newtab file="<ProjectName>"
```

## CLI Command Reference

All operations use the `Obsidian` binary (capital O on macOS). Commands follow:
```bash
Obsidian vault=<name> <command> [params...]
```

### CRUD Operations

**Create:**
```bash
Obsidian vault=<name> create name="Note Title" content="# Note Title\n\nContent here" silent
# With folder:
Obsidian vault=<name> create name="Note Title" folder="Projects/Active" content="..." silent
# Overwrite existing:
Obsidian vault=<name> create name="Note Title" content="..." silent overwrite
```

**Read:**
```bash
# By wikilink name:
Obsidian vault=<name> read file="Note Title"
# By exact path:
Obsidian vault=<name> read path="Projects/Active/plan.md"
```

**Append:**
```bash
Obsidian vault=<name> append file="Note Title" content="\n## New Section\nContent here"
```

**Search:**
```bash
Obsidian vault=<name> search query="search terms" limit=10
# JSON output for programmatic use:
Obsidian vault=<name> search query="search terms" format=json
```

**List files:**
```bash
Obsidian vault=<name> files folder="Projects"
```

**List folders:**
```bash
Obsidian vault=<name> folders folder="Projects"
```

### Opening Notes in Obsidian

**ALWAYS use `newtab`** so the note opens in a new tab, not replacing the current one:

```bash
Obsidian vault=<name> open newtab file="Note Title"
Obsidian vault=<name> open newtab path="Projects/Active/plan.md"
```

**After creating or editing a note, ALWAYS offer to open it:**
```
Created "Note Title". Open in Obsidian? (I'll pop it up in a new tab)
```

If the user says yes:
```bash
sleep 1 && Obsidian vault=<name> open newtab file="Note Title"
```

> **Why `sleep 1`?** If the vault is on iCloud/Dropbox, the file watcher can race with sync.
> Without the delay, Obsidian may show the old cached version.

### Properties (Frontmatter)

```bash
# Get all properties:
Obsidian vault=<name> properties file="Note Title" format=json

# Set a property:
Obsidian vault=<name> property:set name="status" value="active" file="Note Title"
```

### Tags & Backlinks

```bash
# List all tags with counts:
Obsidian vault=<name> tags format=json counts

# Tags for a specific note:
Obsidian vault=<name> tags file="Note Title" format=json

# Backlinks (who links to this note):
Obsidian vault=<name> backlinks file="Note Title" format=json
```

### Tasks

```bash
# List incomplete tasks:
Obsidian vault=<name> tasks todo format=json

# List completed tasks:
Obsidian vault=<name> tasks done format=json

# Toggle a task:
Obsidian vault=<name> task file="Note Title" line=15 toggle
```

### Vault Info

```bash
Obsidian vault=<name> vault
```

## Core Patterns

### Folder-with-Index Pattern
When creating a topic that needs multiple sub-notes:
```
Topic Name/
├── Topic Name.md      # Index file (same name as folder) - MINIMAL
├── Subtopic 1.md      # Detailed content
├── Subtopic 2.md      # Detailed content
└── Resources/
```

### Index Page Philosophy
> **Index pages = MINIMAL** | **Subpages = STRUCTURED**

**Index pages:** Simple list of wikilinks to subpages — just navigation.
**Subpages:** Detailed and well-organized — tables, callouts, checklists.

### Single Note Pattern
For standalone topics, just create a single `.md` file in the appropriate location.

## Required Structure / Algorithm

### CREATE NOTE
1. Check CLI is available (run `Obsidian version`)
2. If first time, discover vault (`Obsidian vaults verbose`)
3. If vault is empty/unstructured, offer to bootstrap (see Vault Structure Bootstrap above)
4. If user mentions a "project", use Per-Project Folder Structure to create the full scaffold
5. Determine folder based on content type (ask user if unclear)
4. Decide pattern: single note vs folder-with-index
5. Create with CLI:
   ```bash
   Obsidian vault=<name> create name="Title" folder="Target/Folder" content="..." silent
   ```
6. Set frontmatter properties if needed:
   ```bash
   Obsidian vault=<name> property:set name="created" value="2026-04-10" file="Title"
   Obsidian vault=<name> property:set name="tags" value="tag1, tag2" file="Title"
   ```
7. **Offer to open in Obsidian** — always ask, then:
   ```bash
   sleep 1 && Obsidian vault=<name> open newtab file="Title"
   ```

### READ/FIND NOTE
1. Search by content:
   ```bash
   Obsidian vault=<name> search query="keyword" format=json limit=10
   ```
2. Read specific note:
   ```bash
   Obsidian vault=<name> read file="Note Title"
   ```
3. Browse folder:
   ```bash
   Obsidian vault=<name> files folder="Projects/Active"
   ```

### UPDATE NOTE
1. Read existing content first:
   ```bash
   Obsidian vault=<name> read file="Note Title"
   ```
2. For appending:
   ```bash
   Obsidian vault=<name> append file="Note Title" content="\n## New Section\nContent"
   ```
3. For full rewrite:
   ```bash
   Obsidian vault=<name> create name="Note Title" content="..." silent overwrite
   ```
4. Update properties:
   ```bash
   Obsidian vault=<name> property:set name="modified" value="2026-04-10" file="Note Title"
   ```

### DELETE/ARCHIVE NOTE
1. Prefer archiving over deletion — move to an archive folder
2. For deletion, confirm with user first
3. Use filesystem operations for moves (CLI doesn't have a move command):
   ```bash
   mv "<vault-path>/Notes/old.md" "<vault-path>/.archive/old.md"
   ```

## Obsidian Syntax Quick Reference

| Syntax | Example |
|--------|---------|
| Internal link | `[[Note Name]]` |
| Aliased link | `[[Note Name\|Display Text]]` |
| Heading link | `[[Note Name#Heading]]` |
| Embed note | `![[Note Name]]` |
| Tag | `#tag/subtag` |
| Callout | `> [!note] Title` |
| Task | `- [ ] Todo` / `- [x] Done` |

## Quality Checklist
- [ ] CLI is available (`Obsidian version` returns version)
- [ ] Vault is specified (not hardcoded)
- [ ] Frontmatter is valid YAML (if used)
- [ ] Internal links use `[[wikilink]]` syntax
- [ ] Folder pattern used for multi-part topics
- [ ] Index file has same name as parent folder
- [ ] Offered to open note in Obsidian after create/update

## Failure Modes & Recovery

**CLI not installed**
→ Show setup instructions (see Setup & Warmup section)

**Obsidian not running**
→ Tell user: "Obsidian needs to be running for the CLI to work. Please open Obsidian first."

**Vault not found**
→ Run `Obsidian vaults verbose` and ask user to pick from the list

**Note already exists**
→ Offer to update existing or create with different name. Use `overwrite` flag if user confirms.

**iCloud/Dropbox sync race**
→ Always `sleep 1` before opening a note after create/edit

## Limits
- Only manage markdown/Obsidian files
- Don't modify `.obsidian/` config folder
- Don't delete without explicit confirmation
- Don't create files outside the vault
- CLI requires Obsidian v1.8+ to be running
