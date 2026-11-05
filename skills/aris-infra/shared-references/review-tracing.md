# Review tracing (Workflow M extract)

Trace every advisory and landing reviewer attempt, including errors and capability
fallbacks. Resolve `TRACE_HELPER` per [integration-contract.md](integration-contract.md).
Save the exact prompt, full response, actual model/effort, thread ID, backend and
fallback reason. Keep landing reviews fresh and paths-only.

```bash
bash "$TRACE_HELPER" --skill "aris-meta-apply" --purpose "patch-01-jury" --trace-mode full \
  --model "$JURY_MODEL" --effort "$JURY_EFFORT" --thread-id "$JURY_THREAD_ID" \
  --backend codex --tool mcp__codex__codex --executor "$EXECUTOR" \
  --executor-model "$AUTHOR" --requested-reviewer-model "$REQUESTED_MODEL" \
  --reported-reviewer-model "$JURY_MODEL" --fallback-reason "$FALLBACK_REASON" \
  --status ok --prompt-file "$PROMPT_FILE" --response-file "$RESPONSE_FILE"
```

Use `--skill aris-meta-optimize` for advisory calls and `--status error` for
failures. Output: `.aris/traces/<skill>/<YYYY-MM-DD>_run<NN>/` containing
`run.meta.json`, numbered `<NNN>-<purpose>.request.json`,
`<NNN>-<purpose>.response.md`, and `<NNN>-<purpose>.meta.json`.
Before landing, read back all four artifacts, check the saved request/response and
thread ID against the fresh jury call, and refuse mutation if any is missing or
does not match. A zero exit status alone is not a landing receipt.

The helper derives families, ignoring caller-supplied contradictory labels.
For Codex the executor identity is caller-declared and reviewer identity is
requested/backend-reported: a different pair is `family_relation: different`
but `independence_verified: unverified`, **not attested host proof**. Its optional
native-evidence code is bundled to satisfy the helper's dependency, not to enable
a Copilot landing route in Dr. Claw.

If the helper is missing, write those four artifacts directly: run metadata
(skill, run ID, start time, project, executor); request (tool and exact arguments);
full response; call metadata (timestamp, purpose, thread ID, model, effort, status,
fallback reason, identity sources and family relation). Never invent attestation.
An unavailable trace blocks landing. `trace: off` may suppress advisory logging
only if the user explicitly requests it; it cannot remove the landing receipt.

Traces and event logs may contain sensitive research, commands, paths and prompt
text. They are local, but sending source files to a reviewer shares those contents
with its configured service. Inspect/redact secrets before review; do not silently
upload logs. Retain the records only as long as needed and keep `.aris/` out of
published repositories unless deliberately reviewed for sharing.
