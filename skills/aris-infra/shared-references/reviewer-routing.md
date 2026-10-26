# Workflow M reviewer routing (Dr. Claw)

Scoped from upstream at the commit recorded in [provenance](../UPSTREAM.md).
This pack does not claim the upstream HTTP fallback, Oracle, Copilot or other
reviewer overlays are installed. Generic `llm-chat/chat` is **not** a drop-in
landing jury: a remote chat model cannot read local paths.

## Default pair and capability gates

The bundle includes the [codex-exec bridge](../mcp-servers/codex-exec/README.md),
which serves `mcp__codex__codex` and `mcp__codex__codex-reply` over `codex exec`.
It requires a working, authenticated Codex CLI. Installing it or selecting a
model does not prove account/model/effort availability.

| Call | Initial model | Initial effort |
|---|---|---|
| meta-optimize advisory screen | `gpt-6-astra` | `xhigh` |
| meta-apply fresh landing jury | `gpt-6-astra` | `ultra` |

Pin both model and `config.model_reasoning_effort` on every new thread. Pass
`sandbox: read-only` and the actual project `cwd` for **both** calls. Do not use
full-access, bypass approval/sandbox flags, or grant write access for a reviewer.
The bridge supports other modes for other uses; this workflow never selects them.
CLI sandbox enforcement depends on the installed CLI and host OS; the Markdown
instructions and bridge alone are not a new sandbox.

For a new thread with **no usable thread returned**:

1. Only an explicit unsupported-effort error permits `ultra` → `xhigh` on the
   same model.
2. Only an explicit unknown/unavailable-model error permits `gpt-6-astra` →
   `gpt-5.6-sol` + `xhigh` → `gpt-5.5` + `xhigh`.
3. Never downgrade/retry on timeout, authentication, rate-limit, transport,
   sandbox/tool, server, context-length, malformed-request or parse errors.
   An ambiguous response may mean a paid review already executed.
4. Never use effort below `xhigh`. `gpt-5.4` is an explicit user override only.
   An explicit model override disables the automatic model chain.
5. Trace every attempt and actual successful pair; if none succeeds, emit
   `REVIEW_UNAVAILABLE` and leave pending patches untouched. A diagnostic error
   is not a substantive PASS or KILL.

A reply retains its original thread's model/effort/sandbox/cwd; send only
`threadId` + prompt. **Landing always uses a fresh thread**, never a reply.

## Identity before verdict

Use the actual producer model from the run and the model that actually reviewed
it. Run `provenance.py check` **before mutation**, not merely when stamping.
Same-family or unknown identity refuses landing. Claude → Codex can qualify;
Codex → Codex cannot. Do not assume Claude based on the UI/provider name.

If a different-family jury with file access and the required capability is not
available, stop; do not relabel a model, claim an ordinary chat call is a jury,
or downgrade to self-review. A deterministic checker can verify mechanical
facts; it is not a substitute for semantic review of a skill change. A PASS
is a second opinion, not ground truth or proof that the change is correct.
