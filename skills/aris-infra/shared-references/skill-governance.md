# Skill governance (Workflow M extract)

`aris-meta-optimize` is a corpus-read-only **producer**. It writes reports and
pending diffs, not SKILL.md files. `aris-meta-apply` is a separately human-invoked
**applier**. Producer-written `advisory_screen` never substitutes for its fresh
jury. See the [landing procedure](../../aris-meta-apply/SKILL.md).

## Provenance receipt

The bundled [provenance.py](../tools/provenance.py) records author/reviewer models,
computed families, nonempty verdict/trace ID, current content hash, timestamp,
review independence and acceptance status in `<file>.provenance.json` (or
`<skill-directory>/.provenance.json`). Strict `stamp` refuses same-family and
unknown-family model pairs. `check` must pass **before** mutation as well.

`is_auto_curatable()` rechecks receipt fields and current content hash. Future
automated curation may only touch accepted, unchanged machine-authored artifacts;
canonical human-written skills and user notes are not automatically curatable.
The explicit human-selected landing workflow may patch a named bundled skill,
but it does not authorize a background curator or unrelated user-file edits.

`stamp-provisional` records same-family review without granting acceptance. It
cannot replace an accepted receipt. Workflow M landing requires the strict
cross-family path, never provisional stamping. A string like
`deterministic:pytest` is accepted by the helper for objective facts; the helper
does not run that verifier or establish a semantic jury verdict.

## Actual enforcement limits

Frontmatter describes tool grants; `disable-model-invocation` is honored only
by hosts that implement it. Neither is an OS security boundary. The optional
corpus-write guard filters common Bash writes across all skills, not Write/Edit,
and it misses obfuscated/absolute-path writes. It is a blacklist, **not a sandbox**.
The landing procedure governs mutation; no hook cryptographically enforces the
jury or human selection. Sidecars are local process receipts and can be edited.
No pre-push integrity verifier, automatic revocation auditor or TTL is installed.

See [capture-antipatterns.md](capture-antipatterns.md) for anti-self-poisoning and
[acceptance-gate.md](acceptance-gate.md) for the quality gate.
