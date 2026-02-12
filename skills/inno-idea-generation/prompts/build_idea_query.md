# build_idea_query

Constructs the initial prompt for the first round of idea generation.

## Parameters

| Parameter          | Type   | Description |
|--------------------|--------|-------------|
| `task_description` | string | The ML task description (from `data_module.TASK`) |
| `references`       | string | Pre-formatted string listing all source papers |
| `prepare_res`      | string | Full response from Prepare Agent (selected repos and reasoning) |
| `download_res`     | string | Result log from downloading arXiv paper sources |

## Template

```
I have a task related to machine learning:
{task_description}
And a list of papers for your reference:
{references}

I have carefully gone through these papers' github repositories and found download some of them in my local machine, with the following information:
{prepare_res}
And I have also downloaded the corresponding paper (LaTeX sources, markdown, txt), with the following information:
{download_res}

Your task is to thoroughly review research papers and generate innovative ideas for the given task.

Note that the math formula should be as complete as possible.
```

## Usage

This is the **first message** sent to the Idea Agent. The agent will:
1. Read the referenced papers from `Ideation/references/papers/`
2. Analyze the codebase structure from `Experiment/code_references/<repo_name>/`
3. Generate an innovative idea with: Challenges, Existing Methods, Motivation, Proposed Method, Key Equations, Technical Details, Expected Outcomes
