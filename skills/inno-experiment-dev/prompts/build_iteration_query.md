# build_iteration_query

Constructs the prompt for the ML Agent to refine its implementation based on Judge feedback.

## Parameters

| Parameter        | Type   | Description |
|------------------|--------|-------------|
| `survey_res`     | string | The finalized selected idea |
| `prepare_res`    | string | JSON with reference codebases and paths |
| `code_survey_res`| string | Comprehensive code survey / model survey notes |
| `plan_res`       | string | Detailed implementation plan |
| `ml_dev_res`     | string | The ML Agent's last implementation result |
| `judge_res`      | string | The Judge Agent's feedback / suggestions |
| `core_code_path` | string | Path to `Experiment/core_code/` |
| `code_references_path` | string | Path to `Experiment/code_references/` |

## Template

```
You are given an innovative idea:
{survey_res}
and the reference codebases chosen by the `Prepare Agent`:
{prepare_res}
and the model survey notes (comprehensive implementation report):
{code_survey_res}
and the detailed coding plan:
{plan_res}
And your last implementation of the project:
{ml_dev_res}
The suggestion about your last implementation:
{judge_res}
Your task is to modify the project according to the suggestion. Note that you should
MODIFY rather than create a new project! Take full advantage of the existing resources!
Still use the SAME DATASET!

[IMPORTANT] You should modify the project in the directory `Experiment/core_code/`,
rather than create a new project!

[IMPORTANT] If you meet dataset missing problem, you should download the dataset from
the reference codebases in `Experiment/code_references/`, and put the dataset in the
directory `Experiment/core_code/data`.

[IMPORTANT] You CANNOT stop until you 2 epochs of training and testing on your model
with the ACTUAL dataset.

[IMPORTANT] If you encounter ImportError while using `run_python()`, you should check
whether every `__init__.py` file is correctly implemented in the directories in
`Experiment/core_code/`!

[IMPORTANT] Carefully check whether model and its components are correctly implemented
according to the model survey notes (code_survey_res) - every atomic academic concept
must be implemented!
```

## Usage

This prompt is **appended** to the existing conversation thread (`judge_messages`).
The ML Agent modifies the project in-place, fixes issues identified by the Judge,
and re-runs training. Used in the iteration loop (rounds 1..`max_iter_times`).
