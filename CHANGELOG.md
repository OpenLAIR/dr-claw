# Changelog

## Unreleased

### Public Upstream Sync - 2026-04-11

#### Included in this upstream-safe branch
- Chat composer queue and steer workflow:
  - Added durable queued-turn data structures and queue reconciliation helpers.
  - Added steer promotion, paused queue handling, queued-turn resume, and queue cleanup after turn settlement.
  - Added queue/session-scope tests for `codexQueue`, `sessionLoadGuards`, `sessionSnapshotCache`, and `sessionScope`.
- Session stability and protocol hardening:
  - Added explicit WebSocket lifecycle protocol messages: `session-accepted`, `session-busy`, `session-state-changed`.
  - Added project-scoped event enrichment for session lifecycle payloads to avoid cross-session/cross-project ambiguity.
  - Added lifecycle projection from provider completion/error messages into normalized session-state events.
  - Added session-created `projectName` metadata for Claude/Cursor/Gemini session initialization paths.
- Nano chain compatibility:
  - Preserved Nano command path and active session reporting in WebSocket session status flows.
  - Ensured session lifecycle protocol is emitted consistently for Nano just like other providers.

#### Explicitly excluded (local/private only, not part of upstream PR)
- Codex-only product strategy and provider lock-in controls.
- External auth / license refresh-heartbeat-offline-grace stack.
- Project root hard-cut and Codex session backfill private policy behavior.
- LingZhi/LingzhiLab branding replacements and private demo/link route changes.

#### Cross-platform notes
- No platform-specific server behavior was hardcoded for this sync.
- Session protocol additions are transport-level and provider-agnostic; Windows-specific stability paths do not alter macOS behavior.

#### Validation
- Passed: `node --check server/index.js`
- Passed: `node --check server/claude-sdk.js`
- Passed: `node --check server/cursor-cli.js`
- Passed: `node --check server/gemini-cli.js`
- Not runnable in current environment (missing local dev dependencies): `vitest`, `tsc`

## Dr. Claw v1.1.1 - 2026-03-30

### Highlights
- Added OpenRouter as a full agentic provider with restored tool-use history, persisted permissions, and corrected Codex token accounting in mixed-provider workflows.
- Added a session context sidebar and review queue to make active session state and follow-up review work more visible in Chat.
- Added explicit chat thinking controls for Codex and Gemini, including Codex reasoning effort selection plus Gemini 3 `thinkingLevel` and Gemini 2.5 `thinkingBudget` presets.
- Improved chat runtime feedback with a dedicated "Running code" status, release reminder follow-up handling, and package/build fixes for the v1.1.1 line.

### Commit Summary
- Since `v1.1.0`, this release includes 14 non-merge commits covering provider expansion, chat UX, reasoning controls, release reminders, and follow-up bug fixes.

### Notable PRs and topics
- #114 OpenRouter full provider support and history restoration
- #115 Codex context indicator semantics and lifetime token accounting fixes
- #116 session context sidebar and review queue
- #117 chat thinking controls for Codex and Gemini
- release reminder snooze and follow-up release metadata fixes
- running-code status feedback in chat

### Validation
- `npm run typecheck` passed.
- `npm run build` passed.
- Version metadata updated in `package.json` and `package-lock.json`.

## Dr. Claw v1.0.0 - 2026-03-17

### Highlights
- Marked the first stable `1.0.0` release for Dr. Claw across desktop and mobile experiences.
- Consolidated the recent major product additions including Codex support, Gemini workflows, Research Lab expansion, and skill discovery improvements.
- Established `Dr. Claw v1.0.0` as the named release milestone for the current product line.

