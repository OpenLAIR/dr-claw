#!/usr/bin/env python3
"""Build a deterministic, self-contained Dr. Claw Codex offline release kit.

The kit is built exclusively from one clean, annotated release tag.  It
contains both a source archive for inspection and a Git bundle that the
existing ``remote-install.sh`` can use as a local repository.  Worktree-only
files are never copied.
"""

from __future__ import annotations

import argparse
import ctypes
import errno
import gzip
import hashlib
import json
import math
import os
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Dict, List, Mapping, NoReturn, Optional, Sequence, Tuple
from urllib.parse import urlsplit


SCHEMA_VERSION = 1
BUILDER_VERSION = "2"
MANIFEST_PATH = "bootstrap/codex/manifest.json"
REMOTE_INSTALL_PATH = "bootstrap/codex/remote-install.sh"
BUILDER_PATH = "bootstrap/codex/build_release_kit.py"
GITMODULES_PATH = ".gitmodules"
TAG_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}")
OBJECT_ID_PATTERN = re.compile(r"[0-9a-f]{40}")
HEX_SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")
GITMODULES_SECTION_RE = re.compile(r'^\s*\[submodule\s+"([^"\r\n]+)"\]\s*$')
GITMODULES_ASSIGNMENT_RE = re.compile(r"^\s*([A-Za-z][A-Za-z0-9-]*)\s*=\s*(.*?)\s*$")

# These are high-confidence credential signatures, not generic words such as
# "token" or "session" that legitimately occur in application source.  Keep
# literal credential prefixes split so this scanner does not flag its own
# source when the builder is included in a release.
SECRET_SIGNATURES: Sequence[Tuple[str, re.Pattern[bytes]]] = (
    (
        "private-key",
        re.compile(
            b"-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----\\r?\\n"
            b"(?:[A-Za-z0-9+/=]{20,}\\r?\\n){2,}"
            b"-----END \\1-----"
        ),
    ),
    (
        "escaped-private-key",
        re.compile(
            b"-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----\\\\n"
            b"(?:[A-Za-z0-9+/=]{20,}\\\\n){2,}"
            b"-----END \\1-----"
        ),
    ),
    (
        "github-token",
        re.compile(b"gh" + b"[pousr]_[A-Za-z0-9]{36,}"),
    ),
    (
        "openai-api-key",
        re.compile(b"sk-" + b"(?:proj-)?[A-Za-z0-9_-]{32,}"),
    ),
    (
        "aws-access-key",
        re.compile(b"AK" + b"IA[0-9A-Z]{16}"),
    ),
    (
        "slack-token",
        re.compile(b"xox" + b"[aboprs]-[A-Za-z0-9-]{24,}"),
    ),
)


class ReleaseKitError(RuntimeError):
    """A fail-closed release-kit validation error."""


def fail(message: str) -> NoReturn:
    raise ReleaseKitError(message)


def git_environment() -> Dict[str, str]:
    """Return a credential-free, locale-stable environment for local Git."""

    return {
        "PATH": os.environ.get("PATH", os.defpath),
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_SYSTEM": os.devnull,
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_NO_REPLACE_OBJECTS": "1",
    }


