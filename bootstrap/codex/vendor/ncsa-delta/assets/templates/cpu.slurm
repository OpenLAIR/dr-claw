#!/usr/bin/env bash
# NCSA Delta — CPU/OpenMP or threaded Python template.
# Replace CHANGE_ME values and create /work/hdd/CHANGE_ME_PROJECT/$USER/logs first.

# Accounting-aware start: 29G ~= 31.14 decimal GB for 16 CPU; raise from measured MaxRSS/OOM needs.
#SBATCH --job-name=CHANGE_ME_cpu
#SBATCH --account=CHANGE_ME_CPU_ACCOUNT
#SBATCH --partition=cpu
#SBATCH --nodes=1
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --mem=29G
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

module reset
# module load CHANGE_ME_MODULES
module list 2>&1

export OMP_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export MKL_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export OPENBLAS_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export NUMEXPR_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export PYTHONUNBUFFERED=1

printf 'start=%s job_id=%s host=%s cpus=%s\n' \
  "$(date -Is)" "$SLURM_JOB_ID" "$(hostname -f)" "$SLURM_CPUS_PER_TASK"
git rev-parse HEAD 2>/dev/null || true
command -v python
python -VV

srun --cpu-bind=cores \
  python -u main.py \
    --config configs/CHANGE_ME.yaml \
    --output-dir "$RUN_DIR"

printf 'end=%s\n' "$(date -Is)"
