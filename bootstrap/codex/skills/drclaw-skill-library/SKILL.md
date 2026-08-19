---
name: drclaw-skill-library
description: Route research, ML engineering, experiment, paper, literature, data, model training, evaluation, deployment, and scientific communication tasks to the best matching skill in the 170+ skill Dr. Claw library. Use when a task may benefit from Dr. Claw expertise, when no specific skill was named, or when a large installed skill set makes native Codex skill discovery ambiguous. Do not use for ordinary repository coding that has no research or ML workflow component.
---

# Route through the Dr. Claw skill library

Use the library index to select a small number of procedures without loading the full skill collection.

1. Convert the task into three to eight concrete English search terms. Keep named frameworks, file formats, or methods unchanged.
2. Run:

   ```bash
   python3 scripts/query_library.py --query "<terms>" --limit 5
   ```

   Resolve `scripts/query_library.py` relative to this `SKILL.md`. The script locates the versioned Dr. Claw repository through the skill symlink; set `DRCLAW_REPO_ROOT` only when the repository was moved.
3. Select one primary skill. Add at most two supporting skills only when their responsibilities are distinct. Prefer a task-specific Dr. Claw workflow over a generic framework guide.
4. Read the selected `SKILL.md` completely before acting. Load only references or scripts required by that procedure. Never bulk-read every `SKILL.md`.
5. If results are weak or tied, refine the query once. Then use `--all --format markdown` and filter the compact index instead of guessing.
6. If a procedure names a sub-skill, resolve it with `--resolve <name>` and read that file directly; slash commands embedded in imported skills are not assumed to be available.
7. State which skill or skills were selected in the work update. Follow their validation and output contracts.

For NCSA Delta access, Slurm, accounts, queues, storage, or GPU jobs, use `$ncsa-delta` in addition to the domain skill. Delta safety and live cluster facts take precedence over generic infrastructure advice.

Useful diagnostics:

```bash
python3 scripts/query_library.py --validate
python3 scripts/query_library.py --resolve inno-paper-writing
python3 scripts/query_library.py --resolve ncsa-delta
python3 scripts/query_library.py --all --format markdown
```
