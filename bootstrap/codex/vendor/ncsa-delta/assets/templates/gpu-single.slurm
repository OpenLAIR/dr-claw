#!/usr/bin/env bash
# NCSA Delta — portable single-GPU production template.
# Before submitting:
#   1) replace every CHANGE_ME value;
#   2) verify account/partition/features with accounts + sinfo, then pass the
#      GPU partition only at submission: sbatch --partition="$delta_partition" ...;
#   3) create the log directory because Slurm opens logs before this script runs;
#   4) on the login node, actually load the full environment and probe the
#      interpreter/framework versions and origins; run every project semantic
#      preflight through that frozen loader, not bare login-node python3;
#   5) lint, then save sbatch --test-only text separately; only a later,
#      explicitly authorized sbatch --parsable result is the actual JobID.
# Example pre-submit command:
#   mkdir -p /work/hdd/CHANGE_ME_PROJECT/"$USER"/logs

# Portable starting point only: measure host memory/CPU needs for the selected partition.
#SBATCH --job-name=CHANGE_ME_single_gpu
#SBATCH --account=CHANGE_ME_GPU_ACCOUNT
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --gpus-per-node=1
#SBATCH --mem=58G
#SBATCH --time=00:30:00
#SBATCH --constraint="projects&work"
#SBATCH --output=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.err

set -Eeuo pipefail
umask 027

readonly PROJECT="CHANGE_ME_PROJECT"
readonly PROJECT_ROOT="/projects/${PROJECT}/${USER}"
readonly WORK_ROOT="/work/hdd/${PROJECT}/${USER}"
readonly CODE_DIR="${PROJECT_ROOT}/code/CHANGE_ME_REPOSITORY"
readonly RUN_DIR="${WORK_ROOT}/runs/${SLURM_JOB_NAME}/${SLURM_JOB_ID}"

mkdir -p "$RUN_DIR"
cd "$CODE_DIR"

printf 'start=%s\n' "$(date -Is)"
printf 'job_id=%s job_name=%s partition=%s account=%s\n' \
  "$SLURM_JOB_ID" "$SLURM_JOB_NAME" "$SLURM_JOB_PARTITION" "$SLURM_JOB_ACCOUNT"
printf 'host=%s nodes=%s submit_dir=%s code_dir=%s run_dir=%s\n' \
  "$(hostname -f)" "$SLURM_JOB_NODELIST" "$SLURM_SUBMIT_DIR" "$CODE_DIR" "$RUN_DIR"
printf 'cpus_per_task=%s gpus_on_node=%s mem_per_node=%s\n' \
  "$SLURM_CPUS_PER_TASK" "${SLURM_GPUS_ON_NODE:-unknown}" "${SLURM_MEM_PER_NODE:-unknown}"

git rev-parse HEAD 2>/dev/null || true
git status --short 2>/dev/null || true

module reset
# Resolve a vendor-compatible frozen loader first; do not bind a GPU model here.
# source CHANGE_ME_PORTABLE_ENV_LOADER
# For the live-verified PyTorch 2.8/cu128 wrapper failure, freeze and use
# scripts/delta-load-pytorch-2.8-cu128.sh plus both login/compute receipts;
# do not paste only `module load pytorch-conda/2.8` here.
module list 2>&1

export OMP_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export MKL_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export OPENBLAS_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export PYTHONUNBUFFERED=1
export HF_HOME="${WORK_ROOT}/caches/huggingface"
export TORCH_HOME="${WORK_ROOT}/caches/torch"
export PIP_CACHE_DIR="${WORK_ROOT}/caches/pip"
export XDG_CACHE_HOME="${WORK_ROOT}/caches/xdg"
mkdir -p "$HF_HOME" "$TORCH_HOME" "$PIP_CACHE_DIR" "$XDG_CACHE_HOME"

command -v python
python -VV
python - <<'PY'
import os
print("python_executable=", __import__("sys").executable)
print("cuda_visible_devices=", os.environ.get("CUDA_VISIBLE_DEVICES"))
try:
    import torch
    print("torch_version=", torch.__version__)
    print("torch_cuda_version=", torch.version.cuda)
    print("torch_hip_version=", getattr(torch.version, "hip", None))
    print("cuda_available=", torch.cuda.is_available())
    if torch.cuda.is_available():
        print("gpu_name=", torch.cuda.get_device_name(0))
except Exception as exc:
    print("torch_probe_error=", repr(exc))
PY
nvidia-smi -L 2>/dev/null || true
rocm-smi --showproductname 2>/dev/null || true

# Replace this command. Keep srun so Slurm places and accounts for the job step.
srun --cpu-bind=cores \
  python -u train.py \
    --config configs/CHANGE_ME.yaml \
    --output-dir "$RUN_DIR"

printf 'end=%s\n' "$(date -Is)"
