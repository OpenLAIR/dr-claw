# Changelog

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
