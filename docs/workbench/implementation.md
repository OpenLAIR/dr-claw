# Research workbench implementation

> The screenshots referenced below were review artifacts and are not stored in the repository.

**Current acceptance: completed on 2026-10-23 within the available web, macOS Electron and responsive-mobile environments.** See [the current re-audit and acceptance record](reaudit.md) for all 15 confirmed decisions, the 262-test full browser run, the final 10-test focus regression, native checks, screenshots and explicit physical-device/external-service limits. Checkpoints below remain historical evidence, not the final test totals.

## Scope and baseline

Requested outcome: three completed and verified stages, with project-first navigation and all existing research/chat functions preserved. React 18, Tailwind 3, APIs and persistence stay in place. Existing `package-lock.json` modification is unrelated and must remain untouched.

Initial HEAD: d51b64e1. Initial dirty file: package-lock.json only. Runtime baseline: Vite 5145, backend 3045. Browser evidence in `.taste-skill/before`; login inspector and source lint recorded. Authenticated screenshots use an isolated review account/database under `/tmp/dr-claw-workbench-check`; they are not production data.

## Direction

Achromatic ledger, seed 1106065559. Chosen for long research sessions and comparable project rows. Local system sans, retained Dr. Claw mark, neutral light/dark surfaces, 8px panels / 6px controls, 12/14/16/24px type. Progress uses a single restrained blue; warnings/errors retain semantic colors. The signature is the real research plan: completed tasks, current task, actual stage and produced files beside the continuation action.

The dealt icon-only shell conflicts with the requested project hierarchy and more than five destinations: use a labeled sidebar with a collapsible rail. The dealt greeting/metric-tile home conflicts with the requested compact project list: use the list screen rules. No invented totals, stages, findings or outputs.

## Inventory and questions

- Projects: names, paths, creation time, TaskMaster metadata, provider-specific session lists.
- Conversations: provider, session identity, title, activity, running state; retain streaming and recovery.
- Tasks: actual task API, status, stage, description and dependencies.
- Research brief: `.pipeline/docs/research_brief.json`, optional legacy metadata.
- Outputs: actual file tree and preview, no assumed artifact existence.
- Auto research: actual eligibility, active/latest run and error via existing API.
- Literature: existing library, references and chat handoff.
- Tools: news, skills, auto research and compute resources.
- Users: researchers working for hours on desktop/Electron, reviewing and continuing on mobile.
- Home question: which project needs attention and where can I continue?
- Overview question: what is the goal, what is happening, and what has been produced?
- Detail question: what evidence or action is needed now?

## Stages and acceptance evidence

1. In progress: design tokens, sidebar, project list, overview, project tabs, preserved chat mount; then composer/configuration, state coverage and navigation tests.
2. Pending: research tasks, literature, auto research, preview and compute consistency.
3. Pending: news, skills, settings, login, creation and trash; locale, light/dark, responsive and keyboard checks.

Do not mark the Goal complete until all stages are verified. Required matrix: 1440/768/390 × light/dark; empty/partial/error/long names/many sessions; create/import → overview → continue/start → outputs; stream/stop/retry/attachments/models/authorization/tab switching/reload; keyboard/focus/IME/touch; typecheck/build/tests; screenshot comparison and final inspector.

## Current verification

- Baseline inspector: login 0 FAIL, 1 empty-space warning; this does not prove workspace quality.
- Full acceptance remains pending.

## Checkpoint: 2026-10-23

Authoritative progress (first stage is still in progress):

- Added `overview` AppTab. Ordinary project clicks open overview; explicit session selection opens the requested chat. Global navigation retains selected chat identity; browsing another overview does not retarget the mounted conversation. Project refresh no longer unmounts chat.
- Project home is now a searchable, priority-sorted list with actual task metadata, session recency, continuation and secondary token usage. Missing progress stays missing. No frontend API or persistence format changes.
- Added overview backed by existing tasks, file-tree and research brief APIs, per-section errors/retry, real outputs and existing editor preview. Research details remain available through the existing ResearchLab.
- Sidebar puts new/search/projects first, tools below projects, trash/settings/account at the bottom. Existing session hierarchy, starring, rename/delete and rail remain.
- Neutral theme tokens, flat navigation, local system font and common control styling. Mobile layout now follows viewport width as well as device hints; preserved Electron safe-zone and PWA inset code.
- Model/reasoning configuration moved into an accessible native modal. Authorization and usage remain next to the composer. Dialog Escape, focus restoration and narrow-screen menus tested. Mobile research tools now occupy their own pane, avoiding the previous composer/side-panel overlap; desktop preferences retained, unset preference starts collapsed.
- Added visible project-load failures and WebSocket disconnect state. New copy is localized in en / zh-CN / ko.

