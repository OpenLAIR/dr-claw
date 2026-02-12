# build_repo_acquisition_query

Constructs the prompt for the Repo Acquisition Agent to find and clone missing code repositories.

## Parameters

| Parameter      | Type   | Description |
|----------------|--------|-------------|
| `survey_res`   | string | The finalized selected idea (from `selected_idea.txt` or `final_selected_idea_data`) |
| `download_res` | string | Result log from downloading arXiv paper sources (from `inno-prepare-resources`) |

## Template

```
We have a finalized refined idea that requires implementation:
{survey_res}

Current resources in Experiment/code_references/:
{download_res}

### MISSION
Your mission is to find implementation references for the **NOVEL** or **SPECIALIZED** parts of the idea that are likely MISSING in the standard repos above.

### EXECUTION STEPS
1. Identify 2-3 specific technical gaps.
2. Construct short, keyword-based queries for GitHub.
3. Clone the best matches.
4. **Verify**: Check their READMEs. Ensure they are actual PyTorch implementations, not just empty shells.

Do not be lazy. If you don't find exact matches, find the closest alternatives that we can adapt.
```

## Usage

This is sent as the **first message** to the Repo Acquisition Agent. The agent will:
1. Analyze the selected idea to identify technical components not yet available in `Experiment/code_references/`
2. Use the "Cascade" search strategy (Level 1: Specific -> Level 2: Broad -> Level 3: Atomic) with 6 queries per gap
3. Clone candidate repos into `Experiment/code_references/`
4. Verify each clone by reading its README.md

## Post-processing

After the agent completes, extract all repo acquisition markers from the conversation:

1. Parse `[REPO_ACQUIRED] name=<name>; path=<path>` patterns from agent messages
2. Filter: only keep entries where `path` contains `code_references`
3. Merge with any `context_variables["acquired_code_repos"]` entries
4. Build `acquired_repos_dict = { name: path }` for each verified repo
5. Set `context_variables["acquired_code_repos"] = acquired_repos_dict`
6. Build `extra_repo_info` string:
   ```
   - Name: <name1> | Path: <path1>
   - Name: <name2> | Path: <path2>
   ```
