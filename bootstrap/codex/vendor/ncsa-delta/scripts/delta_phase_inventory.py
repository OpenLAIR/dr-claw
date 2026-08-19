#!/usr/bin/env python3
"""Validate phase-aware inventories around one generated JSON config.

The contract is deliberately narrower than a generic file-set inventory:

* pre-materialization: the canonical generated config must not exist;
* post-materialization: that config must be the only generated artifact and
  every non-generated projected row must remain byte-and-mode exact;
* post-seal: the complete tree, including the config, must match an explicit
  sealed-mode projection and remain replayable from a whole-tree manifest.

This module is Python 3.9+, standard-library only, and contains no project,
dataset, account, host, job, or GPU identity.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple

from delta_mode_projection import (
    canonical_rows_digest,
    normalize_rows,
    scan_file_rows,
    sha256_file,
)


PHASE_SCHEMA = "ncsa_delta_generated_artifact_phase_inventory_v1"
REPLAY_SCHEMA = "ncsa_delta_generated_artifact_inventory_replay_v1"
STAGE1_SCHEMA = "ncsa_delta_generated_artifact_stage1_round_trip_v1"
MODE_RE = re.compile(r"0[0-7]{3}")


def _safe_relative_path(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value:
        raise ValueError("%s must be a non-empty string" % field)
    pure = PurePosixPath(value)
    if pure.is_absolute() or value != pure.as_posix():
        raise ValueError("%s must be a normalized relative POSIX path" % field)
    if any(part in ("", ".", "..") for part in pure.parts):
        raise ValueError("%s contains an unsafe path component" % field)
    if pure.name.startswith("._"):
        raise ValueError("%s is an AppleDouble path" % field)
    return value


def _parse_mode(value: str, field: str) -> str:
    if not isinstance(value, str) or not MODE_RE.fullmatch(value):
        raise ValueError("%s must look like 0440 or 0750" % field)
    return value


def _rows_by_path(rows: Iterable[Mapping[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {str(row["path"]): dict(row) for row in rows}


def _comparison(
    expected_rows: Iterable[Mapping[str, Any]],
    observed_rows: Iterable[Mapping[str, Any]],
) -> Dict[str, Any]:
    expected = _rows_by_path(expected_rows)
    observed = _rows_by_path(observed_rows)
    expected_paths = set(expected)
    observed_paths = set(observed)
    common = expected_paths & observed_paths
    content_keys = ("type", "size", "sha256")
    content_changed = sorted(
        path
        for path in common
        if any(expected[path][key] != observed[path][key] for key in content_keys)
    )
    mode_changed = sorted(
        path
        for path in common
        if expected[path]["mode_octal"] != observed[path]["mode_octal"]
    )
    missing = sorted(expected_paths - observed_paths)
    unexpected = sorted(observed_paths - expected_paths)
    return {
        "paths_equal": not missing and not unexpected,
        "content_equal": not missing and not unexpected and not content_changed,
        "modes_equal": not missing and not unexpected and not mode_changed,
        "exact_rows_equal": (
            not missing
            and not unexpected
            and not content_changed
            and not mode_changed
        ),
        "missing_paths": missing,
        "unexpected_paths": unexpected,
        "content_changed_paths": content_changed,
        "mode_changed_paths": mode_changed,
    }


def _reject_duplicate_keys(pairs: List[Tuple[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON key: %s" % key)
        result[key] = value
    return result


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        value = json.load(handle, object_pairs_hook=_reject_duplicate_keys)
    if not isinstance(value, dict):
        raise ValueError("JSON document must be an object: %s" % path)
    return value


def _observed_config_schema(path: Path) -> Tuple[Optional[str], Optional[str]]:
    try:
        payload = _load_json(path)
        schema = payload.get("schema")
        if not isinstance(schema, str) or not schema:
            return None, "top-level schema must be a non-empty string"
        return schema, None
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        return None, str(exc)


def _ensure_output_outside_root(output: Path, root: Path) -> None:
    output_resolved = output.resolve()
    root_resolved = root.resolve()
    try:
        output_resolved.relative_to(root_resolved)
    except ValueError:
        return
    raise ValueError("evidence output must be outside scanned root: %s" % output)


def _ensure_path_outside_root(path: Path, root: Path, field: str) -> None:
    path_resolved = path.resolve()
    root_resolved = root.resolve()
    try:
        path_resolved.relative_to(root_resolved)
    except ValueError:
        return
    raise ValueError("%s must be outside scanned root: %s" % (field, path))


def _write_immutable_json(path: Path, payload: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise FileExistsError("refusing to replace existing evidence: %s" % path)
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
            json.dump(payload, handle, indent=2, sort_keys=True)
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


def _phase_common(phase: str, canonical_path: str) -> Dict[str, Any]:
    return {
        "schema": PHASE_SCHEMA,
        "phase": phase,
        "canonical_generated_config_path": canonical_path,
        "excluded_artifacts": [],
        "generic_exclusion_defaults_accepted": False,
        "claim_boundary": {
            "inventory_is_phase_specific": True,
            "generic_inventory_with_excluded_artifacts_is_post_materialization_authority": False,
            "generated_artifact_count_required": 1,
        },
    }


def create_pre_materialization_inventory(
    root: Path, canonical_path: str, output: Path
) -> int:
    canonical_path = _safe_relative_path(
        canonical_path, "canonical generated config path"
    )
    _ensure_output_outside_root(output, root)
    rows = scan_file_rows(root)
    by_path = _rows_by_path(rows)
    config_absent = canonical_path not in by_path
    payload = _phase_common("pre_materialization", canonical_path)
    payload.update(
        {
            "passed": config_absent,
            "checks": {
                "canonical_generated_config_absent": config_absent,
                "generated_artifacts_empty": config_absent,
                "excluded_artifacts_empty": True,
            },
            "failed_checks": (
                [] if config_absent else ["canonical_generated_config_absent"]
            ),
            "observed_rows": rows,
            "observed_rows_sha256": canonical_rows_digest(rows),
            "non_generated_projected_rows": rows if config_absent else [],
            "non_generated_projected_rows_sha256": (
                canonical_rows_digest(rows) if config_absent else None
            ),
            "generated_artifacts": [],
            "root": str(root.resolve()),
        }
    )
    _write_immutable_json(output, payload)
    if not config_absent:
        print(
            "pre-materialization inventory FAIL: canonical generated config already exists: %s"
            % canonical_path,
            file=sys.stderr,
        )
        return 3
    print("pre-materialization phase inventory PASS: %s" % output)
    return 0


def _load_pre_manifest(path: Path) -> Dict[str, Any]:
    payload = _load_json(path)
    if payload.get("schema") != PHASE_SCHEMA:
        raise ValueError(
            "post-materialization requires a phase-aware pre-materialization inventory; "
            "generic inventories or exclude-based manifests are not accepted"
        )
    if payload.get("phase") != "pre_materialization" or payload.get("passed") is not True:
        raise ValueError("pre manifest must be a passed pre_materialization inventory")
    if payload.get("excluded_artifacts") != []:
        raise ValueError("pre manifest excluded_artifacts must be exactly empty")
    if payload.get("generic_exclusion_defaults_accepted") is not False:
        raise ValueError("generic exclusion defaults are forbidden for this phase transition")
    if payload.get("generated_artifacts") != []:
        raise ValueError("pre manifest generated_artifacts must be exactly empty")
    canonical_path = _safe_relative_path(
        payload.get("canonical_generated_config_path"),
        "pre manifest canonical generated config path",
    )
    rows = normalize_rows(
        payload.get("non_generated_projected_rows"),
        "pre manifest non_generated_projected_rows",
    )
    if canonical_path in _rows_by_path(rows):
        raise ValueError("pre manifest illegally contains the canonical generated config")
    digest = canonical_rows_digest(rows)
    if payload.get("non_generated_projected_rows_sha256") != digest:
        raise ValueError("pre manifest non-generated rows digest mismatch")
    payload["_normalized_rows"] = rows
    payload["_canonical_path"] = canonical_path
    return payload


def _expected_config_row(
    expected_file: Path,
    canonical_path: str,
    expected_schema: str,
    expected_mode: str,
) -> Dict[str, Any]:
    status = expected_file.lstat()
    if not stat.S_ISREG(status.st_mode) or expected_file.is_symlink():
        raise ValueError("expected config authority must be a regular non-symlink file")
    payload = _load_json(expected_file)
    if payload.get("schema") != expected_schema:
        raise ValueError("expected config authority schema does not match --expected-schema")
    return {
        "path": canonical_path,
        "type": "file",
        "size": status.st_size,
        "sha256": sha256_file(expected_file),
        "mode_octal": expected_mode,
        "config_schema": expected_schema,
    }


def verify_post_materialization(
    root: Path,
    pre_manifest_path: Path,
    expected_config_file: Path,
    expected_schema: str,
    expected_mode: str,
    output: Path,
) -> int:
    _ensure_output_outside_root(output, root)
    _ensure_path_outside_root(
        expected_config_file, root, "expected config authority file"
    )
    expected_mode = _parse_mode(expected_mode, "expected config mode")
    pre = _load_pre_manifest(pre_manifest_path)
    canonical_path = pre["_canonical_path"]
    pre_rows = pre["_normalized_rows"]
    expected_config = _expected_config_row(
        expected_config_file,
        canonical_path,
        expected_schema,
        expected_mode,
    )

    observed_rows = scan_file_rows(root)
    observed_by_path = _rows_by_path(observed_rows)
    pre_by_path = _rows_by_path(pre_rows)
    observed_non_generated = [
        observed_by_path[path]
        for path in sorted(set(observed_by_path) & set(pre_by_path))
    ]
    non_generated_comparison = _comparison(pre_rows, observed_non_generated)
    generated_paths = sorted(set(observed_by_path) - set(pre_by_path))
    exactly_one_generated = generated_paths == [canonical_path]

    observed_config_base = observed_by_path.get(canonical_path)
    observed_schema: Optional[str] = None
    observed_schema_error: Optional[str] = None
    observed_config: Optional[Dict[str, Any]] = None
    if observed_config_base is not None:
        observed_schema, observed_schema_error = _observed_config_schema(
            root / canonical_path
        )
        observed_config = dict(observed_config_base)
        observed_config["config_schema"] = observed_schema

    checks = {
        "phase_aware_pre_inventory_used": True,
        "pre_inventory_excluded_artifacts_empty": True,
        "non_generated_projected_rows_unchanged": non_generated_comparison[
            "exact_rows_equal"
        ],
        "exactly_one_generated_artifact": exactly_one_generated,
        "generated_config_path_exact": observed_config_base is not None,
        "generated_config_type_exact": (
            observed_config_base is not None
            and observed_config_base.get("type") == expected_config["type"]
        ),
        "generated_config_size_exact": (
            observed_config_base is not None
            and observed_config_base.get("size") == expected_config["size"]
        ),
        "generated_config_sha256_exact": (
            observed_config_base is not None
            and observed_config_base.get("sha256") == expected_config["sha256"]
        ),
        "generated_config_mode_exact": (
            observed_config_base is not None
            and observed_config_base.get("mode_octal")
            == expected_config["mode_octal"]
        ),
        "generated_config_schema_exact": observed_schema == expected_schema,
    }
    failed_checks = sorted(name for name, passed in checks.items() if not passed)
    passed = not failed_checks
    payload = _phase_common("post_materialization", canonical_path)
    payload.update(
        {
            "passed": passed,
            "checks": checks,
            "failed_checks": failed_checks,
            "inputs": {
                "pre_materialization_manifest": str(pre_manifest_path.resolve()),
                "pre_materialization_manifest_sha256": sha256_file(
                    pre_manifest_path
                ),
                "expected_config_authority": str(expected_config_file.resolve()),
                "expected_config_authority_sha256": sha256_file(
                    expected_config_file
                ),
            },
            "expected_generated_config": expected_config,
            "generated_artifacts": (
                [observed_config] if observed_config is not None else []
            ),
            "observed_generated_paths": generated_paths,
            "observed_config_schema_error": observed_schema_error,
            "non_generated_comparison": non_generated_comparison,
            "non_generated_projected_rows": pre_rows,
            "non_generated_projected_rows_sha256": canonical_rows_digest(pre_rows),
            "whole_rows": observed_rows,
            "whole_rows_sha256": canonical_rows_digest(observed_rows),
            "root": str(root.resolve()),
        }
    )
    _write_immutable_json(output, payload)
    if not passed:
        print(
            "post-materialization phase inventory FAIL; do not seal or publish: %s"
            % output,
            file=sys.stderr,
        )
        return 3
    print("post-materialization phase inventory PASS: %s" % output)
    return 0


def _normalize_generated_artifact(value: Any, canonical_path: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("generated artifact row must be an object")
    base = normalize_rows([value], "generated_artifacts")[0]
    if base["path"] != canonical_path:
        raise ValueError("generated artifact path is not canonical")
    schema = value.get("config_schema")
    if not isinstance(schema, str) or not schema:
        raise ValueError("generated artifact config_schema must be non-empty")
    base["config_schema"] = schema
    return base


def _load_post_materialization_manifest(path: Path) -> Dict[str, Any]:
    payload = _load_json(path)
    if payload.get("schema") != PHASE_SCHEMA:
        raise ValueError("unexpected post-materialization inventory schema")
    if payload.get("phase") != "post_materialization" or payload.get("passed") is not True:
        raise ValueError("post manifest must be a passed post_materialization inventory")
    if payload.get("excluded_artifacts") != []:
        raise ValueError("post manifest excluded_artifacts must be exactly empty")
    if payload.get("generic_exclusion_defaults_accepted") is not False:
        raise ValueError("post manifest must reject generic exclusion defaults")
    canonical_path = _safe_relative_path(
        payload.get("canonical_generated_config_path"),
        "post manifest canonical generated config path",
    )
    generated = payload.get("generated_artifacts")
    if not isinstance(generated, list) or len(generated) != 1:
        raise ValueError("post manifest must contain exactly one generated artifact")
    config = _normalize_generated_artifact(generated[0], canonical_path)
    rows = normalize_rows(payload.get("whole_rows"), "post manifest whole_rows")
    if payload.get("whole_rows_sha256") != canonical_rows_digest(rows):
        raise ValueError("post manifest whole rows digest mismatch")
    if canonical_path not in _rows_by_path(rows):
        raise ValueError("post manifest whole rows omit canonical generated config")
    if _rows_by_path(rows)[canonical_path] != {
        key: config[key] for key in ["path", "type", "size", "sha256", "mode_octal"]
    }:
        raise ValueError("post manifest generated config row disagrees with whole rows")
    payload["_normalized_rows"] = rows
    payload["_canonical_path"] = canonical_path
    payload["_config"] = config
    return payload


def _sealed_projection(
    rows: Iterable[Mapping[str, Any]], file_mode: str, executable_mode: str
) -> List[Dict[str, Any]]:
    result: List[Dict[str, Any]] = []
    for value in rows:
        row = dict(value)
        old_mode = int(str(row["mode_octal"]), 8)
        row["mode_octal"] = executable_mode if old_mode & 0o111 else file_mode
        result.append(row)
    result.sort(key=lambda row: row["path"])
    return result


def verify_post_seal(
    root: Path,
    post_manifest_path: Path,
    sealed_file_mode: str,
    sealed_executable_mode: str,
    output: Path,
) -> int:
    _ensure_output_outside_root(output, root)
    sealed_file_mode = _parse_mode(sealed_file_mode, "sealed ordinary-file mode")
    sealed_executable_mode = _parse_mode(
        sealed_executable_mode, "sealed executable mode"
    )
    if int(sealed_file_mode, 8) & 0o111:
        raise ValueError("sealed ordinary-file mode must not contain execute bits")
    if not int(sealed_executable_mode, 8) & 0o111:
        raise ValueError("sealed executable mode must contain an execute bit")
    post = _load_post_materialization_manifest(post_manifest_path)
    canonical_path = post["_canonical_path"]
    post_rows = post["_normalized_rows"]
    expected_rows = _sealed_projection(
        post_rows, sealed_file_mode, sealed_executable_mode
    )
    observed_rows = scan_file_rows(root)
    comparison = _comparison(expected_rows, observed_rows)
    observed_schema, observed_schema_error = _observed_config_schema(
        root / canonical_path
    )
    expected_config_schema = post["_config"]["config_schema"]
    expected_config_row = _rows_by_path(expected_rows).get(canonical_path)
    observed_config_row = _rows_by_path(observed_rows).get(canonical_path)
    checks = {
        "post_materialization_inventory_is_complete": True,
        "post_materialization_excluded_artifacts_empty": True,
        "whole_tree_paths_content_and_sealed_modes_exact": comparison[
            "exact_rows_equal"
        ],
        "canonical_generated_config_included_in_whole_tree": (
            observed_config_row is not None
        ),
        "generated_config_content_unchanged": (
            observed_config_row is not None
            and expected_config_row is not None
            and all(
                observed_config_row[key] == expected_config_row[key]
                for key in ["path", "type", "size", "sha256"]
            )
        ),
        "generated_config_sealed_mode_exact": (
            observed_config_row is not None
            and expected_config_row is not None
            and observed_config_row["mode_octal"]
            == expected_config_row["mode_octal"]
        ),
        "generated_config_schema_exact": observed_schema == expected_config_schema,
    }
    failed_checks = sorted(name for name, passed in checks.items() if not passed)
    passed = not failed_checks
    payload = _phase_common("post_seal", canonical_path)
    payload.update(
        {
            "passed": passed,
            "checks": checks,
            "failed_checks": failed_checks,
            "inputs": {
                "post_materialization_manifest": str(post_manifest_path.resolve()),
                "post_materialization_manifest_sha256": sha256_file(
                    post_manifest_path
                ),
            },
            "sealed_mode_policy": {
                "ordinary_file_mode": sealed_file_mode,
                "executable_mode": sealed_executable_mode,
            },
            "comparison": comparison,
            "generated_artifacts": [
                {
                    **(observed_config_row or {}),
                    "config_schema": observed_schema,
                }
            ]
            if observed_config_row is not None
            else [],
            "observed_config_schema_error": observed_schema_error,
            "expected_sealed_rows_sha256": canonical_rows_digest(expected_rows),
            "whole_rows": observed_rows,
            "whole_rows_sha256": canonical_rows_digest(observed_rows),
            "whole_manifest_replay_required": True,
            "whole_manifest_replay_ready": passed,
            "root": str(root.resolve()),
        }
    )
    _write_immutable_json(output, payload)
    if not passed:
        print(
            "post-seal phase inventory FAIL; final source is not replay-authoritative: %s"
            % output,
            file=sys.stderr,
        )
        return 3
    print("post-seal whole-tree inventory PASS: %s" % output)
    return 0


def _load_post_seal_manifest(path: Path) -> Dict[str, Any]:
    payload = _load_json(path)
    if payload.get("schema") != PHASE_SCHEMA:
        raise ValueError("unexpected post-seal inventory schema")
    if payload.get("phase") != "post_seal" or payload.get("passed") is not True:
        raise ValueError("sealed manifest must be a passed post_seal inventory")
    if payload.get("excluded_artifacts") != []:
        raise ValueError("sealed manifest excluded_artifacts must be exactly empty")
    if payload.get("generic_exclusion_defaults_accepted") is not False:
        raise ValueError("sealed manifest must reject generic exclusion defaults")
    if payload.get("whole_manifest_replay_ready") is not True:
        raise ValueError("sealed manifest is not replay-ready")
    rows = normalize_rows(payload.get("whole_rows"), "sealed manifest whole_rows")
    if payload.get("whole_rows_sha256") != canonical_rows_digest(rows):
        raise ValueError("sealed manifest whole rows digest mismatch")
    canonical_path = _safe_relative_path(
        payload.get("canonical_generated_config_path"),
        "sealed manifest canonical generated config path",
    )
    generated = payload.get("generated_artifacts")
    if not isinstance(generated, list) or len(generated) != 1:
        raise ValueError("sealed manifest must contain exactly one generated artifact")
    config = _normalize_generated_artifact(generated[0], canonical_path)
    payload["_normalized_rows"] = rows
    payload["_canonical_path"] = canonical_path
    payload["_config"] = config
    return payload


def replay_sealed_manifest(root: Path, sealed_manifest_path: Path, report: Path) -> int:
    _ensure_output_outside_root(report, root)
    sealed = _load_post_seal_manifest(sealed_manifest_path)
    expected_rows = sealed["_normalized_rows"]
    observed_rows = scan_file_rows(root)
    comparison = _comparison(expected_rows, observed_rows)
    canonical_path = sealed["_canonical_path"]
    observed_schema, observed_schema_error = _observed_config_schema(
        root / canonical_path
    )
    checks = {
        "whole_manifest_paths_content_and_modes_replayed_exactly": comparison[
            "exact_rows_equal"
        ],
        "canonical_generated_config_present": (
            canonical_path in _rows_by_path(observed_rows)
        ),
        "generated_config_schema_replayed_exactly": (
            observed_schema == sealed["_config"]["config_schema"]
        ),
        "excluded_artifacts_empty": True,
    }
    failed_checks = sorted(name for name, passed in checks.items() if not passed)
    passed = not failed_checks
    payload = {
        "schema": REPLAY_SCHEMA,
        "phase": "post_seal_replay",
        "passed": passed,
        "whole_manifest_replay_passed": passed,
        "checks": checks,
        "failed_checks": failed_checks,
        "comparison": comparison,
        "sealed_manifest": str(sealed_manifest_path.resolve()),
        "sealed_manifest_sha256": sha256_file(sealed_manifest_path),
        "expected_whole_rows_sha256": canonical_rows_digest(expected_rows),
        "observed_whole_rows_sha256": canonical_rows_digest(observed_rows),
        "canonical_generated_config_path": canonical_path,
        "observed_config_schema_error": observed_schema_error,
        "excluded_artifacts": [],
        "generic_exclusion_defaults_accepted": False,
        "root": str(root.resolve()),
    }
    _write_immutable_json(report, payload)
    if not passed:
        print("whole-manifest replay FAIL: %s" % report, file=sys.stderr)
        return 3
    print("whole-manifest replay PASS: %s" % report)
    return 0


def _materialize_config(
    root: Path, canonical_path: str, expected_file: Path, mode: str
) -> None:
    destination = root / canonical_path
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        raise ValueError("materialization destination already exists: %s" % destination)
    temporary = destination.with_name(".%s.generated.tmp" % destination.name)
    if temporary.exists() or temporary.is_symlink():
        raise ValueError("materialization temporary path already exists: %s" % temporary)
    try:
        shutil.copyfile(str(expected_file), str(temporary))
        os.chmod(str(temporary), int(mode, 8))
        temporary.replace(destination)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _apply_seal(root: Path, rows: Iterable[Mapping[str, Any]], file_mode: str, executable_mode: str) -> None:
    for row in rows:
        mode = int(str(row["mode_octal"]), 8)
        target_mode = executable_mode if mode & 0o111 else file_mode
        os.chmod(str(root / str(row["path"])), int(target_mode, 8))


def stage1_round_trip(
    pre_root: Path,
    stage1_root: Path,
    canonical_path: str,
    expected_config_file: Path,
    expected_schema: str,
    generated_mode: str,
    sealed_file_mode: str,
    sealed_executable_mode: str,
) -> int:
    canonical_path = _safe_relative_path(
        canonical_path, "canonical generated config path"
    )
    generated_mode = _parse_mode(generated_mode, "generated config mode")
    sealed_file_mode = _parse_mode(sealed_file_mode, "sealed ordinary-file mode")
    sealed_executable_mode = _parse_mode(
        sealed_executable_mode, "sealed executable mode"
    )
    if stage1_root.exists() or stage1_root.is_symlink():
        raise FileExistsError("refusing to reuse Stage1 root: %s" % stage1_root)
    _ensure_path_outside_root(stage1_root, pre_root, "Stage1 root")
    _ensure_path_outside_root(
        expected_config_file, pre_root, "expected config authority file"
    )
    stage1_root.mkdir(parents=True)
    evidence = stage1_root / "evidence"
    evidence.mkdir()
    materialized = stage1_root / "materialized"
    pre_manifest = evidence / "PRE_MATERIALIZATION_INVENTORY.json"
    post_manifest = evidence / "POST_MATERIALIZATION_INVENTORY.json"
    sealed_manifest = evidence / "POST_SEAL_WHOLE_MANIFEST.json"
    replay_report = evidence / "POST_SEAL_WHOLE_MANIFEST_REPLAY.json"
    complete = evidence / "STAGE1_COMPLETE.json"

    if create_pre_materialization_inventory(
        pre_root, canonical_path, pre_manifest
    ) != 0:
        return 3
    shutil.copytree(pre_root, materialized, copy_function=shutil.copy2)
    _materialize_config(
        materialized, canonical_path, expected_config_file, generated_mode
    )
    if verify_post_materialization(
        materialized,
        pre_manifest,
        expected_config_file,
        expected_schema,
        generated_mode,
        post_manifest,
    ) != 0:
        return 3
    post = _load_post_materialization_manifest(post_manifest)
    _apply_seal(
        materialized,
        post["_normalized_rows"],
        sealed_file_mode,
        sealed_executable_mode,
    )
    if verify_post_seal(
        materialized,
        post_manifest,
        sealed_file_mode,
        sealed_executable_mode,
        sealed_manifest,
    ) != 0:
        return 3
    if replay_sealed_manifest(materialized, sealed_manifest, replay_report) != 0:
        return 3
    payload = {
        "schema": STAGE1_SCHEMA,
        "passed": True,
        "transitions": [
            "pre_materialization_config_absent",
            "disposable_materialization_created",
            "canonical_generated_config_materialized",
            "post_materialization_inventory_verified",
            "whole_tree_sealed_including_generated_config",
            "post_seal_whole_manifest_replayed",
        ],
        "canonical_generated_config_path": canonical_path,
        "materialized_root": str(materialized.resolve()),
        "evidence": {
            "pre_materialization_inventory_sha256": sha256_file(pre_manifest),
            "post_materialization_inventory_sha256": sha256_file(post_manifest),
            "post_seal_whole_manifest_sha256": sha256_file(sealed_manifest),
            "post_seal_replay_sha256": sha256_file(replay_report),
        },
        "excluded_artifacts": [],
        "generic_exclusion_defaults_accepted": False,
    }
    _write_immutable_json(complete, payload)
    print("Stage1 materialize/postinventory/seal/replay PASS: %s" % complete)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Validate phase-aware source inventories around one canonical "
            "generated JSON config and replay a complete post-seal manifest."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    pre = subparsers.add_parser("pre-materialization")
    pre.add_argument("--root", type=Path, required=True)
    pre.add_argument("--canonical-config-path", required=True)
    pre.add_argument("--output", type=Path, required=True)

    post = subparsers.add_parser("post-materialization")
    post.add_argument("--root", type=Path, required=True)
    post.add_argument("--pre-manifest", type=Path, required=True)
    post.add_argument("--expected-config-file", type=Path, required=True)
    post.add_argument("--expected-schema", required=True)
    post.add_argument("--expected-mode", default="0644")
    post.add_argument("--output", type=Path, required=True)

    sealed = subparsers.add_parser("post-seal")
    sealed.add_argument("--root", type=Path, required=True)
    sealed.add_argument("--post-manifest", type=Path, required=True)
    sealed.add_argument("--sealed-file-mode", default="0440")
    sealed.add_argument("--sealed-executable-mode", default="0550")
    sealed.add_argument("--output", type=Path, required=True)

    replay = subparsers.add_parser("replay-sealed")
    replay.add_argument("--root", type=Path, required=True)
    replay.add_argument("--sealed-manifest", type=Path, required=True)
    replay.add_argument("--report", type=Path, required=True)

    stage1 = subparsers.add_parser("stage1-check")
    stage1.add_argument("--pre-root", type=Path, required=True)
    stage1.add_argument("--stage1-root", type=Path, required=True)
    stage1.add_argument("--canonical-config-path", required=True)
    stage1.add_argument("--expected-config-file", type=Path, required=True)
    stage1.add_argument("--expected-schema", required=True)
    stage1.add_argument("--generated-mode", default="0644")
    stage1.add_argument("--sealed-file-mode", default="0440")
    stage1.add_argument("--sealed-executable-mode", default="0550")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "pre-materialization":
            return create_pre_materialization_inventory(
                args.root, args.canonical_config_path, args.output
            )
        if args.command == "post-materialization":
            return verify_post_materialization(
                args.root,
                args.pre_manifest,
                args.expected_config_file,
                args.expected_schema,
                args.expected_mode,
                args.output,
            )
        if args.command == "post-seal":
            return verify_post_seal(
                args.root,
                args.post_manifest,
                args.sealed_file_mode,
                args.sealed_executable_mode,
                args.output,
            )
        if args.command == "replay-sealed":
            return replay_sealed_manifest(
                args.root, args.sealed_manifest, args.report
            )
        return stage1_round_trip(
            args.pre_root,
            args.stage1_root,
            args.canonical_config_path,
            args.expected_config_file,
            args.expected_schema,
            args.generated_mode,
            args.sealed_file_mode,
            args.sealed_executable_mode,
        )
    except FileExistsError as exc:
        print("phase inventory tool error: %s" % exc, file=sys.stderr)
        return 4
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print("phase inventory tool error: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
