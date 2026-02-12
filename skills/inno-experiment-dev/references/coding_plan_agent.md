# Coding Plan Agent

**Name**: `Coding Plan Agent`
**Registry key**: `get_coding_plan_agent`
**Source**: `inno/agents/inno_agent/plan_agent.py`

## Role

Machine Learning Expert that creates a detailed, actionable implementation plan bridging the innovative idea with code.

## System Prompt (summarized)

The agent operates in the project workspace and has access to:
1. The user's innovative idea
2. Reference codebases in `Experiment/code_references/` (downloaded by Prepare Agent)
3. Comprehensive notes from the Survey Agent (used as model plan)

### Workflow

1. **Code Review Phase**
   - Use `gen_code_tree_structure` to understand codebase structure
   - Use `read_file` to examine specific implementations
   - Document key implementation patterns and useful components
   - Use terminal scrolling tools for long outputs

2. **Planning Phase** -- must include:
   - **Dataset Plan** (`plan_dataset`): description, location, task definition, data loading pipeline (read, preprocess, dataloader)
   - **Model Plan**: from Survey Agent's notes -- math formula, implementation details, reference codebases/papers
   - **Training Plan** (`plan_training`): pipeline, loss functions, optimization, configurations, monitoring/logging
   - **Testing Plan** (`plan_testing`): metrics, test dataset preparation, test code

## Tools

| Tool | Description | Claude Code Equivalent |
|------|-------------|----------------------|
| `read_file` | Read code files in the container | `cat <path>` or Read tool |
| `gen_code_tree_structure` | Directory tree listing | `tree -L 3 <path>` |
| `plan_dataset` | Store dataset plan in context_variables | Claude structures in response |
| `plan_training` | Store training plan in context_variables | Claude structures in response |
| `plan_testing` | Store testing plan in context_variables | Claude structures in response |
| `case_resolved` | Merge all plans and return final plan | Agent returns merged plan |
| `terminal_page_down/up/to` | Scroll terminal output | N/A (Claude sees full output) |

## Completion

The agent calls `case_resolved` which merges `dataset_plan`, `model_survey`, `training_plan`, and `testing_plan` from `context_variables` into a single formatted plan string.

## Output Variables

After execution, `context_variables` contains:
- `dataset_plan`: string -- the dataset plan
- `training_plan`: string -- the training plan
- `testing_plan`: string -- the testing plan
- `model_survey`: string -- already present from code survey phase
