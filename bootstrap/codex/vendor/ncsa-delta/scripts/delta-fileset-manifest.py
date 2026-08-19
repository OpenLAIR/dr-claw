#!/usr/bin/env python3
"""Create or verify an exact, content-addressed archive file-set manifest.

The implementation intentionally supports Python 3.9 and uses only the
standard library so it can run with Delta's bare login-node ``python3``.
Project semantic preflights have a different runtime contract and must not use
that interpreter merely because this skill utility can.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import stat
import sys
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Optional, Tuple


SCHEMA = "ncsa_delta_exact_fileset_manifest_v1"
REPORT_SCHEMA = "ncsa_delta_exact_fileset_verification_v1"


def sha256_file(path: Path) -> str:
    before = path.lstat()
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    after = path.lstat()
    identity_before = (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns)
    identity_after = (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns)
    if identity_before != identity_after:
        raise RuntimeError("file changed while hashing: %s" % path)
    return digest.hexdigest()


def relative_posix(path: Path, root: Path) -> str:
    relative = path.relative_to(root)
    value = relative.as_posix()
    if not value or value == "." or value.startswith("../"):
        raise ValueError("invalid relative path: %s" % value)
    return value


def is_appledouble(relative: str) -> bool:
    return PurePosixPath(relative).name.startswith("._")


def scan(root: Path) -> Tuple[List[Dict[str, Any]], List[str]]:
    root = root.resolve()
    if not root.is_dir():
        raise ValueError("root is not a directory: %s" % root)

    entries: List[Dict[str, Any]] = []
    appledouble: List[str] = []
    for current_text, dirnames, filenames in os.walk(
        str(root), topdown=True, followlinks=False
    ):
        current = Path(current_text)
        dirnames.sort()
        filenames.sort()

        for name in dirnames:
            candidate = current / name
            relative = relative_posix(candidate, root)
            if is_appledouble(relative):
                appledouble.append(relative)
            if candidate.is_symlink():
                entries.append(
                    {"path": relative, "type": "symlink", "target": os.readlink(candidate)}
                )
            else:
                entries.append({"path": relative, "type": "directory"})

        for name in filenames:
            candidate = current / name
            relative = relative_posix(candidate, root)
            if is_appledouble(relative):
                appledouble.append(relative)
            mode = candidate.lstat().st_mode
            if stat.S_ISLNK(mode):
                entries.append(
                    {"path": relative, "type": "symlink", "target": os.readlink(candidate)}
                )
            elif stat.S_ISREG(mode):
                entries.append(
                    {
                        "path": relative,
                        "type": "file",
                        "size": candidate.lstat().st_size,
                        "sha256": sha256_file(candidate),
                    }
                )
            else:
                raise ValueError("unsupported non-file archive entry: %s" % candidate)

    entries.sort(key=lambda item: (item["path"], item["type"]))
    appledouble.sort()
    return entries, appledouble


def ensure_output_outside_root(output: Path, root: Path) -> None:
    output_resolved = output.resolve()
    root_resolved = root.resolve()
    try:
        output_resolved.relative_to(root_resolved)
    except ValueError:
        return
    raise ValueError("manifest/report must be outside scanned root: %s" % output)


def write_immutable_json(path: Path, payload: Dict[str, Any]) -> None:
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


def count_types(entries: Iterable[Dict[str, Any]]) -> Dict[str, int]:
    counts = {"directory": 0, "file": 0, "symlink": 0}
    for entry in entries:
        counts[entry["type"]] = counts.get(entry["type"], 0) + 1
    return counts


def create_manifest(root: Path, output: Path) -> int:
    ensure_output_outside_root(output, root)
    entries, appledouble = scan(root)
    payload: Dict[str, Any] = {
        "schema": SCHEMA,
        "passed": not appledouble,
        "root_name": root.resolve().name,
        "entries": entries,
        "counts": count_types(entries),
        "appledouble_paths": appledouble,
    }
    write_immutable_json(output, payload)
    if appledouble:
        print(
            "manifest rejected source AppleDouble entries: %s" % ", ".join(appledouble),
            file=sys.stderr,
        )
        return 3
    print("file-set manifest PASS: %s" % output)
    return 0


def index_entries(entries: Iterable[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    result: Dict[str, Dict[str, Any]] = {}
    for entry in entries:
        path = entry.get("path")
        if not isinstance(path, str) or not path or path in result:
            raise ValueError("manifest contains invalid or duplicate path: %r" % path)
        result[path] = entry
    return result


def verify_manifest(root: Path, manifest_path: Path, report: Path) -> int:
    ensure_output_outside_root(report, root)
    with manifest_path.open("r", encoding="utf-8") as handle:
        expected_payload = json.load(handle)
    if expected_payload.get("schema") != SCHEMA:
        raise ValueError("unexpected manifest schema")
    if not expected_payload.get("passed"):
        raise ValueError("source manifest was not clean/passed")

    expected_entries = expected_payload.get("entries")
    if not isinstance(expected_entries, list):
        raise ValueError("manifest entries must be a list")
    expected = index_entries(expected_entries)
    actual_entries, appledouble = scan(root)
    actual = index_entries(actual_entries)

    expected_paths = set(expected)
    actual_paths = set(actual)
    missing = sorted(expected_paths - actual_paths)
    unexpected = sorted(actual_paths - expected_paths)
    changed = sorted(
        path
        for path in expected_paths & actual_paths
        if expected[path] != actual[path]
    )
    passed = not missing and not unexpected and not changed and not appledouble
    payload: Dict[str, Any] = {
        "schema": REPORT_SCHEMA,
        "passed": passed,
        "root": str(root.resolve()),
        "manifest": str(manifest_path.resolve()),
        "manifest_sha256": sha256_file(manifest_path),
        "expected_counts": expected_payload.get("counts"),
        "actual_counts": count_types(actual_entries),
        "missing_paths": missing,
        "unexpected_paths": unexpected,
        "changed_paths": changed,
        "appledouble_paths": appledouble,
    }
    write_immutable_json(report, payload)
    if not passed:
        print(
            "file-set verification FAIL; retain/isolate incoming and do not create final: %s"
            % report,
            file=sys.stderr,
        )
        return 3
    print("file-set verification PASS: %s" % report)
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Create or verify an exact archive file-set/content manifest."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    create = subparsers.add_parser("create")
    create.add_argument("--root", type=Path, required=True)
    create.add_argument("--output", type=Path, required=True)

    verify = subparsers.add_parser("verify")
    verify.add_argument("--root", type=Path, required=True)
    verify.add_argument("--manifest", type=Path, required=True)
    verify.add_argument("--report", type=Path, required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        if args.command == "create":
            return create_manifest(args.root, args.output)
        return verify_manifest(args.root, args.manifest, args.report)
    except (OSError, ValueError, RuntimeError) as exc:
        print("file-set tool error: %s" % exc, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
