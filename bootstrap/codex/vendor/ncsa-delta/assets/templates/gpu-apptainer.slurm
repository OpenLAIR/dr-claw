#!/usr/bin/env bash
# NCSA Delta — portable GPU job with an immutable Apptainer SIF.
# The same script detects the allocated vendor and selects --nv or --rocm.
# The image itself must truly support that backend. Pass the live-verified GPU
# partition only at submission with sbatch --partition="$delta_partition" ...

# Portable starting point only: measure host memory/CPU needs for the selected partition.
#SBATCH --job-name=CHANGE_ME_container
#SBATCH --account=CHANGE_ME_GPU_ACCOUNT
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --gpus-per-node=1
#SBATCH --mem=58G
#SBATCH --time=01:00:00
#SBATCH --constraint="projects&work"
#SBATCH --output=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.err

set -Eeuo pipefail
umask 027

readonly PROJECT="CHANGE_ME_PROJECT"
readonly PROJECT_ROOT="/projects/${PROJECT}/${USER}"
readonly WORK_ROOT="/work/hdd/${PROJECT}/${USER}"
readonly IMAGE="${PROJECT_ROOT}/containers/CHANGE_ME_IMAGE.sif"
readonly CODE_DIR="${PROJECT_ROOT}/code/CHANGE_ME_REPOSITORY"
readonly RUN_DIR="${WORK_ROOT}/runs/${SLURM_JOB_NAME}/${SLURM_JOB_ID}"

[[ -r "$IMAGE" ]] || { echo "Unreadable image: $IMAGE" >&2; exit 2; }
mkdir -p "$RUN_DIR" "${WORK_ROOT}/caches/apptainer"
cd "$CODE_DIR"

module reset
# module load apptainer
module list 2>&1
command -v apptainer
apptainer --version
sha256sum "$IMAGE"

export APPTAINER_CACHEDIR="${WORK_ROOT}/caches/apptainer"
export OMP_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export PYTHONUNBUFFERED=1

gpu_runtime_flag=()
if command -v nvidia-smi >/dev/null 2>&1; then
  gpu_runtime_flag=(--nv)
  nvidia-smi -L
elif command -v rocm-smi >/dev/null 2>&1; then
  gpu_runtime_flag=(--rocm)
  rocm-smi --showproductname
else
  echo "No supported allocated GPU runtime detected" >&2
  exit 2
fi

srun --cpu-bind=cores \
  apptainer exec --cleanenv "${gpu_runtime_flag[@]}" \
    --bind "$CODE_DIR:/workspace/code" \
    --bind "$WORK_ROOT:/workspace/work" \
    --pwd /workspace/code \
    "$IMAGE" \
    python -u train.py \
      --config configs/CHANGE_ME.yaml \
      --output-dir "/workspace/work/runs/${SLURM_JOB_NAME}/${SLURM_JOB_ID}"
