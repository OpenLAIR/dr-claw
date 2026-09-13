# Workflow M upstream provenance

Source: [wanshuiyin/Auto-claude-code-research-in-sleep](https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep)

Pinned revision: **`f1bd907b58f653131ebe6807c482e2554e07f9b9`**.
The exact import inventory and upstream file hashes are in
[workflow-m-sources.json](workflow-m-sources.json). The upstream [MIT license](LICENSE)
is retained in full, copyright 2026 wanshuiyin. Original helper attribution is
preserved: `trigger_eval.py` credits Anthropic Claude Science's Apache-2.0
skill-creator methodology (the [Apache-2.0 text](LICENSES/Apache-2.0.txt) is also
included); capture/provenance helpers credit MIT Hermes patterns.

## Scope

Only `meta-optimize`, `meta-apply` and their Workflow M dependencies were synced.
Other bundled ARIS skills and MCP backends retain their previous versions. The
Codex-exec bridge is included because the current CLI removed `codex mcp-server`.
Its server includes the continuation safeguards below; setup points to this
bundle, never a remote download.
No unrelated upstream skills or runtime-specific overlays were imported.

## Dr. Claw adaptations

- Namespaced both commands/paths as `aris-*`; preserved producer/applier split,
  model-delta diet, bottleneck succession, capture screening, trigger-rate evidence,
  fresh landing jury, backups and provenance receipts.
- Added `disable-model-invocation: true` to the applier. Clarified host-frontmatter
  limits, shared-symlink scope, fail-closed family checks **before** editing,
  trace-before-mutation and rollback on partial failure. No live behavior claim.
- Scoped shared contracts to Workflow M instead of pulling unrelated workflows,
  installers, overlays and hundreds of dangling dependencies. Routing preserves
  upstream explicit capability fallback and read-only reviewer requirements;
  generic chat is not described as a wired semantic landing jury.
- Added opt-in `configure.py`: preview by default, explicit atomic backed-up merge,
  preserving unrelated settings/hooks; absolute quoted bundle paths for downstream
  projects. Existing standard setup does not call it or enable logging.
- Event logger defaults to project-only; global logging requires separate opt-in.
  Failed Skill/Codex calls retain `tool_failure`. Fixed empty-data grep status
  handling in the producer. Last-run timestamps use the logger's UTC format.
- Guard commentary accurately describes its regex blacklist and lack of an
  installed integrity verifier; its pattern logic remains upstream behavior.
- Codex bridge validates thread IDs, refuses missing/corrupt continuation state,
  defaults new reviews to read-only, and reapplies the explicit/stored sandbox
  after config overrides. Client disconnect cancels active reviewer subprocesses
  with bounded TERM/KILL cleanup (POSIX includes the process group).
  Hub's actual Configure route also registers the bundled
  bridge by installation-root path, while preserving existing registrations.
- Landing trace calls explicitly require full traces and artifact readback;
  `save_trace.sh` refuses a disabled trace for `aris-meta-apply` rather than
  silently returning success without a receipt.
- Trigger sample keeps only installed skills. Actual trigger probes remain opt-in
  and are never used by the offline tests. The trace helper's native-evidence
  dependency is included but no native reviewer route is enabled by this sync.

Registration is in the shared Auto Research pack constant and skills catalog.
`stage-skill-map.json` uses its existing `skillOrigins` metadata for the maintenance
skills, deliberately **not** adding the privileged applier to an automatically
suggested research stage. Tag metadata categorizes it as ARIS infrastructure.

See [project setup and safety](../../docs/aris-self-evolution.md).
