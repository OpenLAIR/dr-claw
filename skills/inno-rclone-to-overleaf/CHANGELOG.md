# Changelog

## v1.1 — 2026-02-12
- Added `resources/onboarding.md` — full setup guide for new users
  - rclone installation (Linux, macOS)
  - Linking Overleaf to Dropbox via browser
  - Interactive `rclone config` walkthrough with Dropbox OAuth
  - Headless server token flow
  - Finding the Overleaf folder path (English and Chinese locales)
  - Dry-run testing before first real sync
  - Optional: filter file for build artifacts, shell alias
  - Troubleshooting: expired tokens, merge conflicts, slow uploads
- Updated SKILL.md to reference onboarding guide in failure recovery and resources

## v1.0 — 2026-02-12
- Initial release
- Core workflow: discover rclone remote → locate Overleaf project → sync with `rclone copy`
- Handles Dropbox paths with Unicode (e.g., 应用/Overleaf/)
- Excludes LaTeX build artifacts by default
- Covers common failure modes (auth expired, path not found, mod time warnings)
- Based on real workflow experience syncing an Interspeech paper (Audio-REM) to Overleaf via `fdropbox:` remote
