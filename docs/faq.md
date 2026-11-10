[English](./faq.md) | [中文](./faq.zh-CN.md)

# FAQ — Troubleshooting

Common installation and runtime problems with Dr. Claw, in **Problem → Cause → Solution** format. See also the [README](../README.md) and [Configuration Reference](./configuration.md).

---

## 1. `posix_spawnp failed` — bash not in PATH

**Problem:** The shell tab crashes with an error like `posix_spawnp failed` or `spawn bash ENOENT`.

**Solution:** Try rebuilding the native module. From your project root directory, run:

```sh
npm rebuild node-pty --build-from-source
```

This will force a rebuild of the `node-pty` binary, which can resolve issues related to missing or misconfigured dependencies.

---

## 2. `npm install` fails on `better-sqlite3` (`'climits' file not found` / Node 25)

**Problem:** `npm install` fails while compiling `better-sqlite3`, often with logs like:

- `prebuild-install warn install No prebuilt binaries found (target=25.x ...)`
- `fatal error: 'climits' file not found`

**Cause:** Native modules in this stack are tested on Node LTS lines. Using Node 25 can trigger build failures.

**Solution:** Switch to Node 22 (recommended in this repo), then reinstall dependencies.

```sh
# If you use nvm
nvm install 22
nvm use 22
node -v

# Reinstall dependencies
npm install
```

If you do not use `nvm`, install Node 22 with your package manager (for example Homebrew on macOS), make sure it is first in `PATH`, then run `npm install` again.

---

## 3. `npm run dev` fails with `Cannot find module @rollup/rollup-darwin-arm64`

**Problem:** Running `npm run dev` exits immediately; Vite crashes with:

- `Cannot find module @rollup/rollup-darwin-arm64`
- `npm has a bug related to optional dependencies`

**Cause:** npm can occasionally skip platform-specific optional Rollup packages.

**Solution:** Install the missing package explicitly, then restart dev server.

```sh
npm install @rollup/rollup-darwin-arm64
npm run dev
```

If the problem persists, perform a clean reinstall under Node 22.

---

## 4. Web search still fails after enabling permissions

**Problem:** Agent web search still does not work even after you allow the relevant tools or switch to a more permissive mode in Settings.

**Cause:** A runtime network lock may still be active for the current process. In particular, `CODEX_SANDBOX_NETWORK_DISABLED=1` can block network access even when the UI permission settings look correct.

**Solution:** Check whether the environment variable is set, then remove or override it in the place where Dr. Claw is started.

```sh
echo "${CODEX_SANDBOX_NETWORK_DISABLED:-0}"
```

If the command prints `1`, remove or override the variable in your shell profile, systemd unit, Docker config, PM2 config, or other startup layer, then restart Dr. Claw.

After that, confirm the provider-specific permissions are still enabled:

- Claude Code: allow `WebSearch` and `WebFetch`
- Antigravity (Gemini): allow `WebSearch` and `WebFetch`
- Codex: use `Bypass Permissions` when web access is required