def run_command(
    command: Sequence[str],
    *,
    cwd: Path,
    label: str,
    stdout_file: Optional[Path] = None,
) -> bytes:
    output_handle = None
    try:
        if stdout_file is not None:
            output_handle = stdout_file.open("xb")
        result = subprocess.run(
            list(command),
            cwd=str(cwd),
            env=git_environment(),
            check=False,
            stdout=output_handle if output_handle is not None else subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        fail(f"{label} could not run ({type(error).__name__})")
    finally:
        if output_handle is not None:
            output_handle.close()
    if result.returncode != 0:
        fail(f"{label} failed with exit status {result.returncode}")
    return b"" if stdout_file is not None else result.stdout


def git(repo: Path, *arguments: str, label: str) -> bytes:
    return run_command(["git", *arguments], cwd=repo, label=label)


def git_text(repo: Path, *arguments: str, label: str) -> str:
    try:
        return git(repo, *arguments, label=label).decode("utf-8").strip()
    except UnicodeDecodeError:
        fail(f"{label} returned non-UTF-8 output")


def lexical_absolute(path: Path) -> Path:
    return Path(os.path.abspath(os.fspath(path)))


def reject_symlink_components(path: Path, *, require_leaf: bool) -> None:
    """Reject symlinks in an existing absolute path without resolving them."""

    absolute = lexical_absolute(path)
    current = Path(absolute.anchor)
    parts = absolute.parts[1:] if absolute.anchor else absolute.parts
    for index, part in enumerate(parts):
        current /= part
        try:
            info = os.lstat(current)
        except FileNotFoundError:
            if require_leaf or index != len(parts) - 1:
                fail("a required path component does not exist")
            return
        if stat.S_ISLNK(info.st_mode):
            fail("symlink path components are forbidden")


def validate_repo_root(raw_root: Path) -> Path:
    root = lexical_absolute(raw_root)
    reject_symlink_components(root, require_leaf=True)
    if not root.is_dir():
        fail("--repo-root must be an existing directory")
    if root.stat().st_uid != os.geteuid():
        fail("--repo-root must be owned by the current user")
    top_level = lexical_absolute(
        Path(git_text(root, "rev-parse", "--show-toplevel", label="repository discovery"))
    )
    if top_level != root:
        fail("--repo-root must name the exact Git worktree root")
    if git_text(root, "rev-parse", "--is-bare-repository", label="repository type") != "false":
        fail("a non-bare worktree is required")
    if git_text(root, "rev-parse", "--is-shallow-repository", label="repository history") != "false":
        fail("a complete, non-shallow repository is required for an offline Git bundle")
    git_dir = lexical_absolute(
        Path(git_text(root, "rev-parse", "--absolute-git-dir", label="Git directory discovery"))
    )
    reject_symlink_components(git_dir, require_leaf=True)
    if not git_dir.is_dir():
        fail("the Git metadata directory is not a real directory")
    return root


def validate_output(raw_output: Path, repo: Path) -> Tuple[Path, Path]:
    output = lexical_absolute(raw_output)
    parent = output.parent
    reject_symlink_components(parent, require_leaf=True)
    if not parent.is_dir():
        fail("the output parent must be an existing directory")
    parent_info = parent.stat()
    parent_mode = stat.S_IMODE(parent_info.st_mode)
    private_owned_parent = (
        parent_info.st_uid == os.geteuid() and parent_mode & 0o022 == 0
    )
    sticky_transport_parent = bool(parent_mode & stat.S_ISVTX)
    if not (private_owned_parent or sticky_transport_parent):
        fail(
            "the output parent must be current-user-owned and not group/other-writable, "
            "or a sticky transport directory"
        )
    try:
        output.relative_to(repo)
    except ValueError:
        pass
    else:
        fail("the release kit output must be outside the source worktree")
    if os.path.lexists(output):
        if output.is_symlink():
            fail("the release kit output must not be a symlink")
        fail("the release kit output already exists; refusing to overwrite it")
    return output, parent


def validate_tag_name(tag: str) -> None:
    if not TAG_PATTERN.fullmatch(tag):
        fail("--tag must be a simple release tag without slashes or control characters")


def parse_manifest(data: bytes, tag: str) -> Mapping[str, object]:
    try:
        manifest = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail(f"the tagged bootstrap manifest is invalid ({type(error).__name__})")
    if not isinstance(manifest, dict):
        fail("the tagged bootstrap manifest must be an object")
    baseline = manifest.get("baseline")
    if not isinstance(baseline, dict) or baseline.get("bundle_release_ref") != tag:
        fail("the tagged manifest release ref does not match --tag")
    required = manifest.get("required_repository_paths")
    if not isinstance(required, list) or BUILDER_PATH not in required:
        fail("the tagged manifest does not require the release-kit builder")
    if REMOTE_INSTALL_PATH not in required:
        fail("the tagged manifest does not require the remote installer")
    return manifest


def parse_gitlinks(manifest: Mapping[str, object]) -> Dict[str, str]:
    source_policy = manifest.get("source_policy", {})
    if not isinstance(source_policy, dict):
        fail("manifest source_policy must be an object")
    raw_gitlinks = source_policy.get("allowed_uninitialized_gitlinks", {})
    if not isinstance(raw_gitlinks, dict):
        fail("manifest allowed_uninitialized_gitlinks must be an object")
    result: Dict[str, str] = {}
    for raw_path, raw_object in raw_gitlinks.items():
        if not isinstance(raw_path, str) or not isinstance(raw_object, str):
            fail("manifest contains an invalid gitlink allowlist entry")
        validate_repository_path(raw_path)
        object_id = raw_object.lower()
        if not OBJECT_ID_PATTERN.fullmatch(object_id):
            fail("manifest contains an invalid gitlink object ID")
        result[raw_path] = object_id
    return result


def validate_repository_path(path: str) -> PurePosixPath:
    if not path or "\x00" in path or "\n" in path or "\r" in path:
        fail("the release contains an invalid repository path")
    pure = PurePosixPath(path)
    if pure.is_absolute() or any(part in {"", ".", ".."} for part in pure.parts):
        fail("the release contains a non-canonical repository path")
    return pure


def forbidden_machine_path(path: str) -> Optional[str]:
    pure = validate_repository_path(path)
    lowered = tuple(part.lower() for part in pure.parts)
    basename = lowered[-1]
    if any(part in {".git", ".ssh", ".codex"} for part in lowered):
        return "machine-state-directory"
    if any(
        part in {"sessions", "archived_sessions", "attachments", "memories", "goals"}
        for part in lowered
    ):
        return "session-state-directory"
    if lowered and lowered[0] in {"sessions", "auth", "credentials"}:
        return "top-level-auth-or-session-state"
    if any(
        lowered[index : index + 2] == ("plugins", "cache")
        for index in range(max(0, len(lowered) - 1))
    ):
        return "plugin-cache"
    if basename.startswith(".env") and basename not in {
        ".env.example",
        ".env.sample",
        ".env.template",
    }:
        return "environment-secret-file"
    if basename.endswith((".sqlite", ".sqlite3", ".sqlite-wal", ".sqlite-shm", ".db")):
        return "session-database"
    if basename in {
        "id_rsa",
        "id_dsa",
        "id_ecdsa",
        "id_ed25519",
        "credentials.json",
        "token.json",
    } or basename.endswith((".p12", ".pfx")):
        return "credential-file"
    if basename == "auth.json":
        is_localization = any(
            lowered[index : index + 2] == ("i18n", "locales")
            for index in range(max(0, len(lowered) - 1))
        )
        if not is_localization:
            return "authentication-state"
    if basename in {
        "session.json",
        "sessions.json",
        "session.jsonl",
        "sessions.jsonl",
        "session.ndjson",
        "sessions.ndjson",
        "cookies.json",
    }:
        return "session-state-file"
    return None


def parse_tree(repo: Path, commit: str) -> Dict[str, Tuple[str, str, str]]:
    raw = git(
        repo,
        "ls-tree",
        "-rz",
        "-r",
        "--full-tree",
        commit,
        label="tag tree inventory",
    )
    result: Dict[str, Tuple[str, str, str]] = {}
    for record in raw.split(b"\0"):
        if not record:
            continue
        try:
            metadata, encoded_path = record.split(b"\t", 1)
            mode_bytes, type_bytes, object_bytes = metadata.split(b" ", 2)
            path = encoded_path.decode("utf-8")
            mode = mode_bytes.decode("ascii")
            object_type = type_bytes.decode("ascii")
            object_id = object_bytes.decode("ascii").lower()
        except (UnicodeDecodeError, ValueError):
            fail("the tag tree contains an unsupported entry")
        validate_repository_path(path)
        reason = forbidden_machine_path(path)
        if reason:
            fail(f"the tag tree contains forbidden machine state ({reason})")
        if mode == "120000":
            fail("tracked symlinks are forbidden in a release kit")
        if mode not in {"100644", "100755", "160000"}:
            fail("the tag tree contains an unsupported file mode")
        if mode == "160000" and object_type != "commit":
            fail("the tag tree contains a malformed gitlink")
        if mode != "160000" and object_type != "blob":
            fail("the tag tree contains a non-blob file")
        result[path] = (mode, object_type, object_id)
    return result


def validate_historical_paths(repo: Path, commit: str) -> int:
    raw = git(
        repo,
        "log",
        "--pretty=format:",
        "--name-only",
        "-z",
        "--no-renames",
        commit,
        label="reachable path history inventory",
    )
    paths = set()
    for encoded in raw.split(b"\0"):
        if not encoded:
            continue
        try:
            path = encoded.decode("utf-8")
        except UnicodeDecodeError:
            fail("reachable history contains a non-UTF-8 path")
        validate_repository_path(path)
        reason = forbidden_machine_path(path)
        if reason:
            fail(f"reachable Git history contains forbidden machine state ({reason})")
        paths.add(path)
    return len(paths)


def reachable_objects(repo: Path, commit: str) -> List[str]:
    raw = git(
        repo,
        "rev-list",
        "--objects",
        "--no-object-names",
        commit,
        label="reachable object inventory",
    )
    objects = []
    for encoded in raw.splitlines():
        try:
            object_id = encoded.decode("ascii").lower()
        except UnicodeDecodeError:
            fail("reachable object inventory is malformed")
        if not OBJECT_ID_PATTERN.fullmatch(object_id):
            fail("reachable object inventory contains an invalid object ID")
        objects.append(object_id)
    if not objects:
        fail("the release tag has no reachable objects")
    return objects


def classify_objects(
    repo: Path, objects: Sequence[str]
) -> Tuple[List[Tuple[str, str, int]], int, int]:
    payload = "".join(f"{object_id}\n" for object_id in objects).encode("ascii")
    try:
        result = subprocess.run(
            ["git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
            cwd=str(repo),
            env=git_environment(),
            input=payload,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
            timeout=600,
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        fail(f"reachable object classification could not run ({type(error).__name__})")
    if result.returncode != 0:
        fail("reachable object classification failed")
    credential_payloads: List[Tuple[str, str, int]] = []
    blob_count = 0
    total_blob_bytes = 0
    lines = result.stdout.splitlines()
    if len(lines) != len(objects):
        fail("reachable object classification returned an incomplete result")
    for line in lines:
        try:
            encoded_id, encoded_type, encoded_size = line.split(b" ", 2)
            object_id = encoded_id.decode("ascii").lower()
            object_type = encoded_type.decode("ascii")
            size = int(encoded_size)
        except (UnicodeDecodeError, ValueError):
            fail("reachable object classification is malformed")
        if object_type == "blob":
            blob_count += 1
            total_blob_bytes += size
        if object_type in {"blob", "commit", "tag"}:
            credential_payloads.append((object_id, object_type, size))
    return credential_payloads, blob_count, total_blob_bytes


def scan_objects_for_credentials(
    repo: Path, objects: Sequence[Tuple[str, str, int]]
) -> None:
    try:
        process = subprocess.Popen(
            ["git", "cat-file", "--batch"],
            cwd=str(repo),
            env=git_environment(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as error:
        fail(f"reachable credential payload scan could not run ({type(error).__name__})")
    assert process.stdin is not None
    assert process.stdout is not None
    try:
        for expected_id, expected_type, expected_size in objects:
            process.stdin.write(expected_id.encode("ascii") + b"\n")
            process.stdin.flush()
            header = process.stdout.readline()
            try:
                encoded_id, object_type, encoded_size = header.rstrip(b"\n").split(b" ", 2)
                actual_id = encoded_id.decode("ascii").lower()
                actual_size = int(encoded_size)
            except (UnicodeDecodeError, ValueError):
                fail("reachable credential payload scan returned a malformed header")
            if (
                actual_id != expected_id
                or object_type.decode("ascii", errors="replace") != expected_type
                or actual_size != expected_size
            ):
                fail("reachable credential payload scan returned the wrong object")
            data = process.stdout.read(actual_size)
            terminator = process.stdout.read(1)
            if len(data) != actual_size or terminator != b"\n":
                fail("reachable credential payload scan returned truncated content")
            for label, pattern in SECRET_SIGNATURES:
                for match in pattern.finditer(data):
                    if looks_like_real_credential(label, match.group(0)):
                        fail(
                            "reachable Git history contains a high-confidence "
                            f"credential ({label})"
                        )
        process.stdin.close()
        return_code = process.wait(timeout=60)
    except BaseException:
        process.kill()
        process.wait()
        raise
    if return_code != 0:
        fail("reachable credential payload scan failed")


def looks_like_real_credential(label: str, value: bytes) -> bool:
    """Exclude obvious repeated-character documentation placeholders."""

    if label in {"private-key", "escaped-private-key"}:
        return True
    if label == "aws-access-key" and value.endswith(b"EXAMPLE"):
        return False
    if b"_" in value:
        payload = value.split(b"_", 1)[1]
    elif label == "openai-api-key":
        payload = value.removeprefix(b"sk-proj-").removeprefix(b"sk-")
    else:
        payload = value
    normalized = bytes(character for character in payload.lower() if chr(character).isalnum())
    if len(normalized) < 20 or len(set(normalized)) < 8:
        return False
    counts = {character: normalized.count(character) for character in set(normalized)}
    entropy = -sum(
        (count / len(normalized)) * math.log2(count / len(normalized))
        for count in counts.values()
    )
    return entropy >= 3.0


def ensure_uninitialized_gitlinks(
    repo: Path,
    tree: Mapping[str, Tuple[str, str, str]],
    allowed: Mapping[str, str],
) -> None:
    actual = {
        path: object_id
        for path, (mode, _object_type, object_id) in tree.items()
        if mode == "160000"
    }
    if actual != dict(allowed):
        fail("tag gitlinks do not exactly match the manifest allowlist")
    for path in sorted(actual):
        candidate = repo.joinpath(*PurePosixPath(path).parts)
        if candidate.is_symlink():
            fail("an allowed gitlink is a symlink")
        if candidate.exists():
            if not candidate.is_dir():
                fail("an allowed gitlink is not a directory")
            try:
                next(candidate.iterdir())
            except StopIteration:
                pass
            else:
                fail("allowed gitlinks must remain uninitialized")


def parse_gitmodules(data: bytes) -> Dict[str, str]:
    """Parse the simple, release-safe subset of Git's .gitmodules format."""

    try:
        lines = data.decode("utf-8").splitlines()
    except UnicodeDecodeError:
        fail("tag .gitmodules must be UTF-8")
    sections: List[Dict[str, str]] = []
    current: Optional[Dict[str, str]] = None
    names = set()
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith(("#", ";")):
            continue
        section = GITMODULES_SECTION_RE.fullmatch(line)
        if section is not None:
            name = section.group(1)
            if name in names:
                fail("tag .gitmodules has duplicate submodule sections")
            names.add(name)
            current = {"name": name}
            sections.append(current)
            continue
        assignment = GITMODULES_ASSIGNMENT_RE.fullmatch(line)
        if assignment is None or current is None:
            fail("tag .gitmodules is malformed")
        key = assignment.group(1).lower()
        value = assignment.group(2)
        if key in {"path", "url"}:
            if key in current:
                fail("tag .gitmodules repeats a required submodule field")
            current[key] = value

    result: Dict[str, str] = {}
    for section in sections:
        path = section.get("path")
        url = section.get("url")
        if not path or not url:
            fail("tag .gitmodules entries require non-empty path and url fields")
        validate_repository_path(path)
        if any(character in url for character in ("\x00", "\n", "\r")) or url.startswith("-"):
            fail("tag .gitmodules contains an unsafe submodule URL")
        if path in result:
            fail("tag .gitmodules maps more than one section to the same path")
        result[path] = url
    return result


def ensure_gitlink_metadata(
    repo: Path,
    tree: Mapping[str, Tuple[str, str, str]],
    allowed: Mapping[str, str],
) -> None:
    """Require checkout-safe .gitmodules metadata for every allowed gitlink."""

    metadata = tree.get(GITMODULES_PATH)
    if not allowed:
        if metadata is not None:
            fail("tag .gitmodules exists without an allowed gitlink")
        return
    if metadata is None:
        fail("tag has gitlinks but no .gitmodules metadata")
    mode, object_type, object_id = metadata
    if mode != "100644" or object_type != "blob":
        fail("tag .gitmodules must be a regular file")
    paths = parse_gitmodules(
        git(repo, "cat-file", "blob", object_id, label="tag .gitmodules read")
    )
    if set(paths) != set(allowed):
        fail("tag .gitmodules paths do not exactly match the gitlink allowlist")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def credential_safe_repository_label(value: object) -> str:
    """Keep only a public HTTPS source URL in portable provenance."""

    if not isinstance(value, str) or any(
        character in value for character in ("\x00", "\n", "\r")
    ):
        return "omitted-by-credential-safe-policy"
    try:
        parsed = urlsplit(value)
    except ValueError:
        return "omitted-by-credential-safe-policy"
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        return "omitted-by-credential-safe-policy"
    return value


def write_bytes(path: Path, data: bytes, *, mode: int = 0o600) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(descriptor)


def write_checksum_sidecar(path: Path, digest: str, artifact_name: str) -> None:
    if not HEX_SHA256_PATTERN.fullmatch(digest):
        fail("an internal SHA256 value is malformed")
    write_bytes(path, f"{digest}  {artifact_name}\n".encode("ascii"))


def build_release_readme(*, tag: str, tag_object: str, commit: str) -> bytes:
    """Return the deterministic, checksum-covered release and offline-kit guide."""

    return f"""# Dr. Claw Codex bootstrap `{tag}`

This is a pinned, reproducible Dr. Claw deployment for the official Codex CLI on Linux x86_64 and aarch64. It installs the portable Codex configuration, global `AGENTS.md`, the `drclaw-skill-library` router, and—when `--full` is used—the Dr. Claw control CLI and Web application.

这是面向 Linux x86_64/aarch64 官方 Codex CLI 的固定、可复现 Dr. Claw 部署。它会安装可移植 Codex 配置、全局 `AGENTS.md`、`drclaw-skill-library` 路由；使用 `--full` 时还会安装 Dr. Claw 控制 CLI 和 Web 应用。

## One-command online install / 在线一键安装

Run this as the final non-root Unix user who will run Codex. The script URL, annotated tag object, and peeled commit are all pinned:

请以最终运行 Codex 的非 root Unix 用户执行。脚本 URL、annotated tag object 和 peeled commit 均已固定：

```bash
bash -c 'set -Eeuo pipefail; curl -fsSL "https://raw.githubusercontent.com/OpenLAIR/dr-claw/{commit}/bootstrap/codex/remote-install.sh" | bash -s -- --ref "{tag}" --expected-commit "{commit}" --expected-tag-object "{tag_object}" --full'
```

- If a compatible official Codex CLI is already installed, it is preserved and contract-tested. If Codex is missing or too old, the audited version is installed. Append `--codex-release latest` only when you explicitly want the newest official CLI on a fresh host.
- `--full` installs the control CLI and Web application. The Web service is not started unless you append `--app-service auto --start-app`.
- On a verified NCSA Delta host, the Delta skill is selected automatically. Do not run production computation on a login node.
- A zero-write preview is available by appending `--dry-run`.

- 已安装且兼容的官方 Codex CLI 会被保留并接受合同测试；Codex 缺失或过旧时安装已审计版本。只有明确要求全新主机安装官方最新版本时才追加 `--codex-release latest`。
- `--full` 会安装控制 CLI 和 Web 应用；只有追加 `--app-service auto --start-app` 才会立即启动 Web 服务。
- 在已验证的 NCSA Delta 主机上会自动选择 Delta skill；生产计算不得运行在登录节点。
- 追加 `--dry-run` 可进行零写入预览。

## Offline source transport / 离线源码传输

Keep every file from this Release in one private directory, then run:

将本 Release 的全部文件放在同一个私有目录后执行：

```bash
sha256sum --strict --check SHA256SUMS
bash ./install.sh --full
```

The offline kit avoids fetching Dr. Claw source from GitHub. A full install still needs the approved Codex, PyPI, Node, and npm endpoints unless separately reviewed mirrors are provided.

离线包不再依赖 GitHub 获取 Dr. Claw 源码；但完整安装仍需要获准的 Codex、PyPI、Node 和 npm endpoint，除非另行提供经过审查的镜像。

## Activation and security boundary / 激活与安全边界

After installation, complete authentication on the target host. For a headless server, the usual command is:

安装后必须在目标主机自行完成认证；无头服务器通常执行：

```bash
codex login --device-auth
codex login status
```

The release never copies Codex auth/session databases, connector OAuth, API keys, SSH keys or Duo state, caches, `.env` files, existing research projects, or another machine's trusted paths. The first Dr. Claw browser account, connector authorization, and a post-login read-only model smoke remain target-user actions.

本 Release 永不复制 Codex auth/session 数据库、connector OAuth、API key、SSH key/Duo 状态、缓存、`.env`、已有研究项目或另一台机器的可信路径。首次 Dr. Claw 浏览器账户、connector 授权以及登录后的只读模型 smoke 仍由目标用户完成。

## Immutable identity / 不可变身份

- Tag: `{tag}`
- Annotated tag object: `{tag_object}`
- Peeled commit: `{commit}`
- Integrity index: `SHA256SUMS`
- Machine-readable provenance: `drclaw-{tag}.provenance.json`

## Documentation / 文档

- English: https://github.com/OpenLAIR/dr-claw/blob/{commit}/docs/codex-bootstrap.md
- 中文: https://github.com/OpenLAIR/dr-claw/blob/{commit}/bootstrap/codex/README.zh-CN.md
- Official Codex CLI: https://learn.chatgpt.com/docs/codex/cli
- Official Codex authentication: https://learn.chatgpt.com/docs/auth
""".encode("utf-8")


def build_wrapper(
    *,
    tag: str,
    tag_object: str,
    commit: str,
    bundle_name: str,
    expected_files: Sequence[str],
) -> bytes:
    # Tag and filenames are constrained to a conservative ASCII alphabet, and
    # commit is exactly 40 lowercase hexadecimal characters.
    files_literal = " ".join(f'"{name}"' for name in expected_files)
    return f"""#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

die() {{
  printf 'ERROR: %s\\n' "$*" >&2
  exit 2
}}

command -v python3 >/dev/null 2>&1 || die "Python 3.9 or newer is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
sha256sum_version=$(sha256sum --version 2>/dev/null || true)
[[ "$sha256sum_version" == *"GNU coreutils"* ]] \
  || die "GNU coreutils sha256sum is required"

raw_script=${{BASH_SOURCE[0]}}
[[ "$raw_script" = /* ]] || raw_script="$PWD/$raw_script"
python3 - "$raw_script" {files_literal} <<'PY' || exit 2
import os
import re
import stat
import sys
from pathlib import Path

if sys.version_info < (3, 9):
    raise SystemExit("ERROR: Python 3.9 or newer is required")

script = Path(os.path.abspath(sys.argv[1]))
root = script.parent

def reject_symlink_chain(path: Path) -> None:
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            info = os.lstat(current)
        except OSError:
            raise SystemExit("ERROR: offline kit has a missing path")
        if stat.S_ISLNK(info.st_mode):
            raise SystemExit("ERROR: offline kit path must not contain symlinks")

reject_symlink_chain(script)
expected = sys.argv[2:]
root_info = os.lstat(root)
if root_info.st_uid != os.geteuid() or root_info.st_mode & 0o022:
    raise SystemExit("ERROR: offline kit directory must be current-user-owned and not group/other-writable")
actual = sorted(path.name for path in root.iterdir())
if actual != sorted(expected):
    raise SystemExit("ERROR: offline kit directory inventory mismatch")
for name in expected:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
        raise SystemExit("ERROR: offline kit has an invalid filename")
    candidate = root / name
    reject_symlink_chain(candidate)
    info = os.lstat(candidate)
    if not stat.S_ISREG(info.st_mode):
        raise SystemExit("ERROR: offline kit has a missing regular file")
    if info.st_uid != os.geteuid() or info.st_mode & 0o022:
        raise SystemExit("ERROR: offline kit files must be current-user-owned and not group/other-writable")

checksum_path = root / "SHA256SUMS"
lines = checksum_path.read_text(encoding="ascii").splitlines()
seen = []
for line in lines:
    match = re.fullmatch(r"([0-9a-f]{{64}})  ([A-Za-z0-9][A-Za-z0-9._-]*)", line)
    if not match:
        raise SystemExit("ERROR: offline kit checksum index is malformed")
    seen.append(match.group(2))
if sorted(seen) != sorted(name for name in expected if name != "SHA256SUMS"):
    raise SystemExit("ERROR: offline kit checksum inventory mismatch")
PY

script_dir=$(CDPATH= cd -P -- "$(dirname -- "$raw_script")" && pwd)
(
  cd -- "$script_dir"
  sha256sum --strict --quiet --check SHA256SUMS
) || die "offline kit checksum verification failed"

for argument in "$@"; do
  case "$argument" in
    --repo-url|--repo-url=*|--ref|--ref=*|--expected-commit|--expected-commit=*|\
    --expected-tag-object|--expected-tag-object=*|--)
      die "offline kit pins repository, tag, and commit; reserved identity arguments are forbidden"
      ;;
  esac
done

exec bash "$script_dir/remote-install.sh" \\
  --repo-url "$script_dir/{bundle_name}" \\
  --ref "{tag}" \\
  --expected-commit "{commit}" \\
  --expected-tag-object "{tag_object}" \\
  "$@"
""".encode("utf-8")


def create_transport_bundle(repo: Path, bundle: Path, tag: str, tag_object: str) -> None:
    """Create a self-contained bundle preserving the original annotated tag."""

    descriptor = os.open(
        bundle,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
        0o600,
    )
    try:
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(f"# v2 git bundle\n{tag_object} refs/tags/{tag}\n\n".encode("ascii"))
            handle.flush()
            try:
                result = subprocess.run(
                    [
                        "git",
                        "-c",
                        "pack.threads=1",
                        "-c",
                        "pack.compression=9",
                        "pack-objects",
                        "--stdout",
                        "--revs",
                    ],
                    cwd=str(repo),
                    env=git_environment(),
                    input=(tag_object + "\n").encode("ascii"),
                    stdout=handle,
                    stderr=subprocess.PIPE,
                    check=False,
                    timeout=600,
                )
            except (OSError, subprocess.TimeoutExpired) as error:
                fail(f"Git bundle pack creation could not run ({type(error).__name__})")
            if result.returncode != 0:
                fail(f"Git bundle pack creation failed with exit status {result.returncode}")
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(descriptor)


def verify_bundle(
    repo: Path, bundle: Path, tag: str, tag_object: str, commit: str
) -> None:
    run_command(["git", "bundle", "verify", str(bundle)], cwd=repo, label="Git bundle verification")
    heads = run_command(
        ["git", "bundle", "list-heads", str(bundle)],
        cwd=repo,
        label="Git bundle ref inventory",
    )
    expected = f"{tag_object} refs/tags/{tag}\n".encode("ascii")
    if heads != expected:
        fail("the Git bundle does not contain exactly the approved tag")
    with tempfile.TemporaryDirectory(prefix=".bundle-verify.", dir=str(bundle.parent)) as raw:
        consumer = Path(raw)
        git(consumer, "init", "--quiet", label="Git bundle verification repository")
        git(
            consumer,
            "fetch",
            "--quiet",
            str(bundle),
            f"refs/tags/{tag}:refs/tags/{tag}",
            label="Git bundle annotated-tag fetch",
        )
        fetched_object = git_text(
            consumer,
            "rev-parse",
            "--verify",
            f"refs/tags/{tag}",
            label="Git bundle tag object verification",
        ).lower()
        fetched_type = git_text(
            consumer,
            "cat-file",
            "-t",
            fetched_object,
            label="Git bundle tag type verification",
        )
        fetched_commit = git_text(
            consumer,
            "rev-parse",
            "--verify",
            f"refs/tags/{tag}^{{commit}}",
            label="Git bundle tag peel verification",
        ).lower()
        if fetched_object != tag_object or fetched_type != "tag" or fetched_commit != commit:
            fail("the Git bundle did not preserve the approved annotated tag identity")


def verify_archive(
    archive: Path,
    tree: Mapping[str, Tuple[str, str, str]],
    gitlinks: Mapping[str, str],
) -> None:
    expected_files = {
        path for path, (mode, _object_type, _object_id) in tree.items() if mode != "160000"
    }
    observed_files = set()
    observed_gitlink_dirs = set()
    try:
        with tarfile.open(archive, "r:gz") as handle:
            for member in handle:
                if member.issym() or member.islnk():
                    fail("the source archive contains a link")
                if not (member.isfile() or member.isdir()):
                    fail("the source archive contains a special file")
                pure = PurePosixPath(member.name)
                if not pure.parts or pure.parts[0] != "dr-claw":
                    fail("the source archive has an invalid prefix")
                relative_parts = pure.parts[1:]
                if not relative_parts:
                    if not member.isdir():
                        fail("the source archive root is not a directory")
                    continue
                relative = PurePosixPath(*relative_parts).as_posix()
                validate_repository_path(relative)
                reason = forbidden_machine_path(relative)
                if reason:
                    fail(f"the source archive contains forbidden machine state ({reason})")
                for gitlink in gitlinks:
                    if relative == gitlink:
                        if not member.isdir():
                            fail("the source archive materialized gitlink content")
                        observed_gitlink_dirs.add(gitlink)
                    elif relative.startswith(gitlink + "/"):
                        fail("the source archive contains submodule content")
                if member.isfile():
                    observed_files.add(relative)
    except (OSError, tarfile.TarError) as error:
        fail(f"source archive verification failed ({type(error).__name__})")
    if observed_files != expected_files:
        fail("the source archive file inventory does not match the tag tree")
    if set(gitlinks) != observed_gitlink_dirs:
        fail("the source archive does not preserve gitlinks as empty directories")


def fsync_release_tree(staging: Path) -> None:
    for path in sorted(staging.iterdir(), key=lambda item: item.name):
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
            fail("the staged release kit contains a non-regular artifact")
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    descriptor = os.open(staging, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def rename_noreplace(source: Path, destination: Path) -> None:
    """Atomically publish one directory without ever replacing a target."""

    libc = ctypes.CDLL(None, use_errno=True)
    renameat2 = getattr(libc, "renameat2", None)
    if renameat2 is None:
        fail("this Linux host lacks atomic renameat2(RENAME_NOREPLACE)")
    renameat2.argtypes = [ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint]
    renameat2.restype = ctypes.c_int
    at_fdcwd = -100
    rename_noreplace_flag = 1
    result = renameat2(
        at_fdcwd,
        os.fsencode(source),
        at_fdcwd,
        os.fsencode(destination),
        rename_noreplace_flag,
    )
    if result == 0:
        return
    error_number = ctypes.get_errno()
    if error_number in {errno.EEXIST, errno.ENOTEMPTY}:
        fail("the release kit output appeared concurrently; refusing to overwrite it")
    if error_number in {errno.ENOSYS, errno.EINVAL}:
        fail("the filesystem does not support atomic no-replace publication")
    fail(f"atomic release kit publication failed (errno {error_number})")


def build_release_kit(
    *,
    repo: Path,
    tag: str,
    expected_commit: Optional[str],
    output: Path,
    output_parent: Path,
) -> Mapping[str, object]:
    status = git(
        repo,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=none",
        label="worktree status",
    )
    if status:
        fail("the source worktree is dirty; release kits require a clean checkout")

    tag_ref = f"refs/tags/{tag}"
    git(repo, "check-ref-format", tag_ref, label="release tag validation")
    tag_object = git_text(repo, "rev-parse", "--verify", tag_ref, label="release tag resolution").lower()
    if not OBJECT_ID_PATTERN.fullmatch(tag_object):
        fail("the release tag did not resolve to a full object ID")
    if git_text(repo, "cat-file", "-t", tag_object, label="release tag type") != "tag":
        fail("the release tag must be annotated, not lightweight")
    commit = git_text(
        repo,
        "rev-parse",
        "--verify",
        f"{tag_ref}^{{commit}}",
        label="release commit resolution",
    ).lower()
    if not OBJECT_ID_PATTERN.fullmatch(commit):
        fail("the release tag did not peel to a full commit ID")
    head = git_text(repo, "rev-parse", "--verify", "HEAD^{commit}", label="HEAD resolution").lower()
    if head != commit:
        fail("HEAD does not match the release tag commit")
    if expected_commit is not None and commit != expected_commit:
        fail("the release tag commit does not match --expected-commit")
    tree_id = git_text(
        repo,
        "rev-parse",
        "--verify",
        f"{commit}^{{tree}}",
        label="release tree resolution",
    ).lower()
    commit_epoch_text = git_text(
        repo,
        "show",
        "-s",
        "--format=%ct",
        commit,
        label="release commit timestamp",
    )
    try:
        source_date_epoch = int(commit_epoch_text)
    except ValueError:
        fail("the release commit timestamp is invalid")

    tree = parse_tree(repo, commit)
    for required_path in (MANIFEST_PATH, REMOTE_INSTALL_PATH, BUILDER_PATH):
        if required_path not in tree or tree[required_path][0] != "100755" and required_path != MANIFEST_PATH:
            fail("the release tag is missing a required regular executable")
    manifest_blob = tree[MANIFEST_PATH][2]
    manifest_data = git(repo, "cat-file", "blob", manifest_blob, label="tagged manifest read")
    manifest = parse_manifest(manifest_data, tag)
    allowed_gitlinks = parse_gitlinks(manifest)
    ensure_gitlink_metadata(repo, tree, allowed_gitlinks)
    ensure_uninitialized_gitlinks(repo, tree, allowed_gitlinks)
    historical_path_count = validate_historical_paths(repo, commit)
    objects = reachable_objects(repo, tag_object)
    credential_payloads, reachable_blob_count, reachable_blob_bytes = classify_objects(
        repo, objects
    )
    scan_objects_for_credentials(repo, credential_payloads)

    staging = Path(
        tempfile.mkdtemp(prefix=f".{output.name}.tmp.", dir=str(output_parent))
    )
    os.chmod(staging, 0o700)
    published = False
    try:
        bundle_name = f"drclaw-{tag}.bundle"
        archive_name = f"drclaw-{tag}.tar.gz"
        provenance_name = f"drclaw-{tag}.provenance.json"
        bundle_path = staging / bundle_name
        archive_path = staging / archive_name
        provenance_path = staging / provenance_name

        create_transport_bundle(repo, bundle_path, tag, tag_object)
        verify_bundle(repo, bundle_path, tag, tag_object, commit)

        raw_tar = staging / ".source-archive.tar"
        run_command(
            [
                "git",
                "archive",
                "--format=tar",
                "--prefix=dr-claw/",
                "--output",
                str(raw_tar),
                commit,
            ],
            cwd=repo,
            label="source archive creation",
        )
        with raw_tar.open("rb") as source, archive_path.open("xb") as destination:
            with gzip.GzipFile(
                filename="",
                mode="wb",
                compresslevel=9,
                fileobj=destination,
                mtime=0,
            ) as compressor:
                shutil.copyfileobj(source, compressor, length=1024 * 1024)
            destination.flush()
            os.fsync(destination.fileno())
        raw_tar.unlink()
        os.chmod(archive_path, 0o600)
        verify_archive(archive_path, tree, allowed_gitlinks)

        remote_install_name = "remote-install.sh"
        remote_install_path = staging / remote_install_name
        remote_install_blob = tree[REMOTE_INSTALL_PATH][2]
        remote_install_data = git(
            repo,
            "cat-file",
            "blob",
            remote_install_blob,
            label="tagged remote installer read",
        )
        if not remote_install_data.startswith(b"#!/usr/bin/env bash\n"):
            fail("the tagged remote installer has an unexpected format")
        write_bytes(remote_install_path, remote_install_data, mode=0o700)

        bundle_digest = sha256_file(bundle_path)
        archive_digest = sha256_file(archive_path)
        bundle_sidecar_name = bundle_name + ".sha256"
        archive_sidecar_name = archive_name + ".sha256"
        write_checksum_sidecar(staging / bundle_sidecar_name, bundle_digest, bundle_name)
        write_checksum_sidecar(staging / archive_sidecar_name, archive_digest, archive_name)

        readme_name = "README.md"
        readme_path = staging / readme_name
        write_bytes(
            readme_path,
            build_release_readme(tag=tag, tag_object=tag_object, commit=commit),
        )

        install_name = "install.sh"
        checksum_index_name = "SHA256SUMS"
        # The wrapper validates this exact inventory before invoking the tagged
        # remote installer.  The provenance sidecar is added after provenance
        # itself is written, so all names are known up front.
        expected_wrapper_files = [
            install_name,
            readme_name,
            remote_install_name,
            bundle_name,
            archive_name,
            bundle_sidecar_name,
            archive_sidecar_name,
            provenance_name,
            provenance_name + ".sha256",
            checksum_index_name,
        ]
        install_data = build_wrapper(
            tag=tag,
            tag_object=tag_object,
            commit=commit,
            bundle_name=bundle_name,
            expected_files=expected_wrapper_files,
        )
        install_path = staging / install_name
        write_bytes(install_path, install_data, mode=0o700)

        artifact_paths = {
            "git_bundle": bundle_path,
            "source_archive": archive_path,
            "remote_installer": remote_install_path,
            "offline_installer": install_path,
            "release_readme": readme_path,
            "git_bundle_checksum": staging / bundle_sidecar_name,
            "source_archive_checksum": staging / archive_sidecar_name,
        }
        artifacts = {
            key: {
                "file": path.name,
                "sha256": sha256_file(path),
                "size": path.stat().st_size,
            }
            for key, path in sorted(artifact_paths.items())
        }
        baseline = manifest.get("baseline")
        assert isinstance(baseline, dict)  # parse_manifest already proved this.
        # Avoid ever carrying a credential-bearing URL or a local absolute path
        # into provenance.  Immutable Git object IDs remain the source identity.
        repository_value = credential_safe_repository_label(baseline.get("repository"))
        provenance: Dict[str, object] = {
            "schema_version": SCHEMA_VERSION,
            "artifact_type": "drclaw-codex-offline-release-kit",
            "builder_version": BUILDER_VERSION,
            "bundle_version": manifest.get("bundle_version"),
            "repository": repository_value,
            "tag": tag,
            "tag_object": tag_object,
            "commit": commit,
            "tree": tree_id,
            "source_date_epoch": source_date_epoch,
            "entrypoint": {
                "file": install_name,
                "command": "bash ./install.sh --full",
                "argument_policy": "forwards bootstrap options but forbids overriding repo/ref/commit",
                "repository_transport": bundle_name,
            },
            "artifacts": artifacts,
            "integrity": {
                "algorithm": "sha256",
                "index": checksum_index_name,
                "provenance_sidecar": provenance_name + ".sha256",
            },
            "source_audit": {
                "clean_worktree_required": True,
                "tag_kind": "annotated",
                "bundle_tag_transport": "original annotated tag object preserved and peel-verified",
                "tracked_symlinks": 0,
                "gitlinks": [
                    {"path": path, "object": object_id, "content_included": False}
                    for path, object_id in sorted(allowed_gitlinks.items())
                ],
                "gitlinks_uninitialized": True,
                "worktree_only_files_included": False,
                "reachable_object_count": len(objects),
                "reachable_blob_count": reachable_blob_count,
                "reachable_blob_bytes": reachable_blob_bytes,
                "credential_scanned_object_count": len(credential_payloads),
                "historical_path_count": historical_path_count,
                "forbidden_machine_state_scan": "passed-current-tree-and-reachable-history",
                "high_confidence_credential_scan": (
                    "passed-all-reachable-blob-commit-and-tag-payloads"
                ),
            },
        }
        provenance_data = (json.dumps(provenance, indent=2, sort_keys=True) + "\n").encode("utf-8")
        write_bytes(provenance_path, provenance_data)
        provenance_digest = sha256_file(provenance_path)
        provenance_sidecar_name = provenance_name + ".sha256"
        write_checksum_sidecar(
            staging / provenance_sidecar_name,
            provenance_digest,
            provenance_name,
        )

        indexed_names = sorted(
            [
                install_name,
                readme_name,
                remote_install_name,
                bundle_name,
                archive_name,
                bundle_sidecar_name,
                archive_sidecar_name,
                provenance_name,
                provenance_sidecar_name,
            ]
        )
        checksum_lines = [
            f"{sha256_file(staging / name)}  {name}\n" for name in indexed_names
        ]
        write_bytes(
            staging / checksum_index_name,
            "".join(checksum_lines).encode("ascii"),
        )

        # Re-parse and independently verify the checksum index before publish.
        for line in (staging / checksum_index_name).read_text(encoding="ascii").splitlines():
            match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)", line)
            if not match or sha256_file(staging / match.group(2)) != match.group(1):
                fail("internal release kit checksum verification failed")
        if sorted(path.name for path in staging.iterdir()) != sorted(expected_wrapper_files):
            fail("the staged release kit file inventory is not exact")
        final_tag_object = git_text(
            repo,
            "rev-parse",
            "--verify",
            tag_ref,
            label="final release tag stability check",
        ).lower()
        final_head = git_text(
            repo,
            "rev-parse",
            "--verify",
            "HEAD^{commit}",
            label="final HEAD stability check",
        ).lower()
        final_status = git(
            repo,
            "status",
            "--porcelain=v1",
            "-z",
            "--untracked-files=all",
            "--ignore-submodules=none",
            label="final worktree status",
        )
        if final_tag_object != tag_object or final_head != commit or final_status:
            fail("the source tag, HEAD, or worktree changed while the release kit was built")
        fsync_release_tree(staging)
        rename_noreplace(staging, output)
        published = True
        parent_descriptor = os.open(output_parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(parent_descriptor)
        finally:
            os.close(parent_descriptor)
        return provenance
    finally:
        if not published and staging.exists():
            shutil.rmtree(staging)


def parse_arguments(argv: Optional[Sequence[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build an atomic, credential-free Dr. Claw Codex offline release kit."
    )
    parser.add_argument("--repo-root", required=True, type=Path, help="exact clean Git worktree root")
    parser.add_argument("--tag", required=True, help="annotated manifest release tag")
    parser.add_argument(
        "--expected-commit",
        help="optional approved 40-hex commit; the tag and HEAD must resolve to it",
    )
    parser.add_argument(
        "--output",
        required=True,
        type=Path,
        help="new output directory outside the worktree; it must not already exist",
    )
    return parser.parse_args(argv)


def main(argv: Optional[Sequence[str]] = None) -> int:
    arguments = parse_arguments(argv)
    validate_tag_name(arguments.tag)
    expected_commit = arguments.expected_commit
    if expected_commit is not None:
        expected_commit = expected_commit.lower()
        if not OBJECT_ID_PATTERN.fullmatch(expected_commit):
            fail("--expected-commit must be exactly 40 hexadecimal characters")
    repo = validate_repo_root(arguments.repo_root)
    output, output_parent = validate_output(arguments.output, repo)
    provenance = build_release_kit(
        repo=repo,
        tag=arguments.tag,
        expected_commit=expected_commit,
        output=output,
        output_parent=output_parent,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "tag": provenance["tag"],
                "commit": provenance["commit"],
                "artifact_count": len(provenance["artifacts"]),  # type: ignore[arg-type]
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ReleaseKitError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(2)
