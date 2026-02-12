# build_code_survey_query

Constructs the prompt for the Code Survey Agent to conduct a comprehensive code survey.

## Parameters

| Parameter         | Type   | Description |
|-------------------|--------|-------------|
| `survey_res`      | string | The finalized selected idea (from `selected_idea.txt` or `final_selected_idea_data`) |
| `download_res`    | string | Result log from downloading arXiv paper sources |
| `extra_repo_info` | string | (Optional) Newly acquired repositories info from Phase A. Empty string if none |

## Building `extra_repo_info`

If Phase A (repo acquisition) produced any cloned repos, format them as:

```
[NEWLY ACQUIRED REPOSITORIES]
The following repositories were just cloned for you to support the idea:
- Name: <name1> | Path: <path1>
- Name: <name2> | Path: <path2>
```

If no extra repos were acquired, this parameter is an empty string.

## Template

```
I have an innovative idea related to machine learning:
{survey_res}

I have carefully gone through these papers' github repositories and found download some of them in my local machine, in the directory `Experiment/code_references/`, use `ls`, `tree`, and `find` to navigate the directory.
And I have also downloaded the corresponding paper (LaTeX sources, markdown, txt), with the following information:
{download_res}

{new_repo_text}

Your task is to carefully understand the innovative idea, and thoroughly review codebases and generate a comprehensive implementation report for the innovative idea. You can NOT stop to review the codebases until you have get all academic concepts in the innovative idea.

Note that the code implementation should be as complete as possible.
```

Where `{new_repo_text}` is the `extra_repo_info` block (or empty).

## Usage

This is sent as the **first message** to the Code Survey Agent. The agent will:
1. List all repos in `Experiment/code_references/` using `tree` or `ls`
2. For each innovative module in the idea, locate matching implementation files
3. Extract code snippets, function signatures, and mathematical formula-to-code mappings
4. Generate a comprehensive implementation report

## Output

The agent produces a comprehensive implementation report (`model_survey`) containing:
- Academic definitions mapped to code implementations
- Code snippets with file paths and function signatures
- Mathematical formula-to-code correspondences
- Key classes, functions, and their relationships

This report is stored as `context_variables["model_survey"]` and consumed by `inno-experiment-dev`.
