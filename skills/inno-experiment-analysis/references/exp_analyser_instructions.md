# Experiment Analysis Agent

**Name**: `Experiment Analysis Agent`
**Registry key**: `get_exp_analyser_agent`
**Source**: `inno/agents/inno_agent/exp_analyser.py`

## Role

Analyzes experimental results conducted by the ML Agent, reviews reference codebases and papers, and creates a detailed analysis report with a further experiment plan.

## System Prompt (summarized)

The agent is given:
- An innovative idea
- Experimental results from `Experiment/core_code/`
- Reference codebases and papers in `Experiment/code_references/` and `Ideation/references/`

### Tasks
1. Analyze experimental results and produce a detailed analysis report
2. Analyze reference codebases and papers, and produce a further plan for the ML Agent. Further experiments may include:
   - Modify implementation to better fit the idea
   - Add experiments to prove effectiveness and superiority
   - Visualize experimental results with detailed analysis
   - Any other experiments that existing reference papers/codebases have done

## Tools

### Project and Codebase Navigation
| Tool | Description | Claude Code Equivalent |
|------|-------------|----------------------|
| `gen_code_tree_structure` | Directory tree listing | `tree -L 3 <path>` |
| `read_file` | Read code files | Read tool / `cat` |
| `terminal_page_down/up/to` | Scroll terminal output | N/A |

### Local File / Paper Navigation
| Tool | Description | Claude Code Equivalent |
|------|-------------|----------------------|
| `open_local_file` | Open and read paper files (PDF/MD) | Read tool (for markdown) |
| `page_up_markdown` / `page_down_markdown` | Navigate through pages | Read with offset/limit |
| `find_on_page_ctrl_f` / `find_next` | Search specific content | Grep tool |
| `question_answer_on_whole_page` | Ask questions about a document | Agent reads and reasons |
| `visualizer` | View images/videos from experiments | Agent describes image content |

### Completion
| Tool | Description |
|------|-------------|
| `case_resolved(analysis_report, further_plan)` | Submit analysis report and further plan |

## Output

The `case_resolved` function stores results in `context_variables["experiment_report"]` as a list. Each call appends:

```json
{
  "analysis_report": "detailed analysis string",
  "further_plan": {
    "experiment_name_1": "description of what to do",
    "experiment_name_2": "description of what to do"
  }
}
```

The `analysis_report` and `further_plan` are then used by the `build_refine_query` prompt to instruct the ML Agent on what refinements to make.

## Important Notes

- The agent must CAREFULLY and COMPREHENSIVELY analyze results before calling `case_resolved`
- It should review both the project code outputs AND reference papers/codebases for comparison
- The `further_plan` should be actionable and specific enough for the ML Agent to implement
