#!/usr/bin/env bash
# Read-only report for one Delta Slurm job.
set -Eeuo pipefail

usage() {
  echo "Usage: delta-job-report.sh JOBID [ACCOUNT]" >&2
}

[[ $# -ge 1 && $# -le 2 ]] || { usage; exit 2; }
job_id=$1
account=${2-}

if [[ ! "$job_id" =~ ^[0-9]+([_.][0-9]+)?$ ]]; then
  echo "Invalid-looking JobID: $job_id" >&2
  exit 2
fi

section() { printf '\n===== %s =====\n' "$1"; }
run() {
  printf '\n$'
  printf ' %q' "$@"
  printf '\n'
  "$@" 2>&1 || printf '[command exited %s]\n' "$?"
}

printf 'NCSA Delta job report\nGenerated: %s\nJobID: %s\n' "$(date -Is 2>/dev/null || date)" "$job_id"

section "Queue / live state"
if command -v squeue >/dev/null 2>&1; then
  run squeue -j "$job_id" -o '%.18i|%.16P|%.24j|%.8u|%.2t|%.10M|%.10L|%.6D|%.6C|%.12b|%.30R'
  run squeue --start -j "$job_id"
fi
if command -v scontrol >/dev/null 2>&1; then
  run scontrol show job -dd "$job_id"
fi
if command -v sprio >/dev/null 2>&1; then
  run sprio -j "$job_id"
fi

section "Accounting"
if command -v sacct >/dev/null 2>&1; then
  run sacct -X -j "$job_id" --parsable2 \
    --format=JobIDRaw,JobName,User,Partition,Account,State,ExitCode,DerivedExitCode,ElapsedRaw,Elapsed,Timelimit,Start,End,AllocTRES,ReqTRES,Billing,MaxRSS,TotalCPU,NodeList
fi
if command -v seff >/dev/null 2>&1; then
  run seff "$job_id"
fi

section "Running-step statistics"
if command -v sstat >/dev/null 2>&1; then
  run sstat -j "$job_id" --format=JobID,AveCPU,AveCPUFreq,AveRSS,MaxRSS,MaxVMSize,MaxDiskRead,MaxDiskWrite
fi

section "Actual project charges"
if [[ -n "$account" ]]; then
  if command -v jobcharge >/dev/null 2>&1; then
    echo "Showing a >24h raw account window; preserve this complete report, then locate JobID $job_id in the output."
    echo "A sub-day start/end window may fail with: range() arg 3 must not be zero"
    run jobcharge -a "$account" --detail -d 2
  else
    echo "jobcharge command not found."
  fi
else
  echo "No ACCOUNT supplied. Run: jobcharge -a <ACCOUNT> --detail -d 2"
fi

section "Log hints"
cat <<EOF
Use `scontrol show job -dd $job_id` to find WorkDir, StdOut, StdErr and Command.
Review both the allocation row and .batch/.extern/application steps in sacct.
For TIMEOUT, OOM, NODE_FAIL or PREEMPTED, preserve logs before retrying.
This report is read-only and may contain project/job metadata; review before sharing.
EOF
