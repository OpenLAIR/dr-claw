#!/usr/bin/env bash
# NCSA Delta — throttled one-GPU job array.
# The parameter file must contain one config path per line, with at least 100 lines.
# Start with a tiny test, e.g. sbatch --partition="$delta_partition" --array=0-2%1 job-array.slurm.
# Replace CHANGE_ME values, create logs, and pass the live-verified GPU partition only at submission.

# Portable per-task starting point only; tune from measured peaks.
#SBATCH --job-name=CHANGE_ME_array
#SBATCH --account=CHANGE_ME_GPU_ACCOUNT
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --gpus-per-node=1
#SBATCH --mem=58G
#SBATCH --time=00:30:00
#SBATCH --array=0-99%8
#SBATCH --constraint="projects&work"
#SBATCH --output=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%A_%a.out
#SBATCH --error=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%A_%a.err

set -Eeuo pipefail
umask 027

readonly PROJECT="CHANGE_ME_PROJECT"
readonly PROJECT_ROOT="/projects/${PROJECT}/${USER}"
readonly WORK_ROOT="/work/hdd/${PROJECT}/${USER}"
readonly CODE_DIR="${PROJECT_ROOT}/code/CHANGE_ME_REPOSITORY"
readonly PARAM_FILE="${PROJECT_ROOT}/experiments/CHANGE_ME_params.txt"
readonly RUN_DIR="${WORK_ROOT}/runs/${SLURM_JOB_NAME}/${SLURM_ARRAY_JOB_ID}_${SLURM_ARRAY_TASK_ID}"

[[ -r "$PARAM_FILE" ]] || { echo "Unreadable parameter file: $PARAM_FILE" >&2; exit 2; }
CONFIG=$(sed -n "$((SLURM_ARRAY_TASK_ID + 1))p" "$PARAM_FILE")
[[ -n "$CONFIG" ]] || {
  echo "No parameter at array index $SLURM_ARRAY_TASK_ID in $PARAM_FILE" >&2
  exit 2
}
[[ "$CONFIG" != \#* ]] || {
  echo "Array index $SLURM_ARRAY_TASK_ID selects a comment, not a config: $CONFIG" >&2
  exit 2
}

mkdir -p "$RUN_DIR"
cd "$CODE_DIR"

module reset
# source CHANGE_ME_PORTABLE_ENV_LOADER
module list 2>&1

export OMP_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export PYTHONUNBUFFERED=1
export HF_HOME="${WORK_ROOT}/caches/huggingface"
export TORCH_HOME="${WORK_ROOT}/caches/torch"
mkdir -p "$HF_HOME" "$TORCH_HOME"

printf 'start=%s array_job=%s task=%s config=%q host=%s\n' \
  "$(date -Is)" "$SLURM_ARRAY_JOB_ID" "$SLURM_ARRAY_TASK_ID" "$CONFIG" "$(hostname -f)"

srun --cpu-bind=cores \
  python -u run_one.py --config "$CONFIG" --output-dir "$RUN_DIR"

printf 'end=%s\n' "$(date -Is)"
