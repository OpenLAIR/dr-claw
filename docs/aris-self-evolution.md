# ARIS Workflow M: self-evolution, with a human landing gate

The ARIS pack exposes **Meta Optimize** (`/aris-meta-optimize`) in both Auto Research
Hub and Chat's Auto Research menu. It is maintenance, not another stage of the
research pipeline. It reads accumulated usage evidence, identifies the current
bottleneck, and proposes small improvements to skill prompts/defaults. It does
not edit the skill corpus. Approved proposals are staged for a **separate manual**
`/aris-meta-apply 1,3` (or `all`) invocation.

This is a focused sync from upstream ARIS commit
`f1bd907b58f653131ebe6807c482e2554e07f9b9`, not a wholesale upgrade of every ARIS
skill. [Provenance and local adaptations](../skills/aris-infra/UPSTREAM.md) and
[upstream MIT license](../skills/aris-infra/LICENSE) ship with the pack.

## Prerequisites and project paths

- Python 3.10+ and Bash for local helpers; Claude Code for these hook templates.
- Keep `aris-meta-optimize`, `aris-meta-apply` and `aris-infra` together. Dr. Claw
  creates project skill links; standalone users can copy/symlink all three under
  their host's skills directory. Copying only SKILL.md loses the dependencies.
- Run the workflow from the research **project root**. Helpers are in
  `skills/aris-infra/tools/` in Dr. Claw, not the project's root `tools/`.
  [Helper resolution](../skills/aris-infra/shared-references/integration-contract.md)
  supports Dr. Claw project links and an explicit `ARIS_INFRA` bundle path.
- Native Claude Code honors `disable-model-invocation` for the applier; Dr. Claw
  and other hosts can expand Markdown commands without enforcing every frontmatter
  field. Always preserve the human-only invocation rule. These hooks are not
  asserted to run in Codex, Cursor, generic Chat or every SDK session.

## Opt in to logging without replacing settings

**Nothing auto-enables logging**: not installing the pack, opening the UI, the
standard `setup.sh`, or invoking meta-optimize. Logs contain command snippets,
file paths, slash-command arguments and prompt/reviewer previews, which may be
sensitive. Review this before enabling. No logging helper sends data to a network.

From the Dr. Claw checkout, preview changes for your research project:

```bash
python3 skills/aris-infra/tools/meta_opt/configure.py \
  --project /absolute/path/to/research-project --logging
```

The preview prints merged settings but writes **nothing**. After reviewing it:

```bash
python3 skills/aris-infra/tools/meta_opt/configure.py \
  --project /absolute/path/to/research-project --logging --apply
```

This preserves unrelated keys and existing hook arrays in
`<project>/.claude/settings.json`, saves the original bytes in a uniquely named
`settings.json.aris-backup-*`, and atomically writes the merged file. Repeating
identical options is a no-op. Invalid JSON/hook structures and symlinked settings
are rejected, not overwritten. The helper refuses HOME as the project. It does
not configure global Claude settings or register MCP servers.

Restart Claude Code in that project. The hooks record SessionStart/SessionEnd,
UserPromptSubmit, PostToolUse and PostToolUseFailure to
`<project>/.aris/meta/events.jsonl`. Failures remain `tool_failure` rather than
successful skill invocations. The SessionEnd readiness helper suggests
`/aris-meta-optimize` after five new invocations or a changed session model; it
never invokes a workflow. Whether a SessionEnd message is visible depends on the
host; the helper can also be run manually.

**Global logging is a second opt-in** (`--global-log`, together with `--logging`)
that also writes `~/.aris/meta/events.jsonl` with a project tag. Unlike upstream,
this pack defaults to project-only logging. Decide before first setup; if changing
options later, remove the old ARIS logger entries first to avoid duplicate hooks.
The raw [logging template](../skills/aris-infra/templates/claude-hooks/meta_logging.json)
is for inspection/manual merging only; its relative checkout paths do not work
in a downstream project without adjustment. The helper uses absolute paths.

To disable: remove only the ARIS command entries from each relevant hook array,
leaving unrelated hooks/settings intact, then restart. Logs are retained; delete
them manually if no longer needed. If the Dr. Claw checkout moves, replace only
the old ARIS entries and rerun preview/merge. Never copy a template over settings.

## Optional common-write guard

Preview/merge `--guard` independently, or add it alongside `--logging`:

```bash
python3 skills/aris-infra/tools/meta_opt/configure.py \
  --project /absolute/path/to/research-project --logging --guard
# Inspect first, then repeat with --apply if desired.
```

