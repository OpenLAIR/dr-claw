#!/usr/bin/env python3
"""Static linter for NCSA Delta Slurm scripts.

The linter intentionally errs on the side of warnings. It does not submit jobs.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from delta_cost import (
    NODE_TYPES,
    PARTITIONS,
    format_duration,
    parse_duration,
    parse_slurm_memory_decimal_gb,
)


SHORT_TO_LONG = {
    "-A": "--account",
    "-p": "--partition",
    "-t": "--time",
    "-N": "--nodes",
    "-n": "--ntasks",
    "-c": "--cpus-per-task",
    "-J": "--job-name",
    "-o": "--output",
    "-e": "--error",
    "-w": "--nodelist",
}

PLACEHOLDER_RE = re.compile(
    r"(?:<[^>]+>|CHANGE(?:_?ME)?|REPLACE(?:_?ME)?|YOUR[_-]|ACCOUNT_NAME|PROJECT_PATH|PROJECT_CODE|TODO)",
    re.I,
)


@dataclass
class Finding:
    severity: str
    code: str
    message: str
    line: Optional[int] = None


def add(findings: list[Finding], severity: str, code: str, message: str, line: Optional[int] = None) -> None:
    findings.append(Finding(severity, code, message, line))


def parse_directives(text: str, findings: list[Finding]) -> tuple[dict[str, list[str]], dict[str, int]]:
    options: dict[str, list[str]] = {}
    option_line: dict[str, int] = {}
    for line_no, line in enumerate(text.splitlines(), 1):
        stripped = line.lstrip()
        if not stripped.startswith("#SBATCH"):
            continue
        payload = stripped[len("#SBATCH") :].strip()
        if not payload:
            continue
        try:
            tokens = shlex.split(payload, comments=False, posix=True)
        except ValueError as exc:
            add(findings, "ERROR", "SBATCH_PARSE", f"Cannot parse #SBATCH line: {exc}", line_no)
            continue
        index = 0
        while index < len(tokens):
            token = tokens[index]
            if token.startswith("--"):
                if "=" in token:
                    key, value = token.split("=", 1)
                else:
                    key = token
                    if index + 1 < len(tokens) and not tokens[index + 1].startswith("-"):
                        index += 1
                        value = tokens[index]
                    else:
                        value = "true"
            elif token in SHORT_TO_LONG:
                key = SHORT_TO_LONG[token]
                if index + 1 < len(tokens):
                    index += 1
                    value = tokens[index]
                else:
                    value = "true"
                    add(findings, "ERROR", "SBATCH_VALUE", f"Missing value for {token}", line_no)
            else:
                add(findings, "WARN", "SBATCH_UNKNOWN", f"Unrecognized token in #SBATCH: {token}", line_no)
                index += 1
                continue
            options.setdefault(key, []).append(value)
            option_line.setdefault(key, line_no)
            index += 1
    return options, option_line


def last(options: dict[str, list[str]], *keys: str) -> Optional[str]:
    for key in keys:
        values = options.get(key)
        if values:
            return values[-1]
    return None


def parse_int(value: Optional[str]) -> Optional[int]:
    if value is None:
        return None
    try:
        return int(value)
    except ValueError:
        return None


def parse_mem_decimal_gb(value: Optional[str]) -> Optional[float]:
    """Parse Slurm memory syntax into NCSA decimal billing GB."""

    if not value or value == "true":
        return None
    try:
        return parse_slurm_memory_decimal_gb(value)
    except argparse.ArgumentTypeError:
        return None


def normalize_output_path(value: str, script: Path) -> Optional[Path]:
    # Replace Slurm patterns with harmless names; skip shell-variable paths because
    # Slurm directives do not expand arbitrary shell variables reliably.
    if "$" in value or PLACEHOLDER_RE.search(value):
        return None
    normalized = re.sub(r"%[A-Za-z]", "X", value)
    path = Path(os.path.expanduser(normalized))
    if not path.is_absolute():
        path = script.parent / path
    return path


def live_partitions() -> Optional[set[str]]:
    if not shutil.which("sinfo"):
        return None
    proc = subprocess.run(["sinfo", "-h", "-o", "%P"], text=True, capture_output=True, check=False)
    if proc.returncode != 0:
        return None
    return {line.strip().rstrip("*") for line in proc.stdout.splitlines() if line.strip()}


def lint(
    path: Path,
    use_live: bool,
    submission_partition: Optional[str] = None,
) -> list[Finding]:
    findings: list[Finding] = []
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [Finding("ERROR", "READ", f"Cannot read {path}: {exc}")]

    lines = text.splitlines()
    if not lines or not lines[0].startswith("#!"):
        add(findings, "WARN", "SHEBANG", "Missing shebang on first line")
    elif "bash" not in lines[0]:
        add(findings, "INFO", "SHELL", f"Template assumes Bash features; shebang is {lines[0]!r}", 1)

    options, option_line = parse_directives(text, findings)

    required = ["--job-name", "--account", "--time"]
    for key in required:
        if last(options, key) is None:
            add(findings, "ERROR", "MISSING_DIRECTIVE", f"Missing required {key}")

    account = last(options, "--account")
    partition_value = last(options, "--partition")
    effective_partition_value = partition_value or submission_partition
    time_value = last(options, "--time")
    job_name = last(options, "--job-name")

    for key, values in options.items():
        for value in values:
            if PLACEHOLDER_RE.search(value):
                add(findings, "ERROR", "PLACEHOLDER", f"Unresolved placeholder in {key}: {value}", option_line.get(key))

    if job_name and len(job_name) > 80:
        add(findings, "WARN", "JOB_NAME_LONG", "Very long job name makes queue/log views hard to read", option_line.get("--job-name"))

    partitions = [
        p.strip().rstrip("*")
        for p in (effective_partition_value or "").split(",")
        if p.strip()
    ]
    available = live_partitions() if use_live else None
    for partition in partitions:
        if available is not None and partition not in available:
            add(findings, "ERROR", "PARTITION_LIVE", f"Partition {partition!r} is not present in live sinfo", option_line.get("--partition"))
        elif partition not in PARTITIONS:
            add(findings, "WARN", "PARTITION_STATIC", f"Partition {partition!r} is not in this skill's static table; verify live config", option_line.get("--partition"))

    parsed_time: Optional[int] = None
    if time_value:
        try:
            parsed_time = parse_duration(time_value)
        except Exception as exc:
            add(findings, "ERROR", "TIME_PARSE", f"Cannot parse --time={time_value!r}: {exc}", option_line.get("--time"))
        else:
            for partition in partitions:
                if partition in PARTITIONS and parsed_time > PARTITIONS[partition].max_seconds:
                    add(
                        findings,
                        "ERROR",
                        "TIME_MAX",
                        f"{format_duration(parsed_time)} exceeds static max {format_duration(PARTITIONS[partition].max_seconds)} for {partition}",
                        option_line.get("--time"),
                    )
            if parsed_time <= 120:
                add(findings, "WARN", "TIME_TINY", "Walltime <= 2 minutes leaves almost no setup/cleanup margin", option_line.get("--time"))

    nodes = parse_int(last(options, "--nodes")) or 1
    ntasks = parse_int(last(options, "--ntasks"))
    ntasks_per_node = parse_int(last(options, "--ntasks-per-node"))
    cpus_per_task = parse_int(last(options, "--cpus-per-task"))
    if ntasks is None and ntasks_per_node is None:
        add(findings, "WARN", "TASKS_DEFAULT", "No --ntasks/--ntasks-per-node; Slurm defaults may not match the launcher")
    if cpus_per_task is None:
        add(findings, "WARN", "CPU_DEFAULT", "No --cpus-per-task; default 1 CPU may starve dataloaders or threads")

    mem = last(options, "--mem")
    mem_per_cpu = last(options, "--mem-per-cpu")
    if mem and mem_per_cpu:
        add(findings, "ERROR", "MEM_CONFLICT", "Use --mem or --mem-per-cpu, not both")
    if not mem and not mem_per_cpu:
        add(findings, "WARN", "MEM_DEFAULT", "No explicit memory; Delta default is roughly 1000 MB/core")
    mem_gb = parse_mem_decimal_gb(mem)
    if mem_gb == 0:
        add(findings, "WARN", "MEM_ALL", "--mem=0 requests all node memory and can imply whole-node cost")
    if mem and mem_gb is None:
        add(findings, "WARN", "MEM_PARSE", f"Could not parse memory value {mem!r}", option_line.get("--mem"))

    gpus_per_node = parse_int(last(options, "--gpus-per-node"))
    gpus_per_task = parse_int(last(options, "--gpus-per-task"))
    gres = last(options, "--gres")
    gpus_total = parse_int(last(options, "--gpus"))
    has_gpu_request = any(x is not None for x in [gpus_per_node, gpus_per_task, gres, gpus_total])
    is_gpu_partition = any(p.startswith("gpu") for p in partitions)
    is_cpu_only = bool(partitions) and all(p.startswith("cpu") for p in partitions)

    if has_gpu_request:
        if partition_value is not None:
            add(
                findings,
                "ERROR",
                "GPU_PARTITION_PIN",
                "Portable GPU scripts must omit #SBATCH --partition; pass the live-verified GPU partition at submission.",
                option_line.get("--partition"),
            )
        elif submission_partition is None:
            add(
                findings,
                "INFO",
                "PARTITION_EXTERNAL",
                "GPU partition is intentionally external; rerun lint with --submission-partition before sbatch.",
            )

        if last(options, "--nodelist") is not None or last(options, "--exclude") is not None:
            add(
                findings,
                "ERROR",
                "GPU_NODE_PIN",
                "Portable GPU scripts must not pin or exclude specific nodes.",
                option_line.get("--nodelist") or option_line.get("--exclude"),
            )

        if last(options, "--gpu-bind") is not None:
            add(
                findings,
                "ERROR",
                "GPU_BIND",
                "Portable GPU scripts must not hard-code GPU binding or maps.",
                option_line.get("--gpu-bind"),
            )

        if gres and re.search(r"(?i)(?:^|,)gpu:[a-z][^,:]*(?::|,|$)", gres):
            add(
                findings,
                "ERROR",
                "GPU_TYPED_GRES",
                "Typed GPU GRES binds a model; request a generic GPU count instead.",
                option_line.get("--gres"),
            )

        constraint_value = last(options, "--constraint") or ""
        if re.search(r"(?i)\b(?:a40|a100|h200|mi100|mi210|nvidia|amd|hopper|ampere)\b", constraint_value):
            add(
                findings,
                "ERROR",
                "GPU_MODEL_CONSTRAINT",
                "GPU model/vendor constraints belong to submission selection, not the portable script.",
                option_line.get("--constraint"),
            )

        active_text = "\n".join(
            line for line in lines if not line.lstrip().startswith("#")
        )
        if re.search(r"(?m)^\s*(?:export\s+)?CUDA_VISIBLE_DEVICES\s*=", active_text):
            add(
                findings,
                "ERROR",
                "GPU_VISIBLE_OVERRIDE",
                "Do not set CUDA_VISIBLE_DEVICES; respect the scheduler-provided visible set.",
            )
        if re.search(r"(?i)\bcuda:\d+\b", active_text):
            add(
                findings,
                "ERROR",
                "GPU_FIXED_LOCAL_INDEX",
                "Fixed cuda:N device selection is not portable; use the framework default or local rank.",
            )
        if re.search(r"\bGPU-[0-9a-fA-F-]{8,}\b", active_text):
            add(
                findings,
                "ERROR",
                "GPU_UUID_PIN",
                "GPU UUIDs may be logged as receipts but must not be embedded as execution targets.",
            )

    if is_gpu_partition and not has_gpu_request:
        add(findings, "ERROR", "GPU_MISSING", "GPU partition selected but no GPU resource directive found")
    if is_cpu_only and has_gpu_request:
        add(findings, "ERROR", "GPU_ON_CPU", "GPU requested on CPU-only partition")
    if account:
        if (has_gpu_request or is_gpu_partition) and account.endswith("-cpu"):
            add(findings, "ERROR", "ACCOUNT_KIND", "GPU request paired with a -cpu account", option_line.get("--account"))
        if is_cpu_only and account.endswith("-gpu"):
            add(findings, "WARN", "ACCOUNT_KIND", "CPU partition paired with a -gpu account; verify this is intentional", option_line.get("--account"))

    if gpus_per_task and ntasks_per_node and gpus_per_node and gpus_per_task * ntasks_per_node > gpus_per_node:
        add(findings, "ERROR", "GPU_TASK_MISMATCH", "ntasks-per-node × gpus-per-task exceeds gpus-per-node")

    exclusive = last(options, "--exclusive") is not None
    if exclusive:
        add(findings, "WARN", "EXCLUSIVE_COST", "--exclusive triggers whole-node reservation/charging; verify it is required", option_line.get("--exclusive"))

    for key in ["--output", "--error"]:
        value = last(options, key)
        if value is None:
            add(findings, "WARN", "LOG_DEFAULT", f"No {key}; output may fall back to slurm-%j.out", None)
            continue
        if "$" in value:
            add(findings, "WARN", "SBATCH_ENV", f"Arbitrary shell variables in {key} may not expand in #SBATCH: {value}", option_line.get(key))
        normalized = normalize_output_path(value, path)
        if normalized is not None and not normalized.parent.exists():
            add(findings, "WARN", "LOG_DIR", f"Log directory does not exist at lint time: {normalized.parent}", option_line.get(key))

    lower_text = text.lower()
    if "set -eeuo pipefail" not in lower_text and "set -euo pipefail" not in lower_text:
        add(findings, "WARN", "STRICT_SHELL", "Consider `set -Eeuo pipefail` for deterministic failure handling")
    if re.search(r"(?m)^\s*(python|python3|torchrun|mpirun|mpiexec)\b", text) and "srun" not in lower_text:
        add(findings, "WARN", "SRUN", "Main program appears to launch without srun; verify task placement and accounting")

    if any(p.endswith("-preempt") for p in partitions):
        if last(options, "--requeue") is None:
            add(findings, "ERROR", "PREEMPT_REQUEUE", "Preempt partition without --requeue")
        if last(options, "--signal") is None:
            add(findings, "WARN", "PREEMPT_SIGNAL", "Preempt partition without an early signal/checkpoint hook")
        if not re.search(r"checkpoint|resume|trap|signal", lower_text):
            add(findings, "WARN", "PREEMPT_CHECKPOINT", "No obvious checkpoint/restart logic found for preempt job")

    if parsed_time and parsed_time >= 1800 and has_gpu_request and last(options, "--signal") is None:
        add(findings, "WARN", "CHECKPOINT_SIGNAL", "Long GPU job has no --signal before walltime; add checkpoint margin if supported")

    uses_projects = "/projects/" in text
    uses_work = "/work/hdd/" in text
    constraint = last(options, "--constraint") or ""
    if (uses_projects or uses_work) and not constraint:
        add(findings, "WARN", "FS_CONSTRAINT", "Script uses shared filesystems but has no filesystem --constraint; verify live feature labels")
    if uses_projects and constraint and "projects" not in constraint:
        add(findings, "WARN", "FS_PROJECTS", "Script uses /projects but constraint does not mention projects")
    if uses_work and constraint and "work" not in constraint:
        add(findings, "WARN", "FS_WORK", "Script uses /work/hdd but constraint does not mention work")
    if uses_work and "scratch" in constraint and "work" not in constraint:
        add(findings, "WARN", "FS_STALE", "Constraint uses scratch for /work/hdd; current docs table says work—verify live features")

    if re.search(r"(?:^|\s)/tmp(?:/|\s|$)|SLURM_TMPDIR", text):
        if not re.search(r"rsync|cp\s|copy|stage|trap", lower_text):
            add(findings, "WARN", "TMP_COPYBACK", "Local /tmp is used but no obvious staging/copy-back/trap logic found")

    if re.search(r"\brsync\b[^\n]*--delete", text):
        add(findings, "ERROR", "RSYNC_DELETE", "rsync --delete is destructive; require explicit user confirmation and dry-run")
    if re.search(r"\brm\s+-[^\n]*r[^\n]*f|\brm\s+-rf\b", text):
        add(findings, "WARN", "RM_RF", "Recursive forced deletion found; validate variables and require explicit confirmation")
    if re.search(r"\bpip(?:3)?\s+install\b", text):
        add(findings, "WARN", "RUNTIME_INSTALL", "pip install inside a job hurts reproducibility and startup; prefer prebuilt env/wheelhouse")
    if re.search(r"\bgit\s+(?:pull|checkout|reset)\b", text):
        add(findings, "WARN", "MUTABLE_CODE", "Job mutates Git working tree at runtime; run an immutable commit/snapshot")
    if re.search(r"(?:conda\s+create|pip\s+install)[^\n]*(?:\$HOME|~/|/u/)", text, re.I):
        add(findings, "WARN", "HOME_ENV", "Large environment/package install appears to target HOME")

    # Live-verified Delta RH9 issue (2026-08-11): this visible wrapper asks Lmod
    # for a hidden dependency that is not on MODULEPATH.  A wrapper-only script
    # passes spider/lint/test-only yet dies before the application starts.
    if "pytorch-conda/2.8" in text:
        has_verified_fallback = (
            "/sw/rh9.4/user/modules/python/.conda-env" in text
            and "pytorch/2.8-cu128" in text
            and "cudatoolkit/25.3_12.8" in text
        )
        if has_verified_fallback:
            add(
                findings,
                "INFO",
                "PYTORCH_WRAPPER_FALLBACK",
                "pytorch-conda/2.8 is currently broken, but the verified hidden-module fallback is present; still require exact login and compute receipts.",
            )
        else:
            add(
                findings,
                "ERROR",
                "PYTORCH_WRAPPER_HIDDEN_DEP",
                "pytorch-conda/2.8 currently fails on hidden dependency python/.conda-env/pytorch/2.8-cu128; add the verified fallback or use the frozen loader helper.",
            )

    uses_delta_pytorch_28 = "pytorch/2.8-cu128" in text or "pytorch-conda/2.8" in text
    has_runtime_receipt = (
        "delta-load-pytorch-2.8-cu128.sh" in text
        or (
            "torch.__file__" in text
            and "sys.executable" in text
            and "torch.version.cuda" in text
            and "torch.cuda.is_available" in text
        )
    )
    if uses_delta_pytorch_28 and not has_runtime_receipt:
        add(
            findings,
            "WARN",
            "PYTORCH_RUNTIME_RECEIPT",
            "PyTorch 2.8/cu128 is referenced without an exact version/origin/CUDA runtime receipt; spider and sbatch --test-only are insufficient.",
        )

    if "apptainer" in lower_text:
        if is_gpu_partition and any("mi100" in p.lower() for p in partitions) and "--rocm" not in lower_text:
            add(findings, "WARN", "APPTAINER_ROCM", "MI100 container job lacks --rocm")
        if is_gpu_partition and not any("mi100" in p.lower() for p in partitions) and "--nv" not in lower_text:
            add(findings, "WARN", "APPTAINER_NV", "NVIDIA container job lacks --nv")
        if has_gpu_request and submission_partition is None:
            has_nv = "--nv" in lower_text
            has_rocm = "--rocm" in lower_text
            if has_nv != has_rocm:
                add(
                    findings,
                    "WARN",
                    "APPTAINER_VENDOR_PIN",
                    "A partition-neutral GPU container script should handle both --nv and --rocm or use an external vendor loader.",
                )

    # Approximate resource billing warnings for a single static partition.
    if len(partitions) == 1 and partitions[0] in PARTITIONS and is_gpu_partition and gpus_per_node and cpus_per_task:
        part = PARTITIONS[partitions[0]]
        node = NODE_TYPES[part.node_type]
        tasks_on_node = ntasks_per_node or (ntasks if nodes == 1 and ntasks else 1)
        total_cpus_node = cpus_per_task * tasks_on_node
        if total_cpus_node > gpus_per_node * node.cores_per_unit:
            add(
                findings,
                "INFO",
                "CPU_BILLING",
                f"CPU request ~{total_cpus_node}/node exceeds {gpus_per_node:g} GPU billing-equivalent "
                f"({gpus_per_node * node.cores_per_unit:g} cores); CPU may dominate SU.",
            )
        if mem_gb is not None and mem_gb > 0 and mem_gb > gpus_per_node * node.mem_gb_per_unit:
            add(
                findings,
                "INFO",
                "MEM_BILLING",
                f"Memory request is {mem_gb:.6g} decimal GB/node after converting Slurm units; "
                f"it exceeds {gpus_per_node:g} GPU billing-equivalent "
                f"({gpus_per_node * node.mem_gb_per_unit:g} decimal GB), so memory may dominate SU.",
            )

    return findings


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Lint an NCSA Delta Slurm script without submitting it.")
    parser.add_argument("script", type=Path)
    parser.add_argument("--live", action="store_true", help="Query live Delta sinfo when available")
    parser.add_argument(
        "--submission-partition",
        help="Live-verified partition supplied at sbatch time; GPU scripts should not hard-code it.",
    )
    parser.add_argument("--json", action="store_true", dest="as_json")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    findings = lint(args.script, args.live, args.submission_partition)
    counts = {severity: sum(f.severity == severity for f in findings) for severity in ["ERROR", "WARN", "INFO"]}
    if args.as_json:
        json.dump({"script": str(args.script), "counts": counts, "findings": [asdict(f) for f in findings]}, sys.stdout, indent=2)
        print()
    else:
        print(f"Delta lint: {args.script}")
        print("=" * 72)
        for finding in findings:
            location = f" line {finding.line}" if finding.line else ""
            print(f"[{finding.severity}] {finding.code}{location}: {finding.message}")
        if not findings:
            print("No findings.")
        print("-" * 72)
        print(f"ERROR={counts['ERROR']} WARN={counts['WARN']} INFO={counts['INFO']}")
        print("Next: run `sbatch --test-only --partition=<verified> <script>` on Delta. This linter never submits.")
    return 2 if counts["ERROR"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