Evidence:

- `npm run typecheck`: pass.
- `npm run build`: pass (6 seconds on latest recorded run; existing Browserslist age notice).
- `npm test -- --reporter=dot`: 33 files, 226 tests pass. Includes 8 new summary/file-evidence tests.
- `npx playwright test --config test/workbench.config.ts`: 16 pass. Includes 1440/768/390 × light/dark overview layout, empty-home wizard opening, per-section failure, session deep link, same-project and cross-project draft/mount retention, project refresh retention, configuration Escape/focus/width, IME Enter and mobile tools layout.
- Playwright fixtures are explicit test data; they do not prove real provider streaming or real create/import writes. Runtime baseline and inspector runs use the actual app/API and an isolated review account.
- Skill inspector on actual authenticated home: light and dark each 0 FAIL, 2 WARN. Warnings are one-project empty space (kept honest, no invented content) and a high proportion of 11–12px metadata (paths, timestamps, usage); core identities and actions are 14px. All corresponding fold/page images were viewed.
- Screenshot review caught and fixed mobile heading squeeze, inherited theme-color transition lag and mobile chat/sidebar overlap. Screenshots remain in `.taste-skill/before` and `.taste-skill/after`.
- Source lint of project-dashboard directory: one FAIL remains in the existing TrashDashboard gradient; scheduled for stage 3. Native dialog shadow is intentional floating-surface elevation.
- `git diff --check`: pass. SHA-256 of package-lock.json matches the start-of-work copy.

Next required work (not completion claims):

1. Finish stage 1 acceptance: real create/import → overview → continue/start → output preview; stream/stop/retry/attachments/model change/permission/multi-session/reload verification; long names and many sessions; navigation/focus on mobile drawers. Improve remaining chat Markdown/tool presentation and consolidate QuickSettingsPanel's floating entry without losing preferences. Check auto-research run state, not just processing-session and taskmaster metadata.
2. Stage 2: flatten and unify ResearchLab/tasks, literature, AutoResearchHub, file preview and compute; preserve their complete actions and error handling. Current ResearchLab and context-detail panels retain old nested/colorful presentation.
3. Stage 3: news, skills, settings/quick settings, login/onboarding, creation wizard and trash; all existing copy/locales/theme and desktop/Electron/touch verification. Final whole-site inspector, flow audit and screenshots still required.

Runtime continuation: development process started with `DATABASE_PATH=/tmp/dr-claw-workbench-check/auth.db WORKSPACES_ROOT=/tmp/dr-claw-workbench-check/workspaces npm run dev`, Vite 5145/backend 3045. Review authentication is local in `/tmp/dr-claw-workbench-check/auth.json` (never commit it). Inspector adapter in that temp directory only supplies authentication/theme and waits for the real home; its measurement rules are unchanged. Revalidate live processes rather than trusting this note.

## Checkpoint 2: research surfaces and task handoff

Stage 1 remains in acceptance; stage 2 is now in progress. Stage 3 has only begun with the creation dialog. No stage is being declared fully complete.

Implemented:

