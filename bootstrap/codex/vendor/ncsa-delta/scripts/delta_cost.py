#!/usr/bin/env python3
"""Approximate NCSA Delta SU cost and balance-admission envelope.

Static partition factors and billing equivalents were verified against the
NCSA Delta documentation on 2026-08-09. This estimator is deliberately
transparent and conservative; live cluster configuration and NCSA's
``jobcharge`` command are authoritative.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from dataclasses import asdict, dataclass
from typing import Optional, Union


@dataclass(frozen=True)
class NodeType:
    name: str
    gpu_model: Optional[str]
    physical_gpus: int
    physical_cpus: int
    physical_mem_gb: float
    cores_per_unit: float
    mem_gb_per_unit: float


@dataclass(frozen=True)
class Partition:
    name: str
    node_type: str
    factor: float
    max_seconds: int
    interactive: bool = False
    preempt: bool = False


NODE_TYPES: dict[str, NodeType] = {
    "cpu": NodeType("cpu", None, 0, 128, 256.0, 1.0, 2.0),
    "a40x4": NodeType("a40x4", "A40", 4, 64, 256.0, 16.0, 62.5),
    "a100x4": NodeType("a100x4", "A100", 4, 64, 256.0, 16.0, 62.5),
    "a100x8": NodeType("a100x8", "A100", 8, 128, 2048.0, 16.0, 250.0),
    "h200x8": NodeType("h200x8", "H200", 8, 96, 2048.0, 12.0, 250.0),
    # The normal partition is x8 even though the architecture page mentions
    # an additional MI210 device. Do not model that ninth device as allocatable.
    "mi100x8": NodeType("mi100x8", "MI100", 8, 128, 2048.0, 16.0, 250.0),
}


def _partition(
    name: str,
    node_type: str,
    factor: float,
    hours: int,
    *,
    interactive: bool = False,
    preempt: bool = False,
) -> Partition:
    return Partition(
        name=name,
        node_type=node_type,
        factor=factor,
        max_seconds=hours * 3600,
        interactive=interactive,
        preempt=preempt,
    )


PARTITIONS: dict[str, Partition] = {
    item.name: item
    for item in [
        _partition("cpu", "cpu", 1.0, 48),
        _partition("cpu-interactive", "cpu", 2.0, 1, interactive=True),
        _partition("cpu-preempt", "cpu", 0.5, 48, preempt=True),
        _partition("gpuA40x4", "a40x4", 0.5, 48),
        _partition("gpuA40x4-interactive", "a40x4", 1.0, 1, interactive=True),
        _partition("gpuA40x4-preempt", "a40x4", 0.25, 48, preempt=True),
        _partition("gpuA100x4", "a100x4", 1.0, 48),
        _partition("gpuA100x4-interactive", "a100x4", 2.0, 1, interactive=True),
        _partition("gpuA100x4-preempt", "a100x4", 0.5, 48, preempt=True),
        _partition("gpuA100x8", "a100x8", 1.5, 48),
        _partition("gpuA100x8-interactive", "a100x8", 3.0, 1, interactive=True),
        _partition("gpuH200x8", "h200x8", 3.0, 48),
        _partition("gpuH200x8-interactive", "h200x8", 6.0, 1, interactive=True),
        _partition("gpuMI100x8", "mi100x8", 0.25, 48),
        _partition("gpuMI100x8-interactive", "mi100x8", 0.5, 1, interactive=True),
    ]
}

_DURATION_RE = re.compile(r"^(?:(?P<days>\d+)-)?(?P<body>\d+(?::\d+){0,2})$")
_SUFFIX_RE = re.compile(r"^(?P<value>\d+(?:\.\d+)?)(?P<unit>[smhd])$", re.IGNORECASE)
_SLURM_MEMORY_RE = re.compile(
    r"^(?P<value>\d+(?:\.\d+)?)\s*(?P<unit>[KMGTP]?)B?$",
    re.IGNORECASE,
)


def parse_duration(value: str) -> int:
    """Parse a Slurm-like duration into seconds.

    Bare integers mean minutes, one colon means MM:SS, two colons mean
    HH:MM:SS, and a leading D- adds days. Suffixes such as 15m/2h are accepted.
    """

    value = value.strip()
    suffix_match = _SUFFIX_RE.match(value)
    if suffix_match:
        amount = float(suffix_match.group("value"))
        unit = suffix_match.group("unit").lower()
        multiplier = {"s": 1, "m": 60, "h": 3600, "d": 86400}[unit]
        return int(math.ceil(amount * multiplier))

    match = _DURATION_RE.match(value)
    if not match:
        raise argparse.ArgumentTypeError(
            f"invalid duration {value!r}; use minutes, MM:SS, HH:MM:SS, "
            "D-HH:MM:SS, or a suffix such as 15m/2h"
        )

    days = int(match.group("days") or 0)
    parts = [int(part) for part in match.group("body").split(":")]
    if len(parts) == 1:
        seconds = parts[0] * 60
    elif len(parts) == 2:
        minutes, second = parts
        if second >= 60:
            raise argparse.ArgumentTypeError("seconds must be < 60")
        seconds = minutes * 60 + second
    else:
        hours, minutes, second = parts
        if minutes >= 60 or second >= 60:
            raise argparse.ArgumentTypeError("minutes and seconds must be < 60 in HH:MM:SS")
        seconds = hours * 3600 + minutes * 60 + second
    return days * 86400 + seconds


def format_duration(seconds: Union[int, float]) -> str:
    total = int(round(seconds))
    if total < 0:
        raise ValueError("duration cannot be negative")
    days, remainder = divmod(total, 86400)
    hours, remainder = divmod(remainder, 3600)
    minutes, seconds_part = divmod(remainder, 60)
    prefix = f"{days}-" if days else ""
    return f"{prefix}{hours:02d}:{minutes:02d}:{seconds_part:02d}"


def parse_slurm_memory_decimal_gb(value: str) -> float:
    """Convert a Slurm ``--mem`` value to decimal billing GB.

    Slurm memory values use binary units: a bare number is MiB, ``G`` is GiB,
    and so on. NCSA Delta's accounting examples define a GB as 1e9 bytes.
    Keeping those unit systems separate matters at billing boundaries: for
    example, ``60G`` is about 64.42 decimal GB, not 60 decimal GB.
    """

    raw = value.strip()
    match = _SLURM_MEMORY_RE.match(raw)
    if not match:
        raise argparse.ArgumentTypeError(
            f"invalid Slurm memory {value!r}; use values such as 60000, 58000M, 58G, or 1T"
        )
    amount = float(match.group("value"))
    unit = match.group("unit").upper() or "M"
    binary_bytes = {
        "K": 2**10,
        "M": 2**20,
        "G": 2**30,
        "T": 2**40,
        "P": 2**50,
    }[unit]
    return amount * binary_bytes / 1_000_000_000


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Estimate NCSA Delta SU usage. Static factors verified 2026-08-09; "
            "live configuration and jobcharge are authoritative."
        )
    )
    parser.add_argument("--partition", required=True, choices=sorted(PARTITIONS))
    parser.add_argument("--nodes", type=int, default=1)
    parser.add_argument("--gpus-per-node", type=int)
    parser.add_argument("--cpus-per-node", type=int, default=1)
    memory_group = parser.add_mutually_exclusive_group()
    memory_group.add_argument(
        "--mem",
        help=(
            "Slurm memory syntax per node, such as 58G. Slurm G means GiB; "
            "the estimator converts it to NCSA decimal billing GB."
        ),
    )
    memory_group.add_argument(
        "--mem-gb-per-node",
        type=float,
        help="Decimal billing GB per node (1 GB = 1e9 bytes), not Slurm GiB syntax",
    )
    parser.add_argument("--elapsed", type=parse_duration, help="Expected actual elapsed time")
    parser.add_argument("--walltime", type=parse_duration, help="Requested Slurm walltime")
    parser.add_argument("--exclusive", action="store_true", help="Model whole-node charging")
    parser.add_argument("--json", action="store_true", dest="as_json")
    return parser


def estimate(args: argparse.Namespace) -> dict:
    partition = PARTITIONS[args.partition]
    node = NODE_TYPES[partition.node_type]
    warnings: list[str] = []

    if args.nodes < 1:
        raise ValueError("--nodes must be >= 1")
    if args.cpus_per_node < 1:
        raise ValueError("--cpus-per-node must be >= 1")

    mem_slurm = getattr(args, "mem", None)
    mem_decimal_arg = getattr(args, "mem_gb_per_node", None)
    if mem_slurm is not None and mem_decimal_arg is not None:
        raise ValueError("use either --mem or --mem-gb-per-node, not both")
    if mem_decimal_arg is not None and mem_decimal_arg <= 0:
        raise ValueError("--mem-gb-per-node must be > 0")
    if args.elapsed is not None and args.elapsed <= 0:
        raise ValueError("--elapsed must be > 0")
    if args.walltime is not None and args.walltime <= 0:
        raise ValueError("--walltime must be > 0")

    mem_input: Optional[str]
    mem_is_all = False
    if mem_slurm is not None:
        try:
            parsed_mem_gb = parse_slurm_memory_decimal_gb(mem_slurm)
        except argparse.ArgumentTypeError as exc:
            raise ValueError(str(exc)) from exc
        mem_input = f"--mem={mem_slurm}"
        if parsed_mem_gb == 0:
            # Slurm --mem=0 requests all memory. Exact allocatable memory can
            # differ from installed memory, so this is only a conservative model.
            mem_is_all = True
            mem_gb = float(node.physical_mem_gb)
            warnings.append(
                "--mem=0 requests all node memory; modeled conservatively as installed "
                f"memory ({node.physical_mem_gb:g} decimal GB). Avoid --mem=0 unless whole-node memory is required."
            )
        else:
            mem_gb = parsed_mem_gb
    elif mem_decimal_arg is not None:
        mem_input = f"{float(mem_decimal_arg):g} decimal GB"
        mem_gb = float(mem_decimal_arg)
    else:
        # Delta documents a default around 1000 MB per requested core. This is
        # only a fallback for the estimator and should not be used in production.
        mem_input = "omitted; estimated from Delta default"
        mem_gb = float(args.cpus_per_node)
        warnings.append(
            "Memory was omitted; assumed approximately 1 decimal GB per requested CPU. "
            "Set --mem explicitly in production."
        )

    if node.gpu_model is None:
        if args.gpus_per_node not in (None, 0):
            raise ValueError("CPU partition cannot request GPUs")
        gpus = 0
        components = {
            "gpu_units": 0.0,
            "cpu_units": float(args.cpus_per_node),
            "memory_units": mem_gb / node.mem_gb_per_unit,
        }
        if args.exclusive:
            base_per_node = max(
                float(node.physical_cpus),
                node.physical_mem_gb / node.mem_gb_per_unit,
            )
        else:
            base_per_node = max(components.values())
    else:
        if args.gpus_per_node is None:
            if not args.exclusive:
                raise ValueError("GPU partition requires --gpus-per-node unless --exclusive is set")
            gpus = node.physical_gpus
            warnings.append(
                f"--exclusive without --gpus-per-node was modeled as all {node.physical_gpus} GPUs/node."
            )
        else:
            gpus = args.gpus_per_node
        if gpus < 1:
            raise ValueError("GPU partition requires at least 1 GPU per node")
        if gpus > node.physical_gpus:
            raise ValueError(
                f"{args.partition} has {node.physical_gpus} allocatable GPUs/node in this static model"
            )

        components = {
            "gpu_units": float(gpus),
            "cpu_units": args.cpus_per_node / node.cores_per_unit,
            "memory_units": mem_gb / node.mem_gb_per_unit,
        }
        if args.exclusive:
            base_per_node = max(
                float(node.physical_gpus),
                node.physical_cpus / node.cores_per_unit,
                node.physical_mem_gb / node.mem_gb_per_unit,
            )
        else:
            base_per_node = max(components.values())

    if args.cpus_per_node > node.physical_cpus:
        warnings.append(
            f"Requested {args.cpus_per_node} CPUs/node exceeds static physical count {node.physical_cpus}."
        )
    # Slurm-available memory is lower than installed, so equality is already a warning.
    if mem_gb >= node.physical_mem_gb:
        warnings.append(
            f"Requested {mem_gb:g} GB/node reaches or exceeds installed {node.physical_mem_gb:g} GB; "
            "available memory is normally lower."
        )
    if args.walltime is not None and args.walltime > partition.max_seconds:
        warnings.append(
            f"Walltime {format_duration(args.walltime)} exceeds the static partition maximum "
            f"{format_duration(partition.max_seconds)}."
        )
    if args.elapsed is not None and args.walltime is not None and args.elapsed > args.walltime:
        warnings.append("Expected elapsed exceeds requested walltime; the job would likely TIMEOUT.")
    if partition.interactive:
        warnings.append("Interactive partitions have premium factors and are intended for debugging.")
    if partition.preempt:
        warnings.append(
            "Preempt partition: lower nominal SU rate requires tested checkpoint/restart and may need retries."
        )
    if args.exclusive:
        warnings.append("Exclusive mode is modeled as whole-node charging.")

    max_component = max(components.values())
    dominant = [
        name
        for name, value in components.items()
        if math.isclose(value, max_component, rel_tol=1e-9, abs_tol=1e-9)
    ]
    if args.exclusive:
        dominant = ["whole_node_exclusive"]
    elif node.gpu_model is None:
        if components["memory_units"] > components["cpu_units"]:
            warnings.append(
                "Host memory, not CPU count, determines the estimated CPU-node billing rate."
            )
    else:
        if components["cpu_units"] > components["gpu_units"]:
            warnings.append(
                f"CPU request corresponds to {components['cpu_units']:.6g} GPU billing units/node, "
                f"above the {components['gpu_units']:.6g} requested GPU units."
            )
        if components["memory_units"] > components["gpu_units"]:
            unit_note = f"; {mem_input} converts to {mem_gb:.6g} decimal GB" if mem_slurm is not None else ""
            warnings.append(
                f"Host memory corresponds to {components['memory_units']:.6g} GPU billing units/node, "
                f"above the {components['gpu_units']:.6g} requested GPU units{unit_note}."
            )

    effective_rate = base_per_node * args.nodes * partition.factor
    actual_cost = (
        effective_rate * args.elapsed / 3600.0 if args.elapsed is not None else None
    )
    admission_cost = (
        effective_rate * args.walltime / 3600.0 if args.walltime is not None else None
    )

    return {
        "model_verified_date": "2026-08-09",
        "authority_note": "Estimate only; verify live settings and completed charges with NCSA jobcharge.",
        "partition": asdict(partition),
        "node_type": asdict(node),
        "request": {
            "nodes": args.nodes,
            "gpus_per_node": gpus,
            "cpus_per_node": args.cpus_per_node,
            "mem_input": mem_input,
            "mem_gb_decimal_per_node": mem_gb,
            "mem_requests_all": mem_is_all,
            "exclusive": bool(args.exclusive),
            "elapsed_seconds": args.elapsed,
            "walltime_seconds": args.walltime,
        },
        "unit_components_per_node": components,
        "dominant_component": dominant,
        "base_units_per_node_hour": base_per_node,
        "effective_su_per_hour_total": effective_rate,
        "estimated_actual_su": actual_cost,
        "requested_walltime_admission_su": admission_cost,
        "warnings": warnings,
    }


def _format_optional(value: Optional[float]) -> str:
    return "not supplied" if value is None else f"{value:.6g} SU"


def print_human(result: dict) -> None:
    request = result["request"]
    partition = result["partition"]
    node = result["node_type"]
    print("NCSA Delta SU estimate")
    print("=" * 72)
    print(f"Partition / factor    : {partition['name']} / {partition['factor']:g}")
    print(f"Node type / GPU       : {node['name']} / {node['gpu_model'] or 'CPU-only'}")
    print(
        "Request per node      : "
        f"{request['gpus_per_node']} GPU, {request['cpus_per_node']} CPU, "
        f"{request['mem_gb_decimal_per_node']:.6g} decimal GB; nodes={request['nodes']}"
    )
    print(f"Memory input          : {request['mem_input']}")
    print(
        "Billing units/node-h  : "
        f"GPU={result['unit_components_per_node']['gpu_units']:.4g}, "
        f"CPU={result['unit_components_per_node']['cpu_units']:.4g}, "
        f"memory={result['unit_components_per_node']['memory_units']:.4g}"
    )
    print(f"Dominant component    : {', '.join(result['dominant_component'])}")
    print(f"Effective SU/hour     : {result['effective_su_per_hour_total']:.6g}")
    print(f"Expected actual cost  : {_format_optional(result['estimated_actual_su'])}")
    print(f"Walltime admission    : {_format_optional(result['requested_walltime_admission_su'])}")
    if request["elapsed_seconds"] is not None:
        print(f"Expected elapsed      : {format_duration(request['elapsed_seconds'])}")
    if request["walltime_seconds"] is not None:
        print(f"Requested walltime    : {format_duration(request['walltime_seconds'])}")
    if result["warnings"]:
        print("\nWarnings:")
        for warning in result["warnings"]:
            print(f"- {warning}")
    print("\nEstimate only. Use `jobcharge -a ACCOUNT -d 10 --detail` after completion.")


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        result = estimate(args)
    except ValueError as exc:
        parser.error(str(exc))

    if args.as_json:
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print_human(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
