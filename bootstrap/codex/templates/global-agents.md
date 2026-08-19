## Dr. Claw portable baseline

- For research, ML engineering, literature, experiment, paper, data, training, evaluation, or scientific-delivery work, use `$drclaw-skill-library` when the user did not name a more specific skill. Query the compact library and read only the selected procedures; never bulk-read the full skill tree.
- On NCSA Delta, use `$ncsa-delta` for SSH/Codex setup, accounts, quota, storage, Slurm, queues, GPU jobs, monitoring, and recovery. Never run production computation on a login node, invent live cluster facts, or mutate a queued job without explicit authorization for the concrete JobID.
- Treat authentication as target-host state. Never copy, print, log, or commit Codex auth data, passwords, Duo information, device codes, connector tokens, SSH private keys, `.env` secrets, or session databases.
- Keep the Dr. Claw repository checkout at an immutable tag or commit for reproducible work. Run `bootstrap/codex/bootstrap.sh doctor` after moving it or updating skills.
- Repository and nested `AGENTS.md` files may add more specific rules. The closest applicable project guidance wins.
