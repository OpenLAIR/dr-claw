#!/usr/bin/env python3
"""Reproducibly install and verify the optional Dr. Claw Web application.

This installer deliberately owns only user-level application runtime and state. It
does not copy credentials, inspect research projects, create users in the Web UI,
or start a process unless ``--start`` is explicitly supplied.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import http.client
import json
import os
import platform
import pwd
import re
import secrets
import shlex
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


SCRIPT_PATH = Path(__file__).resolve()
BOOTSTRAP_ROOT = SCRIPT_PATH.parent
DEFAULT_REPO_ROOT = BOOTSTRAP_ROOT.parent.parent
DEFAULT_MANIFEST_PATH = BOOTSTRAP_ROOT / "app-manifest.json"
MANAGED_ENV_MARKER = "# Managed by Dr. Claw Web bootstrap; contains a secret."
MANAGED_LAUNCHER_MARKER = "# Managed by Dr. Claw Web bootstrap."
MANAGED_UNIT_MARKER = "# Managed by Dr. Claw Web bootstrap."
MANAGED_NPMRC_MARKER = "; Managed by Dr. Claw Web bootstrap; contains no registry credentials."
MAX_NODE_ARCHIVE_BYTES = 200 * 1024 * 1024
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
MANAGED_ENV_KEYS = (
    "HOME",
    "CODEX_HOME",
    "HOST",
    "PORT",
    "DATABASE_PATH",
    "JWT_SECRET",
    "NODE_ENV",
    "DR_CLAW_STRICT_PORT",
    "WORKSPACES_ROOT",
    "DRCLAW_REPO_ROOT",
    "DRCLAW_NODE_BINARY",
    "DRCLAW_NODE_BIN",
)
PROTECTED_ROOTS = tuple(
    Path(item)
    for item in (
        "/bin",
        "/boot",
        "/dev",
        "/etc",
        "/lib",
        "/lib64",
        "/opt",
        "/proc",
        "/root",
        "/run",
        "/sbin",
        "/sys",
        "/usr",
        "/var",
    )
)


class AppBootstrapError(RuntimeError):
    """A safe, user-actionable application bootstrap failure."""


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(1024 * 1024)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def sha256_text(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def directory_digest(root: Path) -> str:
    if not root.is_dir() or root.is_symlink():
        raise AppBootstrapError(f"Cannot digest missing/symlink directory: {root}")
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise AppBootstrapError(f"Refusing symlink in digested application tree: {path}")
        if path.is_dir():
            continue
        if not path.is_file():
            raise AppBootstrapError(f"Refusing special file in digested application tree: {path}")
        digest.update(relative.encode("utf-8") + b"\0")
        digest.update(oct(stat.S_IMODE(path.stat().st_mode)).encode("ascii") + b"\0")
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def load_manifest(path: Path = DEFAULT_MANIFEST_PATH) -> Dict[str, object]:
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AppBootstrapError(f"Cannot load application manifest {path}: {error}") from error

    if manifest.get("schema_version") != 1:
        raise AppBootstrapError("Unsupported application manifest schema_version.")
    node = manifest.get("node")
    npm = manifest.get("npm")
    application = manifest.get("application")
    if not isinstance(node, dict) or not isinstance(npm, dict) or not isinstance(application, dict):
        raise AppBootstrapError("Application manifest is missing node/npm/application objects.")

    version = str(node.get("version", ""))
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise AppBootstrapError("Application manifest has an invalid pinned Node.js version.")
    base_url = str(node.get("release_base_url", ""))
    parsed_url = urllib.parse.urlsplit(base_url)
    if parsed_url.scheme != "https" or parsed_url.hostname != "nodejs.org":
        raise AppBootstrapError("Pinned Node.js release URL must use https://nodejs.org/.")
    if not parsed_url.path.rstrip("/").endswith("/v" + version):
        raise AppBootstrapError("Pinned Node.js release URL and version disagree.")

    artifacts = node.get("artifacts")
    if not isinstance(artifacts, dict) or not artifacts:
        raise AppBootstrapError("Application manifest has no Node.js artifacts.")
    for key, raw_artifact in artifacts.items():
        if not isinstance(key, str) or not isinstance(raw_artifact, dict):
            raise AppBootstrapError("Invalid Node.js artifact entry in application manifest.")
        filename = str(raw_artifact.get("filename", ""))
        checksum = str(raw_artifact.get("sha256", ""))
        if not filename.startswith("node-v" + version + "-") or not filename.endswith(".tar.xz"):
            raise AppBootstrapError(f"Invalid Node.js artifact filename for {key}.")
        if not re.fullmatch(r"[0-9a-f]{64}", checksum):
            raise AppBootstrapError(f"Invalid Node.js SHA256 for {key}.")

    for command_name in ("install", "build", "prepare_native", "prune", "verify"):
        command = npm.get(command_name)
        if not isinstance(command, list) or not command or not all(isinstance(item, str) for item in command):
            raise AppBootstrapError(f"Invalid npm command {command_name!r} in application manifest.")
    return manifest


def first_symlink_component(path: Path) -> Optional[Path]:
    absolute = path.absolute()
    current = Path(absolute.anchor)
    for component in absolute.parts[1:]:
        current = current / component
        if current.is_symlink():
            return current
        if not current.exists():
            break
    return None


def is_within(path: Path, root: Path) -> bool:
    try:
        path.resolve().relative_to(root.resolve())
        return True
    except ValueError:
        return False


def validate_user_home(raw_home: Optional[str]) -> Path:
    if os.name != "posix" or platform.system() != "Linux":
        raise AppBootstrapError("Dr. Claw Web bootstrap currently supports Linux only.")
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        raise AppBootstrapError("Run the application bootstrap as the target non-root user, not root.")

    login_home = Path(pwd.getpwuid(os.geteuid()).pw_dir).absolute()
    home = Path(raw_home).expanduser().absolute() if raw_home else login_home
    if not home.exists() or not home.is_dir():
        raise AppBootstrapError(f"Target home does not exist or is not a directory: {home}")
    symlink = first_symlink_component(home)
    if symlink is not None:
        raise AppBootstrapError(f"Refusing a target home with a symlink component: {symlink}")
    if any(home == root or is_within(home, root) for root in PROTECTED_ROOTS):
        raise AppBootstrapError(f"Refusing protected system path as target home: {home}")
    if hasattr(os, "geteuid") and home.stat().st_uid != os.geteuid():
        raise AppBootstrapError(f"Target home is not owned by the current user: {home}")
    return home.resolve()


def login_home_path() -> Path:
    return Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve()


def validate_target_path(path: Path, home: Path) -> None:
    if not is_within(path, home):
        raise AppBootstrapError(f"Managed application path must stay under target home: {path}")
    symlink = first_symlink_component(path)
    if symlink is not None:
        raise AppBootstrapError(f"Refusing to write through symlink component: {symlink}")


def resolve_codex_home(raw_codex_home: Optional[str], home: Path) -> Path:
    codex_home = (
        Path(raw_codex_home).expanduser().absolute()
        if raw_codex_home
        else home / ".codex"
    )
    if codex_home == home or not is_within(codex_home, home):
        raise AppBootstrapError("Application CODEX_HOME must be a dedicated path inside target home.")
    validate_target_path(codex_home, home)
    if codex_home.exists():
        if not codex_home.is_dir() or codex_home.is_symlink():
            raise AppBootstrapError(f"Application CODEX_HOME is not a real directory: {codex_home}")
        if hasattr(os, "geteuid") and codex_home.stat().st_uid != os.geteuid():
            raise AppBootstrapError(f"Application CODEX_HOME is not owned by current user: {codex_home}")
    return codex_home.resolve()


def ensure_private_dir(path: Path, home: Path, dry_run: bool = False) -> None:
    validate_target_path(path, home)
    if dry_run:
        return
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or not path.is_dir():
        raise AppBootstrapError(f"Managed path is not a real directory: {path}")
    if hasattr(os, "geteuid") and path.stat().st_uid != os.geteuid():
        raise AppBootstrapError(f"Managed directory is not owned by current user: {path}")
    os.chmod(path, 0o700)


def atomic_write(path: Path, content: str, mode: int) -> None:
    if path.is_symlink():
        raise AppBootstrapError(f"Refusing to replace a symlink at managed file path: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix="." + path.name + ".", dir=str(path.parent))
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def reject_managed_file_symlink(path: Path) -> None:
    if path.is_symlink():
        raise AppBootstrapError(f"Managed application file must not be a symlink: {path}")


def validate_repo(repo_root: Path, manifest: Mapping[str, object]) -> None:
    application = manifest["application"]
    if not isinstance(application, dict):
        raise AppBootstrapError("Invalid application manifest application object.")
    required = application.get("required_paths", [])
    if not isinstance(required, list):
        raise AppBootstrapError("Invalid required_paths in application manifest.")
    missing = [str(item) for item in required if not (repo_root / str(item)).is_file()]
    if missing:
        raise AppBootstrapError("Repository is missing required application files: " + ", ".join(missing))
    try:
        package = json.loads((repo_root / "package.json").read_text(encoding="utf-8"))
        lock = json.loads((repo_root / "package-lock.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AppBootstrapError(f"Cannot parse package metadata: {error}") from error
    if package.get("name") != application.get("package_name"):
        raise AppBootstrapError("package.json name does not match the application manifest.")
    if lock.get("lockfileVersion") != 3 or lock.get("name") != package.get("name"):
        raise AppBootstrapError("package-lock.json is missing, stale, or not lockfileVersion 3.")
    lock_root = lock.get("packages", {}).get("") if isinstance(lock.get("packages"), dict) else None
    if not isinstance(lock_root, dict) or lock_root.get("version") != package.get("version"):
        raise AppBootstrapError("package.json and package-lock.json root versions disagree.")


def platform_artifact_key() -> str:
    machine = platform.machine().lower()
    mapping = {
        "x86_64": "linux-x64",
        "amd64": "linux-x64",
        "aarch64": "linux-arm64",
        "arm64": "linux-arm64",
    }
    try:
        return mapping[machine]
    except KeyError as error:
        raise AppBootstrapError(f"No pinned Node.js artifact for Linux architecture {machine!r}.") from error


def verify_node_binary(node_binary: Path, expected_version: str) -> str:
    if node_binary.is_symlink() or not node_binary.is_file():
        raise AppBootstrapError(f"Managed Node.js binary is missing: {node_binary}")
    try:
        result = subprocess.run(
            [str(node_binary), "--version"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise AppBootstrapError(f"Cannot execute managed Node.js binary: {error}") from error
    observed = result.stdout.strip()
    if observed != "v" + expected_version:
        raise AppBootstrapError(
            f"Managed Node.js version mismatch: installed={observed!r}, expected='v{expected_version}'."
        )
    return observed


def validate_runtime_layout(
    runtime_parent: Path,
    node_runtime: Path,
    node_binary: Path,
    npm_binary: Path,
    expected_version: str,
    expected_layout: Optional[Mapping[str, object]] = None,
) -> Dict[str, str]:
    for path in (runtime_parent, node_runtime, node_binary):
        symlink = first_symlink_component(path)
        if symlink is not None:
            raise AppBootstrapError(f"Managed Node.js runtime must not traverse a symlink: {symlink}")
    if not node_runtime.is_dir() or node_runtime.is_symlink():
        raise AppBootstrapError(f"Managed Node.js runtime is not a real directory: {node_runtime}")
    if node_binary.is_symlink() or not node_binary.is_file():
        raise AppBootstrapError(f"Managed Node.js executable is not a regular in-runtime file: {node_binary}")
    try:
        npm_target = npm_binary.resolve(strict=True)
        npm_target.relative_to(node_runtime.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise AppBootstrapError(f"Managed npm launcher escapes/is missing from Node.js runtime: {npm_binary}") from error
    if not npm_target.is_file() or npm_target.is_symlink():
        raise AppBootstrapError(f"Managed npm target is not a regular file: {npm_target}")
    layout = {
        "node_binary_sha256": sha256_file(node_binary),
        "npm_target_relative": npm_target.relative_to(node_runtime.resolve()).as_posix(),
        "npm_target_sha256": sha256_file(npm_target),
    }
    if expected_layout is not None:
        if expected_layout.get("version") != expected_version:
            raise AppBootstrapError("Managed Node.js receipt version differs from pinned manifest.")
        for key, observed in layout.items():
            if expected_layout.get(key) != observed:
                raise AppBootstrapError(f"Managed Node.js runtime drifted from receipt ({key}).")
    # Execute only after the no-symlink and receipt digest/target checks above.
    layout["observed_version"] = verify_node_binary(node_binary, expected_version)
    return layout


def _validate_tar_members(members: Iterable[tarfile.TarInfo], extraction_root: Path) -> None:
    root = extraction_root.resolve()
    for member in members:
        if member.name.startswith("/"):
            raise AppBootstrapError(f"Unsafe absolute path in Node.js archive: {member.name}")
        destination = (extraction_root / member.name).resolve()
        if destination != root and not is_within(destination, root):
            raise AppBootstrapError(f"Unsafe traversal path in Node.js archive: {member.name}")
        if member.ischr() or member.isblk() or member.isfifo():
            raise AppBootstrapError(f"Unsafe special file in Node.js archive: {member.name}")
        if member.issym():
            link_target = (destination.parent / member.linkname).resolve()
            if link_target != root and not is_within(link_target, root):
                raise AppBootstrapError(f"Unsafe symlink in Node.js archive: {member.name}")
        if member.islnk():
            link_target = (extraction_root / member.linkname).resolve()
            if link_target != root and not is_within(link_target, root):
                raise AppBootstrapError(f"Unsafe hardlink in Node.js archive: {member.name}")


def extract_verified_node_archive(
    archive_path: Path,
    runtime_parent: Path,
    final_runtime: Path,
    expected_top_level: str,
) -> None:
    staging = Path(tempfile.mkdtemp(prefix=".node-extract-", dir=str(runtime_parent)))
    try:
        with tarfile.open(archive_path, mode="r:xz") as archive:
            members = archive.getmembers()
            _validate_tar_members(members, staging)
            archive.extractall(staging, members=members)
        extracted = staging / expected_top_level
        if not (extracted / "bin" / "node").is_file():
            raise AppBootstrapError("Verified Node.js archive did not contain the expected runtime tree.")
        if final_runtime.exists():
            raise AppBootstrapError(f"Node.js runtime target appeared concurrently: {final_runtime}")
        os.replace(extracted, final_runtime)
    except (OSError, tarfile.TarError) as error:
        raise AppBootstrapError(f"Cannot extract verified Node.js archive: {error}") from error
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def download_verified_node_archive(
    url: str,
    expected_sha256: str,
    destination: Path,
    local_archive: Optional[Path] = None,
) -> None:
    digest = hashlib.sha256()
    written = 0
    source_handle = None
    response = None
    try:
        if local_archive is not None:
            source_handle = local_archive.open("rb")
        else:
            request = urllib.request.Request(url, headers={"User-Agent": "drclaw-web-bootstrap/0.1"})
            response = urllib.request.urlopen(request, timeout=90)
            final_url = urllib.parse.urlsplit(response.geturl())
            if final_url.scheme != "https" or final_url.hostname != "nodejs.org":
                raise AppBootstrapError("Node.js download redirected outside https://nodejs.org/.")
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_NODE_ARCHIVE_BYTES:
                raise AppBootstrapError("Pinned Node.js archive exceeds the bootstrap size limit.")
            source_handle = response

        with destination.open("wb") as output:
            while True:
                chunk = source_handle.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > MAX_NODE_ARCHIVE_BYTES:
                    raise AppBootstrapError("Pinned Node.js archive exceeds the bootstrap size limit.")
                digest.update(chunk)
                output.write(chunk)
            output.flush()
            os.fsync(output.fileno())
    except (OSError, ValueError) as error:
        try:
            destination.unlink()
        except FileNotFoundError:
            pass
        raise AppBootstrapError(f"Cannot download/read pinned Node.js archive: {error}") from error
    finally:
        if response is not None:
            response.close()
        elif source_handle is not None:
            source_handle.close()

    observed = digest.hexdigest()
    if observed != expected_sha256:
        try:
            destination.unlink()
        except FileNotFoundError:
            pass
        raise AppBootstrapError(
            f"Pinned Node.js archive SHA256 mismatch: observed={observed}, expected={expected_sha256}."
        )


def shell_assignment(name: str, value: str) -> str:
    if not re.fullmatch(r"[A-Z][A-Z0-9_]*", name):
        raise AppBootstrapError(f"Invalid managed environment key: {name}")
    if "\x00" in value or "\n" in value or "\r" in value:
        raise AppBootstrapError(f"Invalid newline/NUL in managed environment value for {name}.")
    return f"{name}={shlex.quote(value)}"


def parse_managed_env(path: Path) -> Dict[str, str]:
    reject_managed_file_symlink(path)
    if not path.is_file():
        return {}
    content = path.read_text(encoding="utf-8")
    if "\x00" in content or not content.endswith("\n"):
        raise AppBootstrapError(f"Managed application environment is not canonical: {path}")
    lines = content.splitlines()
    if not lines or lines[0] != MANAGED_ENV_MARKER:
        raise AppBootstrapError(f"Refusing to parse an unmanaged application environment: {path}")
    if len(lines) != len(MANAGED_ENV_KEYS) + 1:
        raise AppBootstrapError(f"Managed application environment has extra/missing assignments: {path}")
    values: Dict[str, str] = {}
    observed_keys: List[str] = []
    for line in lines[1:]:
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if match is None:
            raise AppBootstrapError(f"Malformed managed environment assignment: {path}")
        key, raw_value = match.groups()
        if key in values or key not in MANAGED_ENV_KEYS:
            raise AppBootstrapError(f"Unknown/duplicate managed environment key {key!r}: {path}")
        try:
            parsed = shlex.split(raw_value, posix=True)
        except ValueError as error:
            raise AppBootstrapError(f"Malformed managed environment value for {key}: {error}") from error
        if len(parsed) != 1:
            raise AppBootstrapError(f"Malformed managed environment value for {key}.")
        value = parsed[0]
        if shell_assignment(key, value) != line:
            raise AppBootstrapError(f"Non-canonical/unsafe managed environment value for {key}.")
        values[key] = value
        observed_keys.append(key)
    if tuple(observed_keys) != MANAGED_ENV_KEYS:
        raise AppBootstrapError(f"Managed application environment key order/set is not canonical: {path}")
    return values


def validate_managed_env_values(
    values: Mapping[str, str], paths: "AppPaths", repo_root: Path
) -> None:
    expected = {
        "HOME": str(paths.home),
        "CODEX_HOME": str(paths.codex_home),
        "DATABASE_PATH": str(paths.database_path),
        "NODE_ENV": "production",
        "DR_CLAW_STRICT_PORT": "1",
        "WORKSPACES_ROOT": str(paths.workspace_root),
        "DRCLAW_REPO_ROOT": str(repo_root),
        "DRCLAW_NODE_BINARY": str(paths.node_binary),
        "DRCLAW_NODE_BIN": str(paths.node_runtime / "bin"),
    }
    for key, expected_value in expected.items():
        if values.get(key) != expected_value:
            raise AppBootstrapError(f"Managed environment {key} differs from its approved path/value.")
    if values.get("HOST") not in LOOPBACK_HOSTS:
        raise AppBootstrapError("Managed HOST is not loopback.")
    try:
        port = int(values.get("PORT", ""))
    except ValueError as error:
        raise AppBootstrapError("Managed PORT is not an integer.") from error
    if not 1024 <= port <= 65535:
        raise AppBootstrapError("Managed PORT is not an unprivileged port.")
    if not re.fullmatch(r"[0-9a-f]{64}", values.get("JWT_SECRET", "")):
        raise AppBootstrapError("Managed JWT secret is missing or weak.")


def systemd_quote(path: Path) -> str:
    value = str(path).replace("%", "%%").replace("\\", "\\\\").replace('"', '\\"')
    if "\n" in value or "\r" in value:
        raise AppBootstrapError("Newline in systemd path is not supported.")
    return '"' + value + '"'


def git_receipt(repo_root: Path) -> Dict[str, object]:
    receipt: Dict[str, object] = {
        "available": False,
        "revision": None,
        "dirty": None,
        "tracked_status_sha256": None,
        "tracked_diff_sha256": None,
    }
    try:
        revision = subprocess.run(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        ).stdout.strip()
        dirty_result = subprocess.run(
            ["git", "-C", str(repo_root), "status", "--porcelain", "--untracked-files=no"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        )
        diff_result = subprocess.run(
            ["git", "-C", str(repo_root), "diff", "--binary", "--no-ext-diff", "HEAD"],
            check=True,
            capture_output=True,
            timeout=120,
        )
        receipt = {
            "available": True,
            "revision": revision,
            "dirty": bool(dirty_result.stdout.strip()),
            "tracked_status_sha256": sha256_text(dirty_result.stdout),
            "tracked_diff_sha256": hashlib.sha256(diff_result.stdout).hexdigest(),
        }
    except (OSError, subprocess.SubprocessError):
        pass
    return receipt


def _safe_application_source(relative: Path) -> bool:
    if not relative.parts:
        return False
    if any(part in {".git", "node_modules", "dist", "release"} for part in relative.parts):
        return False
    name = relative.name.lower()
    if name == ".env" or name.startswith(".env."):
        return False
    if name.endswith((".db", ".sqlite", ".sqlite3", "-wal", "-shm")):
        return False
    return True


def application_source_digest(repo_root: Path, manifest: Mapping[str, object]) -> str:
    """Hash application source without reading ignored secrets, databases, or projects."""
    source_roots = (
        "package.json",
        "package-lock.json",
        "server",
        "shared",
        "src",
        "public",
        "scripts",
        "index.html",
        "vite.config.js",
        "vite.config.mjs",
        "postcss.config.js",
        "tailwind.config.js",
    )
    relatives: List[Path] = []
    try:
        result = subprocess.run(
            [
                "git",
                "-C",
                str(repo_root),
                "ls-files",
                "-z",
                "-c",
                "-o",
                "--exclude-standard",
                "--",
            ]
            + list(source_roots),
            check=True,
            capture_output=True,
            timeout=120,
        )
        relatives = [Path(os.fsdecode(item)) for item in result.stdout.split(b"\0") if item]
    except (OSError, subprocess.SubprocessError):
        application = manifest["application"]
        assert isinstance(application, dict)
        relatives = [Path(str(item)) for item in application.get("required_paths", [])]

    digest = hashlib.sha256()
    seen = set()
    for relative in sorted(relatives, key=lambda item: item.as_posix()):
        normalized = Path(relative.as_posix())
        if normalized.is_absolute() or ".." in normalized.parts or not _safe_application_source(normalized):
            continue
        key = normalized.as_posix()
        if key in seen:
            continue
        seen.add(key)
        path = repo_root / normalized
        if path.is_symlink():
            raise AppBootstrapError(f"Refusing symlink in application source fingerprint: {path}")
        if not path.is_file():
            continue
        digest.update(key.encode("utf-8") + b"\0")
        digest.update(oct(stat.S_IMODE(path.stat().st_mode)).encode("ascii") + b"\0")
        with path.open("rb") as handle:
            while True:
                chunk = handle.read(1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


class AppPaths:
    def __init__(self, home: Path, codex_home: Path, repo_root: Path, manifest: Mapping[str, object]):
        self.home = home
        self.codex_home = codex_home
        self.repo_root = repo_root
        self.data_root = home / ".local" / "share" / "drclaw"
        self.config_root = home / ".config" / "drclaw"
        self.state_root = home / ".local" / "state" / "drclaw"
        self.bin_root = home / ".local" / "bin"
        self.runtime_parent = self.data_root / "runtimes"
        node = manifest["node"]
        service = manifest["service"]
        application = manifest["application"]
        assert isinstance(node, dict) and isinstance(service, dict) and isinstance(application, dict)
        artifact_key = platform_artifact_key()
        artifact = node["artifacts"][artifact_key]
        assert isinstance(artifact, dict)
        top_level = str(artifact["filename"])[: -len(".tar.xz")]
        self.artifact_key = artifact_key
        self.artifact = artifact
        self.node_runtime = self.runtime_parent / top_level
        self.node_binary = self.node_runtime / "bin" / "node"
        self.npm_binary = self.node_runtime / "bin" / "npm"
        self.npm_cache = self.data_root / "cache" / "npm"
        self.npm_tmp = self.data_root / "tmp" / "npm"
        self.npm_userconfig = self.config_root / "npmrc"
        self.database_path = self.data_root / str(application["database_relative_path"])
        self.workspace_root = self.data_root / "workspaces"
        self.env_file = self.config_root / "drclaw.env"
        self.launcher = self.bin_root / str(service["launcher_name"])
        self.receipt = self.state_root / "app-bootstrap-state.json"
        self.backup_root = self.state_root / "backups"
        self.unit_file = home / ".config" / "systemd" / "user" / str(service["unit_name"])

    def managed_directories(self) -> Tuple[Path, ...]:
        return (
            self.data_root,
            self.config_root,
            self.state_root,
            self.bin_root,
            self.runtime_parent,
            self.npm_cache,
            self.npm_tmp,
            self.database_path.parent,
            self.workspace_root,
        )


def render_unit_content(paths: AppPaths, repo_root: Path, manifest: Mapping[str, object]) -> str:
    service = manifest["service"]
    assert isinstance(service, dict)
    return f"""{MANAGED_UNIT_MARKER}
