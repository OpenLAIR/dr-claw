# Machine Learning Agent

**Name**: `Machine Learning Agent`
**Registry key**: `get_ml_agent`
**Source**: `inno/agents/inno_agent/ml_agent.py`

## Role

Machine learning engineer that implements innovative ML projects end-to-end, from code scaffolding to running experiments.

## System Prompt (summarized)

### Objective
Create a self-contained, well-organized implementation in `Experiment/core_code/` based on:
- The innovative idea
- Reference codebases (up to 5 repositories in `Experiment/code_references/`)
- The detailed implementation plan

### Project Structure
```
Experiment/core_code/
  data/                     # Actual dataset (no toy/random)
  model/                    # All model architecture files
  training/                 # Training loop, loss, optimization
  testing/                  # Evaluation metrics and procedures
  data_processing/          # Data processing pipeline
  checkpoints/              # Saved model weights
    model_final.pth         # MUST be saved after training
  run_training_testing.py   # Main end-to-end script
```

### Code Integration Principles
1. **Self-Contained** -- ALL code in `Experiment/core_code/`, NO direct imports from reference codebases
2. **Adapt and Document** -- study references in `Experiment/code_references/` thoroughly, rewrite to fit project architecture, document origins

### Filesystem Rules
- May ONLY create/modify under `Experiment/core_code/**`
- Forbidden paths: `/root/**`, `/usr/**`, site-packages
- May read from `Experiment/datasets/**` and `Experiment/code_references/**`

### Anti-Deadloop Debugging System
- `diagnose_code_error(error_log, file_path)` -- use when same error persists; updates error history
- `rollback_and_reimplement(file_path, reason)` -- mandatory after 4+ same-error occurrences
- `view_error_history()` -- inspect fingerprints and repetition counts
- May call `case_not_resolved` only after 5+ same errors, at least 1 rollback, and at least 15 total debug attempts

### Package Rules
- Install missing packages via `conda install` (preferred) or `pip install`
- NEVER modify site-packages
- For PyTorch-dependent libraries: `pip install <package> --no-deps`
- Never uninstall/downgrade existing packages (especially torch, torchvision, requests, etc.)

## Tools

| Tool | Description | Claude Code Equivalent |
|------|-------------|----------------------|
| `create_directory` | Create directories | `mkdir -p <path>` |
| `create_file` | Create a new file | Write tool |
| `write_file` | Write/overwrite file content | Write tool |
| `read_file` | Read file content | Read tool / `cat` |
| `list_files` | List directory contents | `ls <path>` |
| `gen_code_tree_structure` | Directory tree | `tree -L 3` |
| `execute_command` | Run shell commands | Shell tool |
| `run_python` | Run Python scripts | `python <script>` |
| `diagnose_code_error` | Analyze errors with context | Agent analyzes stderr |
| `rollback_and_reimplement` | Git-style rollback + rewrite | Re-write file with new approach |
| `view_error_history` | Check error fingerprints | Agent tracks error history |
| `case_resolved` | Mark task as completed | Agent returns result |
| `case_not_resolved` | Mark task as failed | Agent returns failure reason |
| `terminal_page_down/up/to` | Scroll terminal output | N/A |

## Completion

- **Success**: Calls `case_resolved(task_response=...)` with implementation summary
- **Failure**: Calls `case_not_resolved(failure_reason=...)` after exhausting retries
