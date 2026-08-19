#!/usr/bin/env python3
"""Write an immutable, exact PyTorch 2.8/cu128 runtime receipt.

This probe is intentionally strict.  It distinguishes a login-node preflight
from a compute-node runtime check and never treats ``module spider`` output as
proof that the numerical runtime is usable.  Lmod load routing is retained as
provenance, but only the exact interpreter/framework fields below define
login-to-compute numerical-runtime parity.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import socket
import sys
import tempfile
from pathlib import Path
from typing import Any


EXPECTED_PYTHON = "3.11.13"
EXPECTED_TORCH = "2.8.0+cu128"
EXPECTED_CUDA = "12.8"
EXPECTED_PREFIX = Path("/sw/rh9.4/user/python/conda-env/pytorch-2.8-cu128")

# Lmod visibility and cache state may legitimately make the login node use the
# hidden-module fallback while a compute node resolves the public wrapper (or
# vice versa).  Those routes are operational provenance, not numerical runtime
# identity.  Keep this partition explicit so an observational field cannot be
# accidentally promoted back into the fail-closed parity gate.
CORE_RUNTIME_PARITY_FIELDS = (
    "python_version",
    "python_executable",
    "python_executable_resolved",
    "python_prefix",
    "torch_version",
    "torch_file",
    "torch_cuda_version",
)
OBSERVATION_ONLY_FIELDS = (
    "load_method",
    "wrapper_rc",
    "module_list",
)


def build_login_compute_parity_checks(
    login_data: dict[str, Any], current_runtime: dict[str, Any]
) -> dict[str, bool]:
    """Compare only fields that identify the numerical Python/Torch runtime."""

    return {
        f"matches_login_{field}": current_runtime.get(field) == login_data.get(field)
        for field in CORE_RUNTIME_PARITY_FIELDS
    }


def differing_observation_fields(
    login_data: dict[str, Any], current_observations: dict[str, Any]
) -> list[str]:
    """Report route/module drift without turning it into a parity failure."""

    return [
        field
        for field in OBSERVATION_ONLY_FIELDS
        if current_observations.get(field) != login_data.get(field)
    ]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def under(path: str | None, root: Path) -> bool:
    if not path:
        return False
    try:
        return os.path.commonpath([str(Path(path).resolve()), str(root.resolve())]) == str(
            root.resolve()
        )
    except (OSError, ValueError):
        return False


def write_immutable_json(path: Path, payload: dict[str, Any]) -> None:
    """Create *path* atomically without replacing an earlier attempt receipt."""

    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError(f"refusing to replace existing receipt: {path}")
    temporary: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=path.parent,
            prefix=f".{path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump(payload, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, 0o640)
        # Hard-link creation fails if another process/attempt already owns path.
        os.link(temporary, path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def load_login_receipt(path: Path | None) -> tuple[dict[str, Any] | None, str | None]:
    if path is None:
        return None, None
    with path.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    return data, sha256_file(path)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Write an exact Delta PyTorch 2.8/cu128 login or compute receipt."
    )
    parser.add_argument("--phase", choices=["login", "compute"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--load-method", choices=["wrapper", "fallback"], required=True)
    parser.add_argument("--wrapper-rc", type=int, required=True)
    parser.add_argument("--login-receipt", type=Path)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.output.exists():
        print(f"refusing to replace existing receipt: {args.output}", file=sys.stderr)
        return 4
    if args.phase == "compute" and args.login_receipt is None:
        print("compute phase requires --login-receipt", file=sys.stderr)
        return 2
    if args.phase == "login" and args.login_receipt is not None:
        print("login phase must not receive --login-receipt", file=sys.stderr)
        return 2

    login_data: dict[str, Any] | None = None
    login_sha256: str | None = None
    login_error: str | None = None
    try:
        login_data, login_sha256 = load_login_receipt(args.login_receipt)
    except Exception as exc:  # preserve an auditable failed compute receipt
        login_error = f"{type(exc).__name__}: {exc}"

    torch_error: str | None = None
    torch: Any = None
    try:
        import torch as imported_torch

        torch = imported_torch
    except Exception as exc:
        torch_error = f"{type(exc).__name__}: {exc}"

    python_version = platform.python_version()
    python_executable = sys.executable
    python_executable_resolved = str(Path(sys.executable).resolve())
    python_prefix = str(Path(sys.prefix).resolve())
    torch_version = str(torch.__version__) if torch is not None else None
    torch_file = (
        str(Path(torch.__file__).resolve())
        if torch is not None and getattr(torch, "__file__", None)
        else None
    )
    torch_cuda_version = str(torch.version.cuda) if torch is not None else None
    cuda_available = bool(torch.cuda.is_available()) if torch is not None else False
    # Do not ask NVML for a device count on a GPU-less login node.  That probe
    # is meaningful and mandatory only inside the compute allocation.
    device_count = (
        int(torch.cuda.device_count())
        if torch is not None and args.phase == "compute"
        else 0
    )

    checks: dict[str, bool] = {
        "python_version_exact": python_version == EXPECTED_PYTHON,
        "python_executable_exact": python_executable
        == str(EXPECTED_PREFIX / "bin/python"),
        "python_executable_resolves_under_expected_prefix": under(
            python_executable_resolved, EXPECTED_PREFIX
        ),
        "python_prefix_exact": python_prefix == str(EXPECTED_PREFIX.resolve()),
        "torch_imported": torch is not None,
        "torch_version_exact": torch_version == EXPECTED_TORCH,
        "torch_cuda_build_exact": torch_cuda_version == EXPECTED_CUDA,
        "torch_origin_under_expected_prefix": under(torch_file, EXPECTED_PREFIX),
        "architecture_x86_64": platform.machine() == "x86_64",
    }
    if args.phase == "compute":
        checks.update(
            {
                "cuda_available_on_compute": cuda_available,
                "visible_device_count_positive": device_count > 0,
                "login_receipt_loaded": login_data is not None and login_error is None,
                "login_receipt_passed": bool(login_data and login_data.get("passed")),
                "login_receipt_phase": bool(login_data and login_data.get("phase") == "login"),
            }
        )

    current_runtime: dict[str, Any] = {
        "python_version": python_version,
        "python_executable": python_executable,
        "python_executable_resolved": python_executable_resolved,
        "python_prefix": python_prefix,
        "torch_version": torch_version,
        "torch_file": torch_file,
        "torch_cuda_version": torch_cuda_version,
    }
    current_observations: dict[str, Any] = {
        "load_method": args.load_method,
        "wrapper_rc": args.wrapper_rc,
        "module_list": os.environ.get("DELTA_PYTORCH_MODULE_LIST", "").splitlines(),
    }
    observation_differences: list[str] = []
    if args.phase == "compute" and login_data is not None:
        checks.update(build_login_compute_parity_checks(login_data, current_runtime))
        observation_differences = differing_observation_fields(
            login_data, current_observations
        )

    device_name: str | None = None
    device_capability: list[int] | None = None
    if torch is not None and cuda_available and device_count > 0:
        device_name = str(torch.cuda.get_device_name(0))
        device_capability = list(torch.cuda.get_device_capability(0))

    payload: dict[str, Any] = {
        "schema": "ncsa_delta_pytorch_2_8_cu128_runtime_receipt_v1",
        "phase": args.phase,
        "passed": all(checks.values()),
        "checks": checks,
        "expected": {
            "python_version": EXPECTED_PYTHON,
            "torch_version": EXPECTED_TORCH,
            "torch_cuda_version": EXPECTED_CUDA,
            "prefix": str(EXPECTED_PREFIX),
        },
        "python_version": python_version,
        "python_verbose_version": sys.version,
        "python_executable": python_executable,
        "python_executable_resolved": python_executable_resolved,
        "python_prefix": python_prefix,
        "torch_version": torch_version,
        "torch_file": torch_file,
        "torch_cuda_version": torch_cuda_version,
        "torch_import_error": torch_error,
        "cuda_available": cuda_available,
        "visible_device_count": device_count,
        "device_name_0": device_name,
        "device_capability_0": device_capability,
        "load_method": current_observations["load_method"],
        "wrapper_rc": current_observations["wrapper_rc"],
        "module_list": current_observations["module_list"],
        "host": socket.getfqdn(),
        "machine": platform.machine(),
        "slurm_job_id": os.environ.get("SLURM_JOB_ID"),
        "slurm_job_name": os.environ.get("SLURM_JOB_NAME"),
        "cuda_visible_devices": os.environ.get("CUDA_VISIBLE_DEVICES"),
        "login_receipt": str(args.login_receipt) if args.login_receipt else None,
        "login_receipt_sha256": login_sha256,
        "login_receipt_error": login_error,
        "compared_login_fields": (
            list(CORE_RUNTIME_PARITY_FIELDS) if args.phase == "compute" else []
        ),
        "observation_only_fields": list(OBSERVATION_ONLY_FIELDS),
        "observations_differing_from_login": observation_differences,
    }
    write_immutable_json(args.output, payload)
    if not payload["passed"]:
        failed = [name for name, passed in checks.items() if not passed]
        print(f"runtime receipt failed checks: {', '.join(failed)}", file=sys.stderr)
        return 3
    print(f"runtime receipt PASS: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
