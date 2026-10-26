# Workflow M integration contract (Dr. Claw)

Scoped adaptation of upstream §2, not a full upgrade of other ARIS workflows.
Run Workflow M from the **research project root**; `.aris/` belongs there, not
in the bundled skill checkout. Keep `aris-infra` beside both meta skills when
copying or symlinking skills. Dr. Claw's project skill links do this already.

## 1. Activation

Logging is opt-in. Neither installing the pack nor loading a skill enables hooks.
Only an explicit setup command with `--apply` merges project hooks. The hook
merger defaults to preview and never replaces unrelated settings.

## 2. Canonical helper resolution

Resolve the bundle once, using the first existing directory below. An explicit
`ARIS_INFRA` points to **Dr. Claw's `skills/aris-infra`**, not an upstream checkout.
No global pointer is written or required. All paths remain quoted, including
paths with spaces. For copied installs without skill-dir metadata, use the
project skill links or set `ARIS_INFRA` to the absolute bundle directory.

```bash
ARIS_INFRA="${ARIS_INFRA:-}"
if [ ! -f "$ARIS_INFRA/tools/provenance.py" ]; then
  ARIS_INFRA=""
  for candidate in \
    "${CLAUDE_SKILL_DIR:-/nonexistent}/../aris-infra" \
    "skills/aris-infra" \
    ".claude/skills/aris-infra" \
    ".agents/skills/library/aris-infra" \
    "${HOME:-/nonexistent}/.claude/skills/aris-infra"; do
    if [ -f "$candidate/tools/provenance.py" ]; then
      ARIS_INFRA="$(cd "$candidate" && pwd)"
      break
    fi
  done
fi
[ -n "$ARIS_INFRA" ] || { echo "ARIS infra not found; set ARIS_INFRA to the bundle path." >&2; exit 1; }
PROVENANCE="$ARIS_INFRA/tools/provenance.py"
CAPTURE_FILTER="$ARIS_INFRA/tools/capture_filter.py"
TRACE_HELPER="$ARIS_INFRA/tools/save_trace.sh"
TRIGGER_EVAL="$ARIS_INFRA/tools/meta_opt/trigger_eval.py"
```

- **Gate (A):** missing provenance or capture filter blocks staging/landing;
  never invent success. `python3 "$PROVENANCE" check --author "$AUTHOR"
  --reviewer "$JURY_MODEL"` is the CLI for `assert_cross_family()`.
- **Forensic (C):** use `bash "$TRACE_HELPER" …`; if unavailable, write the
  request, full response and metadata directly per [review-tracing.md](review-tracing.md).
  Failure to preserve the landing trace blocks landing.
- **Diagnostic (E):** trigger-rate probes are optional and require a separate
  explicit user request because they launch a paid Claude session and may run
  the user's SessionStart hooks. Missing helper means skip with a warning.

The settings merger embeds absolute helper paths; it works from downstream
projects without a `tools/` directory. If the checkout moves, remove only the
old ARIS hook entries and preview/merge again.

## 3. Artifact contracts

Record events, reports, pending diffs, bottleneck history and last-run markers
under `.aris/meta/`. Record reviewer traces under `.aris/traces/`. A staged
manifest's `advisory_screen` is evidence for the human, never a landing verdict.
See [skill-governance.md](skill-governance.md) for the separate mutation gate.
