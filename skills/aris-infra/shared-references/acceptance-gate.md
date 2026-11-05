# Acceptance gate (Workflow M extract)

**A loop can DRIVE; it cannot ACQUIT itself.**

Upstream distinguishes objective completion (Type A: exit status, files exist,
counts) from quality/correctness acceptance (Type B: the patch improves the
harness). Same-family bookkeeping and rejection are fine; accepting a skill
patch needs a fresh **different-family** verdict at landing plus human selection.
Several agreeing same-family agents are not cross-model independence.

The producer's advisory screen, a clean capture-filter exit, and a provenance
receipt each answer different questions. None alone authorizes a corpus edit.
Only [aris-meta-apply](../../aris-meta-apply/SKILL.md), explicitly invoked by the
human for named pending patches, may execute the landing procedure.

See [reviewer-independence.md](reviewer-independence.md) (primary files, not
executor summaries), [reviewer-routing.md](reviewer-routing.md) (capabilities and
fail-closed routing), and [skill-governance.md](skill-governance.md) (receipts).
A PASS is a heterogeneous second opinion, not external ground truth.
