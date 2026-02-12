# Research Flow Integration (VibeLab)

Defines the **UI entry**, **backend API**, and **maturity judgment** for the Start Research pipeline so the correct branch (plan vs idea) runs.

## UI entry: Start Research

- **Single entry**: One button or command, e.g. **"Start Research"**, in the VibeLab UI that kicks off the Research pipeline.
- **User input** (one of):
  1. **Full plan text**: User pastes or uploads a complete implementation plan (method, data, training, evaluation). → Treated as **plan-level**; idea fixed; no idea generation.
  2. **Background / task only**: User provides task description, problem statement, or references without a full plan. → Treated as **idea-level**; system will generate ideas.
  3. **Instance JSON**: User uploads or selects a file with `source_papers` and either `task1` (full plan) or `task2` (background). → Map `task1` → plan, `task2` (or no task1) → idea.

The UI should send the chosen input (and type hint if available) to the backend so the backend can run maturity judgment and the right branch.

## Backend API

- **Recommended endpoint**: `POST /api/research/start` (or equivalent under existing agent/codex routes).
- **Request body** (example):
  - `inputType`: `"plan"` | `"idea"` | `"instance"`
  - `payload`: string (plan text, idea/background text) or object (instance JSON with `source_papers`, `task1`, `task2`, `url`, etc.)
  - Optional: `category`, `max_iter_times`, `instance_path` (if payload is a path).
- **Response**: e.g. `{ runId, status, branch: "plan"|"idea" }` and/or streamed progress (prepare → … → submit/refine).
- **Behavior**: Backend receives payload → runs **maturity judgment** (see below) → runs **plan branch** or **idea branch** (by invoking the Python pipeline or by orchestrating the seven stage skills). Canonical implementation: call `run_infer.py` with `--mode plan` and `ideas=task1`, or `run_infer_idea_ours.py` for idea mode; or replicate the flow in-process using the same prompt/agent calls referenced in the skills.

## Maturity judgment (plan vs idea)

- **Purpose**: Decide whether to run the **plan branch** (no idea generation; user plan = `ideas`) or the **idea branch** (run idea-generation and full 7 steps).
- **Options**:
  1. **LLM-based**: Single short prompt; input = user text or `task1`/`task2`; output = `plan` or `idea` (and optional confidence). Backend uses this to set branch.
  2. **Heuristic**: If instance has `task1` with substantial length/structure → plan; else → idea. If user explicitly chose "I have a full plan" in UI → plan.
- **Where to implement**: In the backend handler for `POST /api/research/start`, or in a small service that the meta skill **inno-research-orchestrator** describes. The meta skill’s SKILL.md documents the same logic so an agent can replicate it when running from chat.

## Flow after judgment

- **Plan**: prepare (with ideas) → inno-code-survey (Plan mode: survey on ideas/papers) → inno-experiment-dev (plan + implement + judge + submit) → inno-experiment-analysis (analyse + refine) → inno-paper-writing (optional). Use `run_infer.py` with `mode=plan` and `ideas=task1` or equivalent.
- **Idea**: prepare → idea-generation → code-survey (Phase A: repo acquisition + Phase B: code survey) → inno-experiment-dev (plan + implement + judge + submit) → inno-experiment-analysis (analyse + refine) → inno-paper-writing (optional). Use `run_infer_idea_ours.py` or equivalent.

Skills in `skills/` (VibeLab repo root) document inputs, outputs, and Python references for each step; the backend can call the existing Python entry points or re-use the same prompt/agent logic in another runtime. When a project is created, VibeLab symlinks these into the project's `.claude/skills/` so Claude can discover them.
