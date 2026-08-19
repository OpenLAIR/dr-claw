#!/usr/bin/env bash
# NCSA Delta — two nodes, four compatible GPUs/node, PyTorch torchrun.
# Multi-node jobs should be used only after single-node scaling is validated.
# Replace CHANGE_ME values, create logs, and pass a live-verified GPU partition
# only at submission with sbatch --partition="$delta_partition" ...

# Portable starting point only: measure per-node host memory/CPU needs.
#SBATCH --job-name=CHANGE_ME_2node_ddp
#SBATCH --account=CHANGE_ME_GPU_ACCOUNT
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=1
#SBATCH --cpus-per-task=64
#SBATCH --gpus-per-node=4
#SBATCH --mem=232G
#SBATCH --time=04:00:00
#SBATCH --constraint="projects&work"
#SBATCH --output=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.err
# Enable only with a tested distributed checkpoint handler:
##SBATCH --signal=USR1@900

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

module reset
# source CHANGE_ME_PORTABLE_ENV_LOADER
module list 2>&1

export OMP_NUM_THREADS=$((SLURM_CPUS_PER_TASK / GPUS_PER_NODE))
export MKL_NUM_THREADS="$OMP_NUM_THREADS"
export OPENBLAS_NUM_THREADS="$OMP_NUM_THREADS"
export PYTHONUNBUFFERED=1
export NCCL_DEBUG="${NCCL_DEBUG:-WARN}"
export NCCL_ASYNC_ERROR_HANDLING=1
export HF_HOME="${WORK_ROOT}/caches/huggingface"
export TORCH_HOME="${WORK_ROOT}/caches/torch"
export XDG_CACHE_HOME="${WORK_ROOT}/caches/xdg"
mkdir -p "$HF_HOME" "$TORCH_HOME" "$XDG_CACHE_HOME"

MASTER_ADDR=$(scontrol show hostnames "$SLURM_JOB_NODELIST" | head -n 1)
MASTER_PORT=$((10000 + SLURM_JOB_ID % 50000))
export MASTER_ADDR MASTER_PORT GPUS_PER_NODE RUN_DIR

printf 'start=%s job_id=%s nnodes=%s nodes=%s\n' \
  "$(date -Is)" "$SLURM_JOB_ID" "$SLURM_NNODES" "$SLURM_JOB_NODELIST"
printf 'master=%s:%s gpus_per_node=%s omp_threads_per_worker=%s\n' \
  "$MASTER_ADDR" "$MASTER_PORT" "$GPUS_PER_NODE" "$OMP_NUM_THREADS"
git rev-parse HEAD 2>/dev/null || true

# Exactly one launcher task per node. Each launcher starts four local workers.
srun --label --kill-on-bad-exit=1 \
  --ntasks="$SLURM_NNODES" --ntasks-per-node=1 \
  bash -c '
    set -Eeuo pipefail
    echo "launcher node_rank=$SLURM_NODEID host=$(hostname -f) visible=$CUDA_VISIBLE_DEVICES"
    torchrun \
      --nnodes="$SLURM_NNODES" \
      --nproc-per-node="$GPUS_PER_NODE" \
      --node-rank="$SLURM_NODEID" \
      --master-addr="$MASTER_ADDR" \
      --master-port="$MASTER_PORT" \
      train.py \
        --config configs/CHANGE_ME.yaml \
        --output-dir "$RUN_DIR"
  '

printf 'end=%s\n' "$(date -Is)"
