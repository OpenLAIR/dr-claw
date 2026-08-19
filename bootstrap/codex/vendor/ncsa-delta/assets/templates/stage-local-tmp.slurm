#!/usr/bin/env bash
# NCSA Delta — stage data to node-local /tmp and copy results back safely.
# /tmp is not persistent. A SIGKILL or node loss can bypass shell traps, so the
# application must also checkpoint periodically to shared storage for valuable work.
# This template is single-node; every node has a different /tmp.
# Replace CHANGE_ME values, create logs, and pass a live-verified GPU partition
# only at submission with sbatch --partition="$delta_partition" ...

# Portable starting point only; local disk size and host memory needs are separate.
#SBATCH --job-name=CHANGE_ME_local_tmp
#SBATCH --account=CHANGE_ME_GPU_ACCOUNT
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --gpus-per-node=1
#SBATCH --mem=58G
#SBATCH --time=02:00:00
#SBATCH --signal=B:USR1@600
#SBATCH --constraint="projects&work"
#SBATCH --output=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.err

set -Eeuo pipefail
umask 027

readonly PROJECT="CHANGE_ME_PROJECT"
readonly PROJECT_ROOT="/projects/${PROJECT}/${USER}"
readonly WORK_ROOT="/work/hdd/${PROJECT}/${USER}"
readonly CODE_DIR="${PROJECT_ROOT}/code/CHANGE_ME_REPOSITORY"
readonly INPUT_SRC="${WORK_ROOT}/datasets/processed/CHANGE_ME_DATASET"
readonly SHARED_RUN_DIR="${WORK_ROOT}/runs/${SLURM_JOB_NAME}/${SLURM_JOB_ID}"
readonly LOCAL_ROOT="/tmp/${USER}/${SLURM_JOB_ID}"
readonly LOCAL_INPUT="${LOCAL_ROOT}/input"
readonly LOCAL_OUTPUT="${LOCAL_ROOT}/output"
readonly COPYBACK_MARKER="${SHARED_RUN_DIR}/_COPYBACK_COMPLETE"

mkdir -p "$LOCAL_INPUT" "$LOCAL_OUTPUT" "$SHARED_RUN_DIR"
cd "$CODE_DIR"

copy_back() {
  local reason=$1
  local mark_complete=${2:-0}
  printf 'copy_back_start=%s reason=%s complete=%s\n' \
    "$(date -Is)" "$reason" "$mark_complete" >&2
  # --partial permits a later retry. Deliberately no --delete. A signal-time
  # sync is only a best-effort snapshot while the application may still write.
  rsync -a --partial --info=stats2 "$LOCAL_OUTPUT/" "$SHARED_RUN_DIR/"
  if ((mark_complete == 1)); then
    printf '%s reason=%s source=%s\n' "$(date -Is)" "$reason" "$LOCAL_OUTPUT" \
      > "${COPYBACK_MARKER}.tmp"
    mv -f "${COPYBACK_MARKER}.tmp" "$COPYBACK_MARKER"
  fi
  printf 'copy_back_end=%s reason=%s\n' "$(date -Is)" "$reason" >&2
}

step_pid=""
normal_complete=0

signal_steps() {
  local sig=$1
  # With --signal=B:... Slurm notifies only this batch shell. Forward the
  # signal to all job steps explicitly; scancel --signal does not cancel here.
  if command -v scancel >/dev/null 2>&1; then
    scancel --signal="$sig" "$SLURM_JOB_ID" || true
  elif [[ -n "$step_pid" ]] && kill -0 "$step_pid" 2>/dev/null; then
    kill -"$sig" "$step_pid" 2>/dev/null || true
  fi
}

on_usr1() {
  signal_steps USR1
  copy_back "USR1-before-walltime" 0 || true
}

on_term() {
  signal_steps TERM
  copy_back TERM 0 || true
}

on_exit() {
  local rc=$?
  trap - EXIT
  if ((normal_complete == 0)); then
    copy_back "EXIT-${rc}" 0 || true
  fi
  printf 'exit=%s time=%s\n' "$rc" "$(date -Is)" >&2
  exit "$rc"
}

trap on_exit EXIT
trap on_usr1 USR1
trap on_term TERM INT

printf 'start=%s job=%s host=%s local_root=%s\n' \
  "$(date -Is)" "$SLURM_JOB_ID" "$(hostname -f)" "$LOCAL_ROOT"
df -hT /tmp
[[ -d "$INPUT_SRC" ]] || { echo "Missing input directory: $INPUT_SRC" >&2; exit 2; }

# For millions of tiny files, stage a tar/SquashFS/sharded representation instead.
rsync -a --info=stats2 "$INPUT_SRC/" "$LOCAL_INPUT/"

module reset
# source CHANGE_ME_PORTABLE_ENV_LOADER
module list 2>&1
export OMP_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export PYTHONUNBUFFERED=1

# Background srun so Bash can execute B:-targeted traps while wait is active.
# A trapped signal interrupts wait; if the child still exists, wait again.
srun --cpu-bind=cores \
  python -u train.py \
    --data-root "$LOCAL_INPUT" \
    --output-dir "$LOCAL_OUTPUT" \
    --config configs/CHANGE_ME.yaml &
step_pid=$!

step_rc=0
while true; do
  set +e
  wait "$step_pid"
  step_rc=$?
  set -e
  if kill -0 "$step_pid" 2>/dev/null; then
    continue
  fi
  break
done
step_pid=""

if ((step_rc != 0)); then
  exit "$step_rc"
fi

# Only a successful, final sync creates _COPYBACK_COMPLETE. Early signal syncs
# never suppress this final pass and never claim completeness.
copy_back normal 1
normal_complete=1
trap - EXIT USR1 TERM INT
printf 'end=%s\n' "$(date -Is)"
