# Templates

Ready-to-use templates for each ARIS workflow. Copy, fill in your content, and run the corresponding skill.

### Workflow Input Templates

| Template | For Workflow | What to do |
|----------|-------------|------------|
| [RESEARCH_BRIEF_TEMPLATE.md](RESEARCH_BRIEF_TEMPLATE.md) | Workflow 1 | Detailed research direction as document input |
| [RESEARCH_CONTRACT_TEMPLATE.md](RESEARCH_CONTRACT_TEMPLATE.md) | Workflow 1 | Define problem boundaries, non-goals, timeline before starting |
| [EXPERIMENT_PLAN_TEMPLATE.md](EXPERIMENT_PLAN_TEMPLATE.md) | Workflow 1.5 | Claim-driven experiment roadmap with run order and budgets |
| [NARRATIVE_REPORT_TEMPLATE.md](NARRATIVE_REPORT_TEMPLATE.md) | Workflow 3 | Research narrative with claims, experiments, results |
| [PAPER_PLAN_TEMPLATE.md](PAPER_PLAN_TEMPLATE.md) | Workflow 3 | Pre-made outline to skip planning phase |

### Compact Mode Templates (`— compact: true`)

| Template | Written by | Purpose |
|----------|-----------|---------|
| [IDEA_CANDIDATES_TEMPLATE.md](IDEA_CANDIDATES_TEMPLATE.md) | `/aris-idea-discovery` | Top 3-5 surviving ideas (lean, not full 12-idea report) |
| [EXPERIMENT_LOG_TEMPLATE.md](EXPERIMENT_LOG_TEMPLATE.md) | `/aris-experiment-bridge` | Structured experiment record (results + reproduction commands) |
| [FINDINGS_TEMPLATE.md](FINDINGS_TEMPLATE.md) | `/aris-auto-review-loop` | One-line-per-finding discovery log (anomalies, decisions) |

## Usage

```bash
cp templates/EXPERIMENT_PLAN_TEMPLATE.md refine-logs/EXPERIMENT_PLAN.md
# Edit with your content, then:
/aris-experiment-bridge
```
