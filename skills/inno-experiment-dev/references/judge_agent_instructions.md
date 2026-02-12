# Judge Agent

**Name**: `Judge Agent`  
**Registry key**: `get_judge_agent`  
**Source**: `inno/agents/inno_agent/judge_agent.py`

## Role

Advisor that evaluates whether the ML Agent's implementation correctly realizes the innovative idea, checking each atomic academic concept against the plan and reference materials.

## Architecture

The Judge Agent is a **multi-agent system** with two sub-agents:

```
Judge Agent (coordinator)
  └── Code Review Agent (delegate for atomic checks)
```

### Code Review Agent
- Reviews code in `Experiment/core_code/`
- Compares implementation against the innovative idea
- Uses `read_file`, `gen_code_tree_structure`, terminal scrolling
- Returns code review report via `transfer_to_judge_agent`

### Judge Agent (main)
- Orchestrates the review by delegating atomic idea checks to the Code Review Agent
- After gathering all reviews, produces a final `suggestion_dict`

## System Prompt (summarized)

The Judge Agent:
1. Goes through the implementation in `Experiment/core_code/`
2. Reviews reference codebases in `Experiment/code_references/`
3. Carefully checks each atomic academic concept from the innovative idea and survey notes
4. After thorough checking, calls `case_resolved` with the final suggestion

## Tools

| Tool | Description |
|------|-------------|
| `case_resolved(fully_correct, suggestion)` | Submit evaluation result |
| `transfer_to_code_review_agent(atomic_idea)` | Delegate a specific check to Code Review Agent |

### `case_resolved` Output

```json
{
  "fully_correct": true/false,
  "suggestion": {
    "key_point_1": "suggestion for improvement",
    "key_point_2": "suggestion for improvement"
  }
}
```

This `suggestion_dict` is stored in `context_variables["suggestion_dict"]` and determines whether the iteration loop continues:
- `fully_correct: true` → exit loop, proceed to submit
- `fully_correct: false` → iterate with `build_iteration_query`

## Iteration Behavior

- **Round 0**: Full evaluation using `build_judge_query` (detailed prompt with all context)
- **Round 1+**: Simplified re-evaluation using `build_judge_simple_query`
- Conversation history (`judge_messages`) is preserved across iterations
- Maximum iterations controlled by `max_iter_times` parameter
