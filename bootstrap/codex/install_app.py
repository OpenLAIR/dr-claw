#!/usr/bin/env python3
"""Reproducibly install and verify the optional Dr. Claw Web application.

This installer deliberately owns only user-level application runtime and state. It
does not copy credentials, inspect research projects, or create users in the Web UI.
It starts an inactive service only when ``--start`` is explicitly supplied; an
already-active managed service is restarted after a successful upgrade.
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
from pathlib import Path, PurePosixPath
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


sys.dont_write_bytecode = True
_MODULE_DIR = Path(__file__).resolve().parent
if str(_MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(_MODULE_DIR))
from codex_contracts import (  # noqa: E402 - supports direct script execution
    KNOWN_CODEX_CONTRACT_PROBES,
    NetworkContractError,
    PathTrustError,
    read_only_git_command,
    read_only_git_environment,
    run_codex_contracts,
    sanitized_network_environment,
    sanitized_network_opener,
    secret_free_probe_env,
    select_safe_temp_root,
    validate_target_home_trust,
)


SCRIPT_PATH = Path(__file__).resolve()
BOOTSTRAP_ROOT = _MODULE_DIR
DEFAULT_REPO_ROOT = BOOTSTRAP_ROOT.parent.parent
DEFAULT_MANIFEST_PATH = BOOTSTRAP_ROOT / "app-manifest.json"
MANAGED_ENV_MARKER = "# Managed by Dr. Claw Web bootstrap; contains a secret."
MANAGED_LAUNCHER_MARKER = "# Managed by Dr. Claw Web bootstrap."
MANAGED_UNIT_MARKER = "# Managed by Dr. Claw Web bootstrap."
MANAGED_NPMRC_MARKER = "; Managed by Dr. Claw Web bootstrap; contains no registry credentials."
MAX_NODE_ARCHIVE_BYTES = 200 * 1024 * 1024
LOOPBACK_HOSTS = {"127.0.0.1", "localhost", "::1"}
RUNTIME_RECEIPT_MANAGED_BY = "drclaw-node-runtime-bootstrap"
RUNTIME_RECEIPT_BASE_KEYS = frozenset(
    {
        "schema_version",
        "managed_by",
        "node_version",
        "artifact_key",
        "artifact_filename",
        "artifact_sha256",
        "runtime_root",
    }
)
RUNTIME_LAYOUT_RECEIPT_KEYS = frozenset(
    {"version", "node_binary_sha256", "npm_target_relative", "npm_target_sha256"}
)
LEGACY_APP_RECEIPT_V01_KEYS = frozenset(
    {
        "schema_version",
        "managed_by",
        "bundle_version",
        "installed_at",
        "repo_root",
        "git",
        "application_source_sha256",
        "package_lock_sha256",
        "dist_sha256",
        "node",
        "environment_file",
        "environment_sha256",
        "codex_home",
        "npm_userconfig",
        "npm_userconfig_sha256",
        "database_path",
        "workspace_root",
        "launcher",
        "launcher_sha256",
        "service",
        "unit_file",
        "unit_sha256",
        "started_by_installer",
    }
)
LEGACY_APP_NODE_V01_KEYS = frozenset(
    {
        "version",
        "artifact_key",
        "artifact_sha256",
        "binary",
        "node_binary_sha256",
        "npm_target_relative",
        "npm_target_sha256",
        "observed_version",
    }
)
GIT_RECEIPT_KEYS = frozenset(
    {
        "available",
        "revision",
        "dirty",
        "tracked_status_sha256",
        "tracked_diff_sha256",
    }
)
TRUSTED_SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
LINUX_ST_NOEXEC = getattr(os, "ST_NOEXEC", 0x8)
REQUIRED_TIMEOUT_KEYS = (
    "npm_install",
    "npm_build",
    "npm_prepare_native",
    "npm_prune",
    "npm_verify",
    "systemctl",
)
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


def app_network_environment(source: Mapping[str, str]) -> Dict[str, str]:
    """Translate the shared safe proxy/CA contract to an app error."""

    try:
        return sanitized_network_environment(source)
    except NetworkContractError as error:
        raise AppBootstrapError(str(error)) from error


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
    bundled_codex = manifest.get("bundled_codex")
    npm = manifest.get("npm")
    application = manifest.get("application")
    runtime_receipt = manifest.get("runtime_receipt")
    timeouts = manifest.get("timeouts_seconds")
    if (
        not isinstance(node, dict)
        or not isinstance(bundled_codex, dict)
        or not isinstance(npm, dict)
        or not isinstance(application, dict)
        or not isinstance(runtime_receipt, dict)
        or not isinstance(timeouts, dict)
    ):
        raise AppBootstrapError(
            "Application manifest is missing node/bundled_codex/npm/application/runtime receipt/timeout objects."
        )

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

    codex_version = str(bundled_codex.get("version", ""))
    if not re.fullmatch(r"\d+\.\d+\.\d+", codex_version):
        raise AppBootstrapError("Application manifest has an invalid bundled Codex version.")
    if bundled_codex.get("cli_package") != "@openai/codex":
        raise AppBootstrapError("Bundled Codex CLI package must be @openai/codex.")
    if bundled_codex.get("sdk_package") != "@openai/codex-sdk":
        raise AppBootstrapError("Bundled Codex SDK package must be @openai/codex-sdk.")
    relative_fields = (
        "cli_package_relative_path",
        "sdk_package_relative_path",
        "launcher_relative_path",
    )
    for field in relative_fields:
        candidate = Path(str(bundled_codex.get(field, "")))
        if not candidate.parts or candidate.is_absolute() or ".." in candidate.parts:
            raise AppBootstrapError(f"Invalid bundled Codex relative path {field}.")
    platforms = bundled_codex.get("platforms")
    if not isinstance(platforms, dict) or set(platforms) != set(artifacts):
        raise AppBootstrapError("Bundled Codex platforms must match the pinned Node.js platforms.")
    for artifact_key, raw_platform in platforms.items():
        if not isinstance(raw_platform, dict):
            raise AppBootstrapError(f"Invalid bundled Codex platform metadata for {artifact_key}.")
        if raw_platform.get("package") != f"@openai/codex-{artifact_key}":
            raise AppBootstrapError(f"Bundled Codex platform package disagrees for {artifact_key}.")
        if raw_platform.get("package_version") != f"{codex_version}-{artifact_key}":
            raise AppBootstrapError(f"Bundled Codex platform version disagrees for {artifact_key}.")
        for field in ("package_relative_path", "binary_relative_path"):
            candidate = Path(str(raw_platform.get(field, "")))
            if not candidate.parts or candidate.is_absolute() or ".." in candidate.parts:
                raise AppBootstrapError(
                    f"Invalid bundled Codex {field} for {artifact_key}."
                )
    required_probes = bundled_codex.get("required_probes")
    if required_probes != list(KNOWN_CODEX_CONTRACT_PROBES):
        raise AppBootstrapError("Bundled Codex must require the complete shared contract probe set.")

    for command_name in ("install", "build", "prepare_native", "prune", "verify"):
        command = npm.get(command_name)
        if not isinstance(command, list) or not command or not all(isinstance(item, str) for item in command):
            raise AppBootstrapError(f"Invalid npm command {command_name!r} in application manifest.")

    if runtime_receipt.get("schema_version") != 1:
        raise AppBootstrapError("Unsupported managed Node.js runtime receipt schema.")
    runtime_receipt_filename = str(runtime_receipt.get("filename", ""))
    if (
        not runtime_receipt_filename
        or Path(runtime_receipt_filename).name != runtime_receipt_filename
        or runtime_receipt_filename in {".", ".."}
        or not re.fullmatch(r"[A-Za-z0-9._-]+", runtime_receipt_filename)
    ):
        raise AppBootstrapError("Invalid managed Node.js runtime receipt filename.")

    if set(timeouts) != set(REQUIRED_TIMEOUT_KEYS):
        raise AppBootstrapError("Application manifest timeout set is incomplete or contains unknown keys.")
    for timeout_name in REQUIRED_TIMEOUT_KEYS:
        value = timeouts.get(timeout_name)
        if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 3600:
            raise AppBootstrapError(
                f"Application manifest timeout {timeout_name!r} must be an integer from 1 to 3600 seconds."
            )
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
    try:
        validate_target_home_trust(home)
    except PathTrustError as error:
        raise AppBootstrapError(str(error)) from error
    return home.resolve()


def login_home_path() -> Path:
    return Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve()


def validate_target_path(path: Path, home: Path) -> None:
    if not is_within(path, home):
        raise AppBootstrapError(f"Managed application path must stay under target home: {path}")
    symlink = first_symlink_component(path)
    if symlink is not None:
        raise AppBootstrapError(f"Refusing to write through symlink component: {symlink}")


def validate_user_managed_path_chain(path: Path, home: Path, label: str) -> None:
    """Validate every existing path component below an ACL-approved HOME."""

    try:
        relative = path.absolute().relative_to(home.absolute())
    except ValueError as error:
        raise AppBootstrapError(f"Managed {label} path escapes the target HOME.") from error
    current = home
    for component in relative.parts:
        current /= component
        if not os.path.lexists(current):
            break
        try:
            info = os.lstat(current)
        except OSError as error:
            raise AppBootstrapError(f"Cannot inspect managed {label} path chain.") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise AppBootstrapError(f"Managed {label} path chain contains a symlink/non-directory.")
        if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
            raise AppBootstrapError(f"Managed {label} path chain is not owned by the current user.")
        if stat.S_IMODE(info.st_mode) & 0o022:
            raise AppBootstrapError(f"Managed {label} path chain is writable by group/other.")


def resolve_codex_home(raw_codex_home: Optional[str], home: Path) -> Path:
    codex_home = (
        Path(raw_codex_home).expanduser().absolute()
        if raw_codex_home
        else home / ".codex"
    )
    if codex_home == home or not is_within(codex_home, home):
        raise AppBootstrapError("Application CODEX_HOME must be a dedicated path inside target home.")
    validate_target_path(codex_home, home)
    validate_user_managed_path_chain(codex_home, home, "CODEX_HOME")
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
    node = manifest.get("node")
    if not isinstance(node, dict):
        raise AppBootstrapError("Application manifest has no Node.js contract.")
    expected_package_engine = node.get("supported_package_engine")
    package_engines = package.get("engines")
    if (
        not isinstance(expected_package_engine, str)
        or not expected_package_engine
        or not isinstance(package_engines, dict)
        or package_engines.get("node") != expected_package_engine
    ):
        raise AppBootstrapError(
            "package.json Node.js engine must exactly match the application manifest."
        )
    if lock.get("lockfileVersion") != 3 or lock.get("name") != package.get("name"):
        raise AppBootstrapError("package-lock.json is missing, stale, or not lockfileVersion 3.")
    lock_root = lock.get("packages", {}).get("") if isinstance(lock.get("packages"), dict) else None
    if not isinstance(lock_root, dict) or lock_root.get("version") != package.get("version"):
        raise AppBootstrapError("package.json and package-lock.json root versions disagree.")
    bundled_codex = manifest.get("bundled_codex")
    if not isinstance(bundled_codex, dict):
        raise AppBootstrapError("Application manifest has no bundled Codex contract.")
    codex_version = str(bundled_codex["version"])
    cli_package = str(bundled_codex["cli_package"])
    sdk_package = str(bundled_codex["sdk_package"])
    package_dependencies = package.get("dependencies")
    locked_root_dependencies = lock_root.get("dependencies")
    if not isinstance(package_dependencies, dict) or not isinstance(locked_root_dependencies, dict):
        raise AppBootstrapError("Package metadata has no locked production dependency map.")
    for dependency in (cli_package, sdk_package):
        if package_dependencies.get(dependency) != codex_version:
            raise AppBootstrapError(f"package.json must pin {dependency} exactly to {codex_version}.")
        if locked_root_dependencies.get(dependency) != codex_version:
            raise AppBootstrapError(
                f"package-lock.json root must pin {dependency} exactly to {codex_version}."
            )
    locked_packages = lock.get("packages")
    assert isinstance(locked_packages, dict)
    cli_lock = locked_packages.get("node_modules/@openai/codex")
    sdk_lock = locked_packages.get("node_modules/@openai/codex-sdk")
    if not isinstance(cli_lock, dict) or cli_lock.get("version") != codex_version:
        raise AppBootstrapError("package-lock.json has no exact bundled Codex CLI package.")
    if not isinstance(sdk_lock, dict) or sdk_lock.get("version") != codex_version:
        raise AppBootstrapError("package-lock.json has no exact bundled Codex SDK package.")
    if not isinstance(sdk_lock.get("dependencies"), dict) or sdk_lock["dependencies"].get(
        cli_package
    ) != codex_version:
        raise AppBootstrapError("Bundled Codex SDK lock entry does not pin the same CLI version.")
    platform_contracts = bundled_codex.get("platforms")
    assert isinstance(platform_contracts, dict)
    platform_contract = platform_contracts[platform_artifact_key()]
    assert isinstance(platform_contract, dict)
    platform_path = str(platform_contract["package_relative_path"])
    platform_lock = locked_packages.get(platform_path)
    if (
        not isinstance(platform_lock, dict)
        or platform_lock.get("name") != "@openai/codex"
        or platform_lock.get("version") != platform_contract.get("package_version")
        or not isinstance(platform_lock.get("integrity"), str)
        or not str(platform_lock["integrity"]).startswith("sha512-")
    ):
        raise AppBootstrapError("package-lock.json has no exact current-platform Codex binary package.")


def verify_pruned_development_dependencies(repo_root: Path) -> int:
    """Reject a runtime tree that retains exclusively development-only packages.

    ``npm ls --omit=dev`` only checks the selected dependency graph.  It does
    not prove that a prior ``npm prune --omit=dev`` removed stale development
    packages from disk.  The lockfile's ``dev: true`` entries are exclusively
    development-only package paths, so every one must be absent after the
    managed production prune.
    """

    lock_path = repo_root / "package-lock.json"
    try:
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AppBootstrapError(
            f"Cannot inspect development dependency prune state: {type(error).__name__}"
        ) from error
    packages = lock.get("packages")
    if not isinstance(packages, dict):
        raise AppBootstrapError("package-lock.json has no package inventory for development-prune verification.")

    retained: List[str] = []
    expected = 0
    for raw_path, metadata in packages.items():
        if raw_path == "" or not isinstance(metadata, dict) or metadata.get("dev") is not True:
            continue
        if not isinstance(raw_path, str):
            raise AppBootstrapError("package-lock.json contains a non-string development package path.")
        pure_path = PurePosixPath(raw_path)
        if (
            pure_path.is_absolute()
            or not pure_path.parts
            or pure_path.parts[0] != "node_modules"
            or any(part in {"", ".", ".."} for part in pure_path.parts)
        ):
            raise AppBootstrapError("package-lock.json contains an unsafe development package path.")
        expected += 1
        candidate = repo_root.joinpath(*pure_path.parts)
        if os.path.lexists(candidate):
            retained.append(raw_path)

    if retained:
        preview = ", ".join(retained[:4])
        suffix = "" if len(retained) <= 4 else ", ..."
        raise AppBootstrapError(
            "npm prune --omit=dev left development-only packages on disk: " + preview + suffix
        )
    return expected


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


def command_timeout(manifest: Mapping[str, object], name: str) -> int:
    timeouts = manifest.get("timeouts_seconds")
    if not isinstance(timeouts, dict):
        raise AppBootstrapError("Application manifest has no command timeout contract.")
    value = timeouts.get(name)
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 3600:
        raise AppBootstrapError(f"Application manifest timeout {name!r} is invalid.")
    return value


def _glibc_version() -> Tuple[int, int]:
    raw = ""
    try:
        raw = os.confstr("CS_GNU_LIBC_VERSION") or ""
    except (AttributeError, OSError, ValueError):
        raw = ""
    match = re.fullmatch(r"glibc\s+(\d+)\.(\d+)(?:\.\d+)?", raw.strip(), re.IGNORECASE)
    if match is None:
        libc_name, libc_version = platform.libc_ver()
        if libc_name.lower() not in {"glibc", "gnu libc"}:
            raise AppBootstrapError(
                "Pinned Node.js Linux binaries require glibc 2.28 or newer; this host libc was not recognized as glibc."
            )
        match = re.fullmatch(r"(\d+)\.(\d+)(?:\.\d+)?", libc_version.strip())
    if match is None:
        raise AppBootstrapError(
            "Cannot verify the host glibc version required by pinned Node.js (minimum 2.28)."
        )
    return int(match.group(1)), int(match.group(2))


def _nearest_existing_path(path: Path) -> Path:
    current = path.absolute()
    while not current.exists():
        if current.is_symlink():
            raise AppBootstrapError(f"Refusing a filesystem probe through a broken symlink: {current}")
        parent = current.parent
        if parent == current:
            raise AppBootstrapError(f"Cannot locate an existing filesystem parent for {path}.")
        current = parent
    return current


def validate_direct_app_host(paths: "AppPaths") -> None:
    """Fail before writes when the pinned direct-app runtime cannot execute here."""

    if platform.system() != "Linux":
        raise AppBootstrapError("Dr. Claw Web direct installation currently supports Linux only.")
    # This also rejects architectures for which the manifest has no pinned artifact.
    if platform_artifact_key() != paths.artifact_key:
        raise AppBootstrapError("Host architecture changed while preparing the application install.")
    glibc_version = _glibc_version()
    if glibc_version < (2, 28):
        raise AppBootstrapError(
            f"Pinned Node.js requires glibc 2.28 or newer; host has {glibc_version[0]}.{glibc_version[1]}."
        )

    for target in (paths.bin_root, paths.data_root, paths.repo_root):
        symlink = first_symlink_component(target)
        if symlink is not None:
            raise AppBootstrapError(f"Refusing a managed executable path through a symlink: {symlink}")
        anchor = _nearest_existing_path(target)
        try:
            flags = os.statvfs(anchor).f_flag
        except OSError as error:
            raise AppBootstrapError(f"Cannot inspect filesystem mount flags for {target}: {error}") from error
        if flags & LINUX_ST_NOEXEC:
            raise AppBootstrapError(
                f"Managed application executables would be placed on a noexec filesystem: {target} (via {anchor})."
            )


def _validate_root_trusted_chain(path: Path) -> None:
    current = Path(path.anchor)
    for component in path.parts[1:]:
        current = current / component
        try:
            info = os.lstat(current)
        except OSError as error:
            raise AppBootstrapError(f"Cannot inspect trusted executable path {current}: {error}") from error
        if info.st_uid != 0:
            raise AppBootstrapError(f"Trusted executable path is not root-owned: {current}")
        # Symlink permission bits are not effective. Its root-owned, non-writable
        # parent is what prevents an unprivileged replacement.
        if not stat.S_ISLNK(info.st_mode) and stat.S_IMODE(info.st_mode) & 0o022:
            raise AppBootstrapError(f"Trusted executable path is group/world-writable: {current}")


def validate_trusted_systemctl_path(candidate: str) -> str:
    candidate_path = Path(candidate)
    if not candidate_path.is_absolute():
        raise AppBootstrapError("Refusing a relative systemctl path.")
    _validate_root_trusted_chain(candidate_path)
    try:
        resolved = candidate_path.resolve(strict=True)
    except OSError as error:
        raise AppBootstrapError(f"Cannot resolve trusted systemctl path {candidate_path}: {error}") from error
    _validate_root_trusted_chain(resolved)
    try:
        info = resolved.stat()
    except OSError as error:
        raise AppBootstrapError(f"Cannot inspect trusted systemctl executable: {error}") from error
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
        raise AppBootstrapError("systemctl must be a root-owned regular executable not writable by group/other.")
    if not os.access(resolved, os.X_OK):
        raise AppBootstrapError(f"Trusted systemctl is not executable: {resolved}")
    return str(resolved)


def resolve_trusted_systemctl(candidate: Optional[str] = None) -> Optional[str]:
    located = candidate if candidate is not None else shutil.which("systemctl", path=TRUSTED_SYSTEM_PATH)
    if not located:
        return None
    return validate_trusted_systemctl_path(located)


def _trusted_user_runtime_directory(runtime_dir: Path, effective_uid: int) -> bool:
    if not runtime_dir.is_absolute():
        return False
    current = Path(runtime_dir.anchor)
    components = runtime_dir.parts[1:]
    for index, component in enumerate(components):
        current /= component
        try:
            info = os.lstat(current)
        except OSError:
            return False
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            return False
        final = index == len(components) - 1
        if final:
            if info.st_uid != effective_uid or stat.S_IMODE(info.st_mode) != 0o700:
                return False
            continue
        if info.st_uid not in {0, effective_uid}:
            return False
        writable = bool(stat.S_IMODE(info.st_mode) & 0o022)
        root_sticky = info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
        if writable and not root_sticky:
            return False
    return bool(components)


def minimal_systemd_environment(home: Path) -> Dict[str, str]:
    account = pwd.getpwuid(os.geteuid())
    environment = {
        "HOME": str(home),
        "PATH": TRUSTED_SYSTEM_PATH,
        "USER": account.pw_name,
        "LOGNAME": account.pw_name,
        "LANG": "C",
        "LC_ALL": "C",
    }
    runtime_candidates: List[Path] = []
    inherited_runtime = os.environ.get("XDG_RUNTIME_DIR")
    if inherited_runtime:
        runtime_candidates.append(Path(inherited_runtime))
    runtime_candidates.append(Path("/run/user") / str(os.geteuid()))
    for runtime_dir in runtime_candidates:
        if not _trusted_user_runtime_directory(runtime_dir, os.geteuid()):
            continue
        environment["XDG_RUNTIME_DIR"] = str(runtime_dir)
        environment["DBUS_SESSION_BUS_ADDRESS"] = f"unix:path={runtime_dir / 'bus'}"
        break
    return environment


def run_user_systemctl(
    systemctl: str,
    arguments: Sequence[str],
    home: Path,
    manifest: Mapping[str, object],
    **kwargs: object,
) -> subprocess.CompletedProcess:
    if "env" in kwargs or "timeout" in kwargs:
        raise AppBootstrapError("Internal systemctl invocation attempted to override its safety contract.")
    trusted_systemctl = validate_trusted_systemctl_path(systemctl)
    return subprocess.run(
        [trusted_systemctl, "--user", *arguments],
        env=minimal_systemd_environment(home),
        timeout=command_timeout(manifest, "systemctl"),
        **kwargs,
    )


def validate_app_python_runtime() -> None:
    """Validate TLS and in-memory tar.xz support before any target write."""

    try:
        import ssl as ssl_module

        ssl_module.create_default_context()
    except Exception as error:
        raise AppBootstrapError(
            "This Python runtime lacks working TLS/SSL support required by the Web installer."
        ) from error

    try:
        import io
        import lzma  # noqa: F401 - importing verifies the optional stdlib extension

        payload = b"drclaw-xz-runtime-probe"
        archive_buffer = io.BytesIO()
        with tarfile.open(fileobj=archive_buffer, mode="w:xz") as archive:
            member = tarfile.TarInfo("probe")
            member.size = len(payload)
            archive.addfile(member, io.BytesIO(payload))
        archive_buffer.seek(0)
        with tarfile.open(fileobj=archive_buffer, mode="r:xz") as archive:
            extracted = archive.extractfile("probe")
            if extracted is None or extracted.read() != payload:
                raise OSError("tar.xz roundtrip mismatch")
    except Exception as error:
        raise AppBootstrapError(
            "This Python runtime lacks working lzma/tar.xz support required by the Web installer."
        ) from error


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
    runtime_info = node_runtime.stat()
    node_info = node_binary.stat()
    if hasattr(os, "geteuid") and (
        runtime_info.st_uid != os.geteuid() or node_info.st_uid != os.geteuid()
    ):
        raise AppBootstrapError("Managed Node.js runtime or executable is not owned by the current user.")
    if stat.S_IMODE(runtime_info.st_mode) & 0o022 or stat.S_IMODE(node_info.st_mode) & 0o022:
        raise AppBootstrapError("Managed Node.js runtime or executable is writable by group/other.")
    if not os.access(node_binary, os.X_OK):
        raise AppBootstrapError(f"Managed Node.js executable is not executable: {node_binary}")
    try:
        npm_target = npm_binary.resolve(strict=True)
        npm_target.relative_to(node_runtime.resolve(strict=True))
    except (OSError, ValueError) as error:
        raise AppBootstrapError(f"Managed npm launcher escapes/is missing from Node.js runtime: {npm_binary}") from error
    if not npm_target.is_file() or npm_target.is_symlink():
        raise AppBootstrapError(f"Managed npm target is not a regular file: {npm_target}")
    npm_info = npm_target.stat()
    if hasattr(os, "geteuid") and npm_info.st_uid != os.geteuid():
        raise AppBootstrapError("Managed npm target is not owned by the current user.")
    if stat.S_IMODE(npm_info.st_mode) & 0o022:
        raise AppBootstrapError("Managed npm target is writable by group/other.")
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
    expected_version: str,
    runtime_receipt_filename: str,
    runtime_receipt_contract: Mapping[str, object],
) -> Dict[str, str]:
    """Validate a pinned Node archive completely before publishing its runtime.

    In particular, execute the staged Node binary before the atomic rename.  A
    loader/libc incompatibility must not strand an unreceipted final runtime
    that a later install cannot safely reuse or replace.
    """

    staging = Path(tempfile.mkdtemp(prefix=".node-extract-", dir=str(runtime_parent)))
    try:
        with tarfile.open(archive_path, mode="r:xz") as archive:
            members = archive.getmembers()
            _validate_tar_members(members, staging)
            archive.extractall(staging, members=members)
        extracted = staging / expected_top_level
        node_binary = extracted / "bin" / "node"
        npm_binary = extracted / "bin" / "npm"
        layout = validate_runtime_layout(
            staging,
            extracted,
            node_binary,
            npm_binary,
            expected_version,
        )
        if set(runtime_receipt_contract) != RUNTIME_RECEIPT_BASE_KEYS:
            raise AppBootstrapError("Managed Node.js staging receipt contract has invalid fields.")
        if runtime_receipt_contract.get("node_version") != expected_version:
            raise AppBootstrapError("Managed Node.js staging receipt version differs from archive contract.")
        if runtime_receipt_contract.get("runtime_root") != str(final_runtime):
            raise AppBootstrapError("Managed Node.js staging receipt target differs from publish target.")
        receipt_layout = {
            "version": expected_version,
            **{key: layout[key] for key in RUNTIME_LAYOUT_RECEIPT_KEYS if key != "version"},
        }
        receipt = {**runtime_receipt_contract, "layout": receipt_layout}
        atomic_write(
            extracted / runtime_receipt_filename,
            json.dumps(receipt, indent=2, sort_keys=True) + "\n",
            0o600,
        )
        if final_runtime.exists():
            raise AppBootstrapError(f"Node.js runtime target appeared concurrently: {final_runtime}")
        os.replace(extracted, final_runtime)
        return layout
    except AppBootstrapError:
        raise
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
            try:
                opener = sanitized_network_opener(os.environ)
            except NetworkContractError as error:
                raise AppBootstrapError(str(error)) from error
            response = opener.open(request, timeout=90)
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
            read_only_git_command(["-C", str(repo_root), "rev-parse", "HEAD"]),
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
            stdin=subprocess.DEVNULL,
            env=read_only_git_environment(),
        ).stdout.strip()
        dirty_result = subprocess.run(
            read_only_git_command(
                ["-C", str(repo_root), "status", "--porcelain", "--untracked-files=no"]
            ),
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
            stdin=subprocess.DEVNULL,
            env=read_only_git_environment(),
        )
        diff_result = subprocess.run(
            read_only_git_command(
                [
                    "-C",
                    str(repo_root),
                    "diff",
                    "--binary",
                    "--no-ext-diff",
                    "--no-textconv",
                    "HEAD",
                ]
            ),
            check=True,
            capture_output=True,
            timeout=120,
            stdin=subprocess.DEVNULL,
            env=read_only_git_environment(),
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
            read_only_git_command(
                [
                "-C",
                str(repo_root),
                "ls-files",
                "-z",
                "-c",
                "-o",
                "--exclude-standard",
                "--",
                ]
                + list(source_roots)
            ),
            check=True,
            capture_output=True,
            timeout=120,
            stdin=subprocess.DEVNULL,
            env=read_only_git_environment(),
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
        bundled_codex = manifest["bundled_codex"]
        runtime_receipt = manifest["runtime_receipt"]
        service = manifest["service"]
        application = manifest["application"]
        assert (
            isinstance(node, dict)
            and isinstance(bundled_codex, dict)
            and isinstance(runtime_receipt, dict)
            and isinstance(service, dict)
            and isinstance(application, dict)
        )
        artifact_key = platform_artifact_key()
        artifact = node["artifacts"][artifact_key]
        assert isinstance(artifact, dict)
        top_level = str(artifact["filename"])[: -len(".tar.xz")]
        self.artifact_key = artifact_key
        self.artifact = artifact
        self.node_runtime = self.runtime_parent / top_level
        self.node_binary = self.node_runtime / "bin" / "node"
        self.npm_binary = self.node_runtime / "bin" / "npm"
        self.node_runtime_receipt = self.node_runtime / str(runtime_receipt["filename"])
        self.npm_cache = self.data_root / "cache" / "npm"
        self.npm_tmp = self.data_root / "tmp" / "npm"
        self.npm_userconfig = self.config_root / "npmrc"
        platform_contracts = bundled_codex["platforms"]
        assert isinstance(platform_contracts, dict)
        self.codex_platform_contract = platform_contracts[artifact_key]
        assert isinstance(self.codex_platform_contract, dict)
        self.codex_package_root = repo_root / str(
            bundled_codex["cli_package_relative_path"]
        )
        self.codex_sdk_package_root = repo_root / str(
            bundled_codex["sdk_package_relative_path"]
        )
        self.codex_launcher = repo_root / str(bundled_codex["launcher_relative_path"])
        self.codex_platform_root = repo_root / str(
            self.codex_platform_contract["package_relative_path"]
        )
        self.codex_binary = self.codex_platform_root / str(
            self.codex_platform_contract["binary_relative_path"]
        )
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


def node_runtime_receipt_contract(
    paths: AppPaths, manifest: Mapping[str, object]
) -> Dict[str, object]:
    runtime_receipt = manifest.get("runtime_receipt")
    node = manifest.get("node")
    if not isinstance(runtime_receipt, dict) or not isinstance(node, dict):
        raise AppBootstrapError("Application manifest has no managed Node.js receipt contract.")
    return {
        "schema_version": runtime_receipt["schema_version"],
        "managed_by": RUNTIME_RECEIPT_MANAGED_BY,
        "node_version": node["version"],
        "artifact_key": paths.artifact_key,
        "artifact_filename": paths.artifact["filename"],
        "artifact_sha256": paths.artifact["sha256"],
        "runtime_root": str(paths.node_runtime),
    }


def write_node_runtime_receipt(
    paths: AppPaths,
    manifest: Mapping[str, object],
    layout: Mapping[str, str],
) -> None:
    missing = (RUNTIME_LAYOUT_RECEIPT_KEYS - {"version"}) - set(layout)
    if missing:
        raise AppBootstrapError(
            "Cannot write managed Node.js receipt without layout fields: " + ", ".join(sorted(missing))
        )
    node = manifest.get("node")
    if not isinstance(node, dict):
        raise AppBootstrapError("Application manifest has no Node.js contract.")
    receipt_layout = {
        "version": str(node["version"]),
        **{key: layout[key] for key in RUNTIME_LAYOUT_RECEIPT_KEYS if key != "version"},
    }
    receipt = {**node_runtime_receipt_contract(paths, manifest), "layout": receipt_layout}
    atomic_write(
        paths.node_runtime_receipt,
        json.dumps(receipt, indent=2, sort_keys=True) + "\n",
        0o600,
    )


def validate_node_runtime_receipt(
    paths: AppPaths,
    manifest: Mapping[str, object],
) -> Dict[str, str]:
    receipt_path = paths.node_runtime_receipt
    if receipt_path.is_symlink() or not receipt_path.is_file():
        raise AppBootstrapError(f"Managed Node.js runtime receipt is missing or symlinked: {receipt_path}")
    try:
        info = receipt_path.stat()
    except OSError as error:
        raise AppBootstrapError(f"Cannot inspect managed Node.js runtime receipt: {error}") from error
    if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
        raise AppBootstrapError("Managed Node.js runtime receipt is not owned by the current user.")
    if stat.S_IMODE(info.st_mode) != 0o600:
        raise AppBootstrapError("Managed Node.js runtime receipt permissions must be exactly 0600.")
    try:
        receipt_content = receipt_path.read_text(encoding="utf-8")
        receipt = json.loads(receipt_content)
    except (OSError, json.JSONDecodeError) as error:
        raise AppBootstrapError(f"Cannot parse managed Node.js runtime receipt: {error}") from error
    if not isinstance(receipt, dict) or set(receipt) != RUNTIME_RECEIPT_BASE_KEYS | {"layout"}:
        raise AppBootstrapError("Managed Node.js runtime receipt has invalid fields.")
    if receipt_content != json.dumps(receipt, indent=2, sort_keys=True) + "\n":
        raise AppBootstrapError("Managed Node.js runtime receipt is not canonical.")
    expected = node_runtime_receipt_contract(paths, manifest)
    for key, expected_value in expected.items():
        if receipt.get(key) != expected_value:
            raise AppBootstrapError(f"Managed Node.js runtime receipt differs from manifest ({key}).")
    layout = receipt.get("layout")
    if not isinstance(layout, dict) or set(layout) != RUNTIME_LAYOUT_RECEIPT_KEYS:
        raise AppBootstrapError("Managed Node.js runtime receipt has an invalid layout contract.")
    node = manifest["node"]
    assert isinstance(node, dict)
    return validate_runtime_layout(
        paths.runtime_parent,
        paths.node_runtime,
        paths.node_binary,
        paths.npm_binary,
        str(node["version"]),
        layout,
    )


def validate_application_node_contract(
    recorded: Mapping[str, object],
    paths: AppPaths,
    manifest: Mapping[str, object],
    observed_layout: Optional[Mapping[str, str]] = None,
) -> None:
    node = manifest.get("node")
    if not isinstance(node, dict):
        raise AppBootstrapError("Application manifest has no Node.js contract.")
    expected_metadata = {
        "version": node["version"],
        "artifact_key": paths.artifact_key,
        "artifact_sha256": paths.artifact["sha256"],
        "binary": str(paths.node_binary),
    }
    for key, expected_value in expected_metadata.items():
        if recorded.get(key) != expected_value:
            raise AppBootstrapError(f"Application Node.js receipt differs from manifest ({key}).")
    if observed_layout is not None:
        for key in RUNTIME_LAYOUT_RECEIPT_KEYS - {"version"}:
            if recorded.get(key) != observed_layout.get(key):
                raise AppBootstrapError(
                    f"Application Node.js receipt differs from standalone runtime receipt ({key})."
                )
        if recorded.get("observed_version") != observed_layout.get("observed_version"):
            raise AppBootstrapError(
                "Application Node.js observed version differs from standalone runtime receipt validation."
            )


def _validate_legacy_release_checkout(paths: AppPaths, state: Mapping[str, object]) -> Path:
    """Resolve the retained immutable v0.1 release without trusting a new checkout."""

    raw_repo = state.get("repo_root")
    if not isinstance(raw_repo, str) or not raw_repo or any(
        control in raw_repo for control in ("\x00", "\n", "\r")
    ):
        raise AppBootstrapError("Legacy app receipt repository path is invalid.")
    recorded_path = Path(raw_repo)
    if not recorded_path.is_absolute():
        raise AppBootstrapError("Legacy app receipt repository path is not absolute.")
    symlink = first_symlink_component(recorded_path)
    if symlink is not None:
        raise AppBootstrapError("Legacy app receipt repository path traverses a symlink.")

    release_root_path = paths.home / ".local" / "share" / "drclaw" / "releases"
    try:
        release_root = release_root_path.resolve(strict=True)
        recorded_repo = recorded_path.resolve(strict=True)
    except OSError as error:
        raise AppBootstrapError(
            "Legacy v0.1 migration requires its retained immutable release checkout; "
            "the recorded checkout is unavailable."
        ) from error
    if recorded_path != recorded_repo or release_root_path != release_root:
        raise AppBootstrapError("Legacy app receipt repository path is not canonical.")
    if recorded_repo.parent != release_root or not re.fullmatch(r"[0-9a-f]{40}", recorded_repo.name):
        raise AppBootstrapError(
            "Legacy app receipt repository is outside the trusted HOME release/<commit> tree."
        )

    try:
        relative = recorded_repo.relative_to(paths.home)
    except ValueError as error:
        raise AppBootstrapError("Legacy app receipt repository escapes the target HOME.") from error
    current = paths.home
    checked: List[Path] = []
    for component in relative.parts:
        current /= component
        checked.append(current)
    for component in checked:
        try:
            info = os.lstat(component)
        except OSError as error:
            raise AppBootstrapError("Cannot inspect the retained legacy release path.") from error
        if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
            raise AppBootstrapError("Retained legacy release path contains a non-directory or symlink.")
        if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
            raise AppBootstrapError("Retained legacy release path is not owned by the current user.")
        if stat.S_IMODE(info.st_mode) & 0o022:
            raise AppBootstrapError("Retained legacy release path is writable by group/other.")
    for private_root in (release_root, recorded_repo):
        if stat.S_IMODE(private_root.stat().st_mode) & 0o077:
            raise AppBootstrapError("Retained legacy release root/checkout must remain private (mode 0700).")

    git_root = recorded_repo / ".git"
    if first_symlink_component(git_root) is not None or not git_root.is_dir() or git_root.is_symlink():
        raise AppBootstrapError("Retained legacy release has no trusted in-tree Git metadata.")
    git_info = git_root.stat()
    if (
        hasattr(os, "geteuid")
        and git_info.st_uid != os.geteuid()
        or stat.S_IMODE(git_info.st_mode) & 0o022
    ):
        raise AppBootstrapError("Retained legacy release Git metadata is not user-owned/read-only to peers.")
    return recorded_repo


def _validate_legacy_receipt_file(
    state: Mapping[str, object],
    *,
    path_key: str,
    digest_key: str,
    expected_path: Path,
    expected_mode: int,
    label: str,
) -> None:
    if state.get(path_key) != str(expected_path):
        raise AppBootstrapError(f"Legacy app receipt {label} path differs from the managed target.")
    if first_symlink_component(expected_path) is not None or expected_path.is_symlink():
        raise AppBootstrapError(f"Legacy app receipt {label} path traverses a symlink.")
    try:
        info = expected_path.stat()
    except OSError as error:
        raise AppBootstrapError(f"Legacy app receipt {label} file is unavailable.") from error
    if not stat.S_ISREG(info.st_mode):
        raise AppBootstrapError(f"Legacy app receipt {label} is not a regular file.")
    if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
        raise AppBootstrapError(f"Legacy app receipt {label} is not owned by the current user.")
    if stat.S_IMODE(info.st_mode) != expected_mode:
        raise AppBootstrapError(
            f"Legacy app receipt {label} permissions must be exactly {expected_mode:04o}."
        )
    recorded_digest = state.get(digest_key)
    if not isinstance(recorded_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", recorded_digest):
        raise AppBootstrapError(f"Legacy app receipt {label} digest is invalid.")
    if sha256_file(expected_path) != recorded_digest:
        raise AppBootstrapError(f"Legacy app receipt {label} digest does not match retained state.")


def validate_legacy_application_runtime_receipt(
    paths: AppPaths,
    manifest: Mapping[str, object],
) -> Dict[str, str]:
    receipt_path = paths.receipt
    if receipt_path.is_symlink() or not receipt_path.is_file():
        raise AppBootstrapError(
            "Existing Node.js runtime has neither a standalone runtime receipt nor a regular legacy app receipt."
        )
    try:
        info = receipt_path.stat()
        receipt_content = receipt_path.read_text(encoding="utf-8")
        state = json.loads(receipt_content)
    except (OSError, json.JSONDecodeError) as error:
        raise AppBootstrapError(f"Cannot validate legacy app receipt before runtime reuse: {error}") from error
    if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
        raise AppBootstrapError("Legacy app receipt is not owned by the current user.")
    if stat.S_IMODE(info.st_mode) != 0o600:
        raise AppBootstrapError("Legacy app receipt permissions must be exactly 0600.")
    if (
        not isinstance(state, dict)
        or set(state) != LEGACY_APP_RECEIPT_V01_KEYS
        or state.get("schema_version") != 1
    ):
        raise AppBootstrapError("Legacy app receipt has an invalid schema.")
    if receipt_content != json.dumps(state, indent=2, sort_keys=True) + "\n":
        raise AppBootstrapError("Legacy app receipt is not canonical.")
    if state.get("managed_by") != "drclaw-web-bootstrap":
        raise AppBootstrapError("Legacy app receipt is not managed by this bootstrap.")
    if state.get("bundle_version") != "0.1.0":
        raise AppBootstrapError("Only a fully validated v0.1 app receipt may migrate a runtime receipt.")
    try:
        installed_at = dt.datetime.fromisoformat(str(state.get("installed_at", "")).replace("Z", "+00:00"))
    except ValueError as error:
        raise AppBootstrapError("Legacy app receipt installed_at timestamp is invalid.") from error
    if installed_at.tzinfo is None:
        raise AppBootstrapError("Legacy app receipt installed_at timestamp has no timezone.")
    if "JWT_SECRET" in json.dumps(state):
        raise AppBootstrapError("Legacy app receipt unexpectedly contains secret material.")

    recorded_repo = _validate_legacy_release_checkout(paths, state)
    recorded_git = state.get("git")
    if (
        not isinstance(recorded_git, dict)
        or set(recorded_git) != GIT_RECEIPT_KEYS
        or recorded_git.get("available") is not True
        or recorded_git.get("dirty") is not False
        or recorded_git.get("revision") != recorded_repo.name
    ):
        raise AppBootstrapError("Legacy app receipt has no clean immutable Git provenance.")
    if git_receipt(recorded_repo) != recorded_git:
        raise AppBootstrapError("Retained legacy release Git provenance drifted from its app receipt.")

    package_lock = recorded_repo / "package-lock.json"
    if first_symlink_component(package_lock) is not None or not package_lock.is_file():
        raise AppBootstrapError("Retained legacy release package lock is missing or symlinked.")
    package_info = package_lock.stat()
    if (
        hasattr(os, "geteuid")
        and package_info.st_uid != os.geteuid()
        or stat.S_IMODE(package_info.st_mode) & 0o022
    ):
        raise AppBootstrapError("Retained legacy release package lock is not user-owned/read-only to peers.")
    recorded_lock_digest = state.get("package_lock_sha256")
    if (
        not isinstance(recorded_lock_digest, str)
        or not re.fullmatch(r"[0-9a-f]{64}", recorded_lock_digest)
        or sha256_file(package_lock) != recorded_lock_digest
    ):
        raise AppBootstrapError("Retained legacy release package-lock digest differs from its app receipt.")

    recorded_source_digest = state.get("application_source_sha256")
    if (
        not isinstance(recorded_source_digest, str)
        or not re.fullmatch(r"[0-9a-f]{64}", recorded_source_digest)
        or application_source_digest(recorded_repo, manifest) != recorded_source_digest
    ):
        raise AppBootstrapError("Retained legacy release source digest differs from its app receipt.")
    recorded_dist_digest = state.get("dist_sha256")
    if (
        not isinstance(recorded_dist_digest, str)
        or not re.fullmatch(r"[0-9a-f]{64}", recorded_dist_digest)
        or directory_digest(recorded_repo / "dist") != recorded_dist_digest
    ):
        raise AppBootstrapError("Retained legacy release build digest differs from its app receipt.")

    if state.get("codex_home") != str(paths.codex_home):
        raise AppBootstrapError("Legacy app receipt CODEX_HOME differs from the upgrade target.")
    if state.get("database_path") != str(paths.database_path) or state.get("workspace_root") != str(
        paths.workspace_root
    ):
        raise AppBootstrapError("Legacy app receipt managed data paths differ from the upgrade target.")
    if not isinstance(state.get("service"), str) or not isinstance(state.get("started_by_installer"), bool):
        raise AppBootstrapError("Legacy app receipt service state is invalid.")

    _validate_legacy_receipt_file(
        state,
        path_key="environment_file",
        digest_key="environment_sha256",
        expected_path=paths.env_file,
        expected_mode=0o600,
        label="environment",
    )
    _validate_legacy_receipt_file(
        state,
        path_key="npm_userconfig",
        digest_key="npm_userconfig_sha256",
        expected_path=paths.npm_userconfig,
        expected_mode=0o600,
        label="npm config",
    )
    _validate_legacy_receipt_file(
        state,
        path_key="launcher",
        digest_key="launcher_sha256",
        expected_path=paths.launcher,
        expected_mode=0o700,
        label="launcher",
    )
    if state.get("unit_file") is None:
        if state.get("unit_sha256") is not None:
            raise AppBootstrapError("Legacy app receipt has a unit digest without a unit path.")
    else:
        _validate_legacy_receipt_file(
            state,
            path_key="unit_file",
            digest_key="unit_sha256",
            expected_path=paths.unit_file,
            expected_mode=0o600,
            label="systemd unit",
        )

    recorded = state.get("node")
    if not isinstance(recorded, dict) or set(recorded) != LEGACY_APP_NODE_V01_KEYS:
        raise AppBootstrapError("Legacy app receipt has no Node.js runtime contract.")
    validate_application_node_contract(recorded, paths, manifest)
    node = manifest["node"]
    assert isinstance(node, dict)
    return validate_runtime_layout(
        paths.runtime_parent,
        paths.node_runtime,
        paths.node_binary,
        paths.npm_binary,
        str(node["version"]),
        recorded,
    )


def _validate_repo_directory(path: Path, repo_root: Path, label: str) -> str:
    symlink = first_symlink_component(path)
    if symlink is not None:
        raise AppBootstrapError(f"Bundled Codex {label} traverses a symlink: {symlink}")
    if path.is_symlink() or not path.is_dir():
        raise AppBootstrapError(f"Bundled Codex {label} is not a real directory: {path}")
    try:
        relative = path.resolve(strict=True).relative_to(repo_root.resolve(strict=True)).as_posix()
    except (OSError, ValueError) as error:
        raise AppBootstrapError(f"Bundled Codex {label} escapes the application checkout: {path}") from error
    for member in (path, *path.rglob("*")):
        if member.is_symlink():
            raise AppBootstrapError(f"Bundled Codex {label} contains a symlink: {member}")
        try:
            info = member.stat()
        except OSError as error:
            raise AppBootstrapError(f"Cannot inspect bundled Codex {label}: {member}") from error
        if hasattr(os, "geteuid") and info.st_uid != os.geteuid():
            raise AppBootstrapError(f"Bundled Codex {label} has a foreign-owned path: {member}")
    return relative


def _validate_repo_file(
    path: Path,
    repo_root: Path,
    label: str,
    *,
    executable: bool,
) -> str:
    symlink = first_symlink_component(path)
    if symlink is not None:
        raise AppBootstrapError(f"Bundled Codex {label} traverses a symlink: {symlink}")
    if path.is_symlink() or not path.is_file():
        raise AppBootstrapError(f"Bundled Codex {label} is not a regular file: {path}")
    try:
        relative = path.resolve(strict=True).relative_to(repo_root.resolve(strict=True)).as_posix()
    except (OSError, ValueError) as error:
        raise AppBootstrapError(f"Bundled Codex {label} escapes the application checkout: {path}") from error
    if hasattr(os, "geteuid") and path.stat().st_uid != os.geteuid():
        raise AppBootstrapError(f"Bundled Codex {label} is not owned by the current user: {path}")
    if executable and not os.access(path, os.X_OK):
        raise AppBootstrapError(f"Bundled Codex {label} is not executable: {path}")
    return relative


def _package_json(package_root: Path, label: str) -> Dict[str, object]:
    package_path = package_root / "package.json"
    if package_path.is_symlink() or not package_path.is_file():
        raise AppBootstrapError(f"Bundled Codex {label} package.json is missing or symlinked.")
    try:
        payload = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise AppBootstrapError(f"Cannot parse bundled Codex {label} package.json: {error}") from error
    if not isinstance(payload, dict):
        raise AppBootstrapError(f"Bundled Codex {label} package.json is not an object.")
    return payload


def validate_bundled_codex_layout(
    paths: AppPaths,
    repo_root: Path,
    manifest: Mapping[str, object],
    expected_contract: Optional[Mapping[str, object]] = None,
) -> Dict[str, object]:
    """Validate and digest every application-owned Codex execution component."""

    bundled = manifest.get("bundled_codex")
    if not isinstance(bundled, dict):
        raise AppBootstrapError("Application manifest has no bundled Codex contract.")
    expected_version = str(bundled["version"])

    cli_relative = _validate_repo_directory(
        paths.codex_package_root, repo_root, "CLI package root"
    )
    sdk_relative = _validate_repo_directory(
        paths.codex_sdk_package_root, repo_root, "SDK package root"
    )
    platform_relative = _validate_repo_directory(
        paths.codex_platform_root, repo_root, "platform package root"
    )
    launcher_relative = _validate_repo_file(
        paths.codex_launcher,
        repo_root,
        "JavaScript launcher",
        executable=True,
    )
    binary_relative = _validate_repo_file(
        paths.codex_binary,
        repo_root,
        "platform binary",
        executable=True,
    )

    cli_package = _package_json(paths.codex_package_root, "CLI")
    sdk_package = _package_json(paths.codex_sdk_package_root, "SDK")
    platform_package = _package_json(paths.codex_platform_root, "platform")
    if cli_package.get("name") != bundled.get("cli_package") or cli_package.get(
        "version"
    ) != expected_version:
        raise AppBootstrapError("Installed bundled Codex CLI package is not the exact pinned version.")
    if not isinstance(cli_package.get("bin"), dict) or cli_package["bin"].get(
        "codex"
    ) != "bin/codex.js":
        raise AppBootstrapError("Installed bundled Codex CLI launcher metadata is invalid.")
    if sdk_package.get("name") != bundled.get("sdk_package") or sdk_package.get(
        "version"
    ) != expected_version:
        raise AppBootstrapError("Installed bundled Codex SDK package is not the exact pinned version.")
    sdk_dependencies = sdk_package.get("dependencies")
    if not isinstance(sdk_dependencies, dict) or sdk_dependencies.get(
        str(bundled["cli_package"])
    ) != expected_version:
        raise AppBootstrapError("Installed bundled Codex SDK does not pin the same CLI version.")
    platform_contract = paths.codex_platform_contract
    if platform_package.get("name") != "@openai/codex" or platform_package.get(
        "version"
    ) != platform_contract.get("package_version"):
        raise AppBootstrapError("Installed bundled Codex platform package is not the exact pinned version.")

    observed: Dict[str, object] = {
        "version": expected_version,
        "command": [str(paths.node_binary), str(paths.codex_launcher)],
        "launcher": str(paths.codex_launcher),
        "launcher_relative": launcher_relative,
        "launcher_sha256": sha256_file(paths.codex_launcher),
        "cli_package_root": str(paths.codex_package_root),
        "cli_package_relative": cli_relative,
        "cli_package_tree_sha256": directory_digest(paths.codex_package_root),
        "sdk_package_root": str(paths.codex_sdk_package_root),
        "sdk_package_relative": sdk_relative,
        "sdk_package_tree_sha256": directory_digest(paths.codex_sdk_package_root),
        "platform_package": str(platform_contract["package"]),
        "platform_package_root": str(paths.codex_platform_root),
        "platform_package_relative": platform_relative,
        "platform_package_tree_sha256": directory_digest(paths.codex_platform_root),
        "platform_binary": str(paths.codex_binary),
        "platform_binary_relative": binary_relative,
        "platform_binary_sha256": sha256_file(paths.codex_binary),
    }
    if expected_contract is not None:
        for key, value in observed.items():
            if expected_contract.get(key) != value:
                raise AppBootstrapError(f"Bundled Codex runtime drifted from receipt ({key}).")
    return observed


def bundled_codex_probe_environment(paths: AppPaths) -> Dict[str, str]:
    environment: Dict[str, str] = {
        "PATH": os.pathsep.join(
            (str(paths.node_runtime / "bin"), "/usr/local/bin", "/usr/bin", "/bin")
        )
    }
    for key in ("LANG", "LC_ALL", "LC_CTYPE"):
        value = os.environ.get(key)
        if value:
            environment[key] = value
    return environment


def verify_bundled_codex_version(paths: AppPaths, expected_version: str) -> str:
    """Execute ``--version`` only in a fresh credential-free profile."""

    try:
        temp_root = select_safe_temp_root(
            os.environ,
            excluded_roots=(paths.repo_root, paths.home, paths.codex_home),
        )
    except PathTrustError as error:
        raise AppBootstrapError(str(error)) from error
    with tempfile.TemporaryDirectory(
        prefix="drclaw-bundled-codex-version-",
        dir=str(temp_root),
    ) as temporary:
        probe_root = Path(temporary)
        probe_home = probe_root / "home"
        probe_codex_home = probe_root / "codex-home"
        probe_work = probe_root / "empty-workspace"
        for directory in (probe_home, probe_codex_home, probe_work):
            directory.mkdir(mode=0o700)
        environment = secret_free_probe_env(
            probe_home,
            probe_codex_home,
            base_environment=bundled_codex_probe_environment(paths),
        )
        try:
            result = subprocess.run(
                [str(paths.node_binary), str(paths.codex_launcher), "--version"],
                cwd=str(probe_work),
                env=environment,
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise AppBootstrapError(
                f"Cannot execute the verified bundled Codex CLI: {type(error).__name__}"
            ) from error
    observed = result.stdout.strip()
    if result.returncode != 0 or observed != f"codex-cli {expected_version}":
        raise AppBootstrapError(
            f"Bundled Codex version mismatch: observed={observed!r}, expected='codex-cli {expected_version}'."
        )
    return observed


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
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONNOUSERSITE": "1",
            "CI": "1",
        }
    )
    environment.update(app_network_environment(os.environ))
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
        self.restarted_active_service = False
        self.service_preflight_complete = False
        self.service_was_active = False
        self.systemctl_path: Optional[str] = None
        self.preflight_managed_path_chains()

    def preflight_managed_path_chains(self) -> None:
        roots = [
            ("CODEX_HOME", self.codex_home),
            *(("application directory", path) for path in self.paths.managed_directories()),
            ("npm configuration", self.paths.npm_userconfig.parent),
            ("application environment", self.paths.env_file.parent),
            ("application launcher", self.paths.launcher.parent),
            ("application receipt", self.paths.receipt.parent),
        ]
        if not self.nonlogin_home and self.args.service != "none":
            roots.append(("user systemd directory", self.paths.unit_file.parent))
        for label, path in roots:
            validate_user_managed_path_chain(path, self.home, label)

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
            if self.paths.node_runtime_receipt.exists() or self.paths.node_runtime_receipt.is_symlink():
                validate_node_runtime_receipt(self.paths, self.manifest)
            else:
                legacy_layout = validate_legacy_application_runtime_receipt(
                    self.paths,
                    self.manifest,
                )
                if not self.args.dry_run:
                    write_node_runtime_receipt(self.paths, self.manifest, legacy_layout)
                    validate_node_runtime_receipt(self.paths, self.manifest)
                    self.event(
                        "MIGRATE",
                        self.paths.node_runtime_receipt,
                        "atomically added standalone receipt after validating the v0.1 app receipt",
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
                expected_version,
                self.paths.node_runtime_receipt.name,
                node_runtime_receipt_contract(self.paths, self.manifest),
            )
            validate_node_runtime_receipt(self.paths, self.manifest)
        finally:
            try:
                archive_path.unlink()
            except FileNotFoundError:
                pass
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
            ("npm ci from package-lock.json", npm["install"], "npm_install"),
            ("production frontend build", npm["build"], "npm_build"),
            ("native module preparation", npm["prepare_native"], "npm_prepare_native"),
            ("development dependency prune", npm["prune"], "npm_prune"),
        )
        for detail, command, timeout_name in commands:
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
                    timeout=command_timeout(self.manifest, timeout_name),
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
                    timeout=command_timeout(self.manifest, "npm_verify"),
                )
                json.loads(result.stdout)
            except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
                raise AppBootstrapError(f"Installed npm dependency verification failed: {error}") from error
            pruned_count = verify_pruned_development_dependencies(self.repo_root)
            if not (self.repo_root / "dist" / "index.html").is_file():
                raise AppBootstrapError("Production frontend build did not create dist/index.html.")
            self.event(
                "OK",
                self.repo_root / "node_modules",
                f"locked production dependencies verified; {pruned_count} development-only lock entries are absent",
            )

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
            "-I",
            "-S",
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
unset PYTHONHOME PYTHONPATH
export PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1
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
        systemctl = resolve_trusted_systemctl()
        if not systemctl:
            return False
        self.systemctl_path = systemctl
        try:
            result = run_user_systemctl(
                systemctl,
                ["show-environment"],
                self.home,
                self.manifest,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return result.returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False

    def user_service_is_active(self, systemctl: str) -> bool:
        try:
            result = run_user_systemctl(
                systemctl,
                ["is-active", str(self.manifest["service"]["unit_name"])],  # type: ignore[index]
                self.home,
                self.manifest,
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            if result.returncode == 0:
                return True
            if result.returncode in {3, 4}:
                return False
            raise AppBootstrapError(
                f"Cannot determine whether the managed user service is active (exit {result.returncode})."
            )
        except (OSError, subprocess.SubprocessError):
            raise AppBootstrapError("Cannot determine whether the managed user service is active.")

    def unit_content(self) -> str:
        return render_unit_content(self.paths, self.repo_root, self.manifest)

    def preflight_service_state(self) -> None:
        """Capture service liveness before npm or managed application files change."""

        if self.service_preflight_complete:
            return
        if self.nonlogin_home:
            if self.args.start:
                raise AppBootstrapError("--start is forbidden with an isolated/non-login --home.")
            self.service_preflight_complete = True
            return
        if self.args.service == "none":
            if self.args.start:
                raise AppBootstrapError("--start requires --service auto or --service user-systemd.")
            self.service_preflight_complete = True
            return
        self.systemd_ready = self.detect_user_systemd()
        if not self.systemd_ready:
            if self.args.service == "user-systemd":
                raise AppBootstrapError("A user systemd manager was required but is not available.")
            if self.args.start:
                raise AppBootstrapError("Cannot --start because the user systemd manager is unavailable.")
            self.service_preflight_complete = True
            return
        if not self.systemctl_path:
            self.systemctl_path = resolve_trusted_systemctl()
        if not self.systemctl_path:
            raise AppBootstrapError("User systemd was detected but systemctl disappeared.")
        self.service_was_active = self.user_service_is_active(self.systemctl_path)
        self.service_preflight_complete = True

    def configure_service(self) -> None:
        self.preflight_service_state()
        if self.nonlogin_home:
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
            return

        if not self.systemd_ready:
            self.service_result = "launcher-only-systemd-unavailable"
            self.event(
                "FALLBACK",
                self.paths.launcher,
                "user systemd is unavailable; no process was started; run launcher in an approved supervisor",
            )
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
        systemctl = self.systemctl_path
        assert systemctl is not None
        atomic_write(self.paths.unit_file, self.unit_content(), 0o600)
        try:
            run_user_systemctl(
                systemctl,
                ["daemon-reload"],
                self.home,
                self.manifest,
                check=True,
            )
            unit_name = str(self.manifest["service"]["unit_name"])  # type: ignore[index]
            run_user_systemctl(
                systemctl,
                ["enable", unit_name],
                self.home,
                self.manifest,
                check=True,
            )
            active_after_install = self.user_service_is_active(systemctl)
            should_restart = self.args.start or self.service_was_active or active_after_install
            if should_restart:
                # restart also starts an inactive unit and, unlike enable --now,
                # guarantees an already-running older checkout is replaced.
                run_user_systemctl(
                    systemctl,
                    ["restart", unit_name],
                    self.home,
                    self.manifest,
                    check=True,
                )
        except (OSError, subprocess.SubprocessError) as error:
            raise AppBootstrapError(f"Cannot configure user-systemd service: {error}") from error
        was_active = self.service_was_active or active_after_install
        self.restarted_active_service = bool(was_active)
        if self.args.start:
            self.service_result = "enabled-and-started"
        elif was_active:
            self.service_result = "enabled-and-restarted"
        else:
            self.service_result = "enabled-not-started"
        self.event(
            "INSTALL",
            self.paths.unit_file,
            "enabled user-systemd unit"
            + (
                " and restarted/started it"
                if self.args.start or was_active
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
        bundled_codex_layout: Dict[str, object] = {}
        if not self.args.dry_run:
            runtime_layout = validate_node_runtime_receipt(self.paths, self.manifest)
            bundled_codex_layout = validate_bundled_codex_layout(
                self.paths,
                self.repo_root,
                self.manifest,
            )
            bundled = self.manifest["bundled_codex"]
            assert isinstance(bundled, dict)
            bundled_codex_layout["observed_version"] = verify_bundled_codex_version(
                self.paths,
                str(bundled["version"]),
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
            "bundled_codex": bundled_codex_layout,
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
            "restarted_active_service": self.restarted_active_service,
        }
        if self.args.dry_run:
            self.event("DRY-RUN", self.paths.receipt, "would write secret-free installation receipt")
            return
        atomic_write(self.paths.receipt, json.dumps(state, indent=2, sort_keys=True) + "\n", 0o600)
        self.event("INSTALL", self.paths.receipt, "wrote secret-free installation receipt")

    def run(self) -> None:
        validate_app_python_runtime()
        app_network_environment(os.environ)
        validate_direct_app_host(self.paths)
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
        self.preflight_service_state()
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
        runtime_layout = validate_node_runtime_receipt(self.paths, self.manifest)
        validate_application_node_contract(
            recorded_runtime,
            self.paths,
            self.manifest,
            runtime_layout,
        )
        validate_repo(self.repo_root, self.manifest)
        if sha256_file(self.repo_root / "package-lock.json") != state.get(
            "package_lock_sha256"
        ):
            raise AppBootstrapError("Package lock digest differs from application receipt.")
        recorded_codex = state.get("bundled_codex")
        if not isinstance(recorded_codex, dict):
            raise AppBootstrapError("Application receipt has no bundled Codex runtime contract.")
        validate_bundled_codex_layout(
            self.paths,
            self.repo_root,
            self.manifest,
            recorded_codex,
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
        self.node_runtime_valid = False

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
            runtime_layout = validate_node_runtime_receipt(self.paths, self.manifest)
            validate_application_node_contract(
                recorded_node,
                self.paths,
                self.manifest,
                runtime_layout,
            )
            runtime_valid = True
            self.node_runtime_valid = True
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
                    timeout=command_timeout(self.manifest, "npm_verify"),
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
                    timeout=command_timeout(self.manifest, "npm_verify"),
                )
                json.loads(result.stdout)
                self.add("PASS", "dependencies", "production npm dependency graph is valid")
            except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
                self.add("FAIL", "dependencies", str(error))
            else:
                try:
                    pruned_count = verify_pruned_development_dependencies(self.repo_root)
                    self.add(
                        "PASS",
                        "development-prune",
                        f"{pruned_count} development-only lock entries are absent from node_modules",
                    )
                except AppBootstrapError as error:
                    self.add("FAIL", "development-prune", str(error))
        else:
            self.add("FAIL", "dependencies", "node_modules is missing or managed runtime contract failed")
            self.add("FAIL", "development-prune", "node_modules is missing or managed runtime contract failed")

    def approved_router_source(self) -> Path:
        installed = self.home / ".agents" / "skills" / "drclaw-skill-library"
        approved = (
            self.repo_root
            / "bootstrap"
            / "codex"
            / "skills"
            / "drclaw-skill-library"
        )
        parent_symlink = first_symlink_component(installed.parent)
        if parent_symlink is not None:
            raise AppBootstrapError(
                f"Installed router parent traverses a symlink: {parent_symlink}"
            )
        if not (approved / "SKILL.md").is_file() or approved.is_symlink():
            raise AppBootstrapError("Approved bundled router skill is missing or symlinked.")
        if installed.is_symlink():
            try:
                if installed.resolve(strict=True) != approved.resolve(strict=True):
                    raise AppBootstrapError("Installed router symlink does not target the approved bundle.")
            except OSError as error:
                raise AppBootstrapError("Installed router symlink is broken.") from error
        elif installed.is_dir():
            if directory_digest(installed) != directory_digest(approved):
                raise AppBootstrapError("Installed router copy differs from the approved bundle.")
        else:
            raise AppBootstrapError(f"Installed router skill is missing: {installed}")
        return installed

    def check_bundled_codex(self, state: Optional[Mapping[str, object]]) -> None:
        bundled = self.manifest.get("bundled_codex")
        assert isinstance(bundled, dict)
        required_probes = bundled["required_probes"]
        assert isinstance(required_probes, list)

        def fail_without_execution(detail: str) -> None:
            self.add("FAIL", "bundled-codex", detail)
            for name in required_probes:
                self.add(
                    "FAIL",
                    f"bundled-codex-contract:{name}",
                    "bundled runtime pre-execution validation failed; probe was not run",
                )

        try:
            if not self.node_runtime_valid:
                raise AppBootstrapError(
                    "Managed Node.js receipt/digest contract failed; bundled CLI was not executed."
                )
            validate_repo(self.repo_root, self.manifest)
            if not state:
                raise AppBootstrapError("Application receipt is unavailable.")
            current_lock = sha256_file(self.repo_root / "package-lock.json")
            if current_lock != state.get("package_lock_sha256"):
                raise AppBootstrapError(
                    "package-lock.json digest differs from the installed receipt; bundled CLI was not executed."
                )
            recorded = state.get("bundled_codex")
            if not isinstance(recorded, dict):
                raise AppBootstrapError("Receipt has no bundled Codex runtime contract.")
            layout = validate_bundled_codex_layout(
                self.paths,
                self.repo_root,
                self.manifest,
                recorded,
            )
            expected_version = str(bundled["version"])
            if recorded.get("observed_version") != f"codex-cli {expected_version}":
                raise AppBootstrapError("Receipt has no exact bundled Codex observed-version proof.")
            observed_version = verify_bundled_codex_version(
                self.paths,
                expected_version,
            )
            router = self.approved_router_source()
        except (OSError, AppBootstrapError) as error:
            fail_without_execution(str(error))
            return

        self.add(
            "PASS",
            "bundled-codex",
            f"{observed_version} at {layout['launcher_relative']} matches package lock and receipt digests",
        )
        results = run_codex_contracts(
            [str(self.paths.node_binary), str(self.paths.codex_launcher)],
            required_probes,
            config_template=BOOTSTRAP_ROOT / "templates" / "config.safe.toml",
            guidance_template=BOOTSTRAP_ROOT / "templates" / "global-agents.md",
            profile_name="safe",
            skill_sources={"drclaw-skill-library": router},
            base_environment=bundled_codex_probe_environment(self.paths),
            excluded_temp_roots=(self.repo_root, self.home, self.codex_home),
        )
        for name in required_probes:
            passed, detail = results.get(name, (False, "probe result unavailable"))
            self.add(
                "PASS" if passed else "FAIL",
                f"bundled-codex-contract:{name}",
                detail,
            )
        compatible = all(results.get(name, (False, ""))[0] for name in required_probes)
        self.add(
            "PASS" if compatible else "FAIL",
            "bundled-codex-compatibility",
            "all isolated extension contracts passed"
            if compatible
            else "one or more isolated extension contracts failed",
        )

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
            "enabled-and-restarted",
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
            try:
                systemctl = resolve_trusted_systemctl()
            except AppBootstrapError as error:
                self.add("FAIL", "service", str(error))
                return
            if not systemctl:
                self.add("FAIL", "service", "enabled-service receipt exists but systemctl is unavailable")
                return
            try:
                enabled = run_user_systemctl(
                    systemctl,
                    ["is-enabled", str(self.manifest["service"]["unit_name"])],  # type: ignore[index]
                    self.home,
                    self.manifest,
                    check=False,
                    capture_output=True,
                    text=True,
                )
            except (OSError, subprocess.SubprocessError, AppBootstrapError) as error:
                self.add("FAIL", "service", f"cannot query user-systemd enablement: {error}")
                return
            if enabled.returncode != 0 or enabled.stdout.strip() != "enabled":
                self.add("FAIL", "service", "managed user-systemd unit is not enabled")
                return
            self.add("PASS", "service-unit", f"canonical user-systemd unit is enabled ({service_state})")
            if service_state == "enabled-not-started":
                self.add("WARN", "service", "unit is enabled for a future login/boot but was not started by installer")
                return
            if service_state in {"enabled-and-started", "enabled-and-restarted"}:
                try:
                    active = run_user_systemctl(
                        systemctl,
                        ["is-active", str(self.manifest["service"]["unit_name"])],  # type: ignore[index]
                        self.home,
                        self.manifest,
                        check=False,
                        capture_output=True,
                        text=True,
                    )
                except (OSError, subprocess.SubprocessError, AppBootstrapError) as error:
                    self.add("FAIL", "service", f"cannot query user-systemd service: {error}")
                    return
                if active.returncode != 0 or active.stdout.strip() != "active":
                    self.add("FAIL", "service", "installer-restarted user service is not active")
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
        self.check_bundled_codex(state)
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
