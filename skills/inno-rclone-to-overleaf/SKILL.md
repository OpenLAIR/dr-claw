---
name: inno-rclone-to-overleaf
description: >-
  Sync local LaTeX paper projects to Overleaf via rclone and Dropbox.
  Use when the user asks to "sync to overleaf", "push to overleaf", "upload paper",
  "update overleaf", "rclone overleaf", or needs to transfer local LaTeX files
  (main.tex, figures, bibliographies) to an Overleaf project backed by Dropbox.
---

# Syncing Overleaf Papers — Execution Rules

## Goal & Scope
Reliably sync a local LaTeX paper directory (main.tex, figures/, .bib files) to an Overleaf project via rclone's Dropbox backend. Handle project discovery, selective sync, conflict avoidance, and verification.

## Audience & Tone
Researchers and students who edit LaTeX locally (or with AI assistance) and use Overleaf for compilation and collaboration. Tone: concise, operational.

## Required Execution Algorithm

### 1. DISCOVER RCLONE CONFIGURATION
Check available rclone remotes and identify the Dropbox-backed remote:
```bash
rclone listremotes
```
Look for a remote with `dropbox` in the name or type (e.g., `fdropbox:`, `dropbox:`). If multiple remotes exist, ask the user which one connects to Dropbox.

Verify connectivity:
```bash
rclone lsd <remote>:
```

### 2. LOCATE THE OVERLEAF PROJECT
Overleaf syncs via the Dropbox app integration. Projects are typically stored at:
```
<remote>:/<username>/应用/Overleaf/<project-name>/
```
or the English equivalent:
```
<remote>:/<username>/Apps/Overleaf/<project-name>/
```

To discover the correct path:
```bash
# List top-level to find user folder
rclone lsd <remote>:

# Find the Overleaf app folder (may be under 应用 or Apps)
rclone lsd "<remote>:/<username>/应用/Overleaf/" 2>/dev/null || \
rclone lsd "<remote>:/<username>/Apps/Overleaf/" 2>/dev/null
```

If the user provides a project name, search for it:
```bash
rclone lsd "<remote>:/<username>/应用/Overleaf/" | grep -i "<project-name>"
```

Store the full Overleaf path for subsequent commands. Example:
```
fdropbox:/Liu Yixin/应用/Overleaf/My-Paper-Project/
```

### 3. INSPECT LOCAL PAPER DIRECTORY
Before syncing, verify the local directory has valid LaTeX content:
- Confirm `main.tex` (or the primary .tex file) exists
- Check for `figures/` directory if figures are referenced
- Check for `.bib` files if bibliography is used
- Warn if `.aux`, `.log`, `.synctex.gz`, or other build artifacts are present (these should NOT be synced)

### 4. SYNC WITH RCLONE COPY
**Always use `rclone copy`, never `rclone sync`.**

`rclone sync` deletes files on the destination that don't exist locally, which can destroy collaborators' work or Overleaf-generated files. `rclone copy` only uploads new/changed files.

Basic sync command:
```bash
rclone copy /path/to/local/paper/ "<remote>:<overleaf-path>/" --verbose
```

To exclude build artifacts:
```bash
rclone copy /path/to/local/paper/ "<remote>:<overleaf-path>/" \
  --exclude "*.aux" \
  --exclude "*.log" \
  --exclude "*.synctex.gz" \
  --exclude "*.fls" \
  --exclude "*.fdb_latexmk" \
  --exclude "*.bbl" \
  --exclude "*.blg" \
  --exclude "*.out" \
  --exclude "__pycache__/**" \
  --exclude ".DS_Store" \
  --verbose
```

### 5. VERIFY SYNC SUCCESS
After rclone finishes:
- Check the output for "Transferred: X / X, 100%"
- Look for any errors in the output
- Optionally list remote files to confirm:
```bash
rclone ls "<remote>:<overleaf-path>/" | head -20
```

Report to the user:
- Number of files transferred
- Total size transferred
- Any files that failed

### 6. SELECTIVE SYNC (OPTIONAL)
If the user only wants to sync specific files (e.g., just figures or just main.tex):

Sync only figures:
```bash
rclone copy /path/to/local/paper/figures/ "<remote>:<overleaf-path>/figures/" --verbose
```

Sync a single file:
```bash
rclone copyto /path/to/local/paper/main.tex "<remote>:<overleaf-path>/main.tex" --verbose
```

## Key Rules

**ALWAYS use `rclone copy`, NEVER `rclone sync`.**
This is critical. `rclone sync` will delete files on the remote that don't exist locally, which can destroy Overleaf auto-generated files or collaborators' changes. The only safe command is `rclone copy`.

