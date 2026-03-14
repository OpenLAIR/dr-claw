# Dr. Claw Rename Plan

## Purpose

Rename the project from `VibeLab` / `Vibe Lab` to `Dr. Claw` without breaking packaging, installs, existing workspaces, or user trust.

## Status

- Branch: `dr-claw-phase-1-branding`
- User-facing branding status: completed
- Package/CLI/workspace-root migration status: completed
- Last updated: `2026-03-14`

## Current State Review

The repo is already in a mixed branding state:

- `README.md` header has already been changed to `Dr. Claw`, but most body copy still says `VibeLab`.
- `README.zh-CN.md` is still fully branded as `VibeLab`.
- App shell branding still uses `Vibe Lab` in browser/PWA metadata.
- Package and CLI metadata still use `vibelab`.
- Several runtime/storage identifiers still use `vibelab-*`.
- Some docs and skill content refer to `VibeLab` as a product name, while some values such as schema IDs and provider IDs use `vibelab` as a technical identifier.

This means the rename should be treated as a controlled migration, not a global search-and-replace.

## Rename Principles

1. Use `Dr. Claw` for the public-facing product name everywhere users see branding.
2. Keep technical identifiers that are already persisted or externally integrated unless there is a strong reason to migrate them.
3. Add compatibility before removing old names for CLI/package/repo-facing surfaces.
4. Separate branding changes from repository/package identity changes so the rollout is reversible.

## Scope

### Phase 1: User-facing branding

Update all visible branding to `Dr. Claw`:

- README files
- docs under `docs/`
- page title and mobile web app title in `index.html`
- PWA manifest `name`, `short_name`, and description in `public/manifest.json`
- visible UI strings such as:
  - sidebar/logo alt text
  - onboarding copy
  - protected route title
  - chat greeting
  - settings labels and release links text
- public images and alt text where appropriate

This phase should not change stable technical IDs unless they are directly user-visible.

Phase 1 has been completed in the current branch for these areas:

- app shell metadata (`index.html`, `public/manifest.json`)
- visible UI copy in onboarding, setup, loading, sidebar, chat intake, and skills labels
- English, Chinese, and Korean locale strings that surface the product name
- README and core docs in `docs/`
- beta agreement text in English and Chinese

Phase 1 intentionally did **not** change at that time:

- GitHub repository URLs and clone paths (`OpenLAIR/VibeLab`, `cd VibeLab`)
- release-check repo identifiers
- npm package name `vibelab`
- CLI command name `vibelab`
- workspace root defaults such as `~/vibelab`
- persisted/internal identifiers such as `vibelab-*` storage keys and schema/provider IDs

### Phase 2: Distribution and repository naming

Current decisions for this branch:

- npm package name: change from `vibelab` to `dr-claw`
- CLI bin name: change from `vibelab` to `dr-claw`
- default workspace root: change from `~/vibelab` to `~/dr-claw`
- GitHub repository path: keep `OpenLAIR/VibeLab` for now
- release-check target: keep `OpenLAIR`, `VibeLab` for now

Applied or planned in this branch:

- update `package.json` and `package-lock.json` package/bin names
- update CLI help, status, self-update, and server startup hints to use `dr-claw`
- update user-facing manual upgrade commands to `npm install -g dr-claw@latest`
- update workspace-root defaults in backend and UI to `~/dr-claw`
- update tests and docs that depend on the default workspace path
- keep GitHub repository links and clone paths unchanged until a later repo rename

### Phase 3: Technical identifier audit

Review all `vibelab` identifiers and classify them:

- Keep:
  - local storage keys such as `vibelab-sidebar-width`
  - schema IDs such as `https://vibelab.local/...`
  - provider/source enums like `vibelab`
- Migrate carefully:
  - telemetry labels
  - generated job names like `vibelab-job`
  - internal prompt text that affects model behavior
  - test fixture names that encode product identity

Rule: only migrate a technical identifier if the value is user-visible, low-risk, or a new compatibility layer is added.

## Files and Areas To Update

### High-priority branding files

- `README.md`
- `README.zh-CN.md`
- `docs/configuration.md`
- `docs/configuration.zh-CN.md`
- `docs/faq.md`
- `docs/faq.zh-CN.md`
- `docs/internal-beta-user-agreement.en-US.md`
- `docs/internal-beta-user-agreement.zh-CN.md`
- `index.html`
- `public/manifest.json`

