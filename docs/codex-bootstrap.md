# One-command Codex server deployment

This guide deploys the versioned Dr. Claw integration into the official Codex CLI on a new Linux server. It is separate from the desktop and `npx dr-claw` quick starts: this path installs the portable Codex profile, global guidance, skill router, and optional Dr. Claw CLI/Web runtime for the final Unix user.

The current pinned release is [`codex-bootstrap-v0.2.9`](https://github.com/OpenLAIR/dr-claw/releases/tag/codex-bootstrap-v0.2.9). Its Release page is generated from checksum-covered provenance and contains the exact copy/paste command with the full commit and annotated tag object. Do not substitute a moving branch or an unpinned `latest` URL.

For the complete Chinese operations guide, Delta access procedure, profile details, update/rollback behavior, and maintainer acceptance checklist, see [the full Codex bootstrap guide](../bootstrap/codex/README.zh-CN.md).

## Requirements

- Linux on `x86_64` or `aarch64`.
- Run as the final non-root Unix user who will run Codex. Cross-user provisioning is intentionally rejected.
- Python 3.9 or newer, Git 2.25 or newer, Bash, GNU coreutils, and outbound HTTPS to the required approved package endpoints.
- At least 1 GiB free for the Codex/skills core, or 8 GiB for `--full`.
- The optional Dr. Claw control CLI requires usable Python `venv`/`ensurepip`; the Web application requires glibc 2.28 or newer.

## Recommended online install

Open the [current release](https://github.com/OpenLAIR/dr-claw/releases/tag/codex-bootstrap-v0.2.9) and copy the command under **One-command online install**. It has this shape, with all three identity values filled by the release workflow:

```bash
bash -c 'set -Eeuo pipefail; curl -fsSL "https://raw.githubusercontent.com/OpenLAIR/dr-claw/<FULL_COMMIT_SHA>/bootstrap/codex/remote-install.sh" | bash -s -- --ref "<ANNOTATED_RELEASE_TAG>" --expected-commit "<FULL_COMMIT_SHA>" --expected-tag-object "<TAG_OBJECT_SHA>" --full'
```

The outer `pipefail` prevents a failed download from looking like a successful empty shell run. The raw script is pinned to the full commit; the installer independently verifies the annotated tag object, peeled commit, clean checkout, manifest release ref, required files, and post-install Codex contracts.

Useful mode changes:

- Omit `--full` for the Codex configuration, global `AGENTS.md`, and skill router only.
- Use `--with-app` for the Web application without the Python control CLI.
- Append `--codex-release latest` only when a fresh host must install the newest official Codex CLI. An already installed compatible official CLI is preserved and contract-tested.
- Append `--dry-run` for a zero-write source and installation preview.
- Append `--app-service auto --start-app` only when the host should start the loopback-only Web service immediately.
- On a verified NCSA Delta host, the Delta skill is selected automatically. Use login nodes only for lightweight work and Slurm submission.

## What is installed

- Managed portable keys in `~/.codex/config.toml` using the safe profile by default.
- A managed block in `~/.codex/AGENTS.md`.
- One native user skill at `~/.agents/skills/drclaw-skill-library`. The router discovers the complete versioned skill tree on demand, avoiding a 170+ entry initial skill-list payload.
- `~/.agents/skills/ncsa-delta` only on a verified Delta host or with explicit opt-in.
- With `--full`, a revision- and hash-locked Dr. Claw control CLI plus a verified Node/Web runtime and private loopback configuration.
- A secret-free installation receipt and an automatic strict pre-activation doctor.

## Authentication and first activation

Authentication is target-machine state and is deliberately not migrated. On a headless server, complete the normal official Codex device flow after installation:

```bash
codex login --device-auth
codex login status
```

Then authorize any approved connector through its own OAuth flow, inject third-party API keys through the target secret store, create the first Dr. Claw browser account if the Web application is installed, and run a read-only model smoke test.

The installer never copies Codex `auth.json`, sessions, SQLite databases, connector caches, OAuth tokens, API keys, SSH keys, Duo state, `.env` files, another host's trusted project paths, existing research projects, or cluster runtime state.

## Offline source transport

Download every asset from the same release into one private directory. Keep `README.md`, `install.sh`, `remote-install.sh`, the Git bundle, source archive, sidecars, provenance, and `SHA256SUMS` together, then run:

```bash
sha256sum --strict --check SHA256SUMS
bash ./install.sh --full
```

The offline kit pins the original annotated tag object and peeled commit and rejects missing, extra, symlinked, group/other-writable, or checksum-mismatched entries. It removes the dependency on GitHub for Dr. Claw source transport; a full install still requires the approved Codex, PyPI, Node, and npm endpoints unless separately reviewed mirrors are supplied.

## Update, rollback, and verification

To update, use the exact command from the newer immutable release. Each release installs into a commit-addressed checkout and atomically retargets managed components only after source and receipt verification. To roll back, rerun the exact command from an older approved release; never move or reuse a published tag.

Every accepted release must have successful x64, native ARM64, Python 3.9–3.13, release-kit, Web, and publish jobs. The Release must contain the checksum-covered `README.md` plus the full artifact inventory, and its provenance identities must match the live public annotated tag.

Official Codex references used by this integration:

- [Codex CLI installation](https://learn.chatgpt.com/docs/codex/cli)
- [Codex authentication](https://learn.chatgpt.com/docs/auth)
- [Config basics](https://learn.chatgpt.com/docs/config-file/config-basic)
- [Custom instructions with AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [Build and discover skills](https://learn.chatgpt.com/docs/build-skills)
