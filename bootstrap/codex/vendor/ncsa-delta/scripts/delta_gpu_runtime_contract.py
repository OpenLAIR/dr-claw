#!/usr/bin/env python3
"""Validate one Delta NVIDIA allocation runtime receipt without GPU pinning.

The contract deliberately keeps three ordinal namespaces separate:

* Slurm's node-global scheduler ordinals (GRES IDX/JOB_GPUS/STEP_GPUS);
* allocation-visible inventory ordinals (CUDA_VISIBLE_DEVICES/nvidia-smi);
* framework-local ordinals (for example Torch local device indices).

Only cardinality and consistency *within* a namespace are checked.  UUID,
name, and PCI fields are used only to join observations made inside the same
allocation; they are never compared with a preselected GPU identity.

This module supports Python 3.9+ and uses only the standard library.  It
validates an already captured receipt; it does not import Torch or access a
GPU, project dataset, checkpoint, Validation, or Test split.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Optional, Tuple


INPUT_SCHEMA = "ncsa_delta_gpu_runtime_contract_input_v1"
REPORT_SCHEMA = "ncsa_delta_gpu_runtime_contract_report_v1"


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _parse_integer_list(value: Any, field: str) -> List[int]:
    """Parse a list such as ``3``, ``0,2``, or ``0-3``.

    The resulting integers retain the namespace of *field*.  Callers must not
    compare them with ordinals originating in another namespace.
    """

    if isinstance(value, list):
        if not all(_is_int(item) and item >= 0 for item in value):
            raise ValueError("%s must contain only non-negative integers" % field)
        return list(value)
    if not isinstance(value, str):
        raise ValueError("%s must be a string or integer list" % field)
    if not value.strip():
        return []
    parsed: List[int] = []
    for token in value.split(","):
        token = token.strip()
        if re.fullmatch(r"[0-9]+", token):
            parsed.append(int(token))
        elif re.fullmatch(r"[0-9]+-[0-9]+", token):
            start_text, end_text = token.split("-", 1)
            start, end = int(start_text), int(end_text)
            if end < start:
                raise ValueError("%s has a descending range: %s" % (field, token))
            parsed.extend(range(start, end + 1))
        else:
            raise ValueError("%s has an unsupported token: %s" % (field, token))
    return parsed


def _parse_gres_indices(value: Any) -> List[int]:
    if not isinstance(value, str):
        raise ValueError("scheduler.scontrol_gres_detail must be a string")
    matches = re.findall(r"IDX:([0-9,-]+)", value)
    if not matches:
        raise ValueError("scheduler.scontrol_gres_detail has no IDX field")
    parsed: List[int] = []
    for match in matches:
        parsed.extend(_parse_integer_list(match, "scheduler.scontrol_gres_detail"))
    return parsed


def _cuda_visible_tokens(value: Any) -> List[str]:
    if not isinstance(value, str):
        raise ValueError("allocation_visible.cuda_visible_devices must be a string")
    if not value.strip():
        return []
    tokens = [token.strip() for token in value.split(",")]
    if any(not token for token in tokens):
        raise ValueError("allocation_visible.cuda_visible_devices has an empty token")
    return tokens


def _normalized_name(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("%s must be a non-empty string" % field)
    return re.sub(r"\s+", " ", value.strip()).casefold()


def _nonempty_string(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("%s must be a non-empty string" % field)
    return value.strip()


def _positive_int(value: Any, field: str) -> int:
    if not _is_int(value) or value <= 0:
        raise ValueError("%s must be a positive integer" % field)
    return int(value)


def _nonnegative_int(value: Any, field: str) -> int:
    if not _is_int(value) or value < 0:
        raise ValueError("%s must be a non-negative integer" % field)
    return int(value)


def _absolute_posix(value: Any, field: str) -> str:
    text = _nonempty_string(value, field)
    if not PurePosixPath(text).is_absolute():
        raise ValueError("%s must be an absolute path" % field)
    return text


def _unique(values: Iterable[Any]) -> bool:
    values_list = list(values)
    return len(values_list) == len(set(values_list))


def _validate(payload: Dict[str, Any]) -> Dict[str, Any]:
    if payload.get("schema") != INPUT_SCHEMA:
        raise ValueError("input schema must be %s" % INPUT_SCHEMA)

    requested = _positive_int(payload.get("requested_gpu_count"), "requested_gpu_count")
    minimum_usable = _positive_int(
        payload.get("minimum_usable_memory_bytes"),
        "minimum_usable_memory_bytes",
    )

    scheduler = payload.get("scheduler")
    visible = payload.get("allocation_visible")
    torch_data = payload.get("torch")
    python_data = payload.get("python")
    for value, field in [
        (scheduler, "scheduler"),
        (visible, "allocation_visible"),
        (torch_data, "torch"),
        (python_data, "python"),
    ]:
        if not isinstance(value, dict):
            raise ValueError("%s must be an object" % field)

    assert isinstance(scheduler, dict)
    assert isinstance(visible, dict)
    assert isinstance(torch_data, dict)
    assert isinstance(python_data, dict)

    gres_indices = _parse_gres_indices(scheduler.get("scontrol_gres_detail"))
    job_gpus = _parse_integer_list(
        scheduler.get("slurm_job_gpus"), "scheduler.slurm_job_gpus"
    )
    step_gpus = _parse_integer_list(
        scheduler.get("slurm_step_gpus"), "scheduler.slurm_step_gpus"
    )
    cvd_tokens = _cuda_visible_tokens(visible.get("cuda_visible_devices"))

    nvidia_rows = visible.get("nvidia_smi_rows")
    if not isinstance(nvidia_rows, list):
        raise ValueError("allocation_visible.nvidia_smi_rows must be a list")
    normalized_rows: List[Dict[str, Any]] = []
    for index, raw in enumerate(nvidia_rows):
        if not isinstance(raw, dict):
            raise ValueError("nvidia_smi_rows[%d] must be an object" % index)
        normalized_rows.append(
            {
                "visible_index": _nonnegative_int(
                    raw.get("visible_index"),
                    "nvidia_smi_rows[%d].visible_index" % index,
                ),
                "uuid": _nonempty_string(
                    raw.get("uuid"), "nvidia_smi_rows[%d].uuid" % index
                ),
                "name": _normalized_name(
                    raw.get("name"), "nvidia_smi_rows[%d].name" % index
                ),
                "pci_bus_id": _nonempty_string(
                    raw.get("pci_bus_id"),
                    "nvidia_smi_rows[%d].pci_bus_id" % index,
                ).casefold(),
                "memory_total_mib": _positive_int(
                    raw.get("memory_total_mib"),
                    "nvidia_smi_rows[%d].memory_total_mib" % index,
                ),
            }
        )

    available = torch_data.get("available") is True
    torch_count = _nonnegative_int(torch_data.get("device_count"), "torch.device_count")
    torch_devices = torch_data.get("devices")
    if not isinstance(torch_devices, list):
        raise ValueError("torch.devices must be a list")
    normalized_torch: List[Dict[str, Any]] = []
    for index, raw in enumerate(torch_devices):
        if not isinstance(raw, dict):
            raise ValueError("torch.devices[%d] must be an object" % index)
        normalized_torch.append(
            {
                "local_index": _nonnegative_int(
                    raw.get("local_index"), "torch.devices[%d].local_index" % index
                ),
                "uuid": _nonempty_string(
                    raw.get("uuid"), "torch.devices[%d].uuid" % index
                ),
                "name": _normalized_name(
                    raw.get("name"), "torch.devices[%d].name" % index
                ),
                "pci_bus_id": _nonempty_string(
                    raw.get("pci_bus_id"),
                    "torch.devices[%d].pci_bus_id" % index,
                ).casefold(),
                "usable_memory_bytes": _positive_int(
                    raw.get("usable_memory_bytes"),
                    "torch.devices[%d].usable_memory_bytes" % index,
                ),
            }
        )

    lexical = _absolute_posix(
        python_data.get("lexical_launcher"), "python.lexical_launcher"
    )
    resolved = _absolute_posix(
        python_data.get("resolved_target"), "python.resolved_target"
    )
    expected_lexical = _absolute_posix(
        python_data.get("expected_lexical_launcher"),
        "python.expected_lexical_launcher",
    )
    expected_resolved = _absolute_posix(
        python_data.get("expected_resolved_target"),
        "python.expected_resolved_target",
    )

    checks: Dict[str, bool] = {}

    def check(name: str, condition: bool) -> None:
        checks[name] = bool(condition)

    # Namespace 1: scheduler/node-global IDs.  Ordinal equality is legal only
    # here because all three fields originate in the same scheduler namespace.
    check("scheduler_gres_count_matches_request", len(gres_indices) == requested)
    check("scheduler_job_gpu_count_matches_request", len(job_gpus) == requested)
    check("scheduler_step_gpu_count_matches_request", len(step_gpus) == requested)
    check("scheduler_gres_indices_unique", _unique(gres_indices))
    check("scheduler_job_gpu_indices_unique", _unique(job_gpus))
    check("scheduler_step_gpu_indices_unique", _unique(step_gpus))
    check("scheduler_job_gpus_match_gres", sorted(job_gpus) == sorted(gres_indices))
    check("scheduler_step_gpus_match_job", sorted(step_gpus) == sorted(job_gpus))

    # Namespace 2: allocation-visible inventory.  CVD tokens remain opaque;
    # their numerals are never compared with scheduler or nvidia-smi ordinals.
    visible_indices = [row["visible_index"] for row in normalized_rows]
    check("cuda_visible_token_count_matches_request", len(cvd_tokens) == requested)
    check("cuda_visible_tokens_unique", _unique(cvd_tokens))
    check("nvidia_visible_row_count_matches_request", len(normalized_rows) == requested)
    check("nvidia_visible_indices_unique", _unique(visible_indices))
    check("nvidia_visible_indices_are_local_contiguous", sorted(visible_indices) == list(range(requested)))
    check("nvidia_visible_uuids_unique", _unique(row["uuid"] for row in normalized_rows))
    check(
        "nvidia_visible_pci_ids_unique",
        _unique(row["pci_bus_id"] for row in normalized_rows),
    )

    # Namespace 3: framework-local IDs.
    local_indices = [device["local_index"] for device in normalized_torch]
    check("torch_accelerator_available", available)
    check("torch_device_count_matches_request", torch_count == requested)
    check("torch_device_records_match_count", len(normalized_torch) == torch_count)
    check("torch_local_indices_unique", _unique(local_indices))
    check("torch_local_indices_contiguous", sorted(local_indices) == list(range(torch_count)))
    check("torch_observed_uuids_unique", _unique(device["uuid"] for device in normalized_torch))

    joins: List[Dict[str, Any]] = []
    all_joins_unique = True
    all_uuid_match = True
    all_name_match = True
    all_pci_match = True
    all_memory_positive_and_not_above_board = True
    all_memory_meets_minimum = True
    for device in normalized_torch:
        candidates = [row for row in normalized_rows if row["uuid"] == device["uuid"]]
        unique_join = len(candidates) == 1
        all_joins_unique = all_joins_unique and unique_join
        if unique_join:
            row = candidates[0]
            uuid_match = row["uuid"] == device["uuid"]
            name_match = row["name"] == device["name"]
            pci_match = row["pci_bus_id"] == device["pci_bus_id"]
            board_bytes = int(row["memory_total_mib"]) * 1024 * 1024
            usable_bytes = int(device["usable_memory_bytes"])
            memory_within_board = 0 < usable_bytes <= board_bytes
            memory_meets_minimum = usable_bytes >= minimum_usable
            memory_difference = board_bytes - usable_bytes
            row_index: Optional[int] = int(row["visible_index"])
        else:
            uuid_match = False
            name_match = False
            pci_match = False
            board_bytes = None
            usable_bytes = int(device["usable_memory_bytes"])
            memory_within_board = False
            memory_meets_minimum = usable_bytes >= minimum_usable
            memory_difference = None
            row_index = None
        all_uuid_match = all_uuid_match and uuid_match
        all_name_match = all_name_match and name_match
        all_pci_match = all_pci_match and pci_match
        all_memory_positive_and_not_above_board = (
            all_memory_positive_and_not_above_board and memory_within_board
        )
        all_memory_meets_minimum = all_memory_meets_minimum and memory_meets_minimum
        joins.append(
            {
                "torch_local_index": device["local_index"],
                "nvidia_visible_index": row_index,
                "uuid": device["uuid"],
                "unique_same_allocation_uuid_join": unique_join,
                "name_matches": name_match,
                "pci_bus_id_matches": pci_match,
                "torch_usable_memory_bytes": usable_bytes,
                "nvidia_board_total_bytes": board_bytes,
                "board_minus_torch_usable_bytes": memory_difference,
                "meets_declared_minimum": memory_meets_minimum,
            }
        )

    check("same_allocation_uuid_join_unique", all_joins_unique)
    check("same_allocation_uuid_matches", all_uuid_match)
    check("same_allocation_name_matches", all_name_match)
    check("same_allocation_pci_matches", all_pci_match)
    check(
        "torch_usable_memory_positive_and_not_above_board_total",
        all_memory_positive_and_not_above_board,
    )
    check("torch_usable_memory_meets_declared_minimum", all_memory_meets_minimum)

    # Lexical launcher identity and resolved target identity are intentionally
    # two independent comparisons.  A valid symlink may make them unequal.
    check("python_lexical_launcher_matches_expected_lexical", lexical == expected_lexical)
    check("python_resolved_target_matches_expected_resolved", resolved == expected_resolved)

    # This invariant documents what the implementation did not do.  It remains
    # true by construction and is regression-tested with IDX 3 -> visible 0.
    check("no_cross_namespace_ordinal_equality_required", True)
    check("no_cross_job_gpu_identity_target_present", "expected_gpu_uuid" not in payload)

    failed_checks = sorted(name for name, passed in checks.items() if not passed)
    return {
        "schema": REPORT_SCHEMA,
        "input_schema": INPUT_SCHEMA,
        "passed": not failed_checks,
        "checks": checks,
        "failed_checks": failed_checks,
        "observed": {
            "requested_gpu_count": requested,
            "scheduler_node_global": {
                "gres_indices": gres_indices,
                "slurm_job_gpus": job_gpus,
                "slurm_step_gpus": step_gpus,
            },
            "allocation_visible": {
                "cuda_visible_devices_tokens": cvd_tokens,
                "nvidia_smi_visible_indices": visible_indices,
            },
            "framework_local": {"torch_local_indices": local_indices},
            "same_allocation_observational_joins": joins,
            "python": {
                "lexical_launcher": lexical,
                "resolved_target": resolved,
                "lexical_equals_resolved": lexical == resolved,
                "comparison_contract": "lexical-to-lexical and resolved-to-resolved only",
            },
        },
        "claim_boundary": {
            "cross_namespace_ordinal_equality_performed": False,
            "gpu_model_uuid_pci_or_node_pinned": False,
            "uuid_name_pci_use": "same-allocation observational join only",
            "memory_rule": "declared minimum <= Torch usable bytes <= observed board total; exact equality is not required",
        },
    }


def validate(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Return a fail-closed report, including for malformed inputs."""

    try:
        return _validate(payload)
    except Exception as exc:
        return {
            "schema": REPORT_SCHEMA,
            "input_schema": payload.get("schema") if isinstance(payload, dict) else None,
            "passed": False,
            "checks": {"input_well_formed": False},
            "failed_checks": ["input_well_formed"],
            "error": "%s: %s" % (type(exc).__name__, exc),
            "claim_boundary": {
                "cross_namespace_ordinal_equality_performed": False,
                "gpu_model_uuid_pci_or_node_pinned": False,
            },
        }


def _write_immutable(path: Path, report: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError("refusing to replace existing report: %s" % path)
    temporary: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=str(path.parent),
            prefix=".%s." % path.name,
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary = Path(handle.name)
            json.dump(report, handle, indent=2, sort_keys=True)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(str(temporary), 0o640)
        os.link(str(temporary), str(path))
    finally:
        if temporary is not None:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate a captured single-node Delta NVIDIA runtime receipt."
    )
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    try:
        with args.input.open("r", encoding="utf-8") as handle:
            payload = json.load(handle)
    except Exception as exc:
        report = {
            "schema": REPORT_SCHEMA,
            "passed": False,
            "checks": {"input_json_readable": False},
            "failed_checks": ["input_json_readable"],
            "error": "%s: %s" % (type(exc).__name__, exc),
        }
    else:
        report = validate(payload)

    if args.output is not None:
        try:
            _write_immutable(args.output, report)
        except Exception as exc:
            print("runtime contract report write failed: %s" % exc, file=sys.stderr)
            return 4
    print(json.dumps(report, indent=2, sort_keys=True))
    return 0 if report.get("passed") is True else 3


if __name__ == "__main__":
    raise SystemExit(main())
