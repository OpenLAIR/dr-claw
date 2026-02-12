# build_refine_query

Constructs the prompt for the ML Agent to refine experiments based on the analysis report.

## Parameters

| Parameter         | Type   | Description |
|-------------------|--------|-------------|
| `survey_res`      | string | The finalized selected idea |
| `prepare_res`     | string | JSON with reference codebases and paths |
| `plan_res`        | string | Detailed implementation plan |
| `submit_res`      | string | Submission result from the ML Agent |
| `analysis_report` | string | The analysis report from the Experiment Analysis Agent |
| `core_code_path`  | string | Path to `Experiment/core_code/` |

## Template

```
You are given an innovative idea:
{survey_res}
And the reference codebases chosen by the `Prepare Agent`:
{prepare_res}
And the detailed coding plan:
{plan_res}
You have conducted the experiments and get the experimental results:
{submit_res}
And a detailed analysis report about the results are given by the
`Experiment Planner Agent`:
{analysis_report}
Your task is to refine the experimental results according to the analysis report
by modifying existing code in the directory `Experiment/core_code/`. You should
NOT stop until every experiment is done with ACTUAL results. If you encounter Out of
Memory problem, you should try another specific GPU device. If you encounter ANY other
problems, you should try your best to solve the problem by yourself.

Note that you should fully utilize the existing code in the directory
`Experiment/core_code/` as much as possible. If you want to add more experiments,
you should add the python script in the directory `Experiment/core_code/`, like
`run_training_testing.py`. Select and output the important results during the experiments
into the log files, do NOT output them all in the terminal. Charts and visualizations
should be saved to `Experiment/analysis/`.

[CRITICAL - Model Checkpoint Saving]:
- MUST ensure all training scripts save final model weights.
- Save final checkpoint to `Experiment/core_code/checkpoints/model_final.pth`.
- If you modify existing training code, ensure checkpoint saving functionality is
  preserved or added.
```

## Usage

This prompt is appended to `judge_messages`. The ML Agent:
1. Reviews the analysis report and further plan
2. Modifies existing code in `Experiment/core_code/`
3. Runs further experiments as specified in the further plan
4. Ensures all training scripts save model checkpoints
5. Returns refined results via `case_resolved` or `case_not_resolved`

The result (`refine_res`) updates `submit_res` for subsequent analysis iterations.