The guard denies common **relative-path Bash writes** to corpus directories
(`skills/`, `tools/`, `templates/`, etc.). It applies to all Bash calls in that
project, not just the producer; legitimate corpus edits use Write/Edit. It is a
regex blacklist, **not a sandbox**. Absolute paths, shell variables, `git apply`
and other file APIs may bypass it. It does not gate Write/Edit, prove a jury
verdict, or automatically verify provenance. Host/filesystem permissions are
needed for a hard read-only boundary. No pre-push verifier or TTL auditor ships.

## Configure a real reviewer, not a label

Workflow M's tested transport contract is the bundled Codex-exec MCP bridge:

```bash
npm install -g @openai/codex
# Authenticate Codex using its supported login flow, then explicitly register:
claude mcp add codex -s user -- python3 "$(pwd)/skills/aris-infra/mcp-servers/codex-exec/server.py"
```

Inspect any existing `codex` registration before manually replacing it. Current
Codex CLI no longer provides `codex mcp-server`. This sync does not change a user's
MCP registration or home config automatically. Restart the host after setup.
The Hub's explicit **Configure** action uses the same bundled bridge and leaves
existing registrations untouched; it does not silently migrate an older entry.

Initial requests use `gpt-6-astra` / `xhigh` for advisory review and `ultra` for the
landing jury, **always `sandbox: read-only` plus explicit project cwd**. These are
requested capabilities, not a promise that the account or CLI supports them.
Only explicit unsupported-effort or unavailable-model errors before a usable
thread allow the documented fallback; never retry/downgrade for authentication,
timeout, rate-limit or ambiguous transport errors. See the exact
[capability gates](../skills/aris-infra/shared-references/reviewer-routing.md).
Unavailable review leaves patches pending. No live model/reviewer is exercised
by installation or the deterministic tests.

The actual author and reviewer families must differ. Claude → Codex can qualify;
Codex → Codex, unknown identities, or changing the display label cannot. The
provenance helper checks model strings but does not attest the provider's identity
or run a verifier. Generic `llm-chat/chat`, the older bundled Gemini bridge and
same-family agents are **not automatically wired as Workflow M landing juries**.
Do not grant unsafe reviewer permissions or silently fall back to self-review.
Reviewer calls share the selected artifact contents with the configured service;
inspect secrets and research privacy before invoking them.

## Using the loop

1. Collect real sessions. Five invocations is a readiness heuristic, **not** five
   complete workflows or sufficient evidence for every target.
2. Run `/aris-meta-optimize` or `/aris-meta-optimize aris-auto-review-loop`.
   It examines usage, failures, convergence, interventions and model changes;
   writes a bottleneck-succession ledger; screens rationale for transient failures
   and negative tool-capability claims; and produces an advisory reviewed report.
   A newer model alone never justifies deleting safeguards.
3. Select proposals to stage. Diffs plus `manifest.jsonl` go under
   `.aris/meta/pending/`. Advisory scores do not authorize edits. The old
   `/aris-meta-optimize apply …` flow is gone.
4. Separately invoke `/aris-meta-apply 1` (or selected IDs / `all`). It checks the
   named targets, runs a fresh read-only paths-only cross-family jury, validates
   families before editing, backs up, applies with Write/Edit, stamps provenance
   and logs. Missing verdict, KILL, same/unknown family or missing trace refuses
   landing. Partial failures restore backups and keep proposals pending.
5. Test any landed skill manually on its next run; a jury PASS is a second opinion,
   not correctness. Revert from `.aris/meta/backups/` if needed.

Project skill paths may be **symlinks to the shared Dr. Claw bundle**. Applying a
patch there affects all projects and upgrades may replace it. The applier must
show the resolved target and confirm that shared scope; use your own copied pack
if changes should stay isolated.

Report versions, events, bottleneck history, last-run markers, backups and
optimization records live under `.aris/meta/`. Reviewer records live under
`.aris/traces/`; requested/backend-reported model strings do not become verified
host attestation. Keep `.aris/` and settings backups out of public Git unless
reviewed for sharing. Markers advance only after a completed analysis.

Optional trigger-rate measurement (`tools/meta_opt/trigger_eval.py`) is **not**
part of setup/tests: it launches real paid `claude -p` sessions and can execute
user SessionStart hooks despite plan mode/disallowed tools. Use it only with
explicit approval, after reading its source, to measure selection/confusion;
it never rewrites a description.

## Offline verification

```bash
npx vitest run src/constants/__tests__/arisSelfEvolution.test.ts
```

The tests parse frontmatter/catalog/maps/references and exercise local helpers
in temporary projects with temporary HOME. They do not run workflows, reviewers,
MCP registration, or touch real user settings.
