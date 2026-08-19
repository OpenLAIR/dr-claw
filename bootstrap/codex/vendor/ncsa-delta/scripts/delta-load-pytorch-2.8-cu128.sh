#!/usr/bin/env bash
# Load the currently verified Delta PyTorch 2.8/cu128 runtime and optionally
# execute a command in that exact environment. Copy this script and its Python
# receipt companion into an immutable attempt snapshot before production use.
set -Eeuo pipefail
umask 027

usage() {
  cat <<'EOF'
Usage:
  delta-load-pytorch-2.8-cu128.sh --phase login --receipt FILE
  delta-load-pytorch-2.8-cu128.sh --phase login --receipt FILE \
    -- python -m PROJECT_PREFLIGHT [ARG ...]
  delta-load-pytorch-2.8-cu128.sh --phase compute --receipt FILE \
    --login-receipt LOGIN.json -- COMMAND [ARG ...]

The login phase performs the full module load and exact Python/Torch/origin
probe without using a GPU.  If a command is supplied, project semantic
preflight runs only after that exact login receipt passes, in the same Python
3.11.13 environment.  The compute phase requires the immutable login receipt,
verifies CUDA and exact interpreter/framework parity, then execs COMMAND in the
same environment.  The wrapper/fallback route, wrapper return code, and module
list remain recorded observations; Lmod route drift alone is not a numerical-
runtime mismatch.  Existing receipts are never overwritten.
EOF
}

phase=""
receipt=""
login_receipt=""
declare -a command_to_run=()
while (($#)); do
  case "$1" in
    --phase)
      [[ $# -ge 2 ]] || { echo "--phase needs a value" >&2; exit 2; }
      phase=$2
      shift 2
      ;;
    --receipt)
      [[ $# -ge 2 ]] || { echo "--receipt needs a path" >&2; exit 2; }
      receipt=$2
      shift 2
      ;;
    --login-receipt)
      [[ $# -ge 2 ]] || { echo "--login-receipt needs a path" >&2; exit 2; }
      login_receipt=$2
      shift 2
      ;;
    --)
      shift
      command_to_run=("$@")
      break
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

[[ "$phase" == login || "$phase" == compute ]] || {
  echo "--phase must be login or compute" >&2
  exit 2
}
[[ -n "$receipt" ]] || { echo "--receipt is required" >&2; exit 2; }
if [[ "$phase" == compute ]]; then
  [[ -n "$login_receipt" ]] || {
    echo "compute phase requires --login-receipt" >&2
    exit 2
  }
  [[ -r "$login_receipt" ]] || {
    echo "login receipt is not readable: $login_receipt" >&2
    exit 2
  }
elif [[ -n "$login_receipt" ]]; then
  echo "login phase must not receive --login-receipt" >&2
  exit 2
fi
[[ ! -e "$receipt" ]] || {
  echo "refusing to replace existing receipt: $receipt" >&2
  exit 4
}
mkdir -p "$(dirname "$receipt")"

failure_marker="${receipt}.environment_failed"
wrapper_rc=not_attempted
write_failure_marker() {
  local stage=$1
  local rc=$2
  (
    set -o noclobber
    {
      printf 'schema=ncsa_delta_environment_load_failure_v1\n'
      printf 'phase=%s\n' "$phase"
      printf 'stage=%s\n' "$stage"
      printf 'exit_code=%s\n' "$rc"
      printf 'wrapper_rc=%s\n' "$wrapper_rc"
      printf 'time=%s\n' "$(date -Is 2>/dev/null || date)"
      printf 'host=%s\n' "$(hostname -f 2>/dev/null || hostname)"
      printf 'slurm_job_id=%s\n' "${SLURM_JOB_ID-}"
    } > "$failure_marker"
  ) 2>/dev/null || true
}

fail() {
  local stage=$1
  local rc=${2:-1}
  write_failure_marker "$stage" "$rc"
  printf 'Delta PyTorch environment failed at %s (rc=%s)\n' "$stage" "$rc" >&2
  exit "$rc"
}

if ! type module >/dev/null 2>&1; then
  # shellcheck disable=SC1091
  source /etc/profile.d/modules.sh || fail module_initialization 10
fi

module reset || fail module_reset_primary 11
set +e
module --ignore_cache load cudatoolkit/25.3_12.8
cuda_primary_rc=$?
if ((cuda_primary_rc == 0)); then
  module --ignore_cache load pytorch-conda/2.8
  wrapper_rc=$?
else
  wrapper_rc=$cuda_primary_rc
fi
set -e

if ((wrapper_rc == 0)); then
  load_method=wrapper
else
  # The wrapper is currently visible to spider but asks Lmod for the hidden
  # dependency python/.conda-env/pytorch/2.8-cu128.  --ignore_cache on the
  # wrapper does not expose that hidden module path, so add the real path.
  module reset || fail module_reset_fallback 12
  module use /sw/rh9.4/user/modules/python/.conda-env || fail module_use_fallback 13
  module --ignore_cache load cudatoolkit/25.3_12.8 || fail cudatoolkit_fallback 14
  module --ignore_cache load pytorch/2.8-cu128 || fail pytorch_fallback 15
  load_method=fallback
fi

module_list=$(module -t list 2>&1) || fail module_list 16
export DELTA_PYTORCH_MODULE_LIST=$module_list
python_bin=$(command -v python) || fail python_resolution 17
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
receipt_probe="${script_dir}/delta-pytorch-runtime-receipt.py"
[[ -r "$receipt_probe" ]] || fail receipt_probe_missing 18

declare -a probe_args=(
  --phase "$phase"
  --output "$receipt"
  --load-method "$load_method"
  --wrapper-rc "$wrapper_rc"
)
if [[ "$phase" == compute ]]; then
  probe_args+=(--login-receipt "$login_receipt")
fi

set +e
"$python_bin" "$receipt_probe" "${probe_args[@]}"
probe_rc=$?
set -e
if ((probe_rc != 0)); then
  write_failure_marker runtime_receipt "$probe_rc"
  exit "$probe_rc"
fi

printf 'delta_pytorch_load_method=%s wrapper_rc=%s\n' "$load_method" "$wrapper_rc"
if ((${#command_to_run[@]})); then
  exec "${command_to_run[@]}"
fi