### Commit Report
#### Product, Dashboard, and UX
- `76185b1` Add Paper News dashboard and integrate research paper skills
- `089f979` Polish dashboard and news page layouts
- `579ee00` fix(pipeline): add promotion workspace structure
- `592d0bb` Add dashboard token usage summaries
- `7a85fed` feat: add file preview support for images and PDFs. Extend CodeEditor beyond text-only viewing to support binary file preview using browser-native elements (img for images, iframe for PDF).
- `8cbf253` fix: remove download button from unsupported file preview
- `0322763` Add files via upload
- `2b260ab` Replace Whisper-based voice input with browser-native Web Speech API
- `ec6a10b` fix: resolve session processing race condition on session switch (#29)
- `485d621` fix: strip thinking blocks from displayed assistant messages
- `72e4295` fix: improve MicButton error messages and use portal for tooltip
- `36f52cf` feat(compute): add SSH port field for Direct GPU nodes
- `95de26f` add immediate inline port validation with visual feedback
- `6640782` Fix default new workspace root path
- `f9011ed` Clarify Opus Plan model label to avoid confusion
- `777735a` Change default Claude model to Opus 4.6
- `6c3a493` Update chat empty state and remove inno-research-orchestrator
- `946257b` feat: more alert when agent not installed
- `ff58b65` Fix chat placeholder showing "Claude" when using Gemini CLI
- `c9e23d3` Fix chat provider ready prompt copy
- `56c7b4c` Add file chat action to preview header
- `f06e144` Fix remembered tool permissions for Gemini

#### Projects, Workspace, and Session Management
- `3a04fc8` feat: update server script to use watch path and enhance session handling logic
- `47cad7f` Add: multi-users support
- `6384d5e` feat: support project and session management
- `b3a9a85` feat: project creation modal
- `bfda97a` fix: resolve typescript errors in sidebar components
- `b6cae22` fix: correctly await normalizeComparablePath in codex session retrieval
- `e2c9fce` Fix workspace root filtering for claimed projects in sidebar
- `a7f49df` fix: refresh projects after creation and handle more tab switches
- `e7fdb74` Fix stale project records on delete
- `123f87a` Add auto research workflow and email settings
- `f31b7e0` feat: analysis workspace when import from outside
- `eaaed7a` Fix stale auto research session recovery
- `a4b58c2` feat: add QA session type
- `6113465` feat: direct to QA session from file systems
- `0f7d5e0` fix: gemini session message count
- `f9683aa` fix: file tag for qa sessions

#### Editor, File Navigation, and Research Workflows
- `15324ac` chore(templates): align agent prompts with claude template
- `6ef6546` feat(skills): add gemini-deep-research skill to skill library
- `c1defb1` Rebuild news dashboard as unified single-page feed with all sources
- `59326f7` Add server/data/ to gitignore
- `3e68622` Add i18n support (en/zh-CN/ko) to news dashboard, replace source icons with brand logos, and improve UX
- `d57e57e` Move research-news Python scripts from skills/ to server/scripts/
- `eb47eb5` Add python-tools installer, news data hook updates, and ignore result files
- `147cd5e` Fix script paths in news source registry and rename action labels
- `045af52` Refactor news dashboard to single-tab browsing, improve UX and filter invalid data
- `f1ffbae` feat(editor): resolve bare filenames and show picker for ambiguous matches
- `ade3e3a` fix(editor): follow symlinks, resolve partial paths, and improve picker UX
- `1de8fdc` fix(chat): recognize extensionless files like Dockerfile as clickable links
- `c00c865` Document auto research in README

#### Branding, Packaging, Docs, and Compliance
- `ead7e5c` Update logo image in README.md
- `49fa5be` Update image source in README.md
- `e963538` Adjust image height for VibeLab logo
- `f8386c8` Adjust image height in README
- `a540603` Rename project from VibeLab to Dr.Claw
- `2938f67` Update README.md
- `662cf74` Update project description in README.md
- `c1d30e3` strengthen beta user agreement restrictions
- `530c5a0` Stop storing telemetry dialogue content
- `149442e` rebrand user-facing product naming to Dr. Claw
- `98ad0d8` rename package cli and workspace defaults to dr-claw
- `cec4bed` Update WeChat group QR code
- `830107b` fix: update .gitignore to exclude __pycache__ and ensure *_results.json is ignored
- `81fbbbb` add dr-claw compatibility migrations
- `346b40a` migrate legacy dr-claw projects and internal identifiers
- `1539ced` clean up remaining Dr. Claw branding references
- `2e8764b` fix remaining skills taxonomy branding references
- `ec08d7f` update repo links and migration guidance for dr-claw
- `2c9c195` remove internal rename plan from branch
- `2a8bc6d` fold long README sections by topic
- `fc28a90` refresh logo assets across README and PWA
- `45d69c8` switch app logo to new SVG asset
- `9817c27` Add leveraged cognition README copy
- `27ce2ba` Update project licensing to GPL+AGPL combined notice
- `bd1f8ab` Update README license badge and wording

#### Merge Commits
- `d01091d` Merge pull request #23 from OpenLAIR/feat/unified-project-management
- `d407811` Merge remote-tracking branch 'origin/main' into pr/project-dashboard-token-usage-main
- `79cefaf` Merge pull request #24 from OpenLAIR/pr/project-dashboard-token-usage-main
- `99b7a20` Merge pull request #25 from OpenLAIR/feat/add-gemini-deep-research
- `237c7bd` Merge remote-tracking branch 'origin/main' into feat/news-dashboard
- `978b6e4` Merge pull request #26 from OpenLAIR/feat/chat-file-preview
- `42978ec` Merge remote-tracking branch 'origin/main' into feat/news-dashboard
- `404f422` Merge pull request #31 from OpenLAIR/feat/news-dashboard
- `2ac3abf` Merge pull request #28 from OpenLAIR/fix/workspace-root-filter-claimed-projects
- `dee91ce` Merge branch 'main' of github.com:OpenLAIR/VibeLab into dr-claw-phase-1-branding
- `5a3a2dd` Merge pull request #34 from OpenLAIR/dr-claw-phase-1-branding
- `cce6e90` Merge pull request #35: feat(compute): add SSH port field for Direct GPU nodes
- `289b11b` Merge pull request #40 from liuyixin-louis/fix/gemini-chat-placeholder
- `0fbbb9b` Merge pull request #37 from OpenLAIR/feat/chat-file-preview
- `24c93b1` Merge pull request #39 from OpenLAIR/fix/workspace-management
- `a9f3c88` Merge pull request #38 from OpenLAIR/fix/auto-research-stale-session
- `a57161c` Merge pull request #42 from OpenLAIR/fix/file-chat

### Validation
- Version metadata updated in `package.json` and `package-lock.json`.

## v0.1.5 - 2026-03-09

### Highlights
- Added broader agent and workspace support with Codex integration, Gemini CLI support, survey workspaces, graph previews, and multi-shell execution.
- Expanded core product workflows with project dashboards, guided chat starter refinements, account recovery, file upload/delete flows, and auth/websocket fixes.
- Reworked skill discovery and research UX with a redesigned skills explorer, taxonomy browsing, global skills library surfacing, and multiple dashboard/preview polish passes.
- Refreshed onboarding and documentation with README improvements, badge updates, and cleanup of obsolete guide content.

### Notable Changes
- `add codex support`
- `feat: add gemini cli support`
- `feat: gemini session support`
- `feat: gemini cli agent follow`
- `feat(survey): add survey workspace and graph previews`
- `feat(workspace): add multi-shell workspace support`
- `feat: add file management features including upload and delete functionality`
- `feat(dashboard): add project overview dashboard`
- `Streamline guided chat starter selection`
- `Add account recovery registration flow`
- `Add global skills library entry and refresh project dashboard`
- `Adopt taxonomy-based skill explorer`

### Validation
- `npm run typecheck` passed.
- `npm run build` passed.

## v2026.3.4 - 2026-03-04

### Highlights
- Added a guided starter flow in Chat with skill-aware prompt templates to improve first-run onboarding and task kickoff.
- Expanded the Research Lab pipeline by introducing a new presentation/promotion stage and related workflow improvements.
- Improved task management ergonomics in Research Lab with inline task editing and better edit-state handling across project switches.
- Strengthened artifact handling by filtering internal planning files from preview and simplifying placeholder behavior.

### Notable Changes
- `feat(chat): add presentation guided starter scenario`
- `feat(chat): add guided starter with skill-aware prompt templates`
- `feat(researchlab): add inline task editing in pipeline board`
- `feat(researchlab): improve task card edit discoverability and i18n`
- `fix(researchlab): reset inline edit state on project switch`
- `feat: add presentation pipeline as 4th research stage`
- `refactor(pipeline): rename presentation stage to promotion`
- `fix: presentation pipeline sanity fixes`
- `fix: guard process.env access in shared modelConstants for browser compatibility`

### Validation
- `npm run typecheck` passed.
- `npm run build` passed.
