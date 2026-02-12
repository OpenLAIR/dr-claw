# build_ml_dev_query

Constructs the prompt for the ML Agent to implement the project code.

## Parameters

| Parameter             | Type   | Description |
|-----------------------|--------|-------------|
| `survey_res`          | string | The finalized selected idea |
| `prepare_res`         | string | JSON with reference codebases and paths |
| `code_survey_res`     | string | Comprehensive code survey / model survey notes |
| `plan_res`            | string | Detailed implementation plan from the Coding Plan Agent |
| `dataset_description` | string | Description of available datasets |
| `core_code_path`      | string | Path to `Experiment/core_code/` |
| `code_references_path`| string | Path to `Experiment/code_references/` |

## Template (abbreviated — full template is extensive)

```
INPUT:
You are given an innovative idea:
{survey_res}
and the reference codebases chosen by the `Prepare Agent`:
{prepare_res}
And I have conducted the comprehensive survey on the innovative idea and the papers, and give you the model survey notes:
{code_survey_res}
And the detailed implementation plan:
{plan_res}
You should carefully go through the math formula and the code implementation, and implement the innovative idea according to the plan and existing resources.

We have already selected the following datasets as experimental datasets:
{dataset_description}
Your task is to implement the innovative idea ... in the directory `Experiment/core_code/`.
You should select ONE most appropriate and lightweight dataset ... and EXACTLY run TWO epochs of training and testing on the ACTUAL dataset on the GPU device.
Note that EVERY atomic academic concept in model survey notes should be implemented in the project.

PROJECT STRUCTURE REQUIREMENTS:
1. Directory Organization
   - Data: Experiment/core_code/data/
   - Model Components: Experiment/core_code/model/
   - Training: Experiment/core_code/training/
   - Testing: Experiment/core_code/testing/
   - Data processing: Experiment/core_code/data_processing/
   - Checkpoints: Experiment/core_code/checkpoints/
   - Main Script: Experiment/core_code/run_training_testing.py

2. Complete Implementation Requirements (no placeholders)
3. Dataset and Training Requirements (actual dataset, 2 epochs, save checkpoints)
4. Integration Requirements (GPU support, error handling)
```

## Key constraints

- `Experiment/core_code/` is the project root
- Reference codebases are in `Experiment/code_references/`
- MUST use actual dataset (no toy/random data)
- MUST implement EVERY atomic academic concept from survey notes
- MUST run exactly 2 epochs of training + testing
- MUST save final model to `Experiment/core_code/checkpoints/model_final.pth`
- NO placeholder code (`pass`, `...`, `raise NotImplementedError`)

## Usage

This is the first message in the implementation phase. The ML Agent creates the full project structure, writes all code files, downloads the dataset, and runs 2 epochs.
