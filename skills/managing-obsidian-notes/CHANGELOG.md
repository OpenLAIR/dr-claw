# Changelog

## 2026-04-10 (v2.0)
- **Rewritten for Obsidian CLI**: All operations now use `Obsidian` CLI instead of direct filesystem access
- **Setup warmup**: Detects missing CLI, guides user through installation
- **Vault discovery**: Auto-discovers vaults via `Obsidian vaults verbose` instead of hardcoding paths
- **Open in Obsidian**: Always offers to pop open notes in a new tab after create/update
- **iCloud sync guard**: `sleep 1` before opening notes after edits to prevent sync race
- **No personal paths**: Removed all hardcoded vault paths — works with any user's vault
- **Public-ready**: Suitable for bundling in dr-claw plugin

## 2025-01-26 (v1.3)
- **Fixed vault path**: Corrected to `iCloud~md~obsidian/Documents/kobo-note/`
- **Added vault structure**: Documented all main folders (Career, Coding, Engineering, Research, Journal, etc.)
- **Enhanced CREATE NOTE routing**: Added folder mappings for all content types

## 2025-12-13 (v1.2)
- **Chinese Headline Summary (总结)**: Content-rich subpages MUST start with `## 总结` in Chinese
- Added to quality checklist

## 2025-12-13 (v1.1)
- **Index Page Philosophy**: Index pages = MINIMAL, Subpages = STRUCTURED
- Index pages should be simple navigation hubs, easy to manually edit
- All detailed content goes in subpages

## 2025-12-13 (v1.0)
- Initial release
- CRUD operations for Obsidian vault notes
- Folder-with-index pattern support
- Obsidian syntax reference (wikilinks, callouts, tags, frontmatter)
- Vault location: kobo-note in iCloud
