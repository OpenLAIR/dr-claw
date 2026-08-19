#!/usr/bin/env bash
# NCSA Delta — one node, four compatible GPUs, one torchrun launcher.
# Replace CHANGE_ME values, create logs, and pass a live-verified GPU partition
# only at submission with sbatch --partition="$delta_partition" ...

# Portable starting point only: measure host memory/CPU needs for the selected partition.
#SBATCH --job-name=CHANGE_ME_4gpu
#SBATCH --account=CHANGE_ME_GPU_ACCOUNT
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=64
#SBATCH --gpus-per-node=4
#SBATCH --mem=232G
#SBATCH --time=02:00:00
#SBATCH --constraint="projects&work"
#SBATCH --output=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.err
# Enable only after the application has a tested signal/checkpoint handler:
##SBATCH --signal=USR1@600

set -Eeuo pipefail
umask 027

readonly PROJECT="CHANGE_ME_PROJECT"
readonly PROJECT_ROOT="/projects/${PROJECT}/${USER}"
readonly WORK_ROOT="/work/hdd/${PROJECT}/${USER}"
readonly CODE_DIR="${PROJECT_ROOT}/code/CHANGE_ME_REPOSITORY"
readonly RUN_DIR="${WORK_ROOT}/runs/${SLURM_JOB_NAME}/${SLURM_JOB_ID}"
readonly GPUS_PER_NODE=4

mkdir -p "$RUN_DIR"
cd "$CODE_DIR"

printf 'start=%s job_id=%s host=%s nodes=%s\n' \
  "$(date -Is)" "$SLURM_JOB_ID" "$(hostname -f)" "$SLURM_JOB_NODELIST"
printf 'account=%s partition=%s cpus=%s gpus=%s\n' \
  "$SLURM_JOB_ACCOUNT" "$SLURM_JOB_PARTITION" "$SLURM_CPUS_PER_TASK" "${SLURM_GPUS_ON_NODE:-unknown}"
git rev-parse HEAD 2>/dev/null || true

module reset
# source CHANGE_ME_PORTABLE_ENV_LOADER
module list 2>&1

export OMP_NUM_THREADS=$((SLURM_CPUS_PER_TASK / GPUS_PER_NODE))
export MKL_NUM_THREADS="$OMP_NUM_THREADS"
export OPENBLAS_NUM_THREADS="$OMP_NUM_THREADS"
export PYTHONUNBUFFERED=1
export NCCL_DEBUG="${NCCL_DEBUG:-WARN}"
export HF_HOME="${WORK_ROOT}/caches/huggingface"
export TORCH_HOME="${WORK_ROOT}/caches/torch"
export XDG_CACHE_HOME="${WORK_ROOT}/caches/xdg"
mkdir -p "$HF_HOME" "$TORCH_HOME" "$XDG_CACHE_HOME"

command -v torchrun
python -VV
nvidia-smi -L 2>/dev/null || rocm-smi --showproductname

# One Slurm task launches exactly four local worker processes.
srun --ntasks=1 --cpu-bind=cores --kill-on-bad-exit=1 \
  torchrun \
    --standalone \
    --nnodes=1 \
    --nproc-per-node="$GPUS_PER_NODE" \
    train.py \
      --config configs/CHANGE_ME.yaml \
      --output-dir "$RUN_DIR"

printf 'end=%s\n' "$(date -Is)"