**Quote paths with special characters.**
Dropbox paths often contain spaces, Unicode (Chinese characters like 应用), or special characters. Always wrap the full remote path in double quotes:
```bash
rclone copy local/ "fdropbox:/Liu Yixin/应用/Overleaf/My Paper/" --verbose
```

**Do not sync build artifacts.**
LaTeX generates many temporary files (.aux, .log, .synctex.gz, .bbl, .blg, .fls, .fdb_latexmk, .out). These should never be uploaded to Overleaf as they cause compilation conflicts.

**Use --verbose for transparency.**
Always pass `--verbose` so the user can see exactly what was transferred.

**Overleaf picks up changes automatically.**
After rclone uploads files to Dropbox, Overleaf detects the changes within 1-2 minutes. No additional action is needed on the Overleaf side.

## Quality Checklist
- [ ] Correct rclone remote identified (Dropbox-backed)
- [ ] Overleaf project path verified (listed successfully)
- [ ] Used `rclone copy` (NOT `rclone sync`)
- [ ] Remote path quoted properly (handles spaces and Unicode)
- [ ] Build artifacts excluded
- [ ] --verbose flag included
- [ ] Transfer output shows 100% completion
- [ ] No error messages in output
- [ ] User informed of results

## Failure Modes & Recovery

**rclone remote not configured**
Direct the user to `resources/onboarding.md` for the full setup walkthrough (install rclone, link Overleaf to Dropbox, configure the rclone remote, and verify). The short version:
1. `rclone config` → New remote → name it (e.g., `dropbox`) → type `dropbox`
2. Follow the OAuth flow to authorize
3. Test with `rclone lsd dropbox:`

**Overleaf folder not found at expected path**
Search more broadly:
```bash
rclone lsd "<remote>:" --recursive | grep -i overleaf
```
Or ask the user to check their Dropbox for the Overleaf folder location.

**Permission denied or auth expired**
```bash
rclone config reconnect <remote>:
```
This refreshes the OAuth token without recreating the remote.

**Transfer hangs or times out**
Add timeout flags:
```bash
rclone copy ... --timeout 60s --contimeout 30s
```
For large files (PDFs, high-res figures), increase timeout.

**Files show as "identical but can't set mod time"**
This is normal for Dropbox. Rclone may re-upload files to set modification times. This is harmless and the message can be ignored.

**Overleaf doesn't pick up changes**
Overleaf's Dropbox sync can lag. Wait 2-3 minutes. If still not updated, try opening the Overleaf project and clicking "Pull changes from Dropbox" in the Overleaf menu (Sync → Dropbox).

## Examples

### Example 1: Full paper sync
**Prompt** "sync my paper to overleaf"

**Steps:**
1. Identify local paper directory (current working directory or ask)
2. Check for rclone remotes: `rclone listremotes` → `fdropbox:`
3. Find Overleaf project: `rclone lsd "fdropbox:/Liu Yixin/应用/Overleaf/"` → list projects
4. Ask user which project (or infer from context)
5. Sync: `rclone copy ./paper/ "fdropbox:/Liu Yixin/应用/Overleaf/My-Paper/" --verbose`
6. Report: "Synced 14 files (2.9 MB) to Overleaf."

### Example 2: Sync only updated figures
**Prompt** "push the new figures to overleaf"

**Steps:**
1. Use previously identified Overleaf path
2. Sync figures only: `rclone copy ./paper/figures/ "fdropbox:/Liu Yixin/应用/Overleaf/My-Paper/figures/" --verbose`
3. Report: "Synced 6 figure files to Overleaf."

### Example 3: First-time setup
**Prompt** "I want to sync to overleaf but I haven't set up rclone"

**Steps:**
1. Check `rclone listremotes` → empty
2. Guide user through `rclone config`:
   - New remote → name: `dropbox` → type: `dropbox` → follow OAuth
3. Verify: `rclone lsd dropbox:`
4. Find Overleaf folder and proceed with sync

## Resources
- `resources/onboarding.md` — Step-by-step setup guide for new users (install rclone, link Overleaf to Dropbox, configure remote, create shell alias)

## Limits
- This skill syncs files TO Overleaf (one-way push). It does not pull changes FROM Overleaf.
- For bidirectional sync, use `rclone bisync` (advanced, not covered here due to conflict risks).
- This skill assumes Overleaf's Dropbox integration is already enabled in the Overleaf project settings.
- Does not handle Overleaf Git integration (use standard git for that workflow).
- Does not compile LaTeX — Overleaf handles compilation after receiving the files.