- Moved QuickSettingsPanel into a disclosure within conversation configuration. Removed its floating draggable handle. All underlying preferences, legacy keys, language/theme behavior and sync events remain; the obsolete handle-position value is left untouched.
- Literature uses a full-width list or preview on mobile, selectable with labeled controls. Desktop retains its adjustable sidebar and now supports arrow-key resizing. Resource counts are compact inline data, and the library starts open. Prevented an older file response from replacing a newer selection.
- Flattened ResearchLab, context panels, AutoResearchHub and compute surfaces. Removed their decorative gradients, blur, glows, oversized radii, category rainbow fills and attention pulses. Kept real status colors and code syntax highlighting. Guides default to collapsed only when no preference is saved. AutoResearchHub's contribution link is now a secondary footer.
- Added an in-memory research-task handoff from overview to a new research chat draft, using the actual next-action prompt/stage. The label is now “Prepare task in chat,” matching its behavior. It uses the existing programmatic-draft replacement protection and preserves the draft if replacement is declined.
- Outputs open in an accessible wide native preview dialog using the existing multimedia/Markdown/JSON viewer; original editing remains available. Escape and focus restoration are verified.
- Compute monitoring distinguishes unknown values from measured zero. Node loading failures have retry; failed delete/activation retains existing nodes and displays an error. Existing APIs and protocol are unchanged.
- New empty workspace creation opens overview. Explicit import-analysis/auto-intake options still open chat. Creation now uses a native dialog with focus containment/Escape and associated field labels.

Latest evidence:

- Typecheck and production build pass; latest build 7.22 seconds with the existing Browserslist notice.
- Unit suite: 33 files / 226 tests passed during this checkpoint. Subsequent changes are covered by final typecheck/build and browser tests.
- Final browser suite: **39 passed** (32.3 seconds). Added preference persistence/reload, literature selection/preview at all six size/theme combinations, keyboard resizing, tool-page layout at all six combinations, compute failure/retry, task handoff and declined replacement, output preview/Escape/focus, and new-workspace contract creation → overview → start research at 1440/390.
- Creation browser tests intercept the API and assert its exact request. They do not claim to have created a real workspace on disk. Import creation and actual provider execution remain outstanding.
- Real authenticated API smoke: AutoResearchHub and ComputeResourcesDashboard render without page exceptions or document overflow at 1440; compute screenshot contains actual local CPU/memory measurements. No provider task was started. Evidence: `.taste-skill/after/live-*-1440.png`.
- Research-source skill lint: **0 FAIL / 8 WARN** across ten files. Seven warnings are literal code/path/SSH command monospace; one is existing prose punctuation. This is not a whole-site lint pass.
- Viewed all six literature screenshots plus desktop/mobile research details, output preview, creation, tool pages, and both live API screenshots. Remaining generated size/theme tool images also exist for final review.
- `git diff --check` passes; existing package-lock.json SHA-256 still matches the initial copy. Removed only this work's old test-results/.last-run.json; Playwright now writes results to the platform temp directory.

Still required:

1. Complete real create/import verification in a properly isolated provider home. Current server uses an isolated database/workspace root, but `addProjectManually` still writes `~/.claude/project-config.json` and creates skill links. Do not claim isolation covers that file. Prefer a test-process filesystem-home shim or a fully isolated test environment for these writes; do not overwrite the user's provider configuration.
2. Streaming/stop/retry/attachment/model-change/authorization/multi-session tests and real refresh/deep-link recovery beyond draft preference checks. Existing 226 tests do not alone establish these end-to-end flows.
3. Long project names and many sessions; mobile drawer keyboard handling; remaining Markdown/tool-state polish and source lint for chat. Auto-research active/latest-run status should also inform project attention, beyond taskmaster and processing-session metadata.
4. Stage 2 completion: partial task/file API failure behavior in literature and ResearchLab, task CRUD and session-stage actions, reference handoff, compute node/Slurm forms and error states, preview editing, and full localization of legacy hardcoded research/compute strings. ResearchLab still contains nested detail cards and nonlocalized labels that need review.
5. Stage 3: news, skills, settings, login/onboarding, trash, remaining creation folder browser/copy, locale and dark/mobile matrix, real Electron drag/window controls/PWA checks, final whole-site inspector/screenshots. The existing trash gradient still needs removal.

Runtime and private test authentication remain as described above. A read-only live API smoke succeeded in this checkpoint. Temporary tool outputs are under `/tmp/dr-claw-workbench-check`; Playwright outputDir uses os.tmpdir(), which on this Mac is `/var/folders/.../T/dr-claw-workbench-check/test-results`.