### High-priority UI files

- `src/components/sidebar/view/subcomponents/SidebarHeader.tsx`
- `src/components/Onboarding.jsx`
- `src/components/ProtectedRoute.jsx`
- `src/components/chat/view/ChatInterface.tsx`
- `src/components/chat/hooks/useChatComposerState.ts`
- `src/components/CredentialsSettings.jsx`

### Packaging and release files

- `package.json`
- `package-lock.json`
- `server/cli.js`
- `server/index.js`
- `server/routes/commands.js`
- any release/version-check hooks tied to `OpenLAIR/VibeLab`
- any badges and links pointing at `OpenLAIR/VibeLab`

### Lower-priority technical references

- workspace path defaults in `src/components/ProjectCreationWizard.jsx`
- workspace root defaults in `server/routes/projects.js` and `server/projects.js`
- storage keys in `src/components/app/AppContent.tsx`
- diagram storage prefix in `src/components/survey/utils/diagramWindow.ts`
- scheduler templates in `src/components/ComputePanel.jsx`
- skill docs and integration docs under `skills/`
- tests under `test/`

## Recommended Implementation Order

1. Finish Phase 1 branding changes everywhere user-visible.
2. Verify the app title, onboarding, and README are consistent in English and Chinese.
3. Keep the repository name unchanged for now.
4. Change package name, CLI name, and workspace-root defaults in one pass.
5. Audit remaining `vibelab` technical identifiers and only migrate the safe/user-visible ones.
6. Run a final grep for:
   - `VibeLab`
   - `Vibe Lab`
   - `vibelab`
   - `vibe lab`

## Compatibility Decisions To Make

Resolved decisions:

- The GitHub repository stays `OpenLAIR/VibeLab` for now.
- The npm package changes to `dr-claw`.
- The CLI command changes to `dr-claw`.
- The default workspace root changes to `~/dr-claw`.
- Should internal source/provider IDs remain `vibelab` permanently?

Current branch policy:

- Keep repo URLs and release-check repo identifiers unchanged.
- Change package, CLI, and default workspace root now.
- Revisit deeper internal identifier migration in a later release if needed.

## Risks

- A blind search-and-replace will break release checks, package installs, links, schema references, or persisted local storage.
- Renaming `~/vibelab` by default can confuse existing users and tests if they rely on implicit defaults.
- Renaming `vibelab` source enums or schema IDs can break code that expects those exact values.
- Renaming the CLI without an alias removes backward compatibility for existing `vibelab` command users.
- Partial rename across English and Chinese docs will look unpolished and reduce trust.

## Verification Checklist

- App title shows `Dr. Claw` in browser and installed PWA.
- Sidebar/header/logo alt text use `Dr. Claw`.
- Onboarding, beta agreement, and settings copy use `Dr. Claw`.
- README and docs are consistent in English and Chinese.
- GitHub/release links still resolve.
- Version check still works after any repo rename.
- Existing projects still open correctly.
- Existing local settings and storage-backed UI preferences still work.
- Grep shows no unintended `VibeLab`/`Vibe Lab` strings in user-facing surfaces.
- Package metadata and update commands use `dr-claw`.
- CLI help/status/update paths use `dr-claw`.
- New workspace defaults point to `~/dr-claw`.

Verification completed for Phase 1:

- `npm run typecheck` passed.
- Remaining `VibeLab` hits in the edited surface are limited to intentionally deferred compatibility references such as repo URLs, clone commands, and release-check identifiers.

Additional verification required for the current branch scope:

- run tests covering workspace-root defaults
- decide whether to provide a temporary `vibelab` CLI alias for backwards compatibility
- decide whether to migrate lower-level persisted/internal identifiers such as `.vibelab`, `vibelab-*` storage keys, provider IDs, and schema IDs

Verification completed for the package/CLI/workspace-root migration:

- package/bin metadata changed in both `package.json` and `package-lock.json`
- targeted grep found no stale `vibelab` package/CLI/workspace-root references in the edited install/update flows
- `npm run typecheck` passed after the runtime rename changes

## Suggested First PR

Title:

`rebrand user-facing VibeLab naming to Dr. Claw`

Scope:

- All user-visible copy and metadata
- README/docs cleanup
- No package name, CLI name, schema ID, or workspace-root migration

This is the safest first step and will give you a clean branded product without forcing downstream migration work in the same change.
