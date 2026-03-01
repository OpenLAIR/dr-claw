# Changelog

## v1.0 — 2026-02-28
- Initial release
- Hybrid script + agent PR review architecture
- Pre-check analysis to skip trivial PRs
- PR classification (ui/backend/mixed) for agent depth control
- Mechanical checks: npm ci, typecheck, build, Playwright E2E
- Claude agent via cliwrapper for intelligent comment writing
- Static fallback when cliwrapper unavailable
- Idempotency via HTML sentinel per commit SHA
- Batch mode for all open non-draft PRs (max 10)
- Mac Mini crontab setup for periodic auto-review