## Checkpoint 3: global surfaces and conversation acceptance

All three stages now have implementation work. The Goal remains active: this checkpoint is not a declaration that the full acceptance matrix is finished. The items below supersede the older checkpoints where they overlap.

Implemented and corrected:

- News uses a compact header, neutral source selection and readable result cards. Source labels remain visible on mobile; summary counts distinguish absent data from zero. Failed initial/partial loads offer retry. Failed config saves keep changes dirty and show an error inside the source settings dialog. Source settings now use the common native dialog.
- Skills uses compact header actions and neutral taxonomy labels. Desktop keeps filters/list/details; compact layouts keep search visible, fold all facets under Filters and open selected details on demand. Import uses the common dialog with a labeled path. Unsaved edits survive closing and reopening the same skill. Detail metadata is sentence case and no longer nested in individual cards.
- Settings uses a native modal with focus containment, Escape, return focus and horizontally scrollable keyboard-operable tabs. Login retains the Dr. Claw mark with neutral forms, autocomplete and announced errors. Onboarding copy is localized in en/zh-CN/ko, uses neutral provider surfaces and retains optional setup/telemetry choices. Trash uses divided project rows with the original restore/delete choices.
- The mobile drawer hides bottom navigation while open, sits above the floating composer, makes background content inert, traps keyboard focus and restores its trigger on Escape. Browser checks found two real overlap failures and verified the fixes.
- Model selection gained listbox semantics, readable options, keyboard arrows/Home/End and focus return. Tool approval and uploaded-file descriptions are localized. User messages and their actions use neutral surfaces.
- Fixed a mobile approval defect: moving the composer on textarea blur could move an approval button between pointer-down and click. Focus now remains within the composer during its actions; removing the focused approval/stop control clears stale focus state. A pending approval keeps the running/stop bar in normal flow instead of covering its buttons. Safe-area bottom padding is retained while the composer floats.

Evidence and boundaries:

- Browser contract tests now cover global surfaces at 1440/768/390 × light/dark, settings tab keyboard/focus/width, skill detail/filter/import/edit flows, news load retry and failed save, login/register validation, and en/zh-CN/ko onboarding completion. Final counts are recorded below after the full run.
- WebSocket contract tests exercise actual frontend handling of incremental responses across navigation, exact session identity on stop, model selection in the submitted request, attachment upload paths, visible tool approval and its outgoing decision, retry, saved history on reload, and separate session histories with keyboard tab switching. These use an explicitly intercepted WebSocket, not a paid provider run.
- Touch emulation verifies tapping approval after typing, then opening the drawer and Settings. This caught the floating composer covering drawer actions; it does not substitute for a physical iOS keyboard/PWA check.
- Long unbroken project names and 60 sessions pass navigation/layout checks at all three widths.
- **Real filesystem/API flow passed** against an isolated server on port 4175: new workspace → overview → start-chat entry; existing workspace import → overview → output file preview; refresh → reopen imported project. Directory creation, generated config in the isolated home, and Markdown read through the real file API were verified. Browser page errors: zero. The real user's `~/.claude/project-config.json` hash stayed unchanged. No provider command was sent.
- Isolation used a temporary Node preload overriding `os.homedir()` (and syncing built-in ESM exports), explicit DATABASE_PATH and WORKSPACES_ROOT, and an isolated review account. The valid workspace root was the macOS user temp directory under `/var/folders/.../T/dr-claw-workbench-live`; `/tmp` was correctly rejected by the existing server path rules. The test server is stopped and the development runtime registry is restored to backend 3045/frontend 5145.
- Private review auth stays outside the repository. Temporary scripts/results: `/tmp/dr-claw-workbench-check/live-create-import.mjs`, `isolated-home.mjs`, `live-flow-result.json`; no credentials appear in screenshots/docs. Live screenshots are `.taste-skill/after/live-created-overview.png` (captured during loading) and `live-imported-output.png` (resolved content).
- Real authenticated News/light inspector across three widths: **0 FAIL / 0 WARN** after increasing abstract text and fixing rank contrast. Skills/dark across three widths: **0 FAIL / 3 WARN** after fixing tiny uppercase labels. The remaining warnings concern independently scrollable columns (unequal heights), a canvas detector misreading the right detail column, and mixed prose/metadata numerals. All six final fold screenshots were viewed; the right panel reaches the content edge and the list/filters intentionally scroll independently. These are not full-site inspector claims.
- Global source lint across 13 files: **0 FAIL / 15 WARN**. Warnings are literal code/path monospace, native-modal elevation and existing punctuation. Two reserved example domains are explicitly exempted because they demonstrate MCP input syntax, not fabricated product data.
- `package-lock.json` still matches its original SHA-256; no backend protocol/persistence changes or framework migration.

