#!/usr/bin/env bash
# Explicit write action: submits three jobs. Run only after reviewing scripts.
set -Eeuo pipefail

for script in preprocess.slurm train.slurm evaluate.slurm; do
  [[ -r "$script" ]] || { echo "missing $script" >&2; exit 2; }
done

prep=$(sbatch --parsable preprocess.slurm)
train=$(sbatch --parsable --dependency="afterok:${prep}" train.slurm)
eval_job=$(sbatch --parsable --dependency="afterok:${train}" evaluate.slurm)
printf 'preprocess=%s train=%s evaluate=%s\n' "$prep" "$train" "$eval_job"
