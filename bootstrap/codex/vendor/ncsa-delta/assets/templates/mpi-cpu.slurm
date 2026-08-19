#!/usr/bin/env bash
# NCSA Delta — two-node CPU MPI template.
# Use a Delta-provided compiler/MPI module pair and compile with that same stack.
# Replace CHANGE_ME values and create /work/hdd/CHANGE_ME_PROJECT/$USER/logs first.

# Per node: 29G ~= 31.14 decimal GB for 16 total CPU; raise from measured MaxRSS/OOM needs.
#SBATCH --job-name=CHANGE_ME_mpi
#SBATCH --account=CHANGE_ME_CPU_ACCOUNT
#SBATCH --partition=cpu
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=8
#SBATCH --cpus-per-task=2
#SBATCH --mem=29G
#SBATCH --time=01:00:00
#SBATCH --constraint="projects&work"
#SBATCH --output=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.out
#SBATCH --error=/work/hdd/CHANGE_ME_PROJECT/%u/logs/%x-%j.err

set -Eeuo pipefail
umask 027

readonly PROJECT="CHANGE_ME_PROJECT"
readonly PROJECT_ROOT="/projects/${PROJECT}/${USER}"
readonly CODE_DIR="${PROJECT_ROOT}/code/CHANGE_ME_REPOSITORY"
cd "$CODE_DIR"

module reset
# module load CHANGE_ME_COMPILER CHANGE_ME_MPI
module list 2>&1

export OMP_NUM_THREADS="$SLURM_CPUS_PER_TASK"
export MKL_NUM_THREADS="$SLURM_CPUS_PER_TASK"

printf 'start=%s job=%s nodes=%s tasks=%s cpus_per_task=%s\n' \
  "$(date -Is)" "$SLURM_JOB_ID" "$SLURM_JOB_NODELIST" "$SLURM_NTASKS" "$SLURM_CPUS_PER_TASK"

# Prefer srun with the site MPI stack; do not mix host/Conda/container MPI blindly.
srun --label --cpu-bind=cores ./CHANGE_ME_MPI_PROGRAM CHANGE_ME_ARGUMENTS

printf 'end=%s\n' "$(date -Is)"
