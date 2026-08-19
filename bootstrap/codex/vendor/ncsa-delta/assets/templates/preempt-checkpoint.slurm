#!/usr/bin/env bash
# NCSA Delta — checkpointable preemptible GPU template.
# Cheap preempt partitions are appropriate only after recovery has been tested.
# The application handles Slurm signals directly; a request file remains for manual testing.
# Replace CHANGE_ME values, create logs, and pass a live-verified compatible
# preempt GPU partition only at submission with sbatch --partition="$delta_partition" ...

# Portable starting point only; checkpointing does not reduce OOM risk.
#SBATCH --job-name=CHANGE_ME_preempt
#SBATCH --account=CHANGE_ME_GPU_ACCOUNT
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --gpus-per-node=1
#SBATCH --mem=58G
#SBATCH --time=12:00:00
#SBATCH --requeue
#SBATCH --signal=USR1@300
#SBATCH --constraint="projects&work"
#SBATCH --output=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.err

set -Eeuo pipefail
umask 027

readonly PROJECT="CHANGE_ME_PROJECT"
readonly PROJECT_ROOT="/projects/${PROJECT}/${USER}"
readonly WORK_ROOT="/work/hdd/${PROJECT}/${USER}"
readonly CODE_DIR="${PROJECT_ROOT}/code/CHANGE_ME_REPOSITORY"
readonly SKILL_ROOT="${PROJECT_ROOT}/code/ncsa-delta"
readonly RUN_ROOT="${WORK_ROOT}/runs/${SLURM_JOB_NAME}"
readonly RUN_DIR="${RUN_ROOT}/${SLURM_JOB_ID}"
readonly CHECKPOINT_DIR="${RUN_DIR}/checkpoints"
readonly CONTROL_DIR="${RUN_DIR}/control"
readonly CHECKPOINT_REQUEST="${CONTROL_DIR}/checkpoint.requested"

mkdir -p "$RUN_DIR" "$CHECKPOINT_DIR" "$CONTROL_DIR"
rm -f "$CHECKPOINT_REQUEST"
cd "$CODE_DIR"

module reset
# source CHANGE_ME_PORTABLE_ENV_LOADER
module list 2>&1

export OMP_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export PYTHONUNBUFFERED=1

printf 'start=%s job=%s restart_count=%s host=%s\n' \
  "$(date -Is)" "$SLURM_JOB_ID" "${SLURM_RESTART_COUNT:-0}" "$(hostname -f)"

# No B: prefix above: default sbatch signalling reaches job steps, including this
# Python process. B: is only for a batch shell that safely forwards the signal.
# Replace the demo with the real trainer after implementing the same guarantees:
# atomic checkpoint write, latest-complete discovery, config compatibility check,
# direct SIGTERM/SIGUSR1 handling, and idempotent restart from script line 1.
srun --unbuffered --cpu-bind=cores --kill-on-bad-exit=1 \
  python -u "$SKILL_ROOT/assets/examples/checkpoint_signal.py" \
    --checkpoint-dir "$CHECKPOINT_DIR" \
    --request-file "$CHECKPOINT_REQUEST" \
    --steps 1000000 \
    --seconds-per-step 1

printf 'end=%s\n' "$(date -Is)"
