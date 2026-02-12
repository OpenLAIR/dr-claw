# build_submit_query

Constructs the prompt for the ML Agent to submit the final experiment run.

## Parameters

| Parameter        | Type   | Description |
|------------------|--------|-------------|
| `survey_res`     | string | The finalized selected idea |
| `ml_dev_res`     | string | The ML Agent's final implementation result |
| `judge_res`      | string | The Judge Agent's last feedback |
| `core_code_path` | string | Path to `Experiment/core_code/` |

## Template

```
You are given an innovative idea:
{survey_res}
And your last implementation of the project:
{ml_dev_res}
The suggestion about your last implementation:
{judge_res}
You have run out the maximum iteration times to implement the idea by running the
script `run_training_testing.py` with TWO epochs of training and testing on ONE
ACTUAL dataset.
Your task is to submit the code to the environment by running the script
`run_training_testing.py` with APPROPRIATE epochs of training and testing on THIS
ACTUAL dataset in order to get some statistical results. You must MODIFY the epochs
in the script `run_training_testing.py` rather than use the 2 epochs.

[IMPORTANT CONSTRAINTS]:
1. The maximum number of epochs MUST NOT exceed 10 epochs. Set epochs to a value
   between 3 and 10 (inclusive) based on dataset size and computational feasibility.
2. In this stage, you are NOT allowed to modify the existing code in the script
   `run_training_testing.py` except for the epochs number!
3. **CRITICAL**: Ensure that the training script saves the final model weights/checkpoint
   at the end of training. If the existing code does not save checkpoints, you MUST add
   checkpoint saving functionality before running the script. The final model should be
   saved to `Experiment/core_code/checkpoints/model_final.pth`.

Note that if your last implementation is not runnable, you should finalize the
submission with `case_not_resolved` function. But you can temporarily ignore the
judgement of the `Judge Agent` which contains the suggestions about the implementation.
After you get the result, you should return the result with your analysis and
suggestions about the implementation with `case_resolved` function.
```

## Usage

This prompt is appended to the `judge_messages` thread. The ML Agent:
1. Adjusts epochs in `run_training_testing.py` (3–10)
2. Runs the full experiment
3. Ensures checkpoints are saved
4. Calls `case_resolved` with the results and analysis, or `case_not_resolved` if the implementation is broken

The result (`submit_res`) is passed to `inno-experiment-analysis` for further analysis.
