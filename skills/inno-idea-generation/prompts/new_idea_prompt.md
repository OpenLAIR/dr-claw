# new_idea_prompt

Follow-up message for rounds 2..N of Step 3. Appended to the same conversation
as `build_idea_query.md`, so the contract and evidence stay in context.

## Parameters

| Parameter | Source | Description |
|-----------|--------|-------------|
| `previous_ideas_text` | `raw_idea_1.txt` … `raw_idea_{N-1}.txt` | All earlier candidates, formatted as below |
| `family` | `idea_slate.md` | The next direction family, different from all earlier ones |

Format `previous_ideas_text` as:

```text
--- Candidate Idea #1 (family: <name>) ---
<full text of raw_idea_1.txt>

--- Candidate Idea #2 (family: <name>) ---
<full text of raw_idea_2.txt>
```

## Template

```text
Here are the candidate proposals so far:
{previous_ideas_text}

Now write one full proposal for a different direction family:
{family}

It must differ from every candidate above in its core mechanism, not only in
details or hyper-parameters. Follow references/idea_report_template.md, cite
only papers from the evidence base, and obey the task contract: do not change
the task, target, metric, or primary data/modality, and do not introduce new
data sources, labels, or modalities unless the contract allows it.
```

## Usage

- The answer is the full text of `raw_idea_{N}.txt`; save it, then write
  `logs/idea_generation_agent_iter_{N-1}.json`.
- If the answer turns out to share its mechanism with an earlier candidate,
  discard it, note the overlap in `idea_slate.md`, and ask again with the next
  family in the slate.
