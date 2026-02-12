---
name: inno-experiment-analysis
description: Analyzes experimental results, draws charts, gives code suggestions, implements refinements, and runs further experiments. Use after inno-experiment-dev.
---

# Inno Experiment Analysis (Analysis and Refinement)

Takes the refinement loop from the former `inno-experiment-submit-refine`. Mirrors the analysis and refinement portions of `_submit_and_refine_experiments` (945-977) in `run_infer_idea_ours.py`.

## Inputs

| Variable | Source | Description |
|----------|--------|-------------|
| `survey_res` | inno-idea-generation or user | The finalized selected idea |
| `updated_prepare_res` | inno-prepare-resources | JSON with reference codebases and paths |
| `plan_res` | inno-experiment-dev Phase 1 | Detailed implementation plan |
| `submit_res` | inno-experiment-dev Phase 3 | Submission result with statistical outputs |
| `judge_messages` | inno-experiment-dev | Full conversation thread to continue |
| `core_code_path` | pipeline config | Path to `Experiment/core_code/` |
| `analysis_path` | pipeline config | Path to `Experiment/analysis/` |
| `code_references_path` | pipeline config | Path to `Experiment/code_references/` |
| `exp_iter_times` | pipeline config | Number of analysis-refinement iterations (default from `DEFAULT_EXP_ITER_TIMES`) |
| `context_variables` | shared state | Mutable dict carrying state across agents |

Plan mode additionally uses `ideas` and plan-specific prompt variants (`build_exp_planner_query_for_plan`).

## Outputs

| Variable | Description |
|----------|-------------|
| `experiment_report` | List of `{analysis_report, further_plan}` dicts (one per iteration) |
| `refine_res` | Final refinement result from the ML Agent |
| `context_variables` | Updated with `experiment_report` list |

## Cache Artifacts

| File | Agent | Content |
|------|-------|---------|
| `Experiment/analysis/logs/experiment_analysis_agent_iter_refine_{N}.json` | Experiment Analysis Agent | Analysis messages with `experiment_report` in context_variables |
| `Experiment/analysis/logs/machine_learning_agent_iter_refine_{N}.json` | ML Agent | Refinement implementation messages |

Where `{N}` is the iteration number (1, 2, ...).

## Instructions

### Analysis-Refinement Loop

For each iteration i in 1..`exp_iter_times`:

1. **Analyze results**: Build `exp_planner_query = build_exp_planner_query(survey_res, prepare_res, plan_res, submit_res)` (see `prompts/build_exp_planner_query.md`). Plan mode uses `build_exp_planner_query_for_plan`.

2. **Call Experiment Analysis Agent**: Append `exp_planner_query` to `judge_messages` as user message. Call the agent with `iter_times="refine_{i}"`.
   - The agent reviews experiment outputs (logs, metrics, saved models, images)
   - Reviews reference codebases and papers for comparison
   - Creates visualizations (loss curves, metric comparisons, confusion matrices, etc.) saved to `Experiment/analysis/`
   - Calls `case_resolved(analysis_report=..., further_plan=...)` which appends to `context_variables["experiment_report"]`
   - See `references/exp_analyser_instructions.md` for agent details

3. **Extract results**: Read `context_variables["experiment_report"][-1]` to get:
   - `analysis_report`: detailed findings about the experiment
   - `further_plan`: dict mapping experiment names to descriptions (e.g., `{"A1_fix_embedding": "Fix embedding dimension mismatch", "A2_add_scheduler": "Add learning rate scheduler"}`)
   - If `experiment_report` is missing, the analysis agent failed to call `case_resolved` -- raise an error.

4. **Build refine query**: `refine_query = build_refine_query(survey_res, prepare_res, plan_res, submit_res, analysis_report, core_code_path)` (see `prompts/build_refine_query.md`).

5. **Call ML Agent for refinement**: Append `refine_query` to `judge_messages` as user message. Call **ML Agent** with `iter_times="refine_{i}"`.
   - The agent modifies existing code in `Experiment/core_code/`
   - Runs further experiments as specified in the further plan
   - Ensures all training scripts save model checkpoints
   - Calls `case_resolved` or `case_not_resolved`
   - Update `refine_res = judge_messages[-1]["content"]`
   - Update `submit_res = refine_res` for next iteration

6. Surface `experiment_report` and `refine_res` to the user/UI.

### Capabilities

The Experiment Analysis Agent can:
- **Analyze results**: Review training logs, metrics, model outputs
- **Draw charts**: Create loss curves, accuracy plots, confusion matrices, t-SNE visualizations, etc. using matplotlib/seaborn
- **View images**: Use the `visualizer` tool to inspect generated images, plots, and visual results
- **Read papers**: Navigate reference papers for comparison benchmarks
- **Code suggestions**: Produce actionable `further_plan` items linking back to the original idea

The ML Agent (for refinements) can:
- **Modify code**: Edit existing files in the project directory
- **Add experiments**: Create new experiment scripts
- **Run experiments**: Execute training/testing with full GPU support
- **Debug**: Use the anti-deadloop system for persistent errors

## Tool Mappings

| Original Tool | Claude Code Equivalent |
|---------------|----------------------|
| `gen_code_tree_structure` | `tree -L 3 <path>` |
| `read_file` | Read tool / `cat` |
| `open_local_file` | Read tool (for markdown/text files) |
| `page_up/down_markdown` | Read with offset/limit |
| `find_on_page_ctrl_f` / `find_next` | Grep tool |
| `question_answer_on_whole_page` | Agent reads and reasons about content |
| `visualizer` | Agent describes image content |
| `case_resolved(analysis_report, further_plan)` | Agent returns structured analysis |
| ML Agent tools | Same mappings as in inno-experiment-dev |

## Checklist

- [ ] `exp_planner_query` built with correct variant for Idea vs Plan mode.
- [ ] Experiment Analysis Agent called; `experiment_report` populated in `context_variables`.
- [ ] `analysis_report` and `further_plan` extracted from latest `experiment_report` entry.
- [ ] `refine_query` built and ML Agent called for refinement.
- [ ] Model checkpoints saved after each refinement training run.
- [ ] Cache artifacts saved to `Experiment/analysis/logs/`: `experiment_analysis_agent_iter_refine_{N}.json`, `machine_learning_agent_iter_refine_{N}.json`.
- [ ] Results surfaced to user/UI.
- [ ] Loop repeats for `exp_iter_times` iterations.

## References

- `run_infer_idea_ours.py`: `_submit_and_refine_experiments` refinement loop (945-977)
- `prompt_templates.py`: `build_exp_planner_query` (530-560), `build_refine_query` (563-598)
- Agent definition: `exp_analyser.py` in `inno/agents/inno_agent/`