Remaining acceptance work:

1. Integrate actual active/latest auto-research status into project attention/running summaries. The current summary reflects processing sessions and task metadata; the existing `/api/auto-research/:projectName/status` response can provide additional evidence without changing the protocol.
2. Finish research-page behavior audit (task CRUD/stage actions, partial task/file failures, reference handoff, preview editing, compute/Slurm forms) and remaining legacy hardcoded locale copy across research/compute/skills/community tools. New checkpoint copy is localized, but full-site localization is not yet complete.
3. Complete real Electron window/drag/traffic-light checks and PWA/physical-keyboard limitations, and remaining theme/locale/viewport inspector coverage. Preserve the current draft/mount/streaming tests while doing so.
4. Review remaining chat/tool dropdown styling and Markdown rendering in the full content matrix. External provider execution and third-party service credentials were deliberately not used as a substitute for deterministic frontend contract verification; report that limitation honestly in the eventual completion report.

Do not mark the Goal complete until the remaining required work is resolved and the final site review is complete.

## Checkpoint 4: acceptance closure

This section supersedes the open items in checkpoints 1–3. All three stages are implemented. Final verification and the practical limits are recorded here; the earlier sections remain as the implementation history.

### Stage 1: project-centered core loop

- Project attention now reads the existing auto-research status API as well as local running sessions and task state. It distinguishes a current run, a failed latest run, loading and unavailable status; retry does not hide known task progress. Requests are bounded and polling pauses while the document is hidden. Muse sessions added by concurrent work are included in summaries.
- Research/skill selection uses the same accessible dialog as model settings. Opening or dismissing a picker preserves typed input. Markdown is checked with tables, math, code, long identifiers and nested lists across the six viewport/theme combinations.
- A new reference-to-chat regression exposed a StrictMode replay issue: restoring local draft state twice could erase the just-consumed reference draft. Restoration now happens once per project identity, queued drafts use the existing unsent-draft protection, and declining replacement preserves the user's draft. Provider request construction was not changed by this fix.
- Verified contracts include stream continuity across global navigation, stop identity, retry, attachment upload, model selection, approval after typing, separate session histories, deep links and reload recovery. Real create/import/filesystem evidence from checkpoint 3 remains valid; no paid provider task was submitted.

### Stage 2: research and resource operations

- ResearchLab task add/edit/delete rejects failed HTTP responses without discarding input. Partial tasks/files failures retain successful data and offer retry. Session-stage updates announce failures and retain their prior state. System labels and brief sections use en/zh-CN/ko resources; user research text and paths remain unchanged.
- Task rows now give titles their own width on phones; actions move beneath them. Task statistics and brief content use dividers rather than repeated framed tiles. Brief and expanded artifact views use native dialog focus/Escape behavior.
- Both the standalone output editor and the inline artifact editor retain edits after a failed save. The inline editor previously treated any resolved HTTP response as success; it now checks the response status.
- Reference detail/import/delete dialogs use the shared native dialog. Reference load/delete failures are visible, a failed deletion retains the selection, list actions are available without hover, and source URLs remain attached to the selected evidence. Desktop/mobile tests verify reference-to-chat handoff, validation and focus return.
- Compute forms retain failed input, validate ports and GPU counts, and preserve an explicit GPU count of zero. Slurm queue/info failures have retry; failed submission retains the script; cancellation only updates the queue after a successful response. Missing CPU/GPU fields render as unknown instead of idle, zero or NaN. Existing endpoints and request shapes remain.
- Compute and AutoResearch UI text now uses the existing locale resources. Pack availability labels explicitly describe MCP configuration rather than asserting the absence of all dependencies.

