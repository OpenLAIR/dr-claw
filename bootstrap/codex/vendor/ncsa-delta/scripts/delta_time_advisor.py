#!/usr/bin/env python3
"""Recommend a conservative Delta walltime from Slurm history or an initial guess."""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import statistics
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

from delta_cost import PARTITIONS, format_duration, parse_duration


@dataclass
class Record:
    job_id: str
    job_name: str
    partition: str
    state: str
    elapsed_seconds: int


def percentile(values: list[int], pct: float) -> float:
    if not values:
        raise ValueError("empty data")
    ordered = sorted(values)
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (len(ordered) - 1) * pct
    lower = math.floor(rank)
    upper = math.ceil(rank)
    if lower == upper:
        return float(ordered[lower])
    weight = rank - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def parse_sacct_lines(lines: Iterable[str], partition_filter: Optional[str]) -> list[Record]:
    records: list[Record] = []
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        fields = line.split("|")
        if len(fields) < 5:
            continue
        job_id, job_name, partition, state, elapsed_raw = fields[:5]
        # Skip .batch/.extern and other steps; array elements like 123_4 are kept.
        if "." in job_id:
            continue
        if state.split()[0].split("+")[0] != "COMPLETED":
            continue
        if partition_filter and partition != partition_filter:
            continue
        try:
            elapsed = int(float(elapsed_raw))
        except ValueError:
            continue
        if elapsed <= 0:
            continue
        records.append(Record(job_id, job_name, partition, state, elapsed))
    return records


def run_sacct(job_name: str, days: int, partition: Optional[str]) -> list[Record]:
    if not shutil.which("sacct"):
        raise RuntimeError("sacct is not available; run this on Delta or pass --input/--expected")
    command = [
        "sacct",
        "-X",
        "-S",
        f"now-{days}days",
        "-u",
        os.environ.get("USER", ""),
        "--name",
        job_name,
        "--state=COMPLETED",
        "--noheader",
        "--parsable2",
        "--format=JobIDRaw,JobName,Partition,State,ElapsedRaw",
    ]
    proc = subprocess.run(command, text=True, capture_output=True, check=False)
    if proc.returncode != 0:
        raise RuntimeError(f"sacct failed ({proc.returncode}): {proc.stderr.strip()}")
    return parse_sacct_lines(proc.stdout.splitlines(), partition)


def load_input(path: Path, partition: Optional[str]) -> list[Record]:
    return parse_sacct_lines(path.read_text(encoding="utf-8").splitlines(), partition)


def ceil_minute(seconds: float) -> int:
    return int(math.ceil(seconds / 60.0) * 60)


def recommendation_from_history(values: list[int]) -> tuple[int, dict]:
    p50 = percentile(values, 0.50)
    p90 = percentile(values, 0.90)
    p95 = percentile(values, 0.95)
    maximum = max(values)
    if p95 < 3600:
        margin = max(300.0, p95 * 0.20)
        policy = "P95 + max(5 min, 20% of P95)"
    else:
        margin = max(600.0, p95 * 0.15)
        policy = "P95 + max(10 min, 15% of P95)"
    recommended = ceil_minute(p95 + margin)
    return recommended, {
        "count": len(values),
        "p50_seconds": p50,
        "p90_seconds": p90,
        "p95_seconds": p95,
        "max_seconds": maximum,
        "margin_seconds": margin,
        "policy": policy,
    }


def recommendation_from_guess(expected: int) -> tuple[int, dict]:
    if expected <= 1800:
        recommended = ceil_minute(expected * 2.0)
        policy = "No history: 2x initial estimate for jobs <= 30 min"
    elif expected <= 4 * 3600:
        recommended = ceil_minute(expected * 1.5)
        policy = "No history: 1.5x initial estimate for jobs <= 4 h"
    else:
        recommended = ceil_minute(expected * 1.25 + 600)
        policy = "No history: 1.25x estimate + 10 min for long jobs"
    return recommended, {
        "count": 0,
        "expected_seconds": expected,
        "policy": policy,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Recommend NCSA Delta walltime from successful sacct history.")
    parser.add_argument("--job-name", help="Exact Slurm job name for sacct query")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--partition", choices=sorted(PARTITIONS))
    parser.add_argument(
        "--input",
        type=Path,
        help="Pipe-delimited file with JobIDRaw|JobName|Partition|State|ElapsedRaw; bypass sacct",
    )
    parser.add_argument("--expected", type=parse_duration, help="Initial expected runtime if history is absent")
    parser.add_argument("--json", action="store_true", dest="as_json")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.days < 1:
        raise SystemExit("--days must be >= 1")
    if not args.input and not args.job_name and args.expected is None:
        raise SystemExit("provide --job-name, --input, or --expected")

    records: list[Record] = []
    source = "none"
    error: Optional[str] = None
    if args.input:
        records = load_input(args.input, args.partition)
        source = str(args.input)
    elif args.job_name:
        try:
            records = run_sacct(args.job_name, args.days, args.partition)
            source = f"sacct:{args.job_name}:{args.days}days"
        except RuntimeError as exc:
            error = str(exc)

    if records:
        values = [r.elapsed_seconds for r in records]
        recommended, stats = recommendation_from_history(values)
        confidence = "low" if len(values) < 5 else "medium" if len(values) < 10 else "higher"
    elif args.expected is not None:
        recommended, stats = recommendation_from_guess(args.expected)
        confidence = "low"
    else:
        message = error or "No matching successful history. Supply --expected, broaden --days, or inspect sacct input."
        raise SystemExit(message)

    max_seconds = PARTITIONS[args.partition].max_seconds if args.partition else None
    segmentation_needed = bool(max_seconds and recommended > max_seconds)
    final = min(recommended, max_seconds) if max_seconds else recommended

    result = {
        "source": source,
        "history_error": error,
        "partition": args.partition,
        "statistics": stats,
        "confidence": confidence,
        "recommended_seconds_before_partition_cap": recommended,
        "recommended_walltime_seconds": final,
        "recommended_walltime": format_duration(final),
        "partition_max_seconds": max_seconds,
        "segmentation_or_checkpoint_chain_needed": segmentation_needed,
        "notes": [
            "Include environment setup, staging, validation, checkpoint, and copy-back in walltime.",
            "A shorter accurate limit may improve backfill, but too short causes TIMEOUT.",
            "Recalculate after representative successful runs; do not mix different input scales or GPU counts.",
        ],
    }

    if args.as_json:
        json.dump(result, sys.stdout, indent=2, sort_keys=True)
        print()
    else:
        print("NCSA Delta walltime advice")
        print("=" * 72)
        print(f"Source               : {source}")
        if error:
            print(f"History query note   : {error}")
        print(f"Confidence           : {confidence}")
        if stats.get("count", 0):
            print(f"Successful samples   : {stats['count']}")
            print(f"P50 / P90 / P95 / max: {format_duration(round(stats['p50_seconds']))} / "
                  f"{format_duration(round(stats['p90_seconds']))} / "
                  f"{format_duration(round(stats['p95_seconds']))} / "
                  f"{format_duration(round(stats['max_seconds']))}")
        elif "expected_seconds" in stats:
            print(f"Initial estimate     : {format_duration(stats['expected_seconds'])}")
        print(f"Policy               : {stats['policy']}")
        print(f"Recommended walltime : {format_duration(final)}")
        if segmentation_needed:
            print(
                f"WARNING              : uncapped recommendation {format_duration(recommended)} exceeds "
                f"partition max {format_duration(max_seconds or 0)}; split/checkpoint the workload."
            )
        print("\nRe-run after collecting representative successful jobs.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
