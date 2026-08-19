#!/usr/bin/env python3
"""Validate sealed-parent plus signed-overlay deployment mode projection.

This utility deliberately separates two authorities:

* scientific/source-content equivalence: path, type, size, and SHA256;
* deployment authority: the per-path mode projected from a sealed parent and
  a signed overlay.

Rows that only exist in the parent inherit the parent's sealed mode.  Rows in
the overlay replace the complete parent row, including mode.  A writable local
full tree may be supplied as a content comparator, but its modes are never an
authority for the merged deployment.

The module supports Python 3.9+ and uses only the standard library.  It does
not access a scheduler, GPU, project dataset, checkpoint, Validation, or Test.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Mapping, Optional, Tuple


MANIFEST_SCHEMA = "ncsa_delta_deployment_mode_rows_v1"
REPORT_SCHEMA = "ncsa_delta_mode_projection_report_v1"
SHA256_RE = re.compile(r"[0-9a-f]{64}")
MODE_RE = re.compile(r"0[0-7]{3}")


def sha256_file(path: Path) -> str:
    before = path.lstat()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    after = path.lstat()
    before_identity = (
        before.st_dev,
        before.st_ino,
        before.st_size,
        before.st_mtime_ns,
    )
    after_identity = (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
    )
    if before_identity != after_identity:
        raise RuntimeError("file changed while hashing: %s" % path)
    return digest.hexdigest()


def canonical_rows_digest(rows: Iterable[Mapping[str, Any]]) -> str:
    encoded = json.dumps(
        list(rows),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _relative_posix(path: Path, root: Path) -> str:
    relative = path.relative_to(root).as_posix()
    if not relative or relative == "." or relative.startswith("../"):
        raise ValueError("invalid relative path: %s" % relative)
    return relative


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


def _normalize_row(value: Any, field: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError("%s must be an object" % field)
    path = _safe_relative_path(value.get("path"), "%s.path" % field)
    if value.get("type") != "file":
        raise ValueError("%s.type must be file" % field)
    size = value.get("size")
    if not isinstance(size, int) or isinstance(size, bool) or size < 0:
        raise ValueError("%s.size must be a non-negative integer" % field)
    sha256 = value.get("sha256")
    if not isinstance(sha256, str) or not SHA256_RE.fullmatch(sha256):
        raise ValueError("%s.sha256 must be lowercase SHA256" % field)
    mode = value.get("mode_octal")
    if not isinstance(mode, str) or not MODE_RE.fullmatch(mode):
        raise ValueError("%s.mode_octal must look like 0440 or 0750" % field)
    return {
        "path": path,
        "type": "file",
        "size": size,
        "sha256": sha256,
        "mode_octal": mode,
    }


def normalize_rows(values: Any, field: str) -> List[Dict[str, Any]]:
    if not isinstance(values, list):
        raise ValueError("%s must be a list" % field)
    result: List[Dict[str, Any]] = []
    seen = set()
    for index, value in enumerate(values):
        row = _normalize_row(value, "%s[%d]" % (field, index))
        if row["path"] in seen:
            raise ValueError("%s contains duplicate path: %s" % (field, row["path"]))
        seen.add(row["path"])
        result.append(row)
    result.sort(key=lambda row: row["path"])
    return result


def scan_file_rows(root: Path) -> List[Dict[str, Any]]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError("root is not a directory: %s" % root)
    rows: List[Dict[str, Any]] = []
    for current_text, dirnames, filenames in os.walk(
        str(root), topdown=True, followlinks=False
    ):
        current = Path(current_text)
        dirnames.sort()
        filenames.sort()
        for name in list(dirnames):
            candidate = current / name
            relative = _relative_posix(candidate, root)
            _safe_relative_path(relative, "scanned directory path")
            if candidate.is_symlink():
                raise ValueError("symlink directory is not allowed: %s" % relative)
        for name in filenames:
            candidate = current / name
            relative = _relative_posix(candidate, root)
            _safe_relative_path(relative, "scanned file path")
            status = candidate.lstat()
            if not stat.S_ISREG(status.st_mode):
                raise ValueError("non-regular file is not allowed: %s" % relative)
            rows.append(
                {
                    "path": relative,
                    "type": "file",
                    "size": status.st_size,
                    "sha256": sha256_file(candidate),
                    "mode_octal": "0%03o" % stat.S_IMODE(status.st_mode),
                }
            )
    rows.sort(key=lambda row: row["path"])
    return rows


def _rows_by_path(rows: Iterable[Mapping[str, Any]]) -> Dict[str, Dict[str, Any]]:
    return {str(row["path"]): dict(row) for row in rows}


def project_rows(
    parent_rows: Iterable[Mapping[str, Any]],
    overlay_rows: Iterable[Mapping[str, Any]],
) -> Tuple[List[Dict[str, Any]], List[str], List[str]]:
    parent = _rows_by_path(parent_rows)
    overlay = _rows_by_path(overlay_rows)
    projected = dict(parent)
    projected.update(overlay)
    base_only = sorted(set(parent) - set(overlay))
    overlay_paths = sorted(overlay)
    return (
        [projected[path] for path in sorted(projected)],
        base_only,
        overlay_paths,
    )


def content_rows(rows: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "path": row["path"],
            "type": row["type"],
            "size": row["size"],
            "sha256": row["sha256"],
        }
        for row in rows
    ]


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


def validate_projection(
    parent_rows: List[Dict[str, Any]],
    overlay_rows: List[Dict[str, Any]],
    candidate_rows: List[Dict[str, Any]],
    local_full_rows: List[Dict[str, Any]],
    phase: str,
) -> Dict[str, Any]:
    if phase not in ("stage1", "prepublish", "postpublish"):
        raise ValueError("unsupported phase: %s" % phase)
    projected, base_only_paths, overlay_paths = project_rows(parent_rows, overlay_rows)
    candidate_comparison = _comparison(projected, candidate_rows)
    local_full_comparison = _comparison(projected, local_full_rows)
    candidate_to_local_full_comparison = _comparison(local_full_rows, candidate_rows)

    parent_by_path = _rows_by_path(parent_rows)
    overlay_by_path = _rows_by_path(overlay_rows)
    projected_by_path = _rows_by_path(projected)
    base_inherited = all(
        projected_by_path[path] == parent_by_path[path] for path in base_only_paths
    )
    overlay_projected = all(
        projected_by_path[path] == overlay_by_path[path] for path in overlay_paths
    )

    checks = {
        "base_only_rows_inherit_sealed_parent_exactly": base_inherited,
        "overlay_rows_replace_with_signed_row_exactly": overlay_projected,
        "candidate_paths_match_projection": candidate_comparison["paths_equal"],
        "candidate_content_matches_projection": candidate_comparison["content_equal"],
        "candidate_modes_match_projection": candidate_comparison["modes_equal"],
        "local_full_content_matches_projection": local_full_comparison["content_equal"],
        "local_full_modes_not_used_as_deployment_authority": True,
        "naive_local_full_exact_equality_not_required": True,
    }
    failed_checks = sorted(name for name, passed in checks.items() if not passed)
    passed = not failed_checks
    projected_digest = canonical_rows_digest(projected)
    candidate_digest = canonical_rows_digest(candidate_rows)
    local_full_digest = canonical_rows_digest(local_full_rows)
    result: Dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "passed": passed,
        "phase": phase,
        "checks": checks,
        "failed_checks": failed_checks,
        "counts": {
            "parent": len(parent_rows),
            "overlay": len(overlay_rows),
            "projected": len(projected),
            "base_only": len(base_only_paths),
            "candidate": len(candidate_rows),
            "local_full": len(local_full_rows),
        },
        "paths": {
            "base_only": base_only_paths,
            "overlay": overlay_paths,
        },
        "candidate_comparison": candidate_comparison,
        "local_full_comparison": local_full_comparison,
        "candidate_to_local_full_comparison": candidate_to_local_full_comparison,
        "digests": {
            "parent_rows_sha256": canonical_rows_digest(parent_rows),
            "overlay_rows_sha256": canonical_rows_digest(overlay_rows),
            "projected_rows_sha256": projected_digest,
            "projected_content_rows_sha256": canonical_rows_digest(
                content_rows(projected)
            ),
            "candidate_rows_sha256": candidate_digest,
            "local_full_rows_sha256": local_full_digest,
            "postpublish_projected_rows_digest_sha256": (
                candidate_digest if phase == "postpublish" and passed else None
            ),
        },
        "claim_boundary": {
            "content_equivalence_fields": ["path", "type", "size", "sha256"],
            "deployment_authority_fields": [
                "path",
                "type",
                "size",
                "sha256",
                "mode_octal",
            ],
            "local_writable_full_tree_modes_used_as_authority": False,
            "naive_local_full_exact_rows_equal": candidate_to_local_full_comparison[
                "exact_rows_equal"
            ],
            "atomic_publish_or_seal_performed_by_validator": False,
        },
    }
    return result


def _ensure_output_outside_root(output: Path, root: Path) -> None:
    output_resolved = output.resolve()
    root_resolved = root.resolve()
    try:
        output_resolved.relative_to(root_resolved)
    except ValueError:
        return
    raise ValueError("output must be outside scanned root: %s" % output)


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


def create_manifest(root: Path, output: Path, role: str) -> int:
    _ensure_output_outside_root(output, root)
    rows = scan_file_rows(root)
    payload = {
        "schema": MANIFEST_SCHEMA,
        "role": role,
        "rows": rows,
        "rows_sha256": canonical_rows_digest(rows),
    }
    _write_immutable_json(output, payload)
    print("mode-row manifest PASS: %s" % output)
    return 0


def load_manifest(path: Path, expected_role: str) -> Tuple[List[Dict[str, Any]], str]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if payload.get("schema") != MANIFEST_SCHEMA:
        raise ValueError("unexpected manifest schema: %s" % path)
    if payload.get("role") != expected_role:
        raise ValueError("manifest role must be %s: %s" % (expected_role, path))
    rows = normalize_rows(payload.get("rows"), "%s.rows" % expected_role)
    digest = canonical_rows_digest(rows)
    if payload.get("rows_sha256") != digest:
        raise ValueError("manifest rows digest mismatch: %s" % path)
    return rows, sha256_file(path)


def verify(args: argparse.Namespace) -> int:
    _ensure_output_outside_root(args.report, args.candidate_root)
    parent_rows, parent_manifest_sha = load_manifest(
        args.parent_manifest, "sealed_parent"
    )
    overlay_rows, overlay_manifest_sha = load_manifest(
        args.overlay_manifest, "signed_overlay"
    )
    local_full_rows, local_full_manifest_sha = load_manifest(
        args.local_full_manifest, "local_full_content_comparator"
    )
    candidate_rows = scan_file_rows(args.candidate_root)
    report = validate_projection(
        parent_rows,
        overlay_rows,
        candidate_rows,
        local_full_rows,
        args.phase,
    )
    report["inputs"] = {
        "parent_manifest": str(args.parent_manifest.resolve()),
        "parent_manifest_sha256": parent_manifest_sha,
        "overlay_manifest": str(args.overlay_manifest.resolve()),
        "overlay_manifest_sha256": overlay_manifest_sha,
        "local_full_manifest": str(args.local_full_manifest.resolve()),
        "local_full_manifest_sha256": local_full_manifest_sha,
        "candidate_root": str(args.candidate_root.resolve()),
    }
    _write_immutable_json(args.report, report)
    if not report["passed"]:
        print(
            "mode projection verification FAIL; retain partial/incoming and do not publish: %s"
            % args.report,
            file=sys.stderr,
        )
        return 3
    print("mode projection verification PASS: %s" % args.report)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Create mode-row manifests or verify sealed-parent plus signed-overlay "
            "per-path deployment projection."
        )
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create")
    create.add_argument("--root", type=Path, required=True)
    create.add_argument("--output", type=Path, required=True)
    create.add_argument(
        "--role",
        choices=[
            "sealed_parent",
            "signed_overlay",
            "local_full_content_comparator",
        ],
        required=True,
    )

    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--parent-manifest", type=Path, required=True)
    verify_parser.add_argument("--overlay-manifest", type=Path, required=True)
    verify_parser.add_argument("--local-full-manifest", type=Path, required=True)
    verify_parser.add_argument("--candidate-root", type=Path, required=True)
    verify_parser.add_argument(
        "--phase", choices=["stage1", "prepublish", "postpublish"], required=True
    )
    verify_parser.add_argument("--report", type=Path, required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "create":
            return create_manifest(args.root, args.output, args.role)
        return verify(args)
    except FileExistsError as exc:
        print("mode projection tool error: %s" % exc, file=sys.stderr)
        return 4
    except (OSError, ValueError, RuntimeError, json.JSONDecodeError) as exc:
        print("mode projection tool error: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
