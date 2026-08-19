#!/usr/bin/env bash
# Read-only environment/account/storage/Slurm snapshot for NCSA Delta.
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: delta-doctor.sh [--output FILE]

Collects read-only diagnostics. It does not submit/cancel jobs or modify files
except for the optional output report.
EOF
}

output=""
while (($#)); do
  case "$1" in
    --output)
      [[ $# -ge 2 ]] || { echo "--output needs a path" >&2; exit 2; }
      output=$2
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -n "$output" ]]; then
  mkdir -p "$(dirname "$output")"
  : > "$output"
  chmod 600 "$output" 2>/dev/null || true
fi

emit() {
  if [[ -n "$output" ]]; then
    tee -a "$output"
  else
    cat
  fi
}

section() {
  printf '\n\n===== %s =====\n' "$1"
}

run() {
  local label=$1
  shift
  printf '\n--- %s ---\n' "$label"
  printf '$'
  printf ' %q' "$@"
  printf '\n'
  if command -v timeout >/dev/null 2>&1; then
    timeout 30 "$@" 2>&1 || printf '[command exited %s]\n' "$?"
  else
    "$@" 2>&1 || printf '[command exited %s]\n' "$?"
  fi
}

collect() {
  echo "NCSA Delta read-only doctor"
  echo "Static skill facts verified: 2026-08-09"
  echo "Generated: $(date -Is 2>/dev/null || date)"
  echo "WARNING: report may contain username, project/account names, job names, and paths."

  section "Identity and host"
  run date date -Is
  run whoami whoami
  run id id
  run hostname hostname -f
  run architecture uname -a
  run machine uname -m
  printf '\nEnvironment:\nHOME=%q\nWORK=%q\nSCRATCH=%q\nSLURM_JOB_ID=%q\n' \
    "${HOME-}" "${WORK-}" "${SCRATCH-}" "${SLURM_JOB_ID-}"

  section "Path resolution"
  for var in HOME WORK SCRATCH; do
    value=${!var-}
    if [[ -n "$value" ]]; then
      run "readlink $var" readlink -f "$value"
      run "ls $var" ls -ld "$value"
      run "df $var" df -hT "$value"
    fi
  done

  section "Accounts and quotas"
  if command -v accounts >/dev/null 2>&1; then
    run accounts accounts
  else
    echo "accounts command not found"
  fi
  if command -v quota >/dev/null 2>&1; then
    run quota quota
  else
    echo "quota command not found"
  fi
  if [[ -d "${HOME-}/.snapshot" ]]; then
    run "HOME snapshots (names only)" bash -lc 'ls -1 "$HOME/.snapshot" | tail -50'
  else
    echo "No $HOME/.snapshot directory visible in this session."
  fi

  section "Slurm versions and cluster"
  for cmd in sinfo squeue scontrol sacct sstat sbatch srun salloc; do
    if command -v "$cmd" >/dev/null 2>&1; then
      run "$cmd version" "$cmd" --version
    else
      echo "$cmd: not found"
    fi
  done

  if command -v scontrol >/dev/null 2>&1; then
    run "Slurm relevant config" bash -lc \
      "scontrol show config | grep -Ei '^(ClusterName|SlurmVersion|SlurmctldHost|SchedulerType|SchedulerParameters|PriorityType|PriorityWeight|Preempt|PreemptExemptTime|KillWait|OverTimeLimit|MaxArraySize)'"
  fi

  section "Partitions and features"
  if command -v sinfo >/dev/null 2>&1; then
    run "partition summary" sinfo -o '%P|%a|%l|%D|%t|%G|%m|%c|%f'
    run "node type summary" sinfo -N -o '%N|%P|%t|%c|%m|%G|%f'
    run "reasons" sinfo -R
  fi
  if command -v scontrol >/dev/null 2>&1; then
    run "partition details" scontrol show partition
  fi

  section "User jobs"
  if command -v squeue >/dev/null 2>&1; then
    run "current queue" squeue -u "${USER:-$(whoami)}" -o '%.18i|%.16P|%.24j|%.2t|%.10M|%.10L|%.6D|%.6C|%.12b|%.30R'
  fi
  if command -v sacct >/dev/null 2>&1; then
    run "recent jobs (7 days)" sacct -X -S now-7days -u "${USER:-$(whoami)}" --noheader --parsable2 \
      --format=JobIDRaw,JobName,Partition,Account,State,ExitCode,Elapsed,Timelimit,AllocTRES
  fi

  section "Software"
  if type module >/dev/null 2>&1; then
    run "module version" bash -lc 'module --version'
    run "loaded modules" bash -lc 'module list'
  else
    echo "Lmod module shell function not available in this shell."
  fi
  for cmd in python3 python conda apptainer gcc git rsync; do
    if command -v "$cmd" >/dev/null 2>&1; then
      run "$cmd location" bash -lc "command -v '$cmd'; '$cmd' --version 2>&1 | head -5"
    else
      echo "$cmd: not found"
    fi
  done
  if [[ -d /sw/external/NGC ]]; then
    run "NGC image directory sample" bash -lc 'find /sw/external/NGC -maxdepth 1 \( -type f -o -type l \) -printf "%f\n" | sort | head -100'
  fi

  section "Compute-node-only checks"
  if [[ -n "${SLURM_JOB_ID-}" ]]; then
    run "local tmp" df -hT /tmp
    run "mount tmp" findmnt /tmp
    if command -v nvidia-smi >/dev/null 2>&1; then
      run "NVIDIA GPUs" nvidia-smi -L
      run "NVIDIA topology" nvidia-smi topo -m
    fi
    if command -v rocm-smi >/dev/null 2>&1; then
      run "AMD GPUs" rocm-smi --showproductname
    fi
  else
    echo "Not inside a Slurm allocation. /tmp capacity and GPUs must be checked on a compute node."
  fi

  section "Interpretation reminders"
  cat <<'EOF'
- Live Slurm/account/quota output wins over static tables.
- /projects is persistent project storage; /work/hdd is persistent work storage;
  compute-node /tmp is local and purged after the job.
- Do not share this report publicly without reviewing account/job/path information.
- Use jobcharge -a ACCOUNT --detail -d N separately to inspect actual project charges.
EOF
}

collect | emit

if [[ -n "$output" ]]; then
  printf 'Report written to %s\n' "$output" >&2
fi