[Unit]
Description=Dr. Claw Web (loopback-only user service)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory={systemd_quote(repo_root)}
ExecStart={systemd_quote(paths.launcher)}
Restart={service['restart_policy']}
RestartSec=5s
KillSignal=SIGTERM
TimeoutStopSec=15s
NoNewPrivileges=true
PrivateTmp=true
UMask={service['umask']}

[Install]
WantedBy=default.target
"""


def build_npm_environment(paths: AppPaths, home: Path) -> Dict[str, str]:
    """Return a credential-minimized environment for npm lifecycle scripts."""
    environment: Dict[str, str] = {}
    for key in ("LANG", "LC_ALL", "LC_CTYPE", "TZ", "TERM", "USER", "LOGNAME"):
        value = os.environ.get(key)
        if value and not any(control in value for control in ("\x00", "\n", "\r")):
            environment[key] = value
    path_entries = (
        paths.node_runtime / "bin",
        Path(sys.executable).resolve().parent,
        home / ".local" / "bin",
        Path("/usr/local/bin"),
        Path("/usr/bin"),
        Path("/bin"),
    )
    environment.update(
        {
            "HOME": str(home),
            "PATH": os.pathsep.join(dict.fromkeys(str(item) for item in path_entries)),
            "TMPDIR": str(paths.npm_tmp),
            "XDG_CACHE_HOME": str(paths.data_root / "cache"),
            "npm_config_cache": str(paths.npm_cache),
            "npm_config_userconfig": str(paths.npm_userconfig),
            "npm_config_globalconfig": os.devnull,
            "npm_config_audit": "false",
            "npm_config_fund": "false",
            "npm_config_update_notifier": "false",
            "npm_config_progress": "false",
            "ELECTRON_SKIP_BINARY_DOWNLOAD": "1",
            "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
            "CI": "1",
        }
    )
    return environment


def managed_npmrc_content() -> str:
    return (
        MANAGED_NPMRC_MARKER
        + "\naudit=false\nfund=false\nupdate-notifier=false\nprogress=false\n"
    )


def probe_loopback_health(host: str, port: int, attempts: int = 20, delay: float = 0.5) -> None:
    if host not in LOOPBACK_HOSTS or not 1024 <= port <= 65535:
        raise AppBootstrapError("Health probe endpoint is not an approved loopback address.")
    last_error = "no response"
    for attempt in range(attempts):
        connection: Optional[http.client.HTTPConnection] = None
        try:
            # HTTPConnection connects directly and never consults proxy environment.
            connection = http.client.HTTPConnection(host, port, timeout=2)
            connection.request("GET", "/health", headers={"User-Agent": "drclaw-web-doctor/0.1"})
            response = connection.getresponse()
            body = response.read(65537)
            if len(body) > 65536:
                raise AppBootstrapError("loopback /health response exceeded 64 KiB")
            if not 200 <= response.status < 300:
                raise AppBootstrapError(f"loopback /health returned HTTP {response.status}")
            payload = json.loads(body.decode("utf-8"))
            if not isinstance(payload, dict) or payload.get("status") != "ok":
                raise AppBootstrapError("loopback /health JSON did not contain status=ok")
            return
        except (OSError, UnicodeDecodeError, json.JSONDecodeError, http.client.HTTPException, AppBootstrapError) as error:
            last_error = str(error)
        finally:
            if connection is not None:
                connection.close()
        if attempt + 1 < attempts:
            time.sleep(delay)
    raise AppBootstrapError(last_error)


class AppInstaller:
    def __init__(
        self,
        args: argparse.Namespace,
        repo_root: Path,
        manifest: Mapping[str, object],
    ):
        self.args = args
        self.repo_root = repo_root.resolve()
        self.manifest = manifest
        self.home = validate_user_home(args.home)
        self.codex_home = resolve_codex_home(getattr(args, "codex_home", None), self.home)
        self.paths = AppPaths(self.home, self.codex_home, self.repo_root, manifest)
        self.nonlogin_home = self.home != login_home_path()
        self.systemd_ready = False
        self.service_result = "not-requested"

    def event(self, status: str, target: Path, detail: str) -> None:
        print(f"[{status}] {target}: {detail}")

    def prepare_directories(self) -> None:
        for path in self.paths.managed_directories():
            ensure_private_dir(path, self.home, self.args.dry_run)
            self.event("DRY-RUN" if self.args.dry_run else "OK", path, "private user directory")

    def preflight_managed_files(self) -> None:
        """Reject managed-file symlinks before downloads or npm lifecycle scripts run."""
        managed_files = (
            self.paths.npm_userconfig,
            self.paths.env_file,
            self.paths.launcher,
            self.paths.receipt,
        )
        if not self.nonlogin_home and self.args.service != "none":
            managed_files += (self.paths.unit_file,)
        for path in managed_files:
            reject_managed_file_symlink(path)

    def ensure_node(self) -> None:
        node = self.manifest["node"]
        assert isinstance(node, dict)
        expected_version = str(node["version"])
        runtime_symlink = first_symlink_component(self.paths.node_runtime)
        if runtime_symlink is not None:
            raise AppBootstrapError(f"Managed Node.js runtime must not traverse a symlink: {runtime_symlink}")
        if self.paths.node_binary.is_file():
            if not self.paths.receipt.is_file() or self.paths.receipt.is_symlink():
                raise AppBootstrapError(
                    "Refusing to execute an existing managed Node.js runtime without a regular prior receipt."
                )
            try:
                prior = json.loads(self.paths.receipt.read_text(encoding="utf-8"))
            except json.JSONDecodeError as error:
                raise AppBootstrapError(f"Cannot validate prior app receipt before runtime reuse: {error}") from error
            prior_node = prior.get("node")
            if prior.get("managed_by") != "drclaw-web-bootstrap" or not isinstance(prior_node, dict):
                raise AppBootstrapError(
                    "Refusing to execute an existing managed Node.js runtime without its managed digest contract."
                )
            validate_runtime_layout(
                self.paths.runtime_parent,
                self.paths.node_runtime,
                self.paths.node_binary,
                self.paths.npm_binary,
                expected_version,
                prior_node,
            )
            self.event("OK", self.paths.node_binary, "pinned Node.js runtime already installed")
            return
        if self.paths.node_runtime.exists():
            raise AppBootstrapError(
                f"Managed Node.js runtime is incomplete; inspect and remove only this path: {self.paths.node_runtime}"
            )
        if self.args.dry_run:
            self.event("DRY-RUN", self.paths.node_runtime, "would download, SHA256-check, and extract pinned Node.js")
            return

        artifact = self.paths.artifact
        filename = str(artifact["filename"])
        url = str(node["release_base_url"]).rstrip("/") + "/" + filename
        descriptor, temporary_name = tempfile.mkstemp(
            prefix=".node-download-", suffix=".tar.xz", dir=str(self.paths.runtime_parent)
        )
        os.close(descriptor)
        archive_path = Path(temporary_name)
        try:
            download_verified_node_archive(
                url,
                str(artifact["sha256"]),
                archive_path,
                Path(self.args.node_archive).resolve() if self.args.node_archive else None,
            )
            extract_verified_node_archive(
                archive_path,
                self.paths.runtime_parent,
                self.paths.node_runtime,
                filename[: -len(".tar.xz")],
            )
        finally:
            try:
                archive_path.unlink()
            except FileNotFoundError:
                pass
        validate_runtime_layout(
            self.paths.runtime_parent,
            self.paths.node_runtime,
            self.paths.node_binary,
            self.paths.npm_binary,
            expected_version,
        )
        self.event("INSTALL", self.paths.node_runtime, "installed SHA256-verified pinned Node.js runtime")

    def npm_environment(self) -> Dict[str, str]:
        # Do not inherit API tokens, passwords, SSH agents, npm auth, NODE_OPTIONS,
        # or proxy URLs from the operator shell into lifecycle scripts.
        return build_npm_environment(self.paths, self.home)

    def write_npm_config(self) -> None:
        reject_managed_file_symlink(self.paths.npm_userconfig)
        content = managed_npmrc_content()
        if self.paths.npm_userconfig.exists():
            existing = self.paths.npm_userconfig.read_text(encoding="utf-8")
            if not existing.startswith(MANAGED_NPMRC_MARKER + "\n"):
                if not self.args.replace:
                    raise AppBootstrapError(
                        f"Refusing to replace unmanaged npm user config: {self.paths.npm_userconfig}"
                    )
                if not self.args.dry_run:
                    self.backup_unmanaged(self.paths.npm_userconfig)
        if self.args.dry_run:
            self.event("DRY-RUN", self.paths.npm_userconfig, "would write credential-free isolated npm config")
            return
        atomic_write(self.paths.npm_userconfig, content, 0o600)
        self.event("INSTALL", self.paths.npm_userconfig, "wrote credential-free isolated npm config")

    def run_npm(self) -> None:
        npm = self.manifest["npm"]
        assert isinstance(npm, dict)
        commands = (
            ("npm ci from package-lock.json", npm["install"]),
            ("production frontend build", npm["build"]),
            ("native module preparation", npm["prepare_native"]),
            ("development dependency prune", npm["prune"]),
        )
        for detail, command in commands:
            assert isinstance(command, list)
            if self.args.dry_run:
                self.event("DRY-RUN", self.repo_root, "would run " + detail)
                continue
            try:
                subprocess.run(
                    [str(self.paths.npm_binary)] + [str(item) for item in command],
                    cwd=str(self.repo_root),
                    env=self.npm_environment(),
                    check=True,
                )
            except (OSError, subprocess.SubprocessError) as error:
                raise AppBootstrapError(f"Failed during {detail}: {error}") from error
            self.event("INSTALL", self.repo_root, detail)

        if not self.args.dry_run:
            verify_command = npm["verify"]
            assert isinstance(verify_command, list)
            try:
                result = subprocess.run(
                    [str(self.paths.npm_binary)] + [str(item) for item in verify_command],
                    cwd=str(self.repo_root),
                    env=self.npm_environment(),
                    check=True,
                    capture_output=True,
                    text=True,
                )
                json.loads(result.stdout)
            except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
                raise AppBootstrapError(f"Installed npm dependency verification failed: {error}") from error
            if not (self.repo_root / "dist" / "index.html").is_file():
                raise AppBootstrapError("Production frontend build did not create dist/index.html.")
            self.event("OK", self.repo_root / "node_modules", "locked production dependencies verified")

    def backup_unmanaged(self, path: Path) -> None:
        reject_managed_file_symlink(path)
        if not path.is_file():
            raise AppBootstrapError(f"Can only back up a regular managed-file conflict: {path}")
        timestamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup_dir = self.paths.backup_root / timestamp
        ensure_private_dir(backup_dir, self.home, False)
        destination = backup_dir / path.name
        if destination.exists() or destination.is_symlink():
            raise AppBootstrapError(f"Backup destination already exists: {destination}")
        shutil.copyfile(path, destination, follow_symlinks=True)
        os.chmod(destination, 0o600)
        self.event("BACKUP", destination, "saved file before explicit replacement")

    def write_environment(self) -> None:
        reject_managed_file_symlink(self.paths.env_file)
        existing: Dict[str, str] = {}
        if self.paths.env_file.exists():
            try:
                existing = parse_managed_env(self.paths.env_file)
            except AppBootstrapError:
                if not self.args.replace:
                    raise AppBootstrapError(
                        f"Application environment is not managed; pass --replace after review: {self.paths.env_file}"
                    )
                if not self.args.dry_run:
                    self.backup_unmanaged(self.paths.env_file)

        jwt_secret = existing.get("JWT_SECRET", "")
        if not re.fullmatch(r"[0-9a-f]{64}", jwt_secret):
            jwt_secret = secrets.token_hex(32)
        values = {
            "HOME": str(self.home),
            "CODEX_HOME": str(self.codex_home),
            "HOST": self.args.host,
            "PORT": str(self.args.port),
            "DATABASE_PATH": str(self.paths.database_path),
            "JWT_SECRET": jwt_secret,
            "NODE_ENV": "production",
            "DR_CLAW_STRICT_PORT": "1",
            "WORKSPACES_ROOT": str(self.paths.workspace_root),
            "DRCLAW_REPO_ROOT": str(self.repo_root),
            "DRCLAW_NODE_BINARY": str(self.paths.node_binary),
            "DRCLAW_NODE_BIN": str(self.paths.node_runtime / "bin"),
        }
        content = MANAGED_ENV_MARKER + "\n" + "\n".join(
            shell_assignment(key, value) for key, value in values.items()
        ) + "\n"
        if self.args.dry_run:
            self.event("DRY-RUN", self.paths.env_file, "would write private loopback environment (secret hidden)")
            return
        atomic_write(self.paths.env_file, content, 0o600)
        self.event("INSTALL", self.paths.env_file, "wrote private loopback environment (secret hidden)")

    def write_launcher(self) -> None:
        reject_managed_file_symlink(self.paths.launcher)
        launch_command = (
            str(Path(sys.executable).resolve()),
            str(self.repo_root / "bootstrap" / "codex" / "install_app.py"),
            "--repo-root",
            str(self.repo_root),
            "launch",
            "--home",
            str(self.home),
            "--codex-home",
            str(self.codex_home),
        )
        content = f"""#!/bin/sh
{MANAGED_LAUNCHER_MARKER}
set -eu
exec {' '.join(shlex.quote(item) for item in launch_command)}
"""
        if self.paths.launcher.exists():
            existing = self.paths.launcher.read_text(encoding="utf-8")
            if not existing.startswith("#!/bin/sh\n" + MANAGED_LAUNCHER_MARKER + "\n"):
                if not self.args.replace:
                    raise AppBootstrapError(
                        f"Refusing to replace unmanaged application launcher: {self.paths.launcher}"
                    )
                if not self.args.dry_run:
                    self.backup_unmanaged(self.paths.launcher)
        if self.args.dry_run:
            self.event("DRY-RUN", self.paths.launcher, "would write foreground application launcher")
            return
        atomic_write(self.paths.launcher, content, 0o700)
        self.event("INSTALL", self.paths.launcher, "wrote foreground application launcher")

    def detect_user_systemd(self) -> bool:
        systemctl = shutil.which("systemctl")
        if not systemctl:
            return False
        try:
            result = subprocess.run(
                [systemctl, "--user", "show-environment"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=20,
            )
            return result.returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False

    def user_service_is_active(self, systemctl: str) -> bool:
        try:
            result = subprocess.run(
                [systemctl, "--user", "is-active", str(self.manifest["service"]["unit_name"])],  # type: ignore[index]
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=20,
            )
            return result.returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False

    def unit_content(self) -> str:
        return render_unit_content(self.paths, self.repo_root, self.manifest)

    def configure_service(self) -> None:
        if self.nonlogin_home:
            if self.args.start:
                raise AppBootstrapError("--start is forbidden with an isolated/non-login --home.")
            self.service_result = "launcher-only-nonlogin-home"
            self.event(
                "ISOLATED",
                self.paths.launcher,
                "non-login --home forces service=none; user-systemd was not probed or changed",
            )
            return

        mode = self.args.service
        if mode == "none":
            self.service_result = "launcher-only"
            self.event("SKIP", self.paths.unit_file, "service manager disabled; launcher remains available")
            if self.args.start:
                raise AppBootstrapError("--start requires --service auto or --service user-systemd.")
            return

        self.systemd_ready = self.detect_user_systemd()
        if not self.systemd_ready:
            if mode == "user-systemd":
                raise AppBootstrapError("A user systemd manager was required but is not available.")
            self.service_result = "launcher-only-systemd-unavailable"
            self.event(
                "FALLBACK",
                self.paths.launcher,
                "user systemd is unavailable; no process was started; run launcher in an approved supervisor",
            )
            if self.args.start:
                raise AppBootstrapError("Cannot --start because the user systemd manager is unavailable.")
            return

        if self.args.dry_run:
            self.service_result = "would-install-user-systemd"
            self.event("DRY-RUN", self.paths.unit_file, "would install and enable user-systemd unit")
            return

        ensure_private_dir(self.paths.unit_file.parent, self.home, False)
        reject_managed_file_symlink(self.paths.unit_file)
        if self.paths.unit_file.exists():
            existing = self.paths.unit_file.read_text(encoding="utf-8")
            if not existing.startswith(MANAGED_UNIT_MARKER + "\n") and not self.args.replace:
                raise AppBootstrapError(
                    f"Refusing to replace unmanaged user-systemd unit: {self.paths.unit_file}"
                )
            if not existing.startswith(MANAGED_UNIT_MARKER + "\n"):
                self.backup_unmanaged(self.paths.unit_file)
        atomic_write(self.paths.unit_file, self.unit_content(), 0o600)
        systemctl = shutil.which("systemctl")
        assert systemctl is not None
        try:
            was_active = self.user_service_is_active(systemctl)
            subprocess.run([systemctl, "--user", "daemon-reload"], check=True)
            unit_name = str(self.manifest["service"]["unit_name"])  # type: ignore[index]
            subprocess.run([systemctl, "--user", "enable", unit_name], check=True)
            if self.args.start:
                # restart also starts an inactive unit and, unlike enable --now,
                # guarantees an already-running older checkout is replaced.
                subprocess.run([systemctl, "--user", "restart", unit_name], check=True)
        except (OSError, subprocess.SubprocessError) as error:
            raise AppBootstrapError(f"Cannot configure user-systemd service: {error}") from error
        if self.args.start:
            self.service_result = "enabled-and-started"
        elif was_active:
            self.service_result = "enabled-running-not-restarted"
        else:
            self.service_result = "enabled-not-started"
        self.event(
            "INSTALL",
            self.paths.unit_file,
            "enabled user-systemd unit"
            + (
                " and restarted/started it"
                if self.args.start
                else "; an existing process still needs restart"
                if was_active
                else "; did not start it"
            ),
        )

    def write_receipt(self) -> None:
        reject_managed_file_symlink(self.paths.receipt)
        node = self.manifest["node"]
        assert isinstance(node, dict)
        if self.paths.receipt.exists():
            managed = False
            try:
                existing_state = json.loads(self.paths.receipt.read_text(encoding="utf-8"))
                managed = existing_state.get("managed_by") == "drclaw-web-bootstrap"
            except (OSError, json.JSONDecodeError):
                managed = False
            if not managed:
                if not self.args.replace:
                    raise AppBootstrapError(
                        f"Refusing to replace unmanaged application receipt: {self.paths.receipt}"
                    )
                if not self.args.dry_run:
                    self.backup_unmanaged(self.paths.receipt)
        runtime_layout: Dict[str, str] = {}
        if not self.args.dry_run:
            runtime_layout = validate_runtime_layout(
                self.paths.runtime_parent,
                self.paths.node_runtime,
                self.paths.node_binary,
                self.paths.npm_binary,
                str(node["version"]),
            )
        state = {
            "schema_version": 1,
            "managed_by": "drclaw-web-bootstrap",
            "bundle_version": self.manifest["bundle_version"],
            "installed_at": utc_now(),
            "repo_root": str(self.repo_root),
            "git": git_receipt(self.repo_root),
            "application_source_sha256": application_source_digest(self.repo_root, self.manifest),
            "package_lock_sha256": sha256_file(self.repo_root / "package-lock.json"),
            "dist_sha256": None
            if self.args.dry_run or not (self.repo_root / "dist").is_dir()
            else directory_digest(self.repo_root / "dist"),
            "node": {
                "version": node["version"],
                "artifact_key": self.paths.artifact_key,
                "artifact_sha256": self.paths.artifact["sha256"],
                "binary": str(self.paths.node_binary),
                **runtime_layout,
            },
            "environment_file": str(self.paths.env_file),
            "environment_sha256": None
            if self.args.dry_run
            else sha256_file(self.paths.env_file),
            "codex_home": str(self.codex_home),
            "npm_userconfig": str(self.paths.npm_userconfig),
            "npm_userconfig_sha256": None
            if self.args.dry_run
            else sha256_file(self.paths.npm_userconfig),
            "database_path": str(self.paths.database_path),
            "workspace_root": str(self.paths.workspace_root),
            "launcher": str(self.paths.launcher),
            "launcher_sha256": None if self.args.dry_run else sha256_file(self.paths.launcher),
            "service": self.service_result,
            "unit_file": str(self.paths.unit_file) if self.systemd_ready else None,
            "unit_sha256": None
            if self.args.dry_run or not self.paths.unit_file.is_file()
            else sha256_file(self.paths.unit_file),
            "started_by_installer": bool(self.args.start and self.systemd_ready),
        }
        if self.args.dry_run:
            self.event("DRY-RUN", self.paths.receipt, "would write secret-free installation receipt")
            return
        atomic_write(self.paths.receipt, json.dumps(state, indent=2, sort_keys=True) + "\n", 0o600)
        self.event("INSTALL", self.paths.receipt, "wrote secret-free installation receipt")

    def run(self) -> None:
        validate_repo(self.repo_root, self.manifest)
        if self.nonlogin_home and not self.args.dry_run and not is_within(self.repo_root, self.home):
            raise AppBootstrapError(
                "An isolated/non-login --home may only install from a disposable checkout inside that home."
            )
        if self.args.host not in LOOPBACK_HOSTS:
            raise AppBootstrapError(
                "This reproducible bootstrap only permits loopback HOST; configure reviewed TLS/reverse proxy separately."
            )
        if not 1024 <= self.args.port <= 65535:
            raise AppBootstrapError("Application port must be an unprivileged integer from 1024 to 65535.")
        self.preflight_managed_files()
        self.prepare_directories()
        self.ensure_node()
        self.write_npm_config()
        self.run_npm()
        self.write_environment()
        self.write_launcher()
        self.configure_service()
        self.write_receipt()
        self.print_scope_summary()

    def print_scope_summary(self) -> None:
        automatic = self.manifest.get("automatic_scope", [])
        interactive = self.manifest.get("interactive_or_external_scope", [])
        print("\nAutomatic application scope:")
        for item in automatic if isinstance(automatic, list) else []:
            print(f"  - {item}")
        print("Action still requiring a person, account, or host administrator:")
        for item in interactive if isinstance(interactive, list) else []:
            print(f"  - {item}")
        if self.service_result == "enabled-not-started":
            print("Next service action: systemctl --user start drclaw.service")
        elif self.service_result == "enabled-running-not-restarted":
            print("Next service action: systemctl --user restart drclaw.service")
        elif self.service_result.startswith("launcher-only"):
            print(f"Next service action: run {self.paths.launcher} under an approved persistent supervisor.")


class AppLauncher:
    """Strict non-shell environment loader for the generated foreground launcher."""

    PASSTHROUGH_KEYS = (
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "TZ",
        "TERM",
        "USER",
        "LOGNAME",
        "SHELL",
        "SSH_AUTH_SOCK",
        "OPENAI_API_KEY",
        "OPENROUTER_API_KEY",
        "ANTHROPIC_API_KEY",
        "GOOGLE_API_KEY",
        "CLAUDE_CLI_PATH",
        "CURSOR_CLI_PATH",
        "GEMINI_CLI_PATH",
        "CODEX_CLI_PATH",
        "CONTEXT_WINDOW",
        "VITE_CONTEXT_WINDOW",
        "TOOL_APPROVAL_TIMEOUT_MS",
    )

    def __init__(self, args: argparse.Namespace, repo_root: Path, manifest: Mapping[str, object]):
        self.repo_root = repo_root.resolve()
        self.manifest = manifest
        self.home = validate_user_home(args.home)
        self.codex_home = resolve_codex_home(getattr(args, "codex_home", None), self.home)
        self.paths = AppPaths(self.home, self.codex_home, self.repo_root, manifest)

    def validate(self) -> Tuple[Dict[str, str], Dict[str, object]]:
        reject_managed_file_symlink(self.paths.receipt)
        if not self.paths.receipt.is_file():
            raise AppBootstrapError(f"Application receipt is missing: {self.paths.receipt}")
        try:
            state = json.loads(self.paths.receipt.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise AppBootstrapError(f"Application receipt is invalid: {error}") from error
        if state.get("managed_by") != "drclaw-web-bootstrap":
            raise AppBootstrapError("Application receipt is not managed by this bootstrap.")
        if state.get("schema_version") != 1 or state.get("bundle_version") != self.manifest.get("bundle_version"):
            raise AppBootstrapError("Application receipt schema/bundle does not match this bootstrap.")
        if Path(str(state.get("repo_root", ""))).resolve() != self.repo_root:
            raise AppBootstrapError("Application receipt repo_root differs from launcher checkout.")
        if state.get("codex_home") != str(self.codex_home):
            raise AppBootstrapError("Application receipt CODEX_HOME differs from launcher target.")
        values = parse_managed_env(self.paths.env_file)
        validate_managed_env_values(values, self.paths, self.repo_root)
        if stat.S_IMODE(self.paths.env_file.stat().st_mode) & 0o077:
            raise AppBootstrapError("Managed environment is readable by group/other.")
        if sha256_file(self.paths.env_file) != state.get("environment_sha256"):
            raise AppBootstrapError("Managed environment digest differs from application receipt.")
        node = self.manifest["node"]
        assert isinstance(node, dict)
        recorded_runtime = state.get("node")
        if not isinstance(recorded_runtime, dict):
            raise AppBootstrapError("Application receipt has no managed Node.js runtime contract.")
        validate_runtime_layout(
            self.paths.runtime_parent,
            self.paths.node_runtime,
            self.paths.node_binary,
            self.paths.npm_binary,
            str(node["version"]),
            recorded_runtime,
        )
        return values, state

    def run(self) -> None:
        values, _ = self.validate()
        environment: Dict[str, str] = {}
        for key in self.PASSTHROUGH_KEYS:
            value = os.environ.get(key)
            if value and not any(control in value for control in ("\x00", "\n", "\r")):
                environment[key] = value
        environment.update(values)
        environment["PATH"] = os.pathsep.join(
            (
                str(self.paths.node_runtime / "bin"),
                str(self.home / ".local" / "bin"),
                "/usr/local/bin",
                "/usr/bin",
                "/bin",
            )
        )
        os.chdir(self.repo_root)
        os.execve(
            str(self.paths.node_binary),
            [str(self.paths.node_binary), str(self.repo_root / "server" / "index.js")],
            environment,
        )


class AppDoctor:
    def __init__(self, args: argparse.Namespace, repo_root: Path, manifest: Mapping[str, object]):
        self.args = args
        self.repo_root = repo_root.resolve()
        self.manifest = manifest
        self.home = validate_user_home(args.home)
        self.codex_home = resolve_codex_home(getattr(args, "codex_home", None), self.home)
        self.paths = AppPaths(self.home, self.codex_home, self.repo_root, manifest)
        self.checks: List[Dict[str, str]] = []

    def add(self, level: str, name: str, detail: str) -> None:
        self.checks.append({"level": level, "name": name, "detail": detail})

    def check_repository(self) -> None:
        try:
            validate_repo(self.repo_root, self.manifest)
            self.add("PASS", "repository", "package metadata and required Web paths are present")
        except AppBootstrapError as error:
            self.add("FAIL", "repository", str(error))

    def load_state(self) -> Optional[Dict[str, object]]:
        if self.paths.receipt.is_symlink():
            self.add("FAIL", "receipt", f"managed receipt must not be a symlink: {self.paths.receipt}")
            return None
        if not self.paths.receipt.is_file():
            self.add("FAIL", "receipt", f"missing {self.paths.receipt}")
            return None
        try:
            state = json.loads(self.paths.receipt.read_text(encoding="utf-8"))
            if state.get("schema_version") != 1:
                raise ValueError("invalid schema_version")
            if state.get("managed_by") != "drclaw-web-bootstrap":
                raise ValueError("invalid managed_by marker")
            if state.get("bundle_version") != self.manifest.get("bundle_version"):
                raise ValueError("bundle_version differs from app manifest")
            if Path(str(state.get("repo_root", ""))).resolve() != self.repo_root:
                raise ValueError("repo_root differs from this checkout")
            if "JWT_SECRET" in json.dumps(state):
                raise ValueError("receipt unexpectedly contains secret material")
            self.add("PASS", "receipt", "secret-free application receipt is valid")
            return state
        except (OSError, json.JSONDecodeError, ValueError) as error:
            self.add("FAIL", "receipt", str(error))
            return None

    def check_runtime(self, state: Optional[Mapping[str, object]]) -> None:
        node = self.manifest["node"]
        npm = self.manifest["npm"]
        assert isinstance(node, dict) and isinstance(npm, dict)
        runtime_layout: Optional[Dict[str, str]] = None
        runtime_valid = False
        try:
            recorded_node = state.get("node") if state else None
            if not isinstance(recorded_node, dict):
                raise AppBootstrapError("receipt has no Node.js runtime contract")
            runtime_layout = validate_runtime_layout(
                self.paths.runtime_parent,
                self.paths.node_runtime,
                self.paths.node_binary,
                self.paths.npm_binary,
                str(node["version"]),
                recorded_node,
            )
            runtime_valid = True
            self.add("PASS", "node", f"managed runtime {runtime_layout['observed_version']} and npm target match receipt")
        except AppBootstrapError as error:
            self.add("FAIL", "node", str(error))

        if not runtime_valid:
            self.add("FAIL", "npm", "managed runtime contract failed; npm was not executed")
        else:
            try:
                version = subprocess.run(
                    [str(self.paths.npm_binary), "--version"],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=20,
                    env=build_npm_environment(self.paths, self.home),
                ).stdout.strip()
                self.add("PASS", "npm", f"managed npm {version}")
            except (OSError, subprocess.SubprocessError) as error:
                self.add("FAIL", "npm", str(error))

        current_lock = sha256_file(self.repo_root / "package-lock.json") if (self.repo_root / "package-lock.json").is_file() else None
        if state and current_lock == state.get("package_lock_sha256"):
            self.add("PASS", "package-lock", "installed receipt matches current package-lock.json")
        else:
            self.add("FAIL", "package-lock", "package-lock.json drifted from installed receipt")
        if (self.repo_root / "dist" / "index.html").is_file():
            try:
                current_dist = directory_digest(self.repo_root / "dist")
                if state and current_dist == state.get("dist_sha256"):
                    self.add("PASS", "frontend-build", "dist tree matches installed receipt")
                else:
                    self.add("FAIL", "frontend-build", "dist tree drifted from installed receipt")
            except AppBootstrapError as error:
                self.add("FAIL", "frontend-build", str(error))
        else:
            self.add("FAIL", "frontend-build", "dist/index.html is missing")

        try:
            current_source = application_source_digest(self.repo_root, self.manifest)
            if state and current_source == state.get("application_source_sha256"):
                self.add("PASS", "application-source", "application source fingerprint matches installed receipt")
            else:
                self.add("FAIL", "application-source", "application source changed since the installed build")
        except AppBootstrapError as error:
            self.add("FAIL", "application-source", str(error))

        current_git = git_receipt(self.repo_root)
        installed_git = state.get("git") if state else None
        if not current_git.get("available"):
            self.add("WARN", "git-source", "Git provenance is unavailable; source fingerprint remains enforced")
        elif current_git == installed_git:
            if current_git.get("dirty"):
                self.add("WARN", "git-source", "checkout matches receipt but was installed from a dirty Git tree")
            else:
                self.add("PASS", "git-source", f"checkout revision {current_git.get('revision')} is clean and unchanged")
        else:
            self.add("FAIL", "git-source", "Git revision/status/diff differs from the installed receipt")

        if runtime_valid and (self.repo_root / "node_modules").is_dir():
            try:
                verify = npm["verify"]
                assert isinstance(verify, list)
                result = subprocess.run(
                    [str(self.paths.npm_binary)] + [str(item) for item in verify],
                    cwd=str(self.repo_root),
                    env=build_npm_environment(self.paths, self.home),
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                json.loads(result.stdout)
                self.add("PASS", "dependencies", "production npm dependency graph is valid")
            except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
                self.add("FAIL", "dependencies", str(error))
        else:
            self.add("FAIL", "dependencies", "node_modules is missing or managed runtime contract failed")

    def check_configuration(self, state: Optional[Mapping[str, object]]) -> None:
        values: Dict[str, str] = {}
        if self.paths.env_file.is_symlink():
            self.add("FAIL", "environment", f"managed environment must not be a symlink: {self.paths.env_file}")
        else:
            try:
                values = parse_managed_env(self.paths.env_file)
                validate_managed_env_values(values, self.paths, self.repo_root)
                if stat.S_IMODE(self.paths.env_file.stat().st_mode) & 0o077:
                    raise AppBootstrapError("environment file is readable by group/other")
                if not state or sha256_file(self.paths.env_file) != state.get("environment_sha256"):
                    raise AppBootstrapError("environment digest differs from installed receipt")
                if state.get("codex_home") != str(self.codex_home):
                    raise AppBootstrapError("receipt CODEX_HOME differs from target")
                self.add("PASS", "environment", "private loopback environment is valid; secret not displayed")
            except (OSError, AppBootstrapError) as error:
                self.add("FAIL", "environment", str(error))

        if self.paths.npm_userconfig.is_symlink():
            self.add("FAIL", "npm-config", f"managed npm config must not be a symlink: {self.paths.npm_userconfig}")
        elif self.paths.npm_userconfig.is_file():
            try:
                content = self.paths.npm_userconfig.read_text(encoding="utf-8")
                if content != managed_npmrc_content():
                    raise AppBootstrapError("managed npm config is not canonical")
                if stat.S_IMODE(self.paths.npm_userconfig.stat().st_mode) & 0o077:
                    raise AppBootstrapError("managed npm config is readable by group/other")
                if not state or sha256_file(self.paths.npm_userconfig) != state.get("npm_userconfig_sha256"):
                    raise AppBootstrapError("managed npm config digest differs from receipt")
                self.add("PASS", "npm-config", "credential-free private npm config matches receipt")
            except (OSError, AppBootstrapError) as error:
                self.add("FAIL", "npm-config", str(error))
        else:
            self.add("FAIL", "npm-config", f"missing managed npm config: {self.paths.npm_userconfig}")

        path_failures = []
        for path in self.paths.managed_directories():
            if path.is_symlink() or not path.is_dir():
                path_failures.append(f"missing/symlink {path}")
                continue
            info = path.stat()
            if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
                path_failures.append(f"wrong owner {path}")
            if stat.S_IMODE(info.st_mode) & 0o077:
                path_failures.append(f"group/other permissions {path}")
        if path_failures:
            self.add("FAIL", "managed-paths", "; ".join(path_failures))
        else:
            self.add("PASS", "managed-paths", "application data/config/state/runtime directories are private")

        if self.paths.launcher.is_symlink():
            self.add("FAIL", "launcher", f"managed launcher must not be a symlink: {self.paths.launcher}")
        elif self.paths.launcher.is_file() and os.access(self.paths.launcher, os.X_OK):
            if state and sha256_file(self.paths.launcher) == state.get("launcher_sha256"):
                self.add("PASS", "launcher", f"managed foreground launcher {self.paths.launcher}")
            else:
                self.add("FAIL", "launcher", "launcher digest differs from installed receipt")
        else:
            self.add("FAIL", "launcher", f"launcher missing or not executable: {self.paths.launcher}")

        self.check_service(state, values)

    def check_service(self, state: Optional[Mapping[str, object]], values: Mapping[str, str]) -> None:
        service_state = str(state.get("service", "")) if state else ""
        known_states = {
            "launcher-only",
            "launcher-only-nonlogin-home",
            "launcher-only-systemd-unavailable",
            "enabled-not-started",
            "enabled-running-not-restarted",
            "enabled-and-started",
        }
        if service_state and service_state not in known_states:
            self.add("FAIL", "service", f"unknown service state in receipt: {service_state}")
            return
        if service_state.startswith("enabled"):
            if self.paths.unit_file.is_symlink():
                self.add("FAIL", "service", f"managed unit must not be a symlink: {self.paths.unit_file}")
                return
            if not self.paths.unit_file.is_file():
                self.add("FAIL", "service", "receipt requires a managed user-systemd unit, but it is missing")
                return
            try:
                unit_content = self.paths.unit_file.read_text(encoding="utf-8")
                if unit_content != render_unit_content(self.paths, self.repo_root, self.manifest):
                    raise AppBootstrapError("user-systemd unit is not the canonical managed content")
                if not state or sha256_file(self.paths.unit_file) != state.get("unit_sha256"):
                    raise AppBootstrapError("user-systemd unit digest differs from receipt")
                if stat.S_IMODE(self.paths.unit_file.stat().st_mode) & 0o077:
                    raise AppBootstrapError("user-systemd unit is readable by group/other")
            except (OSError, AppBootstrapError) as error:
                self.add("FAIL", "service-unit", str(error))
                return
            systemctl = shutil.which("systemctl")
            if not systemctl:
                self.add("FAIL", "service", "enabled-service receipt exists but systemctl is unavailable")
                return
            try:
                enabled = subprocess.run(
                    [systemctl, "--user", "is-enabled", str(self.manifest["service"]["unit_name"])],  # type: ignore[index]
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=20,
                )
            except (OSError, subprocess.SubprocessError) as error:
                self.add("FAIL", "service", f"cannot query user-systemd enablement: {error}")
                return
            if enabled.returncode != 0 or enabled.stdout.strip() != "enabled":
                self.add("FAIL", "service", "managed user-systemd unit is not enabled")
                return
            self.add("PASS", "service-unit", f"canonical user-systemd unit is enabled ({service_state})")
            if service_state == "enabled-not-started":
                self.add("WARN", "service", "unit is enabled for a future login/boot but was not started by installer")
                return
            if service_state == "enabled-running-not-restarted":
                self.add("WARN", "service", "older process may still be running; restart is required to activate this checkout")
                return
            if service_state == "enabled-and-started":
                try:
                    active = subprocess.run(
                        [systemctl, "--user", "is-active", str(self.manifest["service"]["unit_name"])],  # type: ignore[index]
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=20,
                    )
                except (OSError, subprocess.SubprocessError) as error:
                    self.add("FAIL", "service", f"cannot query user-systemd service: {error}")
                    return
                if active.returncode != 0 or active.stdout.strip() != "active":
                    self.add("FAIL", "service", "installer-started user service is not active")
                    return
                host = values.get("HOST", "")
                port = values.get("PORT", "")
                try:
                    port_number = int(port)
                    probe_loopback_health(host, port_number)
                except (ValueError, AppBootstrapError) as error:
                    self.add("FAIL", "service-health", f"loopback /health failed: {error}")
                    return
                self.add("PASS", "service-health", "user service is active and loopback /health succeeds")
        elif service_state:
            self.add("WARN", "service", f"{service_state}; use the launcher with an approved supervisor")

    def run(self) -> int:
        self.check_repository()
        state = self.load_state()
        self.check_runtime(state)
        self.check_configuration(state)
        failed = any(item["level"] == "FAIL" for item in self.checks)
        if self.args.json:
            print(json.dumps({"ok": not failed, "checks": self.checks}, indent=2, sort_keys=True))
        else:
            for check in self.checks:
                print(f"[{check['level']}] {check['name']}: {check['detail']}")
        return 1 if failed else 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Dr. Claw checkout; defaults to the repository containing this script")
    parser.add_argument("--manifest", help="Application manifest path (primarily for release testing)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    install = subparsers.add_parser("install", help="Install/update the optional Dr. Claw Web application")
    install.add_argument("--home", help="Target user home (primarily for isolated acceptance tests)")
    install.add_argument(
        "--codex-home",
        help="Codex state root inside target home (default: <home>/.codex)",
    )
    install.add_argument("--host", default="127.0.0.1", help="Loopback bind host (public bind is refused)")
    install.add_argument("--port", type=int, default=3001, help="Unprivileged loopback port")
    install.add_argument(
        "--service",
        choices=("auto", "user-systemd", "none"),
        default="auto",
        help="Install an enabled user service when available; auto falls back to the launcher",
    )
    install.add_argument("--start", action="store_true", help="Explicitly start the user-systemd service after install")
    install.add_argument("--node-archive", help="Offline Node.js archive; the pinned SHA256 is still required")
    install.add_argument("--replace", action="store_true", help="Back up and replace conflicting managed files")
    install.add_argument("--dry-run", action="store_true", help="Preview without downloads, writes, npm, or service changes")
    install.add_argument("--no-doctor", action="store_true", help="Skip read-only application doctor after install")

    doctor = subparsers.add_parser("doctor", help="Read-only Dr. Claw Web runtime and configuration checks")
    doctor.add_argument("--home", help="Target user home (primarily for isolated acceptance tests)")
    doctor.add_argument(
        "--codex-home",
        help="Codex state root inside target home (default: <home>/.codex)",
    )
    doctor.add_argument("--json", action="store_true", help="Emit machine-readable checks")

    launch = subparsers.add_parser(
        "launch",
        help=argparse.SUPPRESS,
        description="Internal strict launcher; use the generated drclaw-web command.",
    )
    launch.add_argument("--home", help="Target user home")
    launch.add_argument(
        "--codex-home",
        help="Codex state root inside target home (default: <home>/.codex)",
    )
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    repo_root = Path(args.repo_root).expanduser().resolve() if args.repo_root else DEFAULT_REPO_ROOT.resolve()
    manifest_path = Path(args.manifest).expanduser().resolve() if args.manifest else DEFAULT_MANIFEST_PATH
    try:
        manifest = load_manifest(manifest_path)
        if args.command == "install":
            installer = AppInstaller(args, repo_root, manifest)
            installer.run()
            if args.dry_run or args.no_doctor:
                return 0
            doctor_args = argparse.Namespace(home=args.home, codex_home=args.codex_home, json=False)
            return AppDoctor(doctor_args, repo_root, manifest).run()
        if args.command == "doctor":
            return AppDoctor(args, repo_root, manifest).run()
        if args.command == "launch":
            AppLauncher(args, repo_root, manifest).run()
            return 0
    except (AppBootstrapError, OSError, subprocess.SubprocessError) as error:
        print(f"[FAIL] {error}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
