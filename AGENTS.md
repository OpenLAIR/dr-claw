# AGENTS.md — Dr. Claw (ResearchFlow)

Full-stack AI research assistant: web app + desktop (Electron) + terminal CLI that drives Claude Code, Cursor CLI, Codex, Gemini CLI/API, and OpenRouter models through a research lifecycle (survey → ideation → experiments → paper → delivery). npm package: `dr-claw` (v1.1.4). Current branch `researchflow-v1` is adding the "ResearchFlow" product — see `ResearchFlow_PRODUCT_SPEC.md` / `ResearchFlow_DeepSeekV4_Implementation_Prompt.md`.

## Commands
- `npm run dev` — full dev: server (Express, port 3001) + Vite client (port 5173), auto port-fallback
- `npm run server` / `npm run client` — backend / frontend separately
- `npm run build` — Vite production build into `dist/`
- `npm start` — build then serve
- `npm run typecheck` — `tsc --noEmit` (frontend `src/` + `shared/`)
- `npm test` — vitest run (unit tests: `server/__tests__`, `server/utils/__tests__`, `src/**/__tests__`; `test/` is excluded)
- `npm run test:watch` — vitest watch
- `node --test test/*.test.mjs` — node:test unit files under `test/`
- `npx playwright test` — e2e specs in `test/*.spec.ts` (spawns `npm run dev`, baseURL `http://localhost:5173`)
- `npm run desktop:dev` / `desktop:dist` — Electron dev / package (see `electron/cli.mjs`)
- `npm run release` — version bump + publish via `release.sh` / release-it
- Env config: copy `.env.example` → `.env` (full reference in `docs/configuration.md`); `PORT=3001`, `VITE_PORT=5173` defaults

## Architecture
- `server/` — Express backend, entry `server/index.js` (wires all routes ~line 475-539, starts Vite dev server in dev mode). Per-feature routers in `routes/`, JWT auth in `middleware/auth.js`, SQLite in `database/db.js`. Provider adapters: `claude-sdk.js`, `cursor-cli.js`, `openai-codex.js`, `gemini-cli.js`, `gemini-api.js`, `openrouter.js`, `nano-claude-code.js`. Core session logic: `projects.js`, `taskmaster.js` (95KB), `cli.js` / `cli-chat.js` (terminal CLI, bin `dr-claw` / `vibelab`).
- `src/` — React 18 + Vite 7 + Tailwind frontend, entry `src/main.jsx` → `App.tsx`. Large feature components in `components/` (`ResearchLab.jsx`, `SkillsDashboard.jsx`, `Settings.jsx`, `GitPanel.jsx`, chat/ subdir), state in `contexts/`, i18n in `i18n/` (zh-CN + en).
- `shared/` — code shared by server & frontend: `modelConstants.js` (canonical model names), `errorClassifier.js`, `geminiThinkingSupport.js`.
- `skills/` — 100+ built-in research skills (each a SKILL.md playbook) + catalogs (`skills-catalog-v2.json`, `skills-taxonomy-v2.json`, `skill-tag-mapping.json`); the server serves these via `/api/skills`.
- `electron/` — desktop shell: `main.mjs`, `preload.mjs`, `cli.mjs` (dev/pack/dist).
- `scripts/` — tooling: `native-runtime.mjs` (node/electron runtime shim), `check-deps.js`, `export-skills-catalog-v2.mjs`.
- Tests: `test/` (Playwright `.spec.ts` + node:test `.mjs`), `server/__tests__`, `src/**/__tests__` (vitest).

## Conventions
- **`server/AGENTS.md` is binding for all `server/` code** — read it first: plain JS ESM only (no TS, no `require()`), all local imports carry `.js` extension, new routes must be registered in `server/index.js`, protected routes use `authenticateToken`, wrap handlers in try/catch with `console.error('[ERROR]', ...)`, return 400/403/404/500, validate paths via `server/utils/safePath.js`, never hardcode model names — import from `shared/modelConstants.js`.
- Frontend: React 18 functional components; `.jsx` legacy + `.tsx` for newer code; Tailwind utility classes; user-facing strings go through `react-i18next` (add both `en` and `zh-CN` entries in `src/i18n/`).
- Don't add dependencies casually — versions are explicitly pinned in `package.json`.
- Never commit `.env` or real API keys; use `.env.example` for new config.
- Node version: `.nvmrc` = v22 (engines: 20.x || 22.x || 24.x).
- License: GPL-3.0 + AGPL-3.0 dual (see LICENSE/NOTICE).

## Notes
- Add project-specific gotchas here as they come up (e.g., ResearchFlow feature context, integration quirks).
