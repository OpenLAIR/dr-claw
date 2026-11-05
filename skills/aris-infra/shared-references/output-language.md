# Output language (Workflow M extract)

Respect `language:` in the project's CLAUDE.md pipeline settings; otherwise match
the user's language, defaulting to English. Translate report headings and prose,
not paths, command names, model IDs, JSON keys/values or machine-parsed markers.
Keep reviewer prompts and code/diffs faithful to the original technical content.