### Stage 3: global consistency and compatibility

- Skills taxonomy, detail/import/configuration copy is localized, including Korean; localized source markers retain correct native/community classification. Folder browsing uses a nested native dialog, preserves the parent wizard on Escape, reports errors with retry, and handles long paths.
- News, skills, settings, login, onboarding, project creation and trash are covered by the previous global surface work and the final browser suite. Follow-up scanning removed remaining decorative purple treatments, tiny uppercase headings and the shell prompt's backdrop blur. Protocol glyph parsers and the transparent mention-alignment overlay carry narrowly documented lint exceptions because those are functional syntax/rendering mechanisms.
- Electron 1.1.4 was launched with the actual main process and preload, a temporary review database/home and a separate runtime registry. At 1440×900 and the 1100×760 minimum: drag-region CSS, 68px macOS window-button clearance, interactive no-drag controls, theme rendering, overflow and actual minimize/restore passed; zero renderer page errors. The review app and its backend were closed afterward. This does not claim a physical pointer drag or verification on Windows.
- Standalone-mode mobile tests emulate touch, coarse pointer, reduced motion and a 390×844 → 390×500 keyboard-sized viewport. Synthetic composition Enter retains the Chinese draft. These tests preserve safe-area behavior but do not claim a physical IME or an installed iOS/Android PWA test.

### Recorded checks

- Full workbench browser suite: **106 passed** (about 1.5 minutes). This includes six width/theme pairs plus targeted en/zh-CN/ko checks. A further **21 targeted tests passed** after chat/context styling cleanup. The final small copy/style pass has its own targeted run recorded in the completion note below.
- Unit suite: **34 files, 235 passed, 1 skipped**. The skipped test is the concurrent Muse CLI offline-echo integration test, gated by `MUSE_ECHO_TEST_COMMAND`; it is not a failed workbench test.
- Type checking and production build: passed. Production continues to use React 18 and Tailwind 3.
- Source style scan of **61 changed/new component files: 0 FAIL / 72 WARN**. This is not a warning-free repository claim. Remaining categories are literal code/path monospace, legacy transition declarations, overlay/focus elevation, loading/running indicators and punctuation/unknown-value dashes. Inspector thresholds were not relaxed.
- Live authenticated inspectors at 1440/768/390 in both themes: News **0 FAIL / 0 WARN** each; Skills **0 FAIL / 3 WARN** each; Compute **0 FAIL / 1 WARN** each; AutoResearch **0 FAIL / 1 WARN** each. The initial project-home inspectors are **0 FAIL / 2 WARN** each. Screenshots were viewed, with the decisions recorded in `visual-review.md`.
- `git diff --check`: passed. `package-lock.json` still matches the SHA-256 captured before work began.

### Scope and limitations

The frontend uses real API data in normal operation. Deterministic test fixtures are confined to `test/workbench.spec.ts`; they are not shipped as research data. External providers, SSH/Slurm servers, Zotero accounts and paid model execution were not used for acceptance. Their frontend request/response and error contracts were exercised with controlled fixtures. Physical device/IME/PWA testing and OS-level dragging remain outside the automated evidence, as described above.

Concurrent Muse integration changed backend/provider files and added tests during this work. Those edits were preserved; they are not attributed to this redesign. No commit, pull request or deployment was requested or created. Review credentials and temporary runtime logs remain outside the repository.

### Completion note

The final copy/style pass passed **20 targeted browser checks**, type checking, and production build (8.04s). The preceding full run passed **106 browser tests**, followed by **21 chat/context checks**; the unit suite passed **235 tests** with the one documented external Muse CLI skip. The final Electron run against the rebuilt production bundle repeated the 1440×900 / 1100×760, theme, drag-region, button clearance and minimize/restore checks with **zero page errors**. Its screenshots were viewed. The development registry remains backend 3045 / frontend 5145; the temporary Electron backend is closed. Final diff whitespace check and original package-lock hash check pass.

No required implementation or automated acceptance work remains. Physical-platform and live external-service limits are explicitly listed above rather than represented as tested.
