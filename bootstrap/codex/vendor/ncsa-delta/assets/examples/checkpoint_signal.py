#!/usr/bin/env python3
"""Minimal atomic checkpoint/restart demonstration for Delta preempt jobs.

This is an educational harness, not a framework-specific trainer. It handles
SIGUSR1/SIGTERM directly and also polls a request file created by the batch
shell. Checkpoints are written to a temporary file, fsynced, then atomically
renamed. A completed checkpoint is discovered on restart.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import time
from pathlib import Path

checkpoint_requested = False
terminate_after_checkpoint = False
request_reason = "none"


def handle_signal(signum: int, _frame: object) -> None:
    global checkpoint_requested, terminate_after_checkpoint, request_reason
    checkpoint_requested = True
    request_reason = signal.Signals(signum).name
    # On actual SIGTERM, save and leave promptly. USR1 is an early warning: save
    # but continue so a scheduler-driven preemption can requeue the allocation.
    if signum == signal.SIGTERM:
        terminate_after_checkpoint = True


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp.{os.getpid()}")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, sort_keys=True)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    # Best-effort directory fsync so the rename is durable on supported FSes.
    try:
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError:
        pass


def load_latest(path: Path) -> dict:
    if not path.exists():
        return {"next_step": 0, "generation": 0}
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value.get("next_step"), int):
        raise ValueError(f"invalid checkpoint: {path}")
    return value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint-dir", type=Path, required=True)
    parser.add_argument("--request-file", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=1000)
    parser.add_argument("--seconds-per-step", type=float, default=1.0)
    parser.add_argument("--checkpoint-every", type=int, default=60)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.steps < 1 or args.seconds_per_step < 0 or args.checkpoint_every < 1:
        raise SystemExit("steps/checkpoint-every must be positive; seconds-per-step must be nonnegative")

    signal.signal(signal.SIGUSR1, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    latest = args.checkpoint_dir / "latest.json"
    state = load_latest(latest)
    start = state["next_step"]
    generation = int(state.get("generation", 0))
    print(
        f"resume checkpoint={latest} start_step={start} generation={generation} "
        f"job={os.environ.get('SLURM_JOB_ID')} restart={os.environ.get('SLURM_RESTART_COUNT', '0')}",
        flush=True,
    )

    def save(next_step: int, why: str) -> None:
        nonlocal generation
        generation += 1
        payload = {
            "next_step": next_step,
            "generation": generation,
            "reason": why,
            "saved_at_unix": time.time(),
            "job_id": os.environ.get("SLURM_JOB_ID"),
            "restart_count": os.environ.get("SLURM_RESTART_COUNT", "0"),
        }
        atomic_json(latest, payload)
        print(f"checkpoint_saved next_step={next_step} reason={why} generation={generation}", flush=True)

    global checkpoint_requested, terminate_after_checkpoint, request_reason
    for step in range(start, args.steps):
        # Replace with a real optimizer step.
        time.sleep(args.seconds_per_step)
        next_step = step + 1

        if args.request_file.exists():
            try:
                request_text = args.request_file.read_text(encoding="utf-8").strip()
            except OSError:
                request_text = "request-file"
            checkpoint_requested = True
            request_reason = request_text or "request-file"
            try:
                args.request_file.unlink()
            except FileNotFoundError:
                pass

        if checkpoint_requested:
            save(next_step, request_reason)
            checkpoint_requested = False
            request_reason = "none"
            if terminate_after_checkpoint:
                print("terminating_after_checkpoint_due_to_SIGTERM", flush=True)
                return 143
        elif next_step % args.checkpoint_every == 0:
            save(next_step, "periodic")

        if next_step % 10 == 0:
            print(f"progress step={next_step}/{args.steps}", flush=True)

    save(args.steps, "completed")
    (args.checkpoint_dir / "_SUCCESS").write_text(f"completed_at={time.time()}\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
