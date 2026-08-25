#!/usr/bin/env python3
"""Idempotent, secret-free Codex bootstrap for the Dr. Claw environment."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import pwd
import re
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple


sys.dont_write_bytecode = True
_MODULE_DIR = Path(__file__).resolve().parent
if str(_MODULE_DIR) not in sys.path:
    sys.path.insert(0, str(_MODULE_DIR))
from codex_contracts import (  # noqa: E402 - supports direct script execution
    BEGIN_MARKER,
    END_MARKER,
    legacy_v01_peer_metadata_only_lock_drift,
    NetworkContractError,
    PathTrustError,
    parse_plugin_inventory,
    parse_prompt_input,
    read_only_git_command,
    read_only_git_environment,
    run_codex_contracts,
    sanitized_network_environment,
    sanitized_network_opener,
    secret_free_probe_env as build_secret_free_probe_env,
    select_safe_temp_root,
    validate_target_home_trust,
)


BUNDLE_DIR = _MODULE_DIR
MANIFEST_PATH = BUNDLE_DIR / "manifest.json"
TOML_SIMPLE_KEY = r'''(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')'''
ROOT_ASSIGNMENT_RE = re.compile(rf"^({TOML_SIMPLE_KEY})\s*=\s*(.+?)\s*$")
ANY_ASSIGNMENT_RE = re.compile(
    rf"^({TOML_SIMPLE_KEY}(?:\s*\.\s*{TOML_SIMPLE_KEY})*)\s*=\s*(.+?)\s*$"
)
CODEX_INSTALL_URL = "https://chatgpt.com/codex/install.sh"
CODEX_INSTALL_USER_AGENT = "DrClaw-Codex-Bootstrap/1.0"
CODEX_INSTALL_TIMEOUT_SECONDS = 900
HOSTNAME_TIMEOUT_SECONDS = 5
DELTA_DNS_SUFFIX = ".delta.ncsa.illinois.edu"
DRCLAW_CLI_LOCK_PATH = BUNDLE_DIR / "requirements-drclaw-cli.lock"
DRCLAW_CLI_ENVIRONMENT_SCHEMA = 1
DRCLAW_CLI_LOCKED_PACKAGES = {
    "certifi",
    "charset-normalizer",
    "click",
    "idna",
    "pip",
    "requests",
    "setuptools",
    "urllib3",
    "websockets",
    "wheel",
}
DRCLAW_CLI_BOOTSTRAP_PACKAGES: set = set()
DRCLAW_CLI_LAUNCHERS = {
    "drclaw": "drclaw",
    "dr-claw": "drclaw",
    "vibelab": "vibelab",
}
LEGACY_V01_CLI_ENTRY_POINTS = {
    "drclaw": "cli_anything.drclaw.drclaw_cli:cli",
    "dr-claw": "cli_anything.drclaw.drclaw_cli:cli",
    "vibelab": "cli_anything.drclaw.drclaw_cli:vibelab_cli",
}


class BootstrapError(RuntimeError):
    pass


def utc_stamp() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


def iso_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def load_manifest() -> Dict[str, object]:
    try:
        return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BootstrapError(f"Cannot read {MANIFEST_PATH}: {error}") from error


def find_repo_root() -> Path:
    for candidate in [BUNDLE_DIR, *BUNDLE_DIR.parents]:
        if (candidate / ".git").exists() and (candidate / "skills").is_dir():
            return candidate
    raise BootstrapError("The bootstrap bundle is not inside a Dr. Claw source checkout.")


def parse_version(value: str) -> Tuple[int, int, int]:
    match = re.search(r"(\d+)\.(\d+)(?:\.(\d+))?", value)
    if not match:
        return (0, 0, 0)
    return tuple(int(part or 0) for part in match.groups())  # type: ignore[return-value]


def codex_installer_request() -> urllib.request.Request:
    return urllib.request.Request(
        CODEX_INSTALL_URL,
        headers={
            "User-Agent": CODEX_INSTALL_USER_AGENT,
            "Accept": "text/x-shellscript, text/plain;q=0.9, */*;q=0.1",
        },
    )


def validate_python_tls_runtime() -> None:
    """Fail without target writes when an optional network install lacks SSL."""

    try:
        import ssl as ssl_module

        ssl_module.create_default_context()
    except Exception as error:
        raise BootstrapError(
            "This Python runtime lacks working TLS/SSL support required for the requested Codex/CLI install."
        ) from error


def credential_free_proxy_env(source: Mapping[str, str]) -> Dict[str, str]:
    """Return the shared credential-free proxy/CA contract."""

    try:
        return sanitized_network_environment(source)
    except NetworkContractError as error:
        raise BootstrapError(str(error)) from error


def bootstrap_temp_root(source: Mapping[str, str], *excluded_roots: Path) -> Path:
    try:
        return select_safe_temp_root(source, excluded_roots=excluded_roots)
    except PathTrustError as error:
        raise BootstrapError(str(error)) from error


def portable_codex_env(
    user_home: Path,
    codex_home: Path,
    source: Mapping[str, str],
    *,
    include_release: bool = False,
    trusted_path_entries: Sequence[str] = (),
) -> Dict[str, str]:
    """Environment for Codex operations that need state but never operator secrets."""

    path_entries: List[str] = []
    for entry in (
        str(user_home / ".local" / "bin"),
        *trusted_path_entries,
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
    ):
        if entry and entry not in path_entries:
            path_entries.append(entry)
    environment = {
        "HOME": str(user_home),
        "CODEX_HOME": str(codex_home),
        "PATH": os.pathsep.join(path_entries),
        "PYTHONDONTWRITEBYTECODE": "1",
    }
    for key in ("LANG", "LC_ALL", "LC_CTYPE"):
        value = source.get(key)
        if value and not any(control in value for control in ("\x00", "\n", "\r")):
            environment[key] = value
    environment.update(credential_free_proxy_env(source))
    if include_release:
        release = source.get("CODEX_RELEASE")
        if release:
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._+-]*", release):
                raise BootstrapError("CODEX_RELEASE contains unsupported characters.")
            environment["CODEX_RELEASE"] = release
    return environment


def path_chain_is_unprivileged_writable(path: Path, *, euid: Optional[int] = None) -> bool:
    """Return whether the effective user can replace/modify a shared-path component.

    Group/world-writable shared paths are rejected conservatively.  User-local
    ``~/.local/bin`` is handled as an explicit, intentional trust boundary by
    ``discover_codex_cli`` and does not call this helper.
    """

    effective_uid = os.geteuid() if euid is None else euid
    absolute = path if path.is_absolute() else Path("/") / path
    components = [absolute, *absolute.parents]
    for component in components:
        try:
            metadata = component.stat()
        except OSError:
            return True
        mode = metadata.st_mode
        if mode & (stat.S_IWGRP | stat.S_IWOTH):
            return True
        if metadata.st_uid == effective_uid and mode & stat.S_IWUSR:
            return True
    return False


def discover_codex_cli(
    user_home: Path,
    source: Mapping[str, str],
) -> Optional[Tuple[str, str, List[str]]]:
    """Find Codex on an absolute, controlled PATH and return execution metadata.

    The user-local official install location remains supported.  Site/module
    paths such as ``/opt/.../bin`` are accepted only when neither their lexical
    nor resolved path is writable by the target user (or group/world).  Empty
    and relative PATH entries are ignored so discovery can never fall back to
    the current working directory.
    """

    local_bin = (user_home / ".local" / "bin").absolute()
    source_entries: List[Path] = []
    for raw_entry in source.get("PATH", "").split(os.pathsep):
        if not raw_entry or any(control in raw_entry for control in ("\x00", "\n", "\r")):
            continue
        entry = Path(raw_entry)
        if not entry.is_absolute() or entry in source_entries:
            continue
        source_entries.append(entry)

    search_entries: List[Path] = []
    for entry in (local_bin, *source_entries, Path("/usr/local/bin"), Path("/usr/bin"), Path("/bin")):
        if entry not in search_entries:
            search_entries.append(entry)

    for directory in search_entries:
        candidate = directory / "codex"
        try:
            resolved = candidate.resolve(strict=True)
        except OSError:
            continue
        if not resolved.is_file() or not os.access(resolved, os.X_OK):
            continue
        user_local = directory == local_bin
        if not user_local and (
            path_chain_is_unprivileged_writable(candidate)
            or path_chain_is_unprivileged_writable(resolved)
        ):
            continue

        trusted_entries: List[str] = []
        for path_entry in (directory, resolved.parent, *source_entries):
            if path_entry == local_bin or not path_chain_is_unprivileged_writable(path_entry):
                value = str(path_entry)
                if value not in trusted_entries:
                    trusted_entries.append(value)
        return str(resolved), "user-local" if user_local else "site-path", trusted_entries
    return None


def codex_installer_opener(source: Mapping[str, str]) -> urllib.request.OpenerDirector:
    try:
        return sanitized_network_opener(source)
    except NetworkContractError as error:
        raise BootstrapError(str(error)) from error


def is_delta_hostname(hostname: str) -> bool:
    normalized = hostname.rstrip(".").lower()
    return normalized == DELTA_DNS_SUFFIX[1:] or normalized.endswith(DELTA_DNS_SUFFIX)


def bounded_fqdn() -> str:
    """Read the live FQDN through a bounded absolute command, never NSS in-process."""

    hostname_command = next(
        (
            path
            for path in (Path("/usr/bin/hostname"), Path("/bin/hostname"))
            if path.is_file()
            and os.access(path, os.X_OK)
            and not path_chain_is_unprivileged_writable(path)
        ),
        None,
    )
    if hostname_command is None:
        return ""
    try:
        result = subprocess.run(
            [str(hostname_command), "-f"],
            check=False,
            capture_output=True,
            text=True,
            timeout=HOSTNAME_TIMEOUT_SECONDS,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    hostname = result.stdout.strip().rstrip(".").lower()
    if (
        result.returncode != 0
        or not hostname
        or any(control in hostname for control in ("\x00", "\n", "\r"))
        or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", hostname)
    ):
        return ""
    return hostname


def is_login_home(user_home: Path) -> bool:
    """Live cluster probes are meaningful only for the real login profile."""

    try:
        return user_home.resolve() == Path(pwd.getpwuid(os.geteuid()).pw_dir).resolve()
    except (KeyError, OSError):
        return False


def normalize_architecture(machine: str) -> str:
    """Normalize Linux uname aliases to the manifest's canonical architecture."""

    normalized = machine.strip().lower()
    return {
        "amd64": "x86_64",
        "x86_64": "x86_64",
        "arm64": "aarch64",
        "aarch64": "aarch64",
    }.get(normalized, normalized)


def verify_live_delta_identity(*, cwd: Optional[Path] = None) -> Dict[str, str]:
    """Fail closed unless the live host is the audited NCSA Delta environment."""

    hostname = bounded_fqdn()
    machine = normalize_architecture(platform.machine())
    if not is_delta_hostname(hostname):
        raise BootstrapError("current-delta requires a live host in the delta.ncsa.illinois.edu DNS domain.")
    if machine != "x86_64":
        raise BootstrapError("current-delta requires the audited x86_64 Delta architecture.")
    scontrol_path = shutil.which("scontrol")
    if scontrol_path:
        scontrol_candidate = Path(scontrol_path)
        try:
            scontrol_candidate = scontrol_candidate.resolve(strict=True)
        except OSError:
            scontrol_path = None
        else:
            if (
                not Path(scontrol_path).is_absolute()
                or not scontrol_candidate.is_file()
                or not os.access(scontrol_candidate, os.X_OK)
                or path_chain_is_unprivileged_writable(Path(scontrol_path))
                or path_chain_is_unprivileged_writable(scontrol_candidate)
            ):
                scontrol_path = None
            else:
                scontrol_path = str(scontrol_candidate)
    if not scontrol_path:
        raise BootstrapError("current-delta requires the live scontrol command.")
    try:
        result = subprocess.run(
            [scontrol_path, "show", "config"],
            check=False,
            capture_output=True,
            text=True,
            timeout=10,
            cwd=str(cwd) if cwd else None,
            env={"PATH": "/usr/local/bin:/usr/bin:/bin"},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise BootstrapError(
            f"current-delta live Slurm identity probe failed: {type(error).__name__}."
        ) from error
    clusters = re.findall(r"^\s*ClusterName\s*=\s*([^\s]+)\s*$", result.stdout, re.MULTILINE)
    if result.returncode != 0 or clusters != ["delta"]:
        raise BootstrapError("current-delta live Slurm identity did not confirm exact ClusterName=delta.")
    return {"fqdn": hostname, "architecture": machine, "cluster_name": "delta"}


def validate_executable_target_filesystems(user_home: Path) -> None:
    """Fail before install writes when managed executable targets are on noexec."""

    noexec_flag = getattr(os, "ST_NOEXEC", None)
    if noexec_flag is None:
        raise BootstrapError("Python cannot determine whether managed executable filesystems allow execution.")
    for target in (
        user_home / ".local" / "bin",
        user_home / ".local" / "share" / "drclaw",
    ):
        parent = target
        while not parent.exists() and parent != parent.parent:
            parent = parent.parent
        try:
            filesystem = os.statvfs(parent)
        except OSError as error:
            raise BootstrapError("Cannot inspect the managed executable target filesystem.") from error
        if filesystem.f_flag & noexec_flag:
            raise BootstrapError("Managed executable target filesystem is mounted noexec.")


def validate_user_managed_directory_chain(user_home: Path, path: Path, label: str) -> None:
    """Validate every existing managed-path component below an approved HOME."""

    try:
        relative = path.absolute().relative_to(user_home.absolute())
    except ValueError as error:
        raise BootstrapError(f"Managed {label} path escapes the target HOME.") from error
    current = user_home
    for component in relative.parts:
        current /= component
        if not os.path.lexists(current):
            break
        try:
            info = os.lstat(current)
        except OSError as error:
            raise BootstrapError(f"Cannot inspect managed {label} path chain.") from error
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise BootstrapError(f"Managed {label} path chain contains a symlink/non-directory.")
        if info.st_uid != os.geteuid():
            raise BootstrapError(f"Managed {label} path chain is not owned by the current user.")
        if stat.S_IMODE(info.st_mode) & 0o022:
            raise BootstrapError(
                f"Managed {label} path chain is group/world writable (writable by group/other)."
            )


def normalize_toml_key(raw_key: str) -> str:
    """Normalize one simple quoted/bare TOML key for managed-key matching."""

    raw_key = raw_key.strip()
    if len(raw_key) >= 2 and raw_key[0] == raw_key[-1] == "'":
        return raw_key[1:-1]
    if len(raw_key) >= 2 and raw_key[0] == raw_key[-1] == '"':
        inner = raw_key[1:-1]
        inner = re.sub(
            r"\\U([0-9A-Fa-f]{8})",
            lambda match: chr(int(match.group(1), 16)),
            inner,
        )
        try:
            return str(json.loads(f'"{inner}"'))
        except (ValueError, json.JSONDecodeError):
            return raw_key
    return raw_key


def ensure_python() -> None:
    if sys.version_info < (3, 9):
        raise BootstrapError("Python 3.9 or newer is required.")


def resolve_homes(args: argparse.Namespace) -> Tuple[Path, Path, Path]:
    if os.geteuid() == 0:
        raise BootstrapError("Refusing to provision as root; run as the target Unix user (for example, sudo -iu USER).")

    if args.home:
        raw_user_home = Path(args.home).expanduser().absolute()
        symlink = first_symlink_component(raw_user_home)
        if symlink:
            raise BootstrapError(f"Refusing explicit --home path through symlink component {symlink}.")
        user_home = raw_user_home.resolve()
    else:
        raw_user_home = Path.home().absolute()
        symlink = first_symlink_component(raw_user_home)
        if symlink:
            raise BootstrapError(f"Refusing default HOME path through symlink component {symlink}.")
        user_home = raw_user_home.resolve()
    preliminary_forbidden = {
        Path("/"), Path("/bin"), Path("/boot"), Path("/dev"), Path("/etc"),
        Path("/home"), Path("/lib"), Path("/lib64"), Path("/opt"), Path("/proc"),
        Path("/root"), Path("/run"), Path("/sbin"), Path("/sys"), Path("/tmp"),
        Path("/u"), Path("/usr"), Path("/var"),
    }
    if user_home in preliminary_forbidden:
        raise BootstrapError(f"Refusing broad/system --home target: {user_home}")
    preliminary_protected = preliminary_forbidden - {Path("/"), Path("/home"), Path("/tmp"), Path("/u")}
    if any(root in user_home.parents for root in preliminary_protected):
        raise BootstrapError(f"Refusing protected system --home target: {user_home}")
    try:
        validate_target_home_trust(user_home)
    except PathTrustError as error:
        raise BootstrapError(str(error)) from error
    if args.codex_home:
        raw_codex_home = Path(args.codex_home).expanduser().absolute()
        symlink = first_symlink_component(raw_codex_home)
        if symlink:
            raise BootstrapError(f"Refusing explicit --codex-home path through symlink component {symlink}.")
        codex_home = raw_codex_home.resolve()
    elif args.home:
        codex_home = user_home / ".codex"
    elif os.environ.get("CODEX_HOME"):
        raw_codex_home = Path(os.environ["CODEX_HOME"]).expanduser().absolute()
        symlink = first_symlink_component(raw_codex_home)
        if symlink:
            raise BootstrapError(f"Refusing CODEX_HOME path through symlink component {symlink}.")
        codex_home = raw_codex_home.resolve()
    else:
        codex_home = user_home / ".codex"
    forbidden_roots = {
        Path("/"), Path("/bin"), Path("/boot"), Path("/dev"), Path("/etc"),
        Path("/home"), Path("/lib"), Path("/lib64"), Path("/opt"), Path("/proc"),
        Path("/root"), Path("/run"), Path("/sbin"), Path("/sys"), Path("/tmp"),
        Path("/u"), Path("/usr"), Path("/var"),
    }
    for label, candidate in (("home", user_home), ("codex-home", codex_home)):
        if candidate in forbidden_roots:
            raise BootstrapError(f"Refusing broad/system --{label} target: {candidate}")
        protected_trees = [
            Path("/bin"), Path("/boot"), Path("/dev"), Path("/etc"), Path("/lib"),
            Path("/lib64"), Path("/opt"), Path("/proc"), Path("/root"), Path("/run"),
            Path("/sbin"), Path("/sys"), Path("/usr"), Path("/var"),
        ]
        if any(root == candidate or root in candidate.parents for root in protected_trees):
            raise BootstrapError(f"Refusing protected system --{label} target: {candidate}")
    if codex_home == user_home:
        raise BootstrapError("Refusing to use the entire user home as CODEX_HOME.")
    try:
        codex_relative = codex_home.relative_to(user_home)
    except ValueError as error:
        raise BootstrapError(
            "CODEX_HOME must be a dedicated path inside the target user home."
        ) from error
    current = user_home
    components: List[Path] = []
    for part in codex_relative.parts:
        current /= part
        components.append(current)
    for current in components:
        if not os.path.lexists(current):
            break
        if current.is_symlink():
            raise BootstrapError(f"CODEX_HOME path component is a symlink: {current}")
        if not current.is_dir():
            raise BootstrapError(f"CODEX_HOME path component is not a real directory: {current}")
        metadata = current.stat()
        if metadata.st_uid != os.geteuid():
            raise BootstrapError(f"CODEX_HOME path component is not user-owned: {current}")
        if metadata.st_mode & 0o022:
            raise BootstrapError(
                f"CODEX_HOME path component is group/world writable: {current}"
            )
    user_skills = user_home / ".agents" / "skills"
    return user_home, codex_home, user_skills


def atomic_write(path: Path, content: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def fsync_directory(path: Path) -> None:
    """Make transaction metadata durable before old managed data is discarded."""

    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    try:
        descriptor = os.open(path, flags)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    except OSError as error:
        raise BootstrapError("Cannot durably synchronize a managed transaction directory.") from error


def first_symlink_component(path: Path) -> Optional[Path]:
    """Return the first existing symlink in an absolute path chain."""

    absolute = path.absolute()
    current = Path(absolute.anchor)
    for part in absolute.parts[1:]:
        current /= part
        if os.path.lexists(current) and current.is_symlink():
            return current
    return None


def global_agents_override_shadow(codex_home: Path) -> Tuple[bool, str]:
    """Report whether the user-owned global override can shadow AGENTS.md.

    Codex gives a non-empty ``AGENTS.override.md`` precedence over ``AGENTS.md``
    at global scope.  Inspect only whether non-whitespace content exists; never
    retain or report the user-owned contents.
    """

    override_path = codex_home / "AGENTS.override.md"
    if not os.path.lexists(override_path):
        return False, "AGENTS.override.md is absent"
    if override_path.is_symlink():
        return True, "AGENTS.override.md is a symlink, so effective guidance cannot be proven"
    if not override_path.is_file():
        return True, "AGENTS.override.md is not a regular file"
    try:
        with override_path.open("r", encoding="utf-8", errors="replace") as handle:
            for chunk in iter(lambda: handle.read(64 * 1024), ""):
                if any(not character.isspace() for character in chunk):
                    return True, "non-empty AGENTS.override.md shadows the managed AGENTS.md"
    except OSError:
        return True, "AGENTS.override.md is unreadable, so effective guidance cannot be proven"
    return False, "AGENTS.override.md is empty"


def directory_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        relative = path.relative_to(root)
        if "__pycache__" in relative.parts or path.suffix == ".pyc":
            continue
        digest.update(str(relative).encode("utf-8"))
        digest.update(oct(path.lstat().st_mode & 0o777).encode("ascii"))
        if path.is_symlink():
            digest.update(b"L")
            digest.update(os.readlink(path).encode("utf-8"))
        elif path.is_file():
            digest.update(b"F")
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                    digest.update(chunk)
        elif path.is_dir():
            digest.update(b"D")
    return digest.hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_package_name(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_drclaw_cli_lock(path: Path = DRCLAW_CLI_LOCK_PATH) -> Dict[str, str]:
    """Parse the deliberately small, exact, hash-locked CLI dependency set."""

    if path.is_symlink() or not path.is_file():
        raise BootstrapError(f"Dr. Claw CLI dependency lock must be a regular file: {path}")
    dependencies: Dict[str, str] = {}
    line_pattern = re.compile(
        r"^([A-Za-z0-9_.-]+)==([^\s]+)(?:\s+--hash=sha256:[0-9a-f]{64})+$"
    )
    for line_number, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = line_pattern.fullmatch(line)
        if not match:
            raise BootstrapError(
                f"Invalid unhashed or non-exact Dr. Claw CLI lock entry at {path}:{line_number}"
            )
        name = canonical_package_name(match.group(1))
        if name in dependencies:
            raise BootstrapError(f"Duplicate Dr. Claw CLI dependency in {path}: {name}")
        dependencies[name] = match.group(2)
    if set(dependencies) != DRCLAW_CLI_LOCKED_PACKAGES:
        missing = sorted(DRCLAW_CLI_LOCKED_PACKAGES - set(dependencies))
        unexpected = sorted(set(dependencies) - DRCLAW_CLI_LOCKED_PACKAGES)
        raise BootstrapError(
            "Dr. Claw CLI dependency lock package set differs from the audited closure"
            f" (missing={missing}, unexpected={unexpected})."
        )
    return dependencies


def drclaw_cli_subprocess_env(
    home: Path,
    cache: Path,
    temporary: Path,
    source: Optional[Mapping[str, str]] = None,
) -> Dict[str, str]:
    """Return a minimal pip/Python environment with no inherited credentials."""

    environment = {
        "HOME": str(home),
        "LANG": "C",
        "LC_ALL": "C",
        "PATH": os.defpath,
        "PIP_CACHE_DIR": str(cache),
        "PIP_CONFIG_FILE": os.devnull,
        "PIP_DISABLE_PIP_VERSION_CHECK": "1",
        "PIP_NO_INPUT": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
        "TMPDIR": str(temporary),
    }
    if source:
        environment.update(credential_free_proxy_env(source))
    return environment


def drclaw_cli_runner_content() -> str:
    return """from __future__ import annotations

import sys
import os
from pathlib import Path

_SOURCE_ROOT = Path(__file__).resolve().parent / "source"
_REPO_ROOT_TEXT = (Path(__file__).resolve().parent / "repo-root").read_text(encoding="utf-8")
if not _REPO_ROOT_TEXT.endswith("\\n") or "\\n" in _REPO_ROOT_TEXT[:-1]:
    raise SystemExit("invalid managed Dr. Claw repository pointer")
_REPO_ROOT = _REPO_ROOT_TEXT[:-1]
sys.path.insert(0, str(_SOURCE_ROOT))
os.environ["DRCLAW_SERVER_PATH"] = _REPO_ROOT
from cli_anything.drclaw.drclaw_cli import cli, vibelab_cli


def main() -> None:
    if len(sys.argv) < 2 or sys.argv[1] not in {"drclaw", "vibelab"}:
        raise SystemExit("invalid managed Dr. Claw CLI entry point")
    entry_point = sys.argv.pop(1)
    sys.argv[0] = entry_point
    (vibelab_cli if entry_point == "vibelab" else cli)()


if __name__ == "__main__":
    main()
"""


def drclaw_cli_launcher_content(python_path: Path, runner_path: Path, entry_point: str) -> str:
    python_literal = shlex.quote(str(python_path))
    runner_literal = shlex.quote(str(runner_path))
    entry_literal = shlex.quote(entry_point)
    return (
        "#!/bin/sh\n"
        "unset PYTHONHOME PYTHONPATH DRCLAW_SERVER_PATH\n"
        "export PYTHONDONTWRITEBYTECODE=1 PYTHONNOUSERSITE=1\n"
        f"exec {python_literal} {runner_literal} {entry_literal} \"$@\"\n"
    )


def drclaw_cli_runtime_smoke(
    python_path: Path,
    runner_path: Path,
    source_root: Path,
    environment: Dict[str, str],
    cwd: Path,
) -> Dict[str, object]:
    """Import the sealed CLI and exercise each distinct managed entry point."""

    expected_module = (source_root / "cli_anything" / "drclaw" / "drclaw_cli.py").resolve()
    script = (
        "import importlib, json, os, sys; "
        "probe_marker='managed_cli_import_probe'; "
        "sys.path.insert(0, sys.argv[1]); "
        "module=importlib.import_module('cli_anything.drclaw.drclaw_cli'); "
        "importlib.import_module('click'); importlib.import_module('requests'); "
        "importlib.import_module('websockets'); "
        "print(json.dumps({'module_file': os.path.realpath(module.__file__)}, sort_keys=True))"
    )
    try:
        result = subprocess.run(
            [str(python_path), "-c", script, str(source_root)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
            env=environment,
            cwd=str(cwd),
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise BootstrapError(
            "Managed Dr. Claw CLI import smoke test could not run; command output was "
            f"intentionally suppressed ({type(error).__name__})."
        ) from error
    if result.returncode != 0:
        raise BootstrapError(
            f"Managed Dr. Claw CLI import smoke test failed (exit {result.returncode}); "
            "command output was intentionally suppressed."
        )
    try:
        import_identity = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise BootstrapError("Managed Dr. Claw CLI import smoke output is not valid JSON.") from error
    if import_identity != {"module_file": str(expected_module)}:
        raise BootstrapError("Managed Dr. Claw CLI imported from outside its sealed source snapshot.")

    entry_points = sorted(set(DRCLAW_CLI_LAUNCHERS.values()))
    for entry_point in entry_points:
        try:
            help_result = subprocess.run(
                [str(python_path), str(runner_path), entry_point, "--help"],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=30,
                env=environment,
                cwd=str(cwd),
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise BootstrapError(
                f"Managed Dr. Claw CLI entry point {entry_point} could not run "
                f"({type(error).__name__}); command output was intentionally suppressed."
            ) from error
        if help_result.returncode != 0:
            raise BootstrapError(
                f"Managed Dr. Claw CLI entry point {entry_point} failed its help smoke test "
                f"(exit {help_result.returncode}); command output was intentionally suppressed."
            )
    return {"module_file": str(expected_module), "entry_points": entry_points}


def drclaw_cli_distribution_inventory(
    python_path: Path,
    environment: Dict[str, str],
    cwd: Path,
) -> Dict[str, str]:
    script = (
        "import importlib.metadata as m, json, re; "
        "norm=lambda value: re.sub(r'[-_.]+', '-', value).lower(); "
        "print(json.dumps({norm(d.metadata['Name']): d.version for d in m.distributions() "
        "if d.metadata.get('Name')}, sort_keys=True))"
    )
    result = subprocess.run(
        [str(python_path), "-c", script],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
        env=environment,
        cwd=str(cwd),
    )
    if result.returncode != 0:
        raise BootstrapError(
            f"Cannot inspect the managed Dr. Claw CLI dependency environment (exit {result.returncode}); "
            "command output was intentionally suppressed."
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise BootstrapError("Managed Dr. Claw CLI dependency inventory is not valid JSON.") from error
    if not isinstance(payload, dict) or any(
        not isinstance(name, str) or not isinstance(version, str)
        for name, version in payload.items()
    ):
        raise BootstrapError("Managed Dr. Claw CLI dependency inventory has an invalid shape.")
    return {canonical_package_name(name): version for name, version in payload.items()}


def drclaw_cli_python_identity(
    python_path: Path,
    environment: Dict[str, str],
    cwd: Path,
) -> Dict[str, object]:
    script = (
        "import json, os, platform, sys; "
        "print(json.dumps({'version': list(sys.version_info[:3]), "
        "'cache_tag': sys.implementation.cache_tag, 'system': platform.system(), "
        "'machine': platform.machine(), 'executable': sys.executable, "
        "'resolved_executable': os.path.realpath(sys.executable)}, sort_keys=True))"
    )
    result = subprocess.run(
        [str(python_path), "-c", script],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
        env=environment,
        cwd=str(cwd),
    )
    if result.returncode != 0:
        raise BootstrapError(
            f"Cannot inspect the managed Dr. Claw CLI Python runtime (exit {result.returncode}); "
            "command output was intentionally suppressed."
        )
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as error:
        raise BootstrapError("Managed Dr. Claw CLI Python identity is not valid JSON.") from error
    if not isinstance(payload, dict):
        raise BootstrapError("Managed Dr. Claw CLI Python identity has an invalid shape.")
    return payload


def path_is_within(path: Path, root: Path) -> bool:
    try:
        path.absolute().relative_to(root.absolute())
        return True
    except ValueError:
        return False


def validate_drclaw_cli_state_shape(value: object) -> Dict[str, object]:
    if not isinstance(value, dict):
        raise BootstrapError("bootstrap state drclaw_cli field is not an object")
    expected_keys = {
        "environment_id",
        "environment_root",
        "git_revision",
        "git_dirty",
        "git_status_sha256",
        "repo_root",
        "repo_root_sha256",
        "source_sha256",
        "lock_sha256",
        "receipt_sha256",
        "launchers",
    }
    if set(value) != expected_keys:
        raise BootstrapError("bootstrap state drclaw_cli field has an unexpected key set")
    for field in ("environment_id", "environment_root", "git_revision", "repo_root"):
        field_value = value.get(field)
        if (
            not isinstance(field_value, str)
            or not field_value
            or any(character in field_value for character in "\x00\r\n")
        ):
            raise BootstrapError(f"bootstrap state drclaw_cli {field} is invalid")
    if value.get("git_dirty") is not None and not isinstance(value.get("git_dirty"), bool):
        raise BootstrapError("bootstrap state drclaw_cli git_dirty is invalid")
    for field in (
        "git_status_sha256",
        "repo_root_sha256",
        "source_sha256",
        "lock_sha256",
        "receipt_sha256",
    ):
        digest = value.get(field)
        if field == "git_status_sha256" and digest is None:
            continue
        if not isinstance(digest, str) or re.fullmatch(r"[0-9a-f]{64}", digest) is None:
            raise BootstrapError(f"bootstrap state drclaw_cli {field} is not a SHA-256 digest")
    launchers = value.get("launchers")
    if not isinstance(launchers, dict) or set(launchers) != set(DRCLAW_CLI_LAUNCHERS):
        raise BootstrapError("bootstrap state drclaw_cli launcher set is invalid")
    for name, launcher in launchers.items():
        if not isinstance(launcher, dict) or set(launcher) != {"path", "sha256"}:
            raise BootstrapError(f"bootstrap state drclaw_cli launcher is invalid: {name}")
        path_value = launcher.get("path")
        digest = launcher.get("sha256")
        if (
            not isinstance(path_value, str)
            or not Path(path_value).is_absolute()
            or any(character in path_value for character in "\x00\r\n")
            or not isinstance(digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", digest) is None
        ):
            raise BootstrapError(f"bootstrap state drclaw_cli launcher contract is invalid: {name}")
    return value


def validate_drclaw_cli_environment(
    environment_root: Path,
    subprocess_environment: Dict[str, str],
    expected_contract: Optional[Dict[str, object]] = None,
) -> Dict[str, object]:
    """Fail closed unless an immutable CLI environment matches its own receipt."""

    symlink = first_symlink_component(environment_root)
    if symlink:
        raise BootstrapError(f"Managed Dr. Claw CLI environment crosses symlink {symlink}.")
    if not environment_root.is_dir() or environment_root.stat().st_uid != os.geteuid():
        raise BootstrapError(f"Managed Dr. Claw CLI environment is missing or not user-owned: {environment_root}")
    if environment_root.stat().st_mode & 0o077:
        raise BootstrapError(f"Managed Dr. Claw CLI environment is not private (expected mode 700): {environment_root}")

    receipt_path = environment_root / "receipt.json"
    if receipt_path.is_symlink() or not receipt_path.is_file():
        raise BootstrapError(f"Managed Dr. Claw CLI receipt is missing or symlinked: {receipt_path}")
    if receipt_path.stat().st_uid != os.geteuid() or receipt_path.stat().st_mode & 0o077:
        raise BootstrapError(f"Managed Dr. Claw CLI receipt must be user-owned and private: {receipt_path}")
    try:
        receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BootstrapError(f"Managed Dr. Claw CLI receipt is invalid: {type(error).__name__}") from error
    if not isinstance(receipt, dict) or receipt.get("schema_version") != DRCLAW_CLI_ENVIRONMENT_SCHEMA:
        raise BootstrapError("Managed Dr. Claw CLI receipt has an unsupported schema.")
    if receipt.get("environment_id") != environment_root.name:
        raise BootstrapError("Managed Dr. Claw CLI receipt environment identity differs from its directory.")
    if Path(str(receipt.get("environment_root", ""))) != environment_root:
        raise BootstrapError("Managed Dr. Claw CLI receipt environment path differs from its directory.")

    source_root = environment_root / "source"
    lock_path = environment_root / "requirements.lock"
    repo_root_path = environment_root / "repo-root"
    runner_path = environment_root / "runner.py"
    python_path = environment_root / "venv" / "bin" / "python"
    expected_paths = {
        "source_root": source_root,
        "lock_path": lock_path,
        "repo_root_path": repo_root_path,
        "runner_path": runner_path,
    }
    for field, expected_path in expected_paths.items():
        if Path(str(receipt.get(field, ""))) != expected_path:
            raise BootstrapError(f"Managed Dr. Claw CLI receipt {field} differs from the sealed layout.")
    if not source_root.is_dir() or source_root.is_symlink():
        raise BootstrapError("Managed Dr. Claw CLI source snapshot is missing or symlinked.")
    source_symlink = next((path for path in source_root.rglob("*") if path.is_symlink()), None)
    if source_symlink:
        raise BootstrapError(f"Managed Dr. Claw CLI source snapshot contains symlink {source_symlink}.")
    source_digest = directory_digest(source_root)
    if receipt.get("source_sha256") != source_digest:
        raise BootstrapError("Managed Dr. Claw CLI source snapshot drifted from its receipt.")
    locked_dependencies = parse_drclaw_cli_lock(lock_path)
    lock_digest = sha256_file(lock_path)
    if receipt.get("lock_sha256") != lock_digest:
        raise BootstrapError("Managed Dr. Claw CLI dependency lock drifted from its receipt.")
    if receipt.get("locked_dependencies") != locked_dependencies:
        raise BootstrapError("Managed Dr. Claw CLI locked dependency set differs from its receipt.")
    if repo_root_path.is_symlink() or not repo_root_path.is_file():
        raise BootstrapError("Managed Dr. Claw CLI repository pointer is missing or symlinked.")
    if receipt.get("repo_root_sha256") != sha256_file(repo_root_path):
        raise BootstrapError("Managed Dr. Claw CLI repository pointer drifted from its receipt.")
    recorded_repo_root = Path(str(receipt.get("repo_root", "")))
    if repo_root_path.read_text(encoding="utf-8") != str(recorded_repo_root) + "\n":
        raise BootstrapError("Managed Dr. Claw CLI repository pointer content drifted.")
    recorded_repo_symlink = first_symlink_component(recorded_repo_root)
    if recorded_repo_symlink:
        raise BootstrapError(
            f"Managed Dr. Claw CLI versioned server checkout crosses symlink {recorded_repo_symlink}."
        )
    server_entry = recorded_repo_root / "server" / "index.js"
    if (
        not recorded_repo_root.is_absolute()
        or not recorded_repo_root.is_dir()
        or recorded_repo_root.stat().st_uid != os.geteuid()
        or server_entry.is_symlink()
        or not server_entry.is_file()
    ):
        raise BootstrapError("Managed Dr. Claw CLI versioned server checkout is missing or incomplete.")
    recorded_repo_git = git_state(recorded_repo_root)
    if (
        receipt.get("git_revision") != str(recorded_repo_git.get("revision") or "unversioned")
        or receipt.get("git_dirty") != recorded_repo_git.get("dirty")
        or receipt.get("git_status_sha256") != recorded_repo_git.get("status_sha256")
    ):
        raise BootstrapError("Managed Dr. Claw CLI versioned server checkout drifted from its receipt.")
    if runner_path.is_symlink() or not runner_path.is_file():
        raise BootstrapError("Managed Dr. Claw CLI runner is missing or symlinked.")
    expected_runner = drclaw_cli_runner_content()
    if runner_path.read_text(encoding="utf-8") != expected_runner:
        raise BootstrapError("Managed Dr. Claw CLI runner content drifted.")
    if receipt.get("runner_sha256") != sha256_file(runner_path):
        raise BootstrapError("Managed Dr. Claw CLI runner digest differs from its receipt.")

    if not python_path.exists() or not os.access(python_path, os.X_OK):
        raise BootstrapError(f"Managed Dr. Claw CLI Python is missing or not executable: {python_path}")
    recorded_python = receipt.get("python")
    if not isinstance(recorded_python, dict):
        raise BootstrapError("Managed Dr. Claw CLI receipt has no Python runtime contract.")
    observed_python = drclaw_cli_python_identity(
        python_path,
        subprocess_environment,
        environment_root,
    )
    if recorded_python != observed_python:
        raise BootstrapError("Managed Dr. Claw CLI Python runtime drifted from its receipt.")
    if Path(str(observed_python.get("executable", ""))) != python_path:
        raise BootstrapError("Managed Dr. Claw CLI Python reports an unexpected lexical executable.")
    if Path(str(observed_python.get("resolved_executable", ""))) != python_path.resolve():
        raise BootstrapError("Managed Dr. Claw CLI Python resolved target drifted from its receipt.")

    observed_distributions = drclaw_cli_distribution_inventory(
        python_path,
        subprocess_environment,
        environment_root,
    )
    for name, version in locked_dependencies.items():
        if observed_distributions.get(name) != version:
            raise BootstrapError(
                f"Managed Dr. Claw CLI dependency drift: {name} is not the locked version {version}."
            )
    unexpected = set(observed_distributions) - set(locked_dependencies) - DRCLAW_CLI_BOOTSTRAP_PACKAGES
    if unexpected:
        raise BootstrapError(
            "Managed Dr. Claw CLI environment contains unexpected distributions: "
            + ", ".join(sorted(unexpected))
        )
    if receipt.get("observed_distributions") != observed_distributions:
        raise BootstrapError("Managed Dr. Claw CLI installed distribution graph drifted from its receipt.")
    pip_check = subprocess.run(
        [str(python_path), "-m", "pip", "check"],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=30,
        env=subprocess_environment,
        cwd=str(environment_root),
    )
    if pip_check.returncode != 0:
        raise BootstrapError(
            f"Managed Dr. Claw CLI dependency consistency check failed (exit {pip_check.returncode}); "
            "command output was intentionally suppressed."
        )
    drclaw_cli_runtime_smoke(
        python_path,
        runner_path,
        source_root,
        subprocess_environment,
        environment_root,
    )

    launchers = receipt.get("launchers")
    if not isinstance(launchers, dict) or set(launchers) != set(DRCLAW_CLI_LAUNCHERS):
        raise BootstrapError("Managed Dr. Claw CLI receipt launcher set is invalid.")
    for launcher_name, entry_point in DRCLAW_CLI_LAUNCHERS.items():
        launcher = launchers.get(launcher_name)
        if not isinstance(launcher, dict):
            raise BootstrapError(f"Managed Dr. Claw CLI launcher receipt is invalid: {launcher_name}")
        expected_content = drclaw_cli_launcher_content(python_path, runner_path, entry_point)
        if launcher.get("sha256") != hashlib.sha256(expected_content.encode("utf-8")).hexdigest():
            raise BootstrapError(f"Managed Dr. Claw CLI launcher template digest drifted: {launcher_name}")

    if expected_contract:
        for key in (
            "bundle_version",
            "environment_id",
            "git_dirty",
            "git_revision",
            "git_status_sha256",
            "lock_sha256",
            "repo_root",
            "runner_sha256",
            "source_sha256",
        ):
            if receipt.get(key) != expected_contract.get(key):
                raise BootstrapError(f"Managed Dr. Claw CLI environment {key} differs from this bundle.")
    return receipt


def config_assignments(path: Path) -> Dict[str, str]:
    if not path.exists():
        return {}
    content = path.read_text(encoding="utf-8", errors="replace")
    if content.startswith("\ufeff"):
        content = content[1:]
    lines = content.splitlines()
    spans = root_assignment_spans(lines, strict=True)
    assignments: Dict[str, str] = {}
    for key, (start, end) in spans.items():
        match = ANY_ASSIGNMENT_RE.match(lines[start].strip())
        if not match:
            raise BootstrapError(f"Invalid root config assignment in {path} at line {start + 1}")
        value = match.group(2)
        if end > start + 1:
            value += "\n" + "\n".join(lines[start + 1 : end])
        assignments[key] = value
    return assignments


def normalize_toml_scalar(value: str) -> str:
    value = value.strip()
    quote: Optional[str] = None
    escaped = False
    end = len(value)
    for index, char in enumerate(value):
        if escaped:
            escaped = False
            continue
        if char == "\\" and quote == '"':
            escaped = True
            continue
        if char in {'"', "'"}:
            quote = None if quote == char else (char if quote is None else quote)
        elif char == "#" and quote is None:
            end = index
            break
    normalized = value[:end].strip()
    if len(normalized) >= 2 and normalized[0] == normalized[-1] and normalized[0] in {'"', "'"}:
        return normalized[1:-1]
    return normalized


def profile_assignments(path: Path) -> Dict[str, str]:
    assignments: Dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        match = ROOT_ASSIGNMENT_RE.match(stripped)
        if not match:
            raise BootstrapError(f"Unsupported config template line in {path}: {line}")
        assignments[normalize_toml_key(match.group(1))] = match.group(2)
    return assignments


def toml_value_complete(value: str) -> bool:
    """Return whether a TOML value has closed its arrays/tables/strings.

    This is deliberately a boundary scanner, not a TOML parser. Codex performs
    semantic validation later. Keeping the scanner here lets us preserve a
    Python 3.9 baseline while avoiding writes inside root-level multiline values.
    """

    square_depth = 0
    brace_depth = 0
    string_kind: Optional[str] = None
    index = 0
    while index < len(value):
        if string_kind in {'"""', "'''"}:
            if value.startswith(string_kind, index):
                index += 3
                string_kind = None
                continue
            if string_kind == '"""' and value[index] == "\\":
                index += 2
                continue
            index += 1
            continue
        if string_kind in {'"', "'"}:
            character = value[index]
            if string_kind == '"' and character == "\\":
                index += 2
                continue
            if character == string_kind:
                string_kind = None
            index += 1
            continue

        if value.startswith('"""', index):
            string_kind = '"""'
            index += 3
        elif value.startswith("'''", index):
            string_kind = "'''"
            index += 3
        elif value[index] in {'"', "'"}:
            string_kind = value[index]
            index += 1
        elif value[index] == "#":
            newline = value.find("\n", index)
            index = len(value) if newline == -1 else newline + 1
        elif value[index] == "[":
            square_depth += 1
            index += 1
        elif value[index] == "]":
            square_depth -= 1
            index += 1
        elif value[index] == "{":
            brace_depth += 1
            index += 1
        elif value[index] == "}":
            brace_depth -= 1
            index += 1
        else:
            index += 1
    return string_kind is None and square_depth <= 0 and brace_depth <= 0


def root_assignment_spans(
    lines: Sequence[str], strict: bool = False
) -> Dict[str, Tuple[int, int]]:
    """Locate root assignment line spans without entering the first table."""

    spans: Dict[str, Tuple[int, int]] = {}
    index = 0
    while index < len(lines):
        stripped = lines[index].strip()
        if stripped.startswith("["):
            break
        match = ANY_ASSIGNMENT_RE.match(stripped)
        if not match or stripped.startswith("#"):
            if strict and stripped and not stripped.startswith("#"):
                raise BootstrapError(f"Invalid root config syntax at line {index + 1}")
            index += 1
            continue
        raw_key, initial_value = match.groups()
        key = normalize_toml_key(raw_key)
        if key in spans:
            raise BootstrapError(f"Duplicate root config key at line {index + 1}")
        end = index + 1
        complete_value = initial_value
        while not toml_value_complete(complete_value):
            if end >= len(lines):
                raise BootstrapError(f"Unterminated root config value starting at line {index + 1}")
            complete_value += "\n" + lines[end]
            end += 1
        spans[key] = (index, end)
        index = end
    return spans


def merge_root_config(existing: str, updates: Dict[str, str], overwrite: bool) -> str:
    has_bom = existing.startswith("\ufeff")
    if has_bom:
        existing = existing[1:]
    lines = existing.splitlines()
    spans = root_assignment_spans(lines, strict=True)

    replacements = {
        key: span
        for key, span in spans.items()
        if overwrite and key in updates
    }
    for key, (start, end) in sorted(replacements.items(), key=lambda item: item[1][0], reverse=True):
        lines[start:end] = [f"{key} = {updates[key]}"]

    # Prepending missing root keys is safe for every valid TOML document. In
    # particular, it never guesses that a line beginning with '[' inside a
    # multiline array is a table header.
    additions = [f"{key} = {value}" for key, value in updates.items() if key not in spans]
    body = "\n".join(lines).rstrip()
    if additions:
        prefix = "\n".join(additions)
        merged = prefix + ("\n\n" + body if body else "") + "\n"
    else:
        merged = body + ("\n" if body else "")
    return ("\ufeff" if has_bom else "") + merged


def managed_agents_content(existing: str, block: str) -> str:
    managed = f"{BEGIN_MARKER}\n{block.strip()}\n{END_MARKER}"
    begin_count = existing.count(BEGIN_MARKER)
    end_count = existing.count(END_MARKER)
    if begin_count > 1 or end_count > 1:
        raise BootstrapError("Global AGENTS.md contains duplicate managed markers; repair it manually.")
    has_begin = begin_count == 1
    has_end = end_count == 1
    if has_begin != has_end:
        raise BootstrapError("Global AGENTS.md has only one managed marker; repair it manually.")
    if has_begin:
        start = existing.index(BEGIN_MARKER)
        end_start = existing.index(END_MARKER)
        if end_start < start:
            raise BootstrapError("Global AGENTS.md managed markers are reversed; repair it manually.")
        end = end_start + len(END_MARKER)
        return (existing[:start] + managed + existing[end:]).rstrip() + "\n"
    if not existing.strip():
        return managed + "\n"
    return existing.rstrip() + "\n\n" + managed + "\n"


def git_state(repo_root: Path) -> Dict[str, object]:
    result: Dict[str, object] = {"revision": None, "dirty": None, "status_sha256": None}
    try:
        revision = subprocess.run(
            read_only_git_command(["rev-parse", "HEAD"]),
            cwd=str(repo_root),
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
            stdin=subprocess.DEVNULL,
            env=read_only_git_environment(),
        ).stdout.strip()
        dirty = subprocess.run(
            read_only_git_command(["status", "--porcelain"]),
            cwd=str(repo_root),
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
            stdin=subprocess.DEVNULL,
            env=read_only_git_environment(),
        ).stdout.strip()
        result.update(
            {
                "revision": revision,
                "dirty": bool(dirty),
                "status_sha256": hashlib.sha256(dirty.encode("utf-8")).hexdigest(),
            }
        )
    except (OSError, subprocess.SubprocessError):
        pass
    return result


class Installer:
    def __init__(self, args: argparse.Namespace, repo_root: Path, manifest: Dict[str, object]):
        self.args = args
        self.repo_root = repo_root
        self.manifest = manifest
        self.user_home, self.codex_home, self.user_skills = resolve_homes(args)
        self.backup_root = self.codex_home / "drclaw-backups" / utc_stamp()
        self.events: List[Dict[str, str]] = []
        self.target_env = os.environ.copy()
        self.target_env["HOME"] = str(self.user_home)
        self.target_env["CODEX_HOME"] = str(self.codex_home)
        local_bin = str(self.user_home / ".local" / "bin")
        current_path = self.target_env.get("PATH", "")
        self.target_env["PATH"] = local_bin + (os.pathsep + current_path if current_path else "")
        self.codex_env = portable_codex_env(
            self.user_home,
            self.codex_home,
            self.target_env,
        )
        self.codex_source = "not-found"
        self.drclaw_cli_state: Optional[Dict[str, object]] = None
        self._prior_bootstrap_state: Optional[Dict[str, object]] = None

    def prior_bootstrap_state(self) -> Dict[str, object]:
        """Load the prior receipt without treating arbitrary files as managed state."""

        if self._prior_bootstrap_state is not None:
            return self._prior_bootstrap_state
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        if not os.path.lexists(state_path):
            self._prior_bootstrap_state = {}
            return self._prior_bootstrap_state
        if state_path.is_symlink() or not state_path.is_file():
            raise BootstrapError("Existing bootstrap state must be a real regular file.")
        metadata = state_path.stat()
        if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
            raise BootstrapError("Existing bootstrap state must be current-user-owned and private.")
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BootstrapError("Existing bootstrap state is not valid JSON.") from error
        if not isinstance(state, dict):
            raise BootstrapError("Existing bootstrap state root is not an object.")
        self._prior_bootstrap_state = state
        return state

    @staticmethod
    def skill_source_in_checkout(repo_root: Path, name: str) -> Path:
        relative_sources = {
            "drclaw-skill-library": Path("bootstrap/codex/skills/drclaw-skill-library"),
            "ncsa-delta": Path("bootstrap/codex/vendor/ncsa-delta"),
        }
        try:
            return repo_root / relative_sources[name]
        except KeyError as error:
            raise BootstrapError(f"Unsupported managed skill name in receipt: {name}") from error

    def validated_prior_repo(self, state: Mapping[str, object]) -> Path:
        """Validate the checkout provenance shared by prior managed artifacts."""

        recorded_git = state.get("git")
        repo_text = state.get("repo_root")
        if (
            state.get("schema_version") != 1
            or not isinstance(recorded_git, dict)
            or not isinstance(repo_text, str)
            or any(character in repo_text for character in "\x00\r\n")
        ):
            raise BootstrapError("Prior bootstrap receipt has an invalid checkout contract.")
        old_repo = Path(repo_text)
        if not old_repo.is_absolute() or old_repo != old_repo.resolve(strict=False):
            raise BootstrapError("Prior bootstrap receipt repository path is not canonical and absolute.")
        if first_symlink_component(old_repo) or not old_repo.is_dir():
            raise BootstrapError("Prior bootstrap receipt repository is missing or crosses a symlink.")
        old_repo_metadata = old_repo.stat()
        if old_repo_metadata.st_uid != os.geteuid() or stat.S_IMODE(old_repo_metadata.st_mode) & 0o022:
            raise BootstrapError("Prior bootstrap receipt repository is not a protected user-owned checkout.")

        same_checkout = old_repo == self.repo_root.resolve()
        release_root = self.user_home / ".local" / "share" / "drclaw" / "releases"
        if not same_checkout:
            if old_repo.parent != release_root or re.fullmatch(r"[0-9a-f]{40}", old_repo.name) is None:
                raise BootstrapError("Prior managed artifact is not from a retained immutable release checkout.")
            validate_user_managed_directory_chain(
                self.user_home, old_repo, "prior immutable release checkout"
            )
        observed_git = git_state(old_repo)
        recorded_matches = all(
            recorded_git.get(key) == observed_git.get(key)
            for key in ("revision", "dirty", "status_sha256")
        )
        legacy_peer_lock_drift = (
            state.get("bundle_version") == "0.1.0"
            and recorded_git.get("revision") == old_repo.name
            and recorded_git.get("dirty") is False
            and observed_git.get("revision") == old_repo.name
            and observed_git.get("dirty") is True
            and legacy_v01_peer_metadata_only_lock_drift(old_repo, old_repo.name)
        )
        if not recorded_matches and not legacy_peer_lock_drift:
            raise BootstrapError("Prior managed checkout drifted from its bootstrap receipt.")
        if not same_checkout and (
            observed_git.get("revision") != old_repo.name
            or observed_git.get("dirty") is not False and not legacy_peer_lock_drift
        ):
            raise BootstrapError("Prior managed release checkout is not clean at its recorded commit.")
        if legacy_peer_lock_drift:
            self.event(
                "MIGRATE",
                old_repo / "package-lock.json",
                "accepted the audited v0.1 npm peer-metadata normalization while retaining source/digest checks",
            )
        return old_repo

    def validate_prior_managed_skill(self, name: str, destination: Path) -> Tuple[str, Path]:
        """Prove an existing artifact belongs to the exact prior core receipt."""

        state = self.prior_bootstrap_state()
        managed_names = state.get("managed_skills")
        digests = state.get("managed_skill_digests")
        mode = state.get("skill_install_mode")
        if (
            state.get("schema_version") != 1
            or not isinstance(managed_names, list)
            or any(not isinstance(item, str) for item in managed_names)
            or len(managed_names) != len(set(managed_names))
            or not isinstance(digests, dict)
            or set(digests) != set(managed_names)
            or mode not in {"symlink", "copy"}
        ):
            raise BootstrapError("Prior bootstrap receipt has an invalid managed-skill contract.")
        if name not in managed_names:
            raise BootstrapError(f"Existing {destination} is not recorded as a managed skill.")
        recorded_digest = digests.get(name)
        if not isinstance(recorded_digest, str) or re.fullmatch(r"[0-9a-f]{64}", recorded_digest) is None:
            raise BootstrapError("Prior bootstrap receipt has an invalid managed-skill digest.")

        old_repo = self.validated_prior_repo(state)
        old_source = self.skill_source_in_checkout(old_repo, name)
        if old_source.is_symlink() or not (old_source / "SKILL.md").is_file():
            raise BootstrapError("Prior managed-skill source is missing, symlinked, or incomplete.")
        if directory_digest(old_source) != recorded_digest:
            raise BootstrapError("Prior managed-skill source digest differs from its receipt.")
        if mode == "symlink":
            if not destination.is_symlink():
                raise BootstrapError("Prior managed skill changed from its recorded symlink mode.")
            link_text = os.readlink(destination)
            if link_text != str(old_source) or destination.resolve() != old_source:
                raise BootstrapError("Prior managed skill symlink target drifted from its receipt.")
        else:
            if destination.is_symlink() or not destination.is_dir():
                raise BootstrapError("Prior managed skill changed from its recorded copy mode.")
            if directory_digest(destination) != recorded_digest:
                raise BootstrapError("Prior managed skill copy digest drifted from its receipt.")
        return str(mode), old_source

    def skill_transaction_root(self) -> Path:
        return self.user_home / ".agents" / "drclaw-transactions"

    def _remove_artifact(self, path: Path) -> None:
        if path.is_symlink() or path.is_file():
            path.unlink()
        elif path.exists():
            shutil.rmtree(path)

    def _artifact_matches(
        self, path: Path, source: Path, install_mode: str, expected_digest: str
    ) -> bool:
        try:
            if install_mode == "symlink":
                return (
                    path.is_symlink()
                    and os.readlink(path) == str(source)
                    and path.resolve() == source
                    and directory_digest(source) == expected_digest
                )
            return (
                install_mode == "copy"
                and path.is_dir()
                and not path.is_symlink()
                and directory_digest(path) == expected_digest
            )
        except OSError:
            return False

    def _load_skill_transaction(self, marker: Path) -> Dict[str, str]:
        if marker.is_symlink() or not marker.is_file():
            raise BootstrapError("Managed skill transaction marker is missing or symlinked.")
        info = marker.stat()
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise BootstrapError("Managed skill transaction marker is not private and user-owned.")
        try:
            value = json.loads(marker.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BootstrapError("Managed skill transaction marker is invalid.") from error
        required = {
            "schema_version",
            "kind",
            "name",
            "destination",
            "source",
            "source_sha256",
            "install_mode",
            "incoming",
            "previous",
        }
        if not isinstance(value, dict) or set(value) != required or value.get("schema_version") != 1:
            raise BootstrapError("Managed skill transaction marker has an invalid schema.")
        if value.get("kind") not in {"update", "remove"}:
            raise BootstrapError("Managed skill transaction marker has an invalid operation.")
        name = value.get("name")
        if name not in {"drclaw-skill-library", "ncsa-delta"}:
            raise BootstrapError("Managed skill transaction marker has an invalid skill name.")
        root = self.skill_transaction_root()
        expected_paths = {
            "destination": self.user_skills / str(name),
            "incoming": root / f"{name}.incoming",
            "previous": root / f"{name}.previous",
        }
        for field, expected in expected_paths.items():
            if value.get(field) != str(expected):
                raise BootstrapError("Managed skill transaction marker contains an escaped path.")
        source_text = value.get("source")
        digest = value.get("source_sha256")
        if (
            not isinstance(source_text, str)
            or not Path(source_text).is_absolute()
            or any(character in source_text for character in "\x00\r\n")
            or not isinstance(digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", digest) is None
            or value.get("install_mode") not in {"copy", "symlink"}
        ):
            raise BootstrapError("Managed skill transaction marker has an invalid source contract.")
        return {key: str(item) for key, item in value.items()}

    def recover_managed_skill_transactions(self) -> None:
        """Rollback an interrupted pre-receipt exchange, or clean a committed one."""

        root = self.skill_transaction_root()
        if not root.exists():
            return
        if root.is_symlink() or not root.is_dir() or root.stat().st_uid != os.geteuid() or root.stat().st_mode & 0o077:
            raise BootstrapError("Managed skill transaction directory is not protected.")
        for marker in sorted(root.glob("*.json")):
            transaction = self._load_skill_transaction(marker)
            name = transaction["name"]
            destination = Path(transaction["destination"])
            incoming = Path(transaction["incoming"])
            previous = Path(transaction["previous"])
            source = Path(transaction["source"])
            digest = transaction["source_sha256"]
            mode = transaction["install_mode"]
            prior_names = self.prior_bootstrap_state().get("managed_skills")
            if transaction["kind"] == "remove" and isinstance(prior_names, list) and name not in prior_names:
                self._remove_artifact(incoming)
                if os.path.lexists(previous):
                    self.ensure_backup_root()
                    archive = self.backup_root / f"skills-{name}"
                    if os.path.lexists(archive):
                        raise BootstrapError("Managed removed-skill archive path unexpectedly exists.")
                    shutil.move(str(previous), str(archive))
                marker.unlink()
                continue
            receipt_committed = isinstance(prior_names, list) and name in prior_names
            if receipt_committed:
                try:
                    self.validate_prior_managed_skill(name, destination)
                except BootstrapError:
                    receipt_committed = False
            if receipt_committed:
                self._remove_artifact(previous)
                self._remove_artifact(incoming)
                marker.unlink()
                continue
            if os.path.lexists(previous):
                self.validate_prior_managed_skill(name, previous)
                if os.path.lexists(destination):
                    if not self._artifact_matches(destination, source, mode, digest):
                        raise BootstrapError("Interrupted managed skill destination cannot be proven safe to roll back.")
                    self._remove_artifact(destination)
                os.replace(previous, destination)
            elif os.path.lexists(destination):
                # The marker may have been persisted before the first rename.
                self.validate_prior_managed_skill(name, destination)
            else:
                raise BootstrapError("Interrupted managed skill transaction lost both artifact copies.")
            self._remove_artifact(incoming)
            marker.unlink()
        if root.exists() and not any(root.iterdir()):
            root.rmdir()

    def _write_skill_transaction(
        self,
        *,
        kind: str,
        name: str,
        destination: Path,
        source: Path,
        digest: str,
        install_mode: str,
    ) -> Tuple[Path, Path, Path]:
        root = self.skill_transaction_root()
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(root, 0o700)
        marker = root / f"{name}.json"
        incoming = root / f"{name}.incoming"
        previous = root / f"{name}.previous"
        if any(os.path.lexists(path) for path in (marker, incoming, previous)):
            raise BootstrapError("Managed skill transaction paths are unexpectedly occupied.")
        payload = {
            "schema_version": 1,
            "kind": kind,
            "name": name,
            "destination": str(destination),
            "source": str(source),
            "source_sha256": digest,
            "install_mode": install_mode,
            "incoming": str(incoming),
            "previous": str(previous),
        }
        atomic_write(marker, json.dumps(payload, sort_keys=True) + "\n", mode=0o600)
        fsync_directory(root)
        return marker, incoming, previous

    def replace_proven_managed_skill(
        self, name: str, source: Path, destination: Path, prior_mode: str
    ) -> None:
        """Stage and transactionally exchange a receipt-proven managed skill."""

        desired_mode = "copy" if self.args.copy_skills else "symlink"
        if self.args.dry_run:
            self.event(
                "DRY-RUN",
                destination,
                f"would atomically update receipt-proven managed skill to {desired_mode} from {source}",
            )
            return
        destination.parent.mkdir(parents=True, exist_ok=True)
        digest = directory_digest(source)
        marker, incoming, previous = self._write_skill_transaction(
            kind="update",
            name=name,
            destination=destination,
            source=source,
            digest=digest,
            install_mode=desired_mode,
        )
        try:
            if self.args.copy_skills:
                shutil.copytree(
                    source,
                    incoming,
                    symlinks=True,
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
                )
            else:
                incoming.symlink_to(source, target_is_directory=True)
            fsync_directory(incoming.parent)
            if prior_mode == desired_mode == "symlink":
                # Preserve the receipt-proven old target outside native skill
                # discovery before the atomic retarget.  The marker and this
                # link remain until the new receipt is durable, so a kill at
                # any instruction boundary can roll back on retry.
                previous.symlink_to(os.readlink(destination), target_is_directory=True)
                fsync_directory(previous.parent)
                os.replace(incoming, destination)
                fsync_directory(destination.parent)
                fsync_directory(previous.parent)
            else:
                os.replace(destination, previous)
                fsync_directory(destination.parent)
                fsync_directory(previous.parent)
                os.replace(incoming, destination)
                fsync_directory(destination.parent)
                fsync_directory(incoming.parent)
        except BaseException:
            # The durable marker lets the next invocation prove and recover
            # either side even if this process is interrupted mid-exchange.
            raise
        self.event("UPDATE", destination, f"atomically changed managed skill to {desired_mode}")

    def reconcile_removed_managed_skills(self) -> None:
        """Remove a formerly managed Delta skill when policy now skips it."""

        if not self.args.skip_delta_skill:
            return
        state = self.prior_bootstrap_state()
        managed = state.get("managed_skills")
        if not isinstance(managed, list) or "ncsa-delta" not in managed:
            return
        destination = self.user_skills / "ncsa-delta"
        if not os.path.lexists(destination):
            raise BootstrapError("Prior receipt manages ncsa-delta, but its installed artifact is missing.")
        prior_mode, prior_source = self.validate_prior_managed_skill("ncsa-delta", destination)
        if self.args.dry_run:
            self.event("DRY-RUN", destination, "would archive receipt-proven skill excluded by current policy")
            return
        marker, _, previous = self._write_skill_transaction(
            kind="remove",
            name="ncsa-delta",
            destination=destination,
            source=prior_source,
            digest=directory_digest(prior_source),
            install_mode=prior_mode,
        )
        os.replace(destination, previous)
        fsync_directory(destination.parent)
        fsync_directory(previous.parent)
        self.event("UPDATE", destination, "staged receipt-proven skill removal pending receipt commit")

    def finalize_managed_skill_transactions(self) -> None:
        """Clean old artifacts only after the new bootstrap receipt is durable."""

        root = self.skill_transaction_root()
        if not root.exists():
            return
        for marker in sorted(root.glob("*.json")):
            transaction = self._load_skill_transaction(marker)
            previous = Path(transaction["previous"])
            incoming = Path(transaction["incoming"])
            if transaction["kind"] == "remove" and os.path.lexists(previous):
                self.ensure_backup_root()
                archive = self.backup_root / f"skills-{transaction['name']}"
                if os.path.lexists(archive):
                    raise BootstrapError("Managed removed-skill archive path unexpectedly exists.")
                shutil.move(str(previous), str(archive))
                self.event("BACKUP", archive, "archived skill removed by current policy")
            else:
                self._remove_artifact(previous)
            self._remove_artifact(incoming)
            marker.unlink()
        if root.exists() and not any(root.iterdir()):
            root.rmdir()

    def prior_managed_config_is_intact(self, assignments: Mapping[str, str]) -> bool:
        """Return whether a prior receipt proves every config key it managed."""

        state = self.prior_bootstrap_state()
        prior_profile = state.get("config_profile")
        if prior_profile not in {"safe", "current-delta"}:
            return False
        recorded_digest = state.get("managed_config_sha256")
        if not isinstance(recorded_digest, str) or re.fullmatch(r"[0-9a-f]{64}", recorded_digest) is None:
            raise BootstrapError("Prior bootstrap receipt has an invalid managed config digest.")
        old_repo = self.validated_prior_repo(state)
        old_template = (
            old_repo
            / "bootstrap"
            / "codex"
            / "templates"
            / f"config.{prior_profile}.toml"
        )
        if old_template.is_symlink() or not old_template.is_file():
            raise BootstrapError("Prior managed config template is missing or symlinked.")
        if hashlib.sha256(old_template.read_bytes()).hexdigest() != recorded_digest:
            raise BootstrapError("Prior managed config template drifted from its receipt.")
        expected = profile_assignments(old_template)
        return all(
            normalize_toml_scalar(assignments.get(key, "")) == normalize_toml_scalar(value)
            for key, value in expected.items()
        )

    def find_codex(self) -> Optional[str]:
        discovered = discover_codex_cli(self.user_home, self.target_env)
        if discovered is None:
            self.codex_source = "not-found"
            return None
        path, source, trusted_path_entries = discovered
        self.codex_source = source
        self.codex_env = portable_codex_env(
            self.user_home,
            self.codex_home,
            self.target_env,
            trusted_path_entries=trusted_path_entries,
        )
        return path

    def validate_drclaw_cli_path_chain(
        self,
        path: Path,
        *,
        create: bool = False,
        private_leaf: bool = False,
    ) -> None:
        """Validate or safely create a user-local CLI path without weak ancestors."""

        if any(character in str(path) for character in "\x00\r\n"):
            raise BootstrapError("Managed Dr. Claw CLI path contains an unsupported control character.")
        try:
            relative = path.absolute().relative_to(self.user_home.absolute())
        except ValueError as error:
            raise BootstrapError(f"Managed Dr. Claw CLI path is outside the target home: {path}") from error
        current = self.user_home
        candidates: List[Path] = []
        for part in relative.parts:
            current /= part
            candidates.append(current)
        for candidate in candidates:
            if not os.path.lexists(candidate):
                if not create:
                    break
                candidate.mkdir(mode=0o700)
                os.chmod(candidate, 0o700)
            if candidate.is_symlink() or not candidate.is_dir():
                raise BootstrapError(
                    f"Managed Dr. Claw CLI path component must be a regular directory: {candidate}"
                )
            stat_result = candidate.stat()
            if stat_result.st_uid != os.geteuid():
                raise BootstrapError(
                    f"Managed Dr. Claw CLI path component is not user-owned: {candidate}"
                )
            if stat_result.st_mode & 0o022:
                raise BootstrapError(
                    f"Managed Dr. Claw CLI path component is group/world writable: {candidate}"
                )
        if private_leaf and path.exists() and path.stat().st_mode & 0o077:
            raise BootstrapError(f"Managed Dr. Claw CLI directory must be private (mode 700): {path}")

    def preflight_drclaw_cli_runtime(self) -> None:
        """Prove venv/pip capability before any persistent target write.

        A dry run is strictly read-only: it validates the stdlib modules and
        target filesystem but never creates even a temporary directory under
        the target home.  A real install additionally creates a disposable
        venv on the intended executable filesystem so a noexec ``TMPDIR``
        cannot produce a false failure.
        """

        self.drclaw_cli_contract()
        cli_root = self.user_home / ".local" / "share" / "drclaw" / "cli"
        for path, private_leaf in (
            (cli_root, True),
            (cli_root / "environments", True),
            (cli_root / "pip-cache", True),
            (cli_root / "tmp", True),
            (self.user_home / ".local" / "bin", False),
        ):
            self.validate_drclaw_cli_path_chain(path, private_leaf=private_leaf)
        # Invalid prior ownership metadata must fail before skills/config are touched.
        self.load_prior_drclaw_cli_state()

        probe_parent = cli_root
        while not probe_parent.exists() and probe_parent != probe_parent.parent:
            probe_parent = probe_parent.parent
        try:
            probe_parent.relative_to(self.user_home)
        except ValueError as error:
            raise BootstrapError("Temporary CLI runtime probe parent escaped the target home.") from error
        noexec_flag = getattr(os, "ST_NOEXEC", None)
        if noexec_flag is None:
            raise BootstrapError("Python cannot verify executable filesystem support for the CLI runtime probe.")
        try:
            if os.statvfs(probe_parent).f_flag & noexec_flag:
                raise BootstrapError("CLI runtime target filesystem is mounted noexec.")
        except OSError as error:
            raise BootstrapError("Cannot inspect the CLI runtime target filesystem.") from error
        if not os.access(probe_parent, os.W_OK | os.X_OK):
            raise BootstrapError("CLI runtime target filesystem is not writable and searchable by the target user.")

        if self.args.dry_run:
            prior_dont_write_bytecode = sys.dont_write_bytecode
            sys.dont_write_bytecode = True
            try:
                import ensurepip
                import venv

                bundled_pip_version = ensurepip.version()
                if not bundled_pip_version or not hasattr(venv, "EnvBuilder"):
                    raise RuntimeError("incomplete venv/ensurepip support")
            except Exception as error:
                raise BootstrapError(
                    "The selected Python lacks usable stdlib venv/ensurepip support. "
                    "Install the OS package that provides venv/ensurepip for this Python "
                    "(often python3-venv), then retry."
                ) from error
            finally:
                sys.dont_write_bytecode = prior_dont_write_bytecode
            self.event(
                "CHECK",
                Path(sys.executable),
                "read-only stdlib venv/ensurepip and target filesystem capability passed",
            )
            return

        try:
            with tempfile.TemporaryDirectory(
                prefix="drclaw-cli-venv-probe-",
                dir=str(probe_parent),
            ) as temporary:
                probe_root = Path(temporary)
                probe_home = probe_root / "home"
                probe_cache = probe_root / "cache"
                probe_temporary = probe_root / "tmp"
                for directory in (probe_home, probe_cache, probe_temporary):
                    directory.mkdir(mode=0o700)
                    os.chmod(directory, 0o700)
                probe_environment = drclaw_cli_subprocess_env(
                    probe_home,
                    probe_cache,
                    probe_temporary,
                    self.target_env,
                )
                probe_venv = probe_root / "venv"
                venv_result = subprocess.run(
                    [sys.executable, "-m", "venv", str(probe_venv)],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=120,
                    env=probe_environment,
                    cwd=str(probe_root),
                )
                probe_python = probe_venv / "bin" / "python"
                if (
                    venv_result.returncode != 0
                    or not probe_python.exists()
                    or not os.access(probe_python, os.X_OK)
                ):
                    raise BootstrapError(
                        "The selected Python cannot create a self-contained virtual environment with pip. "
                        "Install the OS package that provides venv/ensurepip for this Python "
                        "(often python3-venv), then retry; no target files were changed."
                    )
                pip_result = subprocess.run(
                    [str(probe_python), "-m", "pip", "--version"],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=30,
                    env=probe_environment,
                    cwd=str(probe_root),
                )
                if pip_result.returncode != 0:
                    raise BootstrapError(
                        "The selected Python created a venv without a usable pip. Install the OS package "
                        "that provides venv/ensurepip for this Python, then retry; no target files were changed."
                    )
        except BootstrapError:
            raise
        except (OSError, subprocess.SubprocessError) as error:
            raise BootstrapError(
                "Could not complete the temporary Python venv/pip capability probe "
                f"({type(error).__name__}); no target files were changed."
            ) from error
        self.event("CHECK", Path(sys.executable), "temporary venv and bundled pip capability passed")

    def drclaw_cli_contract(self) -> Dict[str, object]:
        source_root = self.repo_root / "agent-harness"
        if source_root.is_symlink() or not source_root.is_dir():
            raise BootstrapError(f"Dr. Claw CLI source must be a regular directory: {source_root}")
        source_symlink = next((path for path in source_root.rglob("*") if path.is_symlink()), None)
        if source_symlink:
            raise BootstrapError(f"Dr. Claw CLI source contains unsupported symlink {source_symlink}.")
        locked_dependencies = parse_drclaw_cli_lock()
        source_digest = directory_digest(source_root)
        lock_digest = sha256_file(DRCLAW_CLI_LOCK_PATH)
        runner_digest = hashlib.sha256(drclaw_cli_runner_content().encode("utf-8")).hexdigest()
        repository_state = git_state(self.repo_root)
        revision = repository_state.get("revision")
        revision_text = str(revision) if revision else "unversioned"
        repository_path = str(self.repo_root.resolve())
        if any(character in repository_path for character in "\x00\r\n"):
            raise BootstrapError("Dr. Claw CLI repository path contains an unsupported control character.")
        identity_payload = {
            "bundle_version": self.manifest.get("bundle_version"),
            "repo_root": repository_path,
            "git_revision": revision_text,
            "git_dirty": repository_state.get("dirty"),
            "git_status_sha256": repository_state.get("status_sha256"),
            "source_sha256": source_digest,
            "lock_sha256": lock_digest,
            "runner_sha256": runner_digest,
            "environment_schema": DRCLAW_CLI_ENVIRONMENT_SCHEMA,
            "launcher_entry_points": DRCLAW_CLI_LAUNCHERS,
            "python_version": list(sys.version_info[:3]),
            "python_cache_tag": sys.implementation.cache_tag,
            "system": platform.system(),
            "machine": platform.machine(),
        }
        identity_digest = hashlib.sha256(
            json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()
        version_component = re.sub(
            r"[^A-Za-z0-9_.-]+", "-", str(self.manifest.get("bundle_version", "unknown"))
        )
        environment_id = f"drclaw-cli-{version_component}-{identity_digest[:24]}"
        environment_root = (
            self.user_home / ".local" / "share" / "drclaw" / "cli" / "environments" / environment_id
        )
        return {
            **identity_payload,
            "environment_id": environment_id,
            "environment_root": str(environment_root),
            "locked_dependencies": locked_dependencies,
        }

    def ensure_private_cli_directory(self, path: Path) -> None:
        self.validate_drclaw_cli_path_chain(path, create=True, private_leaf=True)

    def load_prior_drclaw_cli_state(self) -> Optional[Dict[str, object]]:
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        if not state_path.exists():
            return None
        if state_path.is_symlink() or not state_path.is_file():
            raise BootstrapError(f"Cannot establish launcher ownership from invalid state path {state_path}.")
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            raise BootstrapError(
                f"Cannot establish launcher ownership from invalid bootstrap state: {type(error).__name__}"
            ) from error
        if not isinstance(state, dict):
            raise BootstrapError("Cannot establish launcher ownership from non-object bootstrap state.")
        cli_state = state.get("drclaw_cli")
        if cli_state is None:
            return None
        return validate_drclaw_cli_state_shape(cli_state)

    def legacy_v01_cli_launchers_are_intact(self) -> bool:
        """Recognize all three v0.1 setuptools launchers without trusting lookalikes.

        v0.1 installed an editable ``cli-anything-drclaw`` distribution directly
        into ``~/.local/bin`` and did not record launcher digests in its
        bootstrap receipt.  A v0.2+ upgrade may replace those launchers only
        when the old immutable checkout and all three generated setuptools
        wrappers can be proven intact.  Any partial set, symlink, ownership
        change, writable mode, or content deviation remains an operator
        conflict and requires ``--replace``.
        """

        state = self.prior_bootstrap_state()
        if state.get("bundle_version") != "0.1.0" or state.get("drclaw_cli") is not None:
            return False
        try:
            old_repo = self.validated_prior_repo(state)
            setup_path = old_repo / "agent-harness" / "setup.py"
            if setup_path.is_symlink() or not setup_path.is_file():
                return False
            setup_content = setup_path.read_text(encoding="utf-8")
        except (BootstrapError, OSError, UnicodeDecodeError):
            return False

        for name, target in LEGACY_V01_CLI_ENTRY_POINTS.items():
            if f"'{name}={target}'" not in setup_content:
                return False
            launcher_path = self.user_home / ".local" / "bin" / name
            try:
                metadata = launcher_path.lstat()
                if (
                    launcher_path.is_symlink()
                    or not stat.S_ISREG(metadata.st_mode)
                    or metadata.st_uid != os.geteuid()
                    or stat.S_IMODE(metadata.st_mode) & 0o022
                    or not metadata.st_mode & 0o111
                    or metadata.st_size > 65536
                ):
                    return False
                content = launcher_path.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                return False
            marker = (
                f"# EASY-INSTALL-ENTRY-SCRIPT: 'cli-anything-drclaw',"
                f"'console_scripts','{name}'"
            )
            invocation = (
                f"load_entry_point('cli-anything-drclaw', 'console_scripts', '{name}')()"
            )
            if marker not in content or invocation not in content:
                return False
        return True

    def create_drclaw_cli_environment(
        self,
        contract: Dict[str, object],
        cli_root: Path,
        cache_root: Path,
        temporary_root: Path,
    ) -> Dict[str, object]:
        environment_root = Path(str(contract["environment_root"]))
        incoming = Path(
            tempfile.mkdtemp(
                prefix=f".{environment_root.name}.incoming-",
                dir=str(environment_root.parent),
            )
        )
        os.chmod(incoming, 0o700)
        moved = False
        try:
            source_root = incoming / "source"
            shutil.copytree(
                self.repo_root / "agent-harness",
                source_root,
                symlinks=False,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache"),
            )
            if directory_digest(source_root) != contract["source_sha256"]:
                raise BootstrapError("Dr. Claw CLI source snapshot differs immediately after copy.")
            lock_path = incoming / "requirements.lock"
            shutil.copy2(DRCLAW_CLI_LOCK_PATH, lock_path)
            os.chmod(lock_path, 0o400)
            repo_root_path = incoming / "repo-root"
            atomic_write(repo_root_path, str(self.repo_root.resolve()) + "\n", mode=0o400)
            runner_path = incoming / "runner.py"
            atomic_write(runner_path, drclaw_cli_runner_content(), mode=0o500)

            subprocess_environment = drclaw_cli_subprocess_env(
                self.user_home,
                cache_root,
                temporary_root,
                self.target_env,
            )
            venv_result = subprocess.run(
                [sys.executable, "-m", "venv", str(incoming / "venv")],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=120,
                env=subprocess_environment,
                cwd=str(cli_root),
            )
            if venv_result.returncode != 0:
                raise BootstrapError(
                    f"Could not create the managed Dr. Claw CLI virtual environment (exit {venv_result.returncode}); "
                    "command output was intentionally suppressed."
                )
            incoming_python = incoming / "venv" / "bin" / "python"
            pip_result = subprocess.run(
                [
                    str(incoming_python),
                    "-m",
                    "pip",
                    "install",
                    "--disable-pip-version-check",
                    "--no-input",
                    "--no-color",
                    "--only-binary=:all:",
                    "--require-hashes",
                    "--no-deps",
                    "--index-url",
                    "https://pypi.org/simple",
                    "--requirement",
                    str(lock_path),
                ],
                check=False,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=300,
                env=subprocess_environment,
                cwd=str(cli_root),
            )
            if pip_result.returncode != 0:
                raise BootstrapError(
                    f"Could not install the hash-locked Dr. Claw CLI dependency closure (exit {pip_result.returncode}); "
                    "command output was intentionally suppressed."
                )

            final_python = environment_root / "venv" / "bin" / "python"
            final_source = environment_root / "source"
            final_lock = environment_root / "requirements.lock"
            final_repo_root_path = environment_root / "repo-root"
            final_runner = environment_root / "runner.py"
            observed_python = drclaw_cli_python_identity(
                incoming_python,
                subprocess_environment,
                incoming,
            )
            observed_python["executable"] = str(final_python)
            observed_distributions = drclaw_cli_distribution_inventory(
                incoming_python,
                subprocess_environment,
                incoming,
            )
            drclaw_cli_runtime_smoke(
                incoming_python,
                runner_path,
                source_root,
                subprocess_environment,
                incoming,
            )
            launchers: Dict[str, Dict[str, str]] = {}
            for launcher_name, entry_point in DRCLAW_CLI_LAUNCHERS.items():
                content = drclaw_cli_launcher_content(final_python, final_runner, entry_point)
                launchers[launcher_name] = {
                    "path": str(self.user_home / ".local" / "bin" / launcher_name),
                    "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(),
                }
            receipt: Dict[str, object] = {
                "schema_version": DRCLAW_CLI_ENVIRONMENT_SCHEMA,
                "bundle_version": contract["bundle_version"],
                "environment_id": contract["environment_id"],
                "environment_root": str(environment_root),
                "git_revision": contract["git_revision"],
                "git_dirty": contract["git_dirty"],
                "git_status_sha256": contract["git_status_sha256"],
                "installed_at": iso_now(),
                "repo_root": contract["repo_root"],
                "repo_root_path": str(final_repo_root_path),
                "repo_root_sha256": hashlib.sha256(
                    (str(self.repo_root.resolve()) + "\n").encode("utf-8")
                ).hexdigest(),
                "source_root": str(final_source),
                "source_sha256": contract["source_sha256"],
                "lock_path": str(final_lock),
                "lock_sha256": contract["lock_sha256"],
                "locked_dependencies": contract["locked_dependencies"],
                "observed_distributions": observed_distributions,
                "python": observed_python,
                "runner_path": str(final_runner),
                "runner_sha256": contract["runner_sha256"],
                "launchers": launchers,
            }
            atomic_write(
                incoming / "receipt.json",
                json.dumps(receipt, indent=2, sort_keys=True) + "\n",
                mode=0o600,
            )
            if os.path.lexists(environment_root):
                return validate_drclaw_cli_environment(
                    environment_root,
                    subprocess_environment,
                    expected_contract=contract,
                )
            try:
                os.rename(incoming, environment_root)
            except OSError:
                # A same-user concurrent installer may have atomically
                # published the identical immutable environment after our
                # existence check. Reuse it only after the full contract passes.
                if not os.path.lexists(environment_root):
                    raise
                return validate_drclaw_cli_environment(
                    environment_root,
                    subprocess_environment,
                    expected_contract=contract,
                )
            moved = True
            return validate_drclaw_cli_environment(
                environment_root,
                subprocess_environment,
                expected_contract=contract,
            )
        finally:
            if not moved and incoming.exists():
                shutil.rmtree(incoming)

    def install_drclaw_cli_launchers(
        self,
        receipt: Dict[str, object],
        prior_state: Optional[Dict[str, object]],
    ) -> None:
        bin_root = self.user_home / ".local" / "bin"
        self.validate_drclaw_cli_path_chain(bin_root)
        launchers = receipt.get("launchers")
        if not isinstance(launchers, dict):
            raise BootstrapError("Managed Dr. Claw CLI environment receipt has no launcher contract.")
        prior_launchers = prior_state.get("launchers", {}) if prior_state else {}
        if not isinstance(prior_launchers, dict):
            raise BootstrapError("Existing Dr. Claw CLI state has an invalid launcher contract.")
        legacy_v01_launchers = prior_state is None and self.legacy_v01_cli_launchers_are_intact()

        plans: List[Tuple[Path, str, str]] = []
        for launcher_name, entry_point in DRCLAW_CLI_LAUNCHERS.items():
            launcher_path = bin_root / launcher_name
            launcher_contract = launchers.get(launcher_name)
            if not isinstance(launcher_contract, dict) or Path(
                str(launcher_contract.get("path", ""))
            ) != launcher_path:
                raise BootstrapError(f"Managed Dr. Claw CLI receipt has an invalid launcher path: {launcher_name}")
            expected_content = drclaw_cli_launcher_content(
                Path(str(receipt["environment_root"])) / "venv" / "bin" / "python",
                Path(str(receipt["runner_path"])),
                entry_point,
            )
            action = "create"
            if os.path.lexists(launcher_path):
                if launcher_path.is_symlink() or not launcher_path.is_file():
                    if not self.args.replace:
                        raise BootstrapError(
                            f"Refusing to replace unmanaged or symlinked Dr. Claw CLI launcher {launcher_path}; "
                            "audit it and re-run with --replace."
                        )
                    action = "archive"
                else:
                    actual_digest = sha256_file(launcher_path)
                    desired_digest = hashlib.sha256(expected_content.encode("utf-8")).hexdigest()
                    if actual_digest == desired_digest:
                        action = "current"
                    else:
                        prior = prior_launchers.get(launcher_name)
                        prior_digest = prior.get("sha256") if isinstance(prior, dict) else None
                        if prior_digest == actual_digest:
                            action = "managed-update"
                        elif legacy_v01_launchers:
                            action = "legacy-v01-managed-update"
                        elif self.args.replace:
                            action = "archive"
                        else:
                            raise BootstrapError(
                                f"Dr. Claw CLI launcher drift or ownership conflict at {launcher_path}; "
                                "audit it and re-run with --replace."
                            )
            plans.append((launcher_path, expected_content, action))

        if self.args.dry_run:
            for launcher_path, _, action in plans:
                detail = "already current" if action == "current" else f"would {action} atomically"
                self.event("OK" if action == "current" else "DRY-RUN", launcher_path, detail)
            return
        self.validate_drclaw_cli_path_chain(bin_root, create=True)
        for launcher_path, expected_content, action in plans:
            if action == "current":
                self.event("OK", launcher_path, "managed launcher is current")
                continue
            if action == "archive":
                self.archive_conflict(launcher_path)
            elif action in {"managed-update", "legacy-v01-managed-update"}:
                self.backup_file(launcher_path)
            atomic_write(launcher_path, expected_content, mode=0o755)
            if action == "legacy-v01-managed-update":
                self.event(
                    "MIGRATE",
                    launcher_path,
                    "replaced a receipt-proven v0.1 setuptools launcher with the sealed managed launcher",
                )
            else:
                self.event("INSTALL", launcher_path, "installed atomic managed launcher")

    def validate_write_roots(self) -> None:
        if not self.user_home.is_dir():
            raise BootstrapError(f"Target user home does not exist or is not a directory: {self.user_home}")
        try:
            validate_target_home_trust(self.user_home)
        except PathTrustError as error:
            raise BootstrapError(str(error)) from error
        managed_roots = [
            ("CODEX_HOME", self.codex_home),
            ("native skill directory", self.user_skills),
            ("managed skill transaction directory", self.skill_transaction_root()),
            ("backup directory", self.backup_root.parent),
        ]
        if self.args.install_codex or self.args.with_drclaw_cli:
            managed_roots.append(("user executable directory", self.user_home / ".local" / "bin"))
        if self.args.with_drclaw_cli:
            managed_roots.append(
                (
                    "Dr. Claw CLI runtime",
                    self.user_home / ".local" / "share" / "drclaw" / "cli",
                )
            )
        for label, path in managed_roots:
            validate_user_managed_directory_chain(self.user_home, path, label)
        override_shadows, override_detail = global_agents_override_shadow(self.codex_home)
        if override_shadows:
            raise BootstrapError(
                f"Refusing to install while {self.codex_home / 'AGENTS.override.md'} takes global precedence: "
                f"{override_detail}. Dr. Claw will not modify or archive this user-owned override, even with "
                "--replace. Merge the required Dr. Claw guidance into the override or move it aside, then retry."
            )

    def prepare_codex_home(self) -> None:
        if self.codex_home.exists():
            mode = self.codex_home.stat().st_mode & 0o777
            if mode & 0o077:
                self.event("WARN", self.codex_home, f"existing CODEX_HOME permissions are {mode:03o}; recommend 700")
            return
        if self.args.dry_run:
            self.event("DRY-RUN", self.codex_home, "would create CODEX_HOME with mode 700")
            return
        self.codex_home.mkdir(parents=True, mode=0o700)
        os.chmod(self.codex_home, 0o700)
        self.event("INSTALL", self.codex_home, "created CODEX_HOME with mode 700")

    def event(self, status: str, target: Path, detail: str) -> None:
        self.events.append({"status": status, "target": str(target), "detail": detail})
        print(f"[{status}] {target}: {detail}")

    def ensure_backup_root(self) -> None:
        self.backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.backup_root, 0o700)

    def backup_file(self, path: Path) -> None:
        if not path.exists() or self.args.dry_run:
            return
        self.ensure_backup_root()
        destination = self.backup_root / f"{path.parent.name}-{path.name}"
        shutil.copy2(path, destination)
        os.chmod(destination, 0o600)
        self.event("BACKUP", destination, f"copy of {path}")

    def archive_conflict(self, path: Path) -> None:
        if self.args.dry_run:
            self.event("DRY-RUN", path, f"would archive under {self.backup_root}")
            return
        self.ensure_backup_root()
        destination = self.backup_root / f"{path.parent.name}-{path.name}"
        counter = 1
        while os.path.lexists(destination):
            destination = self.backup_root / f"{path.parent.name}-{path.name}-{counter}"
            counter += 1
        shutil.move(str(path), str(destination))
        self.event("BACKUP", destination, f"moved conflicting {path}")

    def install_skill(self, name: str, source: Path) -> None:
        if not (source / "SKILL.md").is_file():
            raise BootstrapError(f"Skill source is incomplete: {source}")
        destination = self.user_skills / name
        source = source.resolve()

        if os.path.lexists(destination):
            if destination.is_symlink() and destination.resolve() == source and not self.args.copy_skills:
                self.event("OK", destination, "already points to the approved source")
                return
            if self.args.copy_skills and destination.is_dir() and not destination.is_symlink():
                if directory_digest(destination) == directory_digest(source):
                    self.event("OK", destination, "installed copy already matches")
                    return
            if not self.args.replace:
                prior_state = self.prior_bootstrap_state()
                prior_managed = prior_state.get("managed_skills")
                if isinstance(prior_managed, list) and name in prior_managed:
                    prior_mode, _ = self.validate_prior_managed_skill(name, destination)
                    self.replace_proven_managed_skill(name, source, destination, prior_mode)
                    return
            if not self.args.replace:
                raise BootstrapError(
                    f"Refusing to replace existing {destination}. Re-run with --replace to archive it first."
                )
            self.archive_conflict(destination)

        if self.args.dry_run:
            operation = "copy" if self.args.copy_skills else "symlink"
            self.event("DRY-RUN", destination, f"would {operation} from {source}")
            return

        destination.parent.mkdir(parents=True, exist_ok=True)
        if self.args.copy_skills:
            temporary = destination.parent / f".{destination.name}.incoming-{utc_stamp()}"
            shutil.copytree(
                source,
                temporary,
                symlinks=True,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
            )
            os.replace(temporary, destination)
            self.event("INSTALL", destination, f"copied from {source}")
        else:
            destination.symlink_to(source, target_is_directory=True)
            self.event("INSTALL", destination, f"linked to {source}")

    def install_agents_guidance(self) -> None:
        destination = self.codex_home / "AGENTS.md"
        template = (BUNDLE_DIR / "templates" / "global-agents.md").read_text(encoding="utf-8")
        if destination.is_symlink():
            if not self.args.replace:
                raise BootstrapError(
                    f"Refusing to replace symlinked {destination}. Re-run with --replace to archive the link first."
                )
            self.archive_conflict(destination)
            existing = ""
        else:
            existing = destination.read_text(encoding="utf-8") if destination.exists() else ""
        updated = managed_agents_content(existing, template)
        if updated == existing:
            self.event("OK", destination, "managed guidance is current")
            return
        if self.args.dry_run:
            self.event("DRY-RUN", destination, "would merge managed guidance block")
            return
        self.backup_file(destination)
        atomic_write(destination, updated, mode=0o644)
        self.event("INSTALL", destination, "merged managed guidance block")

    def install_config(self) -> None:
        if self.args.config_profile == "preserve":
            self.event("SKIP", self.codex_home / "config.toml", "configuration profile is preserve")
            return
        template = BUNDLE_DIR / "templates" / f"config.{self.args.config_profile}.toml"
        if not template.is_file():
            raise BootstrapError(f"Unknown config template: {template}")
        updates = profile_assignments(template)
        destination = self.codex_home / "config.toml"
        if destination.is_symlink():
            if not self.args.replace:
                raise BootstrapError(
                    f"Refusing to replace symlinked {destination}. Re-run with --replace to archive the link first."
                )
            self.archive_conflict(destination)
            existing = ""
        else:
            existing = destination.read_text(encoding="utf-8") if destination.exists() else ""
        overwrite = self.args.config_profile == "current-delta"
        if self.args.config_profile == "safe" and existing:
            existing_assignments = config_assignments(destination)
            mismatched = [
                key
                for key, value in updates.items()
                if key in existing_assignments
                and normalize_toml_scalar(existing_assignments[key])
                != normalize_toml_scalar(value)
            ]
            if mismatched:
                managed_downgrade = self.prior_managed_config_is_intact(
                    existing_assignments
                )
                if not managed_downgrade and not self.args.replace:
                    raise BootstrapError(
                        "Safe profile keys differ from the audited safe values. Use "
                        "--config-profile preserve to leave operator policy unchanged, or "
                        "--replace to back it up and apply the safe profile."
                    )
                overwrite = True
        updated = merge_root_config(existing, updates, overwrite=overwrite)
        if updated == existing:
            self.event("OK", destination, "portable config keys already satisfied")
            return
        if self.args.dry_run:
            action = "overwrite audited root keys" if overwrite else "add missing safe root keys"
            self.event("DRY-RUN", destination, f"would {action}")
            return
        self.backup_file(destination)
        atomic_write(destination, updated, mode=0o600)
        self.event("INSTALL", destination, f"applied {self.args.config_profile} portable keys")

    def install_codex(self) -> None:
        codex_path = self.find_codex()
        if codex_path:
            if not self.args.install_codex:
                self.event(
                    "OK",
                    Path(codex_path),
                    f"Codex is already on the target PATH ({self.codex_source})",
                )
                return
            minimum = self.manifest.get("requirements", {}).get("codex_cli_minimum")  # type: ignore[union-attr]
            if not isinstance(minimum, str) or parse_version(minimum) == (0, 0, 0):
                raise BootstrapError("Manifest requirements.codex_cli_minimum must be a valid version.")
            version_result = subprocess.run(
                [codex_path, "--version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=15,
                env=self.codex_env,
                cwd=str(self.repo_root),
            )
            installed_version = parse_version(version_result.stdout + "\n" + version_result.stderr)
            if version_result.returncode != 0 or installed_version == (0, 0, 0):
                raise BootstrapError(
                    f"Cannot determine the installed Codex version at {codex_path}; refusing to overwrite it."
                )
            if installed_version >= parse_version(minimum):
                self.event(
                    "OK",
                    Path(codex_path),
                    f"installed Codex satisfies the portable minimum {minimum}",
                )
                return
            self.event(
                "UPDATE",
                Path(codex_path),
                f"installed Codex is below the portable minimum {minimum}",
            )
        if not self.args.install_codex:
            self.event("SKIP", self.user_home, "Codex missing; pass --install-codex for the official installer")
            return
        if self.args.dry_run:
            self.event("DRY-RUN", self.user_home, f"would run official installer from {CODEX_INSTALL_URL}")
            return
        temp_root = bootstrap_temp_root(
            self.target_env,
            self.repo_root,
            self.user_home,
            self.codex_home,
        )
        with tempfile.TemporaryDirectory(
            prefix="drclaw-codex-install-",
            dir=str(temp_root),
        ) as temporary_dir:
            installer_path = Path(temporary_dir) / "install.sh"
            try:
                with codex_installer_opener(self.target_env).open(
                    codex_installer_request(), timeout=60
                ) as response:
                    payload = response.read()
            except OSError as error:
                raise BootstrapError(f"Failed to download official Codex installer: {error}") from error
            if not payload.startswith(b"#!"):
                raise BootstrapError("Downloaded Codex installer did not look like a shell script.")
            installer_path.write_bytes(payload)
            installer_environment = portable_codex_env(
                self.user_home,
                self.codex_home,
                self.target_env,
                include_release=True,
            )
            # The official installer prompts through /dev/tty.  Force its documented
            # non-interactive mode only for this child process so a one-command
            # bootstrap cannot hang or persist an operator's prompt preference.
            installer_environment["CODEX_NON_INTERACTIVE"] = "1"
            try:
                subprocess.run(
                    ["bash", str(installer_path)],
                    check=True,
                    env=installer_environment,
                    cwd=str(self.repo_root),
                    timeout=CODEX_INSTALL_TIMEOUT_SECONDS,
                )
            except subprocess.TimeoutExpired as error:
                raise BootstrapError(
                    f"Official Codex installer timed out after {CODEX_INSTALL_TIMEOUT_SECONDS} seconds; output was not retained."
                ) from error
        codex_path = self.find_codex()
        if not codex_path:
            raise BootstrapError(
                f"The official installer completed but Codex was not found under {self.user_home / '.local' / 'bin'} or PATH."
            )
        self.event("INSTALL", Path(codex_path), "ran the official Codex installer")

    def install_drclaw_cli(self) -> None:
        if not self.args.with_drclaw_cli:
            self.event("SKIP", self.repo_root / "agent-harness", "optional drclaw CLI not requested")
            return
        contract = self.drclaw_cli_contract()
        environment_root = Path(str(contract["environment_root"]))
        cli_root = environment_root.parents[1]
        cache_root = cli_root / "pip-cache"
        temporary_root = cli_root / "tmp"
        prior_state = self.load_prior_drclaw_cli_state()
        if self.args.dry_run:
            if environment_root.exists():
                subprocess_environment = drclaw_cli_subprocess_env(
                    self.user_home,
                    cache_root,
                    temporary_root,
                    self.target_env,
                )
                receipt = validate_drclaw_cli_environment(
                    environment_root,
                    subprocess_environment,
                    expected_contract=contract,
                )
                self.event("OK", environment_root, "immutable hash-locked CLI environment is current")
                self.install_drclaw_cli_launchers(receipt, prior_state)
            else:
                self.event(
                    "DRY-RUN",
                    environment_root,
                    "would create a revision-specific venv from the exact hash-locked dependency closure",
                )
                final_python = environment_root / "venv" / "bin" / "python"
                final_runner = environment_root / "runner.py"
                prospective_receipt: Dict[str, object] = {
                    "environment_root": str(environment_root),
                    "runner_path": str(final_runner),
                    "launchers": {
                        name: {
                            "path": str(self.user_home / ".local" / "bin" / name),
                            "sha256": hashlib.sha256(
                                drclaw_cli_launcher_content(final_python, final_runner, entry).encode("utf-8")
                            ).hexdigest(),
                        }
                        for name, entry in DRCLAW_CLI_LAUNCHERS.items()
                    },
                }
                self.install_drclaw_cli_launchers(prospective_receipt, prior_state)
            return
        for directory in (cli_root, environment_root.parent, cache_root, temporary_root):
            self.ensure_private_cli_directory(directory)
        subprocess_environment = drclaw_cli_subprocess_env(
            self.user_home,
            cache_root,
            temporary_root,
            self.target_env,
        )
        if environment_root.exists():
            receipt = validate_drclaw_cli_environment(
                environment_root,
                subprocess_environment,
                expected_contract=contract,
            )
            self.event("OK", environment_root, "immutable hash-locked CLI environment is current")
        else:
            receipt = self.create_drclaw_cli_environment(
                contract,
                cli_root,
                cache_root,
                temporary_root,
            )
            self.event(
                "INSTALL",
                environment_root,
                "created revision-specific venv with an exact hash-locked dependency closure",
            )
        self.install_drclaw_cli_launchers(receipt, prior_state)
        receipt_path = environment_root / "receipt.json"
        receipt_launchers = receipt.get("launchers")
        if not isinstance(receipt_launchers, dict):
            raise BootstrapError("Managed Dr. Claw CLI receipt lost its launcher contract.")
        self.drclaw_cli_state = {
            "environment_id": receipt["environment_id"],
            "environment_root": str(environment_root),
            "git_revision": receipt["git_revision"],
            "git_dirty": receipt["git_dirty"],
            "git_status_sha256": receipt["git_status_sha256"],
            "repo_root": receipt["repo_root"],
            "repo_root_sha256": receipt["repo_root_sha256"],
            "source_sha256": receipt["source_sha256"],
            "lock_sha256": receipt["lock_sha256"],
            "receipt_sha256": sha256_file(receipt_path),
            "launchers": receipt_launchers,
        }

    def install_plugins(self) -> None:
        plugin_specs = [
            str(plugin["id"])
            for plugin in self.manifest["components"]["observed_plugins"]  # type: ignore[index]
            if plugin.get("enabled_in_audited_config")  # type: ignore[union-attr]
        ]
        if not self.args.install_plugins:
            self.event("SKIP", self.codex_home, "observed Codex plugins not requested")
            return
        if self.args.dry_run:
            for plugin_spec in plugin_specs:
                self.event("DRY-RUN", self.codex_home, f"would install {plugin_spec} if its approved marketplace is available")
            return
        codex_path = self.find_codex()
        if not codex_path:
            raise BootstrapError("Cannot install plugins because Codex is not on PATH.")

        inventory = subprocess.run(
            [codex_path, "plugin", "list", "--available", "--json"],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
            env=self.codex_env,
            cwd=str(self.repo_root),
        )
        available_ids = set()
        installed_ids = set()
        if inventory.returncode == 0:
            try:
                installed_entries, available_entries = parse_plugin_inventory(inventory.stdout)
                installed_ids = {
                    str(plugin.get("pluginId"))
                    for plugin in installed_entries
                    if plugin.get("pluginId") and plugin.get("installed", True)
                }
                available_ids = installed_ids | {
                    str(plugin.get("pluginId"))
                    for plugin in available_entries
                    if plugin.get("pluginId")
                }
            except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
                pass
        unavailable = [plugin for plugin in plugin_specs if plugin not in available_ids]
        if unavailable:
            raise BootstrapError(
                "Required product-managed plugin marketplace entries are unavailable: "
                + ", ".join(unavailable)
                + ". Initialize the Codex product marketplace or configure an approved marketplace, then retry."
            )
        for plugin_spec in plugin_specs:
            if plugin_spec in installed_ids:
                self.event("OK", self.codex_home, f"{plugin_spec} is already installed")
                continue
            result = subprocess.run(
                [codex_path, "plugin", "add", plugin_spec, "--json"],
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
                env=self.codex_env,
                cwd=str(self.repo_root),
            )
            if result.returncode != 0:
                raise BootstrapError(
                    f"Codex could not install {plugin_spec} (exit {result.returncode}); "
                    "complete any required product authorization, then retry. Command output was intentionally suppressed."
                )
            self.event("INSTALL", self.codex_home, f"installed {plugin_spec} through Codex")

    def write_state(self) -> None:
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        existing_state = self.prior_bootstrap_state()
        if state_path.is_symlink():
            if not self.args.replace:
                raise BootstrapError(
                    f"Refusing to replace symlinked {state_path}. Re-run with --replace to archive the link first."
                )
            self.archive_conflict(state_path)

        existing_plugins = existing_state.get("managed_plugins", [])
        if not isinstance(existing_plugins, list) or any(
            not isinstance(plugin, str) for plugin in existing_plugins
        ):
            raise BootstrapError(
                "Existing bootstrap state has an invalid managed_plugins field; repair or archive the receipt."
            )
        existing_profile = existing_state.get("config_profile")
        if existing_profile is not None and (
            not isinstance(existing_profile, str)
            or existing_profile not in {"safe", "current-delta", "preserve"}
        ):
            raise BootstrapError(
                "Existing bootstrap state has an invalid config_profile field; repair or archive the receipt."
            )
        existing_config_hash = existing_state.get("managed_config_sha256")
        if existing_config_hash is not None and not isinstance(existing_config_hash, str):
            raise BootstrapError(
                "Existing bootstrap state has an invalid managed_config_sha256 field; repair or archive the receipt."
            )
        existing_drclaw_cli = existing_state.get("drclaw_cli")
        if existing_drclaw_cli is not None:
            validate_drclaw_cli_state_shape(existing_drclaw_cli)

        managed_skills = ["drclaw-skill-library"] + ([] if self.args.skip_delta_skill else ["ncsa-delta"])
        skill_sources = {
            "drclaw-skill-library": self.repo_root / "bootstrap" / "codex" / "skills" / "drclaw-skill-library",
            "ncsa-delta": self.repo_root / "bootstrap" / "codex" / "vendor" / "ncsa-delta",
        }
        installed_plugins = [
            str(plugin["id"])
            for plugin in self.manifest["components"]["observed_plugins"]  # type: ignore[index]
            if self.args.install_plugins and plugin.get("enabled_in_audited_config")  # type: ignore[union-attr]
        ]
        managed_plugins = installed_plugins or existing_plugins
        guidance_payload = (BUNDLE_DIR / "templates" / "global-agents.md").read_bytes()
        effective_config_profile = self.args.config_profile
        managed_config_sha256: Optional[str] = None
        profile_path = BUNDLE_DIR / "templates" / f"config.{effective_config_profile}.toml"
        if profile_path.is_file():
            managed_config_sha256 = hashlib.sha256(profile_path.read_bytes()).hexdigest()
        elif self.args.config_profile == "preserve" and existing_profile in {
            "safe",
            "current-delta",
        }:
            # `preserve` describes this action; it must not erase provenance
            # established by an earlier managed config install.
            effective_config_profile = str(existing_profile)
            recorded_hash = existing_config_hash
            managed_config_sha256 = str(recorded_hash) if recorded_hash is not None else None
        state = {
            "schema_version": 1,
            "bundle_version": self.manifest["bundle_version"],
            "installed_at": iso_now(),
            "repo_root": str(self.repo_root.resolve()),
            "git": git_state(self.repo_root),
            "config_profile": effective_config_profile,
            "skill_install_mode": "copy" if self.args.copy_skills else "symlink",
            "managed_skills": managed_skills,
            "managed_skill_digests": {
                name: directory_digest(skill_sources[name]) for name in managed_skills
            },
            "managed_guidance_sha256": hashlib.sha256(guidance_payload).hexdigest(),
            "managed_config_sha256": managed_config_sha256,
            "managed_plugins": managed_plugins,
        }
        managed_drclaw_cli = self.drclaw_cli_state or existing_drclaw_cli
        if managed_drclaw_cli is not None:
            state["drclaw_cli"] = managed_drclaw_cli
        if self.args.dry_run:
            self.event("DRY-RUN", state_path, "would write secret-free installation state")
            return
        comparable_existing = {key: value for key, value in existing_state.items() if key != "installed_at"}
        comparable_new = {key: value for key, value in state.items() if key != "installed_at"}
        if comparable_existing == comparable_new:
            self.event("OK", state_path, "installation receipt is current")
            return
        if state_path.exists():
            self.backup_file(state_path)
        atomic_write(state_path, json.dumps(state, indent=2) + "\n", mode=0o600)
        self.event("INSTALL", state_path, "wrote secret-free installation state")

    def run(self) -> None:
        if self.args.config_profile == "current-delta":
            # This gate intentionally precedes every validation path that can
            # create, back up, or replace target files.
            verify_live_delta_identity(cwd=self.repo_root)
        if self.args.install_codex or self.args.with_drclaw_cli:
            validate_python_tls_runtime()
            validate_executable_target_filesystems(self.user_home)
        self.validate_write_roots()
        if self.skill_transaction_root().exists():
            if self.args.dry_run:
                raise BootstrapError(
                    "An interrupted managed skill transaction requires a real install run for recovery."
                )
            self.recover_managed_skill_transactions()
        if self.args.with_drclaw_cli:
            self.preflight_drclaw_cli_runtime()
        self.prepare_codex_home()
        self.install_codex()
        self.reconcile_removed_managed_skills()
        self.install_skill(
            "drclaw-skill-library",
            self.repo_root / "bootstrap" / "codex" / "skills" / "drclaw-skill-library",
        )
        if not self.args.skip_delta_skill:
            self.install_skill("ncsa-delta", self.repo_root / "bootstrap" / "codex" / "vendor" / "ncsa-delta")
        self.install_agents_guidance()
        self.install_config()
        self.install_plugins()
        self.install_drclaw_cli()
        self.write_state()
        if not self.args.dry_run:
            fsync_directory(self.codex_home)
        self.finalize_managed_skill_transactions()


@dataclass
class Check:
    level: str
    name: str
    detail: str


class Doctor:
    def __init__(self, args: argparse.Namespace, repo_root: Path, manifest: Dict[str, object]):
        self.args = args
        self.repo_root = repo_root
        self.manifest = manifest
        self.user_home, self.codex_home, self.user_skills = resolve_homes(args)
        self.checks: List[Check] = []
        self.target_env = os.environ.copy()
        self.target_env["HOME"] = str(self.user_home)
        self.target_env["CODEX_HOME"] = str(self.codex_home)
        local_bin = str(self.user_home / ".local" / "bin")
        current_path = self.target_env.get("PATH", "")
        self.target_env["PATH"] = local_bin + (os.pathsep + current_path if current_path else "")
        self.codex_env = portable_codex_env(
            self.user_home,
            self.codex_home,
            self.target_env,
        )
        self.codex_source = "not-found"
        self.effective_global_guidance_ok = False

    def find_command(self, name: str) -> Optional[str]:
        return shutil.which(name, path=self.target_env.get("PATH"))

    def find_codex(self) -> Optional[str]:
        discovered = discover_codex_cli(self.user_home, self.target_env)
        if discovered is None:
            self.codex_source = "not-found"
            return None
        path, source, trusted_path_entries = discovered
        self.codex_source = source
        self.codex_env = portable_codex_env(
            self.user_home,
            self.codex_home,
            self.target_env,
            trusted_path_entries=trusted_path_entries,
        )
        return path

    def add(self, level: str, name: str, detail: str) -> None:
        self.checks.append(Check(level, name, detail))

    def check_drclaw_cli(self, state: Optional[Dict[str, object]]) -> None:
        cli_state = state.get("drclaw_cli") if state else None
        if cli_state is None:
            unmanaged = [
                name
                for name in DRCLAW_CLI_LAUNCHERS
                if os.path.lexists(self.user_home / ".local" / "bin" / name)
            ]
            if unmanaged:
                self.add(
                    "WARN",
                    "drclaw-cli-managed",
                    "CLI launchers exist without a managed immutable-environment receipt: "
                    + ", ".join(unmanaged),
                )
            return
        try:
            cli_state = validate_drclaw_cli_state_shape(cli_state)
            environment_root = Path(str(cli_state.get("environment_root", "")))
            expected_environments_root = (
                self.user_home / ".local" / "share" / "drclaw" / "cli" / "environments"
            )
            if (
                not environment_root.is_absolute()
                or environment_root.parent != expected_environments_root
                or not path_is_within(environment_root, expected_environments_root)
            ):
                raise BootstrapError("managed CLI environment path is outside the user-local sealed root")
            cli_root = expected_environments_root.parent
            bin_root = self.user_home / ".local" / "bin"
            try:
                validate_target_home_trust(self.user_home)
            except PathTrustError as error:
                raise BootstrapError(str(error)) from error
            protected_directories = (
                self.user_home / ".local",
                self.user_home / ".local" / "share",
                self.user_home / ".local" / "share" / "drclaw",
                cli_root,
                expected_environments_root,
                bin_root,
            )
            for path in protected_directories:
                if (
                    not os.path.lexists(path)
                    or path.is_symlink()
                    or not path.is_dir()
                    or path.stat().st_uid != os.geteuid()
                    or path.stat().st_mode & 0o022
                ):
                    raise BootstrapError(
                        f"managed CLI path is missing, symlinked, not user-owned, or group/world writable: {path}"
                    )
            cache_root = cli_root / "pip-cache"
            temporary_root = cli_root / "tmp"
            for label, path in (("pip cache", cache_root), ("temporary root", temporary_root)):
                symlink = first_symlink_component(path)
                if symlink:
                    raise BootstrapError(f"managed CLI {label} crosses symlink {symlink}")
                if not path.is_dir() or path.stat().st_uid != os.geteuid() or path.stat().st_mode & 0o077:
                    raise BootstrapError(f"managed CLI {label} is missing, not user-owned, or not mode 700")
            subprocess_environment = drclaw_cli_subprocess_env(
                self.user_home,
                cache_root,
                temporary_root,
                self.target_env,
            )
            receipt_path = environment_root / "receipt.json"
            if cli_state.get("receipt_sha256") != sha256_file(receipt_path):
                raise BootstrapError("managed CLI environment receipt digest differs from bootstrap state")
            receipt = validate_drclaw_cli_environment(
                environment_root,
                subprocess_environment,
            )
            for key in (
                "environment_id",
                "environment_root",
                "git_dirty",
                "git_revision",
                "git_status_sha256",
                "repo_root",
                "repo_root_sha256",
                "source_sha256",
                "lock_sha256",
                "launchers",
            ):
                if cli_state.get(key) != receipt.get(key):
                    raise BootstrapError(f"managed CLI bootstrap-state {key} differs from environment receipt")

            launchers = receipt.get("launchers")
            if not isinstance(launchers, dict):
                raise BootstrapError("managed CLI launcher receipt is not an object")
            for launcher_name, entry_point in DRCLAW_CLI_LAUNCHERS.items():
                launcher_path = self.user_home / ".local" / "bin" / launcher_name
                launcher_receipt = launchers.get(launcher_name)
                if not isinstance(launcher_receipt, dict):
                    raise BootstrapError(f"managed CLI launcher receipt is invalid: {launcher_name}")
                if Path(str(launcher_receipt.get("path", ""))) != launcher_path:
                    raise BootstrapError(f"managed CLI launcher path drifted: {launcher_name}")
                if launcher_path.is_symlink() or not launcher_path.is_file():
                    raise BootstrapError(f"managed CLI launcher is missing or symlinked: {launcher_path}")
                mode = launcher_path.stat().st_mode
                if launcher_path.stat().st_uid != os.geteuid() or not mode & 0o100 or mode & 0o022:
                    raise BootstrapError(
                        f"managed CLI launcher must be user-owned, owner-executable, and not group/world writable: {launcher_path}"
                    )
                expected_content = drclaw_cli_launcher_content(
                    environment_root / "venv" / "bin" / "python",
                    environment_root / "runner.py",
                    entry_point,
                )
                expected_digest = hashlib.sha256(expected_content.encode("utf-8")).hexdigest()
                if launcher_receipt.get("sha256") != expected_digest or sha256_file(launcher_path) != expected_digest:
                    raise BootstrapError(f"managed CLI launcher content drifted: {launcher_name}")
            self.add(
                "PASS",
                "drclaw-cli-managed",
                f"sealed source, exact dependencies, Python runtime, receipt, and {len(launchers)} launchers match",
            )

            current_source_digest = directory_digest(self.repo_root / "agent-harness")
            current_lock_digest = sha256_file(DRCLAW_CLI_LOCK_PATH)
            current_git = git_state(self.repo_root)
            current_revision = current_git.get("revision")
            if (
                receipt.get("source_sha256") == current_source_digest
                and receipt.get("lock_sha256") == current_lock_digest
                and receipt.get("git_revision") == (str(current_revision) if current_revision else "unversioned")
                and receipt.get("git_dirty") == current_git.get("dirty")
                and receipt.get("git_status_sha256") == current_git.get("status_sha256")
            ):
                self.add("PASS", "drclaw-cli-bundle", "managed CLI was built from the current checkout")
            else:
                self.add(
                    "WARN",
                    "drclaw-cli-bundle",
                    "managed CLI is internally valid but belongs to an earlier checkout; rerun with --with-drclaw-cli to update",
                )
        except (BootstrapError, OSError, ValueError, subprocess.SubprocessError) as error:
            self.add("FAIL", "drclaw-cli-managed", str(error))

    def check_repository(self) -> None:
        missing = [
            path
            for path in self.manifest["required_repository_paths"]  # type: ignore[index]
            if not (self.repo_root / str(path)).exists()
        ]
        if missing:
            self.add("FAIL", "repository", "missing: " + ", ".join(str(path) for path in missing))
        else:
            self.add("PASS", "repository", str(self.repo_root))
        state = git_state(self.repo_root)
        if state["dirty"]:
            level = "FAIL" if self.args.strict_release else "WARN"
            self.add(level, "git-revision", f"checkout has uncommitted changes at {state['revision']}")
        elif state["revision"]:
            self.add("PASS", "git-revision", str(state["revision"]))
        else:
            self.add("WARN", "git-revision", "Git revision unavailable")

        baseline = self.manifest.get("baseline", {})
        release_ref = baseline.get("bundle_release_ref") if isinstance(baseline, dict) else None
        if not release_ref:
            level = "FAIL" if self.args.strict_release else "WARN"
            self.add(
                level,
                "release-ref",
                "bundle_release_ref is unset; commit/tag this bundle before production deployment",
            )
        else:
            try:
                resolved_ref = subprocess.run(
                    read_only_git_command(["rev-parse", f"{release_ref}^{{commit}}"]),
                    cwd=str(self.repo_root),
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    stdin=subprocess.DEVNULL,
                    env=read_only_git_environment(),
                ).stdout.strip()
                if state.get("revision") == resolved_ref:
                    self.add("PASS", "release-ref", f"checkout matches {release_ref}")
                else:
                    level = "FAIL" if self.args.strict_release else "WARN"
                    self.add(
                        level,
                        "release-ref",
                        f"checkout {state.get('revision')} does not match {release_ref} ({resolved_ref})",
                    )
            except (OSError, subprocess.SubprocessError) as error:
                level = "FAIL" if self.args.strict_release else "WARN"
                self.add(level, "release-ref", f"cannot resolve {release_ref}: {type(error).__name__}")

    def check_library(self) -> None:
        skill_paths = sorted((self.repo_root / "skills").rglob("SKILL.md"))
        expected = int(
            self.manifest["components"]["library"]["expected_minimum_skill_files"]  # type: ignore[index]
        )
        if len(skill_paths) < expected:
            self.add("FAIL", "skill-files", f"found {len(skill_paths)}; expected at least {expected}")
        else:
            self.add("PASS", "skill-files", f"found {len(skill_paths)} complete skill entry points")

        catalog_path = self.repo_root / "skills" / "skills-catalog-v2.json"
        try:
            catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
            catalog_count = len(catalog.get("skills", []))
            if catalog_count != len(skill_paths):
                self.add(
                    "WARN",
                    "catalog-drift",
                    f"catalog={catalog_count}, filesystem={len(skill_paths)}; router supplements missing entries",
                )
            else:
                self.add("PASS", "catalog-drift", f"catalog and filesystem both contain {catalog_count}")
        except (OSError, json.JSONDecodeError) as error:
            self.add("FAIL", "catalog", str(error))

        query_script = (
            self.repo_root
            / "bootstrap"
            / "codex"
            / "skills"
            / "drclaw-skill-library"
            / "scripts"
            / "query_library.py"
        )
        try:
            result = subprocess.run(
                [sys.executable, str(query_script), "--repo-root", str(self.repo_root), "--validate"],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self.repo_root),
            )
            if result.returncode == 0:
                self.add("PASS", "router-validation", "frontmatter and canonical names are structurally valid")
            else:
                self.add("FAIL", "router-validation", result.stderr.strip() or "validation returned non-zero")
        except (OSError, subprocess.SubprocessError) as error:
            self.add("FAIL", "router-validation", str(error))

        mcp_mentions = 0
        provider_specific = 0
        packages_with_scripts = 0
        for path in skill_paths:
            scripts_dir = path.parent / "scripts"
            if scripts_dir.is_dir() and any(item.is_file() for item in scripts_dir.rglob("*")):
                packages_with_scripts += 1
            try:
                head = path.read_text(encoding="utf-8", errors="replace").lower()
            except OSError:
                continue
            if "mcp" in head:
                mcp_mentions += 1
            if ".claude" in head or "claude mcp" in head or "claude code" in head:
                provider_specific += 1
        self.add(
            "WARN",
            "skill-runtime-inventory",
            json.dumps(
                {
                    "claude_specific": provider_specific,
                    "mcp_mentions": mcp_mentions,
                    "packages_with_scripts": packages_with_scripts,
                    "source_installed_does_not_imply_dependency_activated": True,
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
        )
        if provider_specific:
            self.add(
                "WARN",
                "provider-compatibility",
                f"{provider_specific} skills mention Claude-specific paths or commands; installed does not imply Codex-runnable",
            )

    def check_managed_files(self) -> None:
        try:
            home_trust = validate_target_home_trust(self.user_home)
        except PathTrustError as error:
            self.add("FAIL", "target-owner", str(error))
        else:
            self.add("PASS", "target-owner", f"HOME trust={home_trust}")

        if self.codex_home.is_dir():
            stat_result = self.codex_home.stat()
            mode = stat_result.st_mode & 0o777
            if stat_result.st_uid != os.geteuid():
                self.add(
                    "FAIL",
                    "codex-home-permissions",
                    f"owner uid={stat_result.st_uid}, effective uid={os.geteuid()}",
                )
            elif mode & 0o077:
                self.add("WARN", "codex-home-permissions", f"mode={mode:03o}; recommend 700")
            else:
                self.add("PASS", "codex-home-permissions", f"mode={mode:03o}")
        else:
            self.add("FAIL", "codex-home-permissions", f"missing directory {self.codex_home}")

        for label, path in (
            ("CODEX_HOME", self.codex_home),
            ("native skill directory", self.user_skills),
        ):
            try:
                validate_user_managed_directory_chain(self.user_home, path, label)
            except BootstrapError as error:
                self.add("FAIL", "managed-paths", str(error))

        agents_path = self.codex_home / "AGENTS.md"
        managed_guidance_ok = False
        if agents_path.is_symlink():
            self.add("FAIL", "global-guidance", f"refusing symlinked managed file {agents_path}")
        elif agents_path.exists():
            content = agents_path.read_text(encoding="utf-8", errors="replace")
            expected_body = (BUNDLE_DIR / "templates" / "global-agents.md").read_text(encoding="utf-8").strip()
            expected_block = f"{BEGIN_MARKER}\n{expected_body}\n{END_MARKER}"
            if content.count(BEGIN_MARKER) != 1 or content.count(END_MARKER) != 1:
                self.add("FAIL", "global-guidance", "managed block markers are missing or duplicated")
            else:
                start = content.index(BEGIN_MARKER)
                end_start = content.index(END_MARKER)
                if end_start < start:
                    self.add("FAIL", "global-guidance", "managed block markers are reversed")
                elif content[start : end_start + len(END_MARKER)] == expected_block:
                    self.add("PASS", "global-guidance", str(agents_path))
                    managed_guidance_ok = True
                else:
                    self.add("FAIL", "global-guidance", "managed block content differs from the approved template")
        else:
            self.add("FAIL", "global-guidance", f"missing {agents_path}")

        override_shadows, override_detail = global_agents_override_shadow(self.codex_home)
        self.effective_global_guidance_ok = managed_guidance_ok and not override_shadows
        if override_shadows:
            self.add("FAIL", "effective-global-guidance", override_detail)
        elif managed_guidance_ok:
            self.add(
                "PASS",
                "effective-global-guidance",
                f"{override_detail}; managed AGENTS.md remains effective at global scope",
            )
        else:
            self.add(
                "FAIL",
                "effective-global-guidance",
                "managed AGENTS.md is not valid, so effective global guidance cannot be established",
            )

        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        state: Optional[Dict[str, object]] = None
        if state_path.is_symlink():
            self.add("FAIL", "bootstrap-state", f"refusing symlinked managed file {state_path}")
        elif state_path.is_file():
            try:
                loaded = json.loads(state_path.read_text(encoding="utf-8"))
                if not isinstance(loaded, dict):
                    raise ValueError("state root is not an object")
                state = loaded
                if state.get("schema_version") != 1:
                    raise ValueError("unsupported schema_version")
                if state.get("bundle_version") != self.manifest.get("bundle_version"):
                    raise ValueError("bundle_version differs from manifest")
                if state.get("skill_install_mode") not in {"copy", "symlink"}:
                    raise ValueError("invalid skill_install_mode")
                if state.get("config_profile") not in {"safe", "current-delta", "preserve"}:
                    raise ValueError("invalid config_profile")
                if not isinstance(state.get("managed_skills"), list):
                    raise ValueError("managed_skills is not a list")
                if not isinstance(state.get("managed_skill_digests"), dict):
                    raise ValueError("managed_skill_digests is not an object")
                if not isinstance(state.get("managed_plugins"), list):
                    raise ValueError("managed_plugins is not a list")
                if Path(str(state.get("repo_root", ""))).resolve() != self.repo_root.resolve():
                    raise ValueError("repo_root differs from the checkout running doctor")
                recorded_git = state.get("git")
                if not isinstance(recorded_git, dict):
                    raise ValueError("git receipt is not an object")
                current_git = git_state(self.repo_root)
                for key in ("revision", "dirty", "status_sha256"):
                    if recorded_git.get(key) != current_git.get(key):
                        raise ValueError(f"git receipt {key} differs from the current checkout")
                expected_guidance_hash = hashlib.sha256(
                    (BUNDLE_DIR / "templates" / "global-agents.md").read_bytes()
                ).hexdigest()
                if state.get("managed_guidance_sha256") != expected_guidance_hash:
                    raise ValueError("managed guidance digest differs from the current bundle")
                self.add("PASS", "bootstrap-state", str(state_path))
            except (OSError, ValueError, json.JSONDecodeError) as error:
                self.add("FAIL", "bootstrap-state", f"invalid state: {error}")
        else:
            self.add("FAIL", "bootstrap-state", f"missing {state_path}")

        self.check_drclaw_cli(state)

        expected_sources = {
            "drclaw-skill-library": self.repo_root / "bootstrap" / "codex" / "skills" / "drclaw-skill-library",
            "ncsa-delta": self.repo_root / "bootstrap" / "codex" / "vendor" / "ncsa-delta",
        }
        expected_names = ["drclaw-skill-library"] + ([] if self.args.skip_delta_skill else ["ncsa-delta"])
        managed_names = state.get("managed_skills", []) if state else []
        for name in expected_names:
            installed_path = self.user_skills / name
            source_path = expected_sources[name].resolve()
            if not (installed_path / "SKILL.md").is_file():
                self.add("FAIL", f"skill:{name}", f"missing or incomplete at {installed_path}")
                continue
            try:
                if installed_path.is_symlink():
                    if installed_path.resolve() != source_path:
                        raise ValueError(f"link resolves to unapproved source {installed_path.resolve()}")
                    detail = f"approved link to {source_path}"
                else:
                    if directory_digest(installed_path) != directory_digest(source_path):
                        raise ValueError("installed copy digest differs from approved source")
                    detail = f"copy matches {source_path}"
                if name not in managed_names:
                    raise ValueError("skill is not recorded in bootstrap state")
                source_digest = directory_digest(source_path)
                recorded_digests = state.get("managed_skill_digests", {}) if state else {}
                if recorded_digests.get(name) != source_digest:  # type: ignore[union-attr]
                    raise ValueError("recorded skill digest differs from the approved source")
                if name == "ncsa-delta":
                    version = (installed_path / "VERSION").read_text(encoding="utf-8").strip()
                    expected_version = next(
                        str(item.get("version"))
                        for item in self.manifest["components"]["user_skills"]  # type: ignore[index]
                        if item.get("name") == "ncsa-delta"  # type: ignore[union-attr]
                    )
                    if version != expected_version:
                        raise ValueError(f"version={version}, expected={expected_version}")
                    detail += f" (v{version})"
                self.add("PASS", f"skill:{name}", detail)
            except (OSError, ValueError, StopIteration) as error:
                self.add("FAIL", f"skill:{name}", str(error))

        if self.user_skills.is_dir():
            discovered_top_level: List[str] = []
            root_skill = self.user_skills / "SKILL.md"
            if root_skill.is_file() or root_skill.is_symlink():
                discovered_top_level.append("SKILL.md (discovery-root)")
            for entry in self.user_skills.iterdir():
                if entry.name == "SKILL.md":
                    continue
                try:
                    has_skill = (entry / "SKILL.md").is_file()
                    if not has_skill and entry.is_symlink() and entry.is_dir():
                        # A directory link at native skill scope can expose an
                        # arbitrarily large recursive tree. Treat every such
                        # unexpected link as discoverable without walking it.
                        has_skill = True
                    elif not has_skill and entry.is_dir():
                        has_skill = next(entry.rglob("SKILL.md"), None) is not None
                    if has_skill:
                        discovered_top_level.append(entry.name)
                except OSError:
                    continue
            discovered_top_level.sort()
            unexpected = [name for name in discovered_top_level if name not in expected_names]
            if unexpected:
                level = "FAIL" if self.args.require_clean_native_skills else "WARN"
                self.add(
                    level,
                    "native-skill-scope",
                    "unexpected recursively discoverable entries: " + ", ".join(unexpected),
                )
            else:
                self.add("PASS", "native-skill-scope", ", ".join(discovered_top_level))

        config_path = self.codex_home / "config.toml"
        try:
            if config_path.is_symlink():
                raise BootstrapError(f"refusing symlinked managed file {config_path}")
            assignments = config_assignments(config_path)
            if config_path.exists():
                profile = str(state.get("config_profile")) if state else "unknown"
                profile_path = BUNDLE_DIR / "templates" / f"config.{profile}.toml"
                expected_profile_hash = (
                    hashlib.sha256(profile_path.read_bytes()).hexdigest() if profile_path.is_file() else None
                )
                if state and state.get("managed_config_sha256") != expected_profile_hash:
                    raise BootstrapError("recorded config profile digest differs from the current bundle")
                if profile in {"safe", "current-delta"}:
                    expected_assignments = profile_assignments(BUNDLE_DIR / "templates" / f"config.{profile}.toml")
                    missing = [key for key in expected_assignments if key not in assignments]
                    if missing:
                        raise BootstrapError("missing managed root keys: " + ", ".join(missing))
                    mismatched = [
                        key
                        for key, value in expected_assignments.items()
                        if normalize_toml_scalar(assignments.get(key, ""))
                        != normalize_toml_scalar(value)
                    ]
                    if mismatched:
                        raise BootstrapError(f"{profile} keys differ: " + ", ".join(mismatched))
                self.add("PASS", "codex-config", f"{len(assignments)} portable root keys visible ({profile})")
            else:
                level = "WARN" if state and state.get("config_profile") == "preserve" else "FAIL"
                self.add(level, "codex-config", f"missing {config_path}")
            if normalize_toml_scalar(assignments.get("approval_policy", "")) == "never" or normalize_toml_scalar(
                assignments.get("sandbox_mode", "")
            ) == "danger-full-access":
                self.add("WARN", "high-trust-config", "approval/sandbox settings require an explicitly trusted host")
        except (OSError, BootstrapError) as error:
            self.add("FAIL", "codex-config", str(error))

    def codex_contract_settings(self) -> Tuple[str, List[str], List[str]]:
        requirements = self.manifest.get("requirements")
        contract = self.manifest.get("codex_compatibility_contract")
        if not isinstance(requirements, dict) or not isinstance(contract, dict):
            raise ValueError("manifest is missing Codex compatibility metadata")
        minimum = requirements.get("codex_cli_minimum")
        audited = requirements.get("codex_cli_audited_versions")
        required_probes = contract.get("required_probes")
        if not isinstance(minimum, str) or parse_version(minimum) == (0, 0, 0):
            raise ValueError("codex_cli_minimum is not a valid version")
        if (
            not isinstance(audited, list)
            or not audited
            or any(not isinstance(version, str) or parse_version(version) == (0, 0, 0) for version in audited)
        ):
            raise ValueError("codex_cli_audited_versions is not a non-empty version array")
        if (
            not isinstance(required_probes, list)
            or not required_probes
            or any(not isinstance(name, str) or not name for name in required_probes)
        ):
            raise ValueError("required_probes is not a non-empty string array")
        return minimum, list(audited), list(required_probes)

    def check_codex_contracts(self, codex_path: str, required_probes: Sequence[str]) -> bool:
        """Exercise the shared portable contract in a synthetic profile."""

        profile = "safe"
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        if state_path.is_file() and not state_path.is_symlink():
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
                recorded_profile = state.get("config_profile") if isinstance(state, dict) else None
                if recorded_profile in {"safe", "current-delta"}:
                    profile = str(recorded_profile)
            except (OSError, json.JSONDecodeError):
                pass
        expected_skills = ["drclaw-skill-library"] + (
            [] if self.args.skip_delta_skill else ["ncsa-delta"]
        )
        results = run_codex_contracts(
            [codex_path],
            required_probes,
            config_template=BUNDLE_DIR / "templates" / f"config.{profile}.toml",
            guidance_template=BUNDLE_DIR / "templates" / "global-agents.md",
            profile_name=profile,
            skill_sources={name: self.user_skills / name for name in expected_skills},
            base_environment=self.codex_env,
            excluded_temp_roots=(self.repo_root, self.user_home, self.codex_home),
        )

        for name in required_probes:
            passed, detail = results.get(name, (False, "probe result unavailable"))
            self.add("PASS" if passed else "FAIL", f"codex-contract:{name}", detail)
        return all(results.get(name, (False, ""))[0] for name in required_probes)

    def secret_free_probe_env(self, home: Path, codex_home: Path) -> Dict[str, str]:
        """Preserve the existing Doctor API while sharing the hardened builder."""

        return build_secret_free_probe_env(
            home,
            codex_home,
            base_environment=self.codex_env,
        )

    def check_runtime(self) -> None:
        codex_path = self.find_codex()
        if not codex_path:
            self.add("FAIL", "codex-cli", "not found on the target PATH")
        else:
            minimum_ok = False
            contract_ok = False
            try:
                minimum_version, audited_versions, required_probes = self.codex_contract_settings()
            except ValueError as error:
                minimum_version, audited_versions, required_probes = "0.0.0", [], []
                self.add("FAIL", "codex-contract-manifest", str(error))
            try:
                temp_root = bootstrap_temp_root(
                    self.target_env,
                    self.repo_root,
                    self.user_home,
                    self.codex_home,
                )
                with tempfile.TemporaryDirectory(
                    prefix="drclaw-codex-version-",
                    dir=str(temp_root),
                ) as temporary:
                    probe_root = Path(temporary)
                    probe_home = probe_root / "home"
                    probe_codex_home = probe_root / "codex-home"
                    probe_home.mkdir()
                    probe_codex_home.mkdir(mode=0o700)
                    result = subprocess.run(
                        [codex_path, "--version"],
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=15,
                        env=self.secret_free_probe_env(probe_home, probe_codex_home),
                        cwd=str(probe_root),
                    )
                version_text = (result.stdout or result.stderr).strip()
                level = "PASS" if result.returncode == 0 else "FAIL"
                self.add(
                    level,
                    "codex-cli",
                    f"{codex_path}: {version_text} (source={self.codex_source})",
                )
                installed_version = parse_version(version_text)
                minimum_ok = result.returncode == 0 and installed_version >= parse_version(minimum_version)
                self.add(
                    "PASS" if minimum_ok else "FAIL",
                    "codex-minimum-version",
                    f"installed={installed_version}, minimum={minimum_version}",
                )
                audited_tuples = {parse_version(version) for version in audited_versions}
                if installed_version in audited_tuples:
                    self.add(
                        "PASS",
                        "codex-version-audit",
                        f"installed {installed_version} is in the audited set",
                    )
                else:
                    self.add(
                        "FAIL" if self.args.require_audited_codex_version else "WARN",
                        "codex-version-audit",
                        f"installed={installed_version}, audited={', '.join(audited_versions) or 'none'}; contract probes decide compatibility",
                    )
                if required_probes:
                    contract_ok = self.check_codex_contracts(codex_path, required_probes)
                self.add(
                    "PASS"
                    if minimum_ok and contract_ok and self.effective_global_guidance_ok
                    else "FAIL",
                    "codex-compatibility",
                    "minimum version, isolated integration contracts, and target effective guidance passed"
                    if minimum_ok and contract_ok and self.effective_global_guidance_ok
                    else "minimum version, an isolated integration contract, or target effective guidance failed",
                )
            except (OSError, subprocess.SubprocessError) as error:
                self.add("FAIL", "codex-cli", str(error))

        if self.args.check_auth and codex_path:
            try:
                result = subprocess.run(
                    [codex_path, "login", "status"],
                    check=False,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=20,
                    env=self.codex_env,
                    cwd=str(self.repo_root),
                )
                self.add("PASS" if result.returncode == 0 else "FAIL", "codex-auth", "login status checked without printing credentials")
            except (OSError, subprocess.SubprocessError) as error:
                self.add("FAIL", "codex-auth", str(error))
        else:
            self.add("WARN", "codex-auth", "not checked; use --check-auth after interactive device login")

        if codex_path:
            try:
                result = subprocess.run(
                    [codex_path, "plugin", "list", "--json"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    env=self.codex_env,
                    cwd=str(self.repo_root),
                )
                if result.returncode != 0:
                    self.add("FAIL" if self.args.require_plugins else "WARN", "codex-plugins", "plugin inventory unavailable")
                else:
                    installed_entries, _ = parse_plugin_inventory(result.stdout)
                    installed = {
                        str(plugin.get("pluginId")): str(plugin.get("version", "unknown"))
                        for plugin in installed_entries
                        if plugin.get("installed") and plugin.get("enabled")
                    }
                    expected = [
                        str(plugin["id"])
                        for plugin in self.manifest["components"]["observed_plugins"]  # type: ignore[index]
                        if plugin.get("enabled_in_audited_config")  # type: ignore[union-attr]
                    ]
                    missing = [plugin for plugin in expected if plugin not in installed]
                    if missing:
                        level = "FAIL" if self.args.require_plugins else "WARN"
                        self.add(level, "codex-plugins", "missing enabled baseline plugins: " + ", ".join(missing))
                    else:
                        versions = ", ".join(f"{plugin}={installed[plugin]}" for plugin in expected)
                        self.add("PASS", "codex-plugins", versions)
                        audited_plugins = {
                            str(plugin["id"]): str(plugin.get("audited_version", ""))
                            for plugin in self.manifest["components"]["observed_plugins"]  # type: ignore[index]
                            if plugin.get("enabled_in_audited_config")  # type: ignore[union-attr]
                        }
                        drift = [
                            f"{plugin}: installed={installed[plugin]}, audited={audited_plugins[plugin]}"
                            for plugin in expected
                            if audited_plugins.get(plugin) and installed[plugin] != audited_plugins[plugin]
                        ]
                        if drift:
                            self.add(
                                "WARN",
                                "plugin-version-drift",
                                "; ".join(drift) + "; product-managed plugin updates are independent of the pinned bundle",
                            )
            except (
                OSError,
                ValueError,
                TypeError,
                AttributeError,
                json.JSONDecodeError,
                subprocess.SubprocessError,
            ) as error:
                level = "FAIL" if self.args.require_plugins else "WARN"
                self.add(level, "codex-plugins", f"inventory check failed: {type(error).__name__}")

        node_path = self.find_command("node")
        if node_path:
            try:
                node_version = subprocess.run(
                    [node_path, "--version"],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=10,
                    env=self.target_env,
                    cwd=str(self.repo_root),
                ).stdout.strip()
                self.add("PASS", "node-optional", f"{node_path}: {node_version}")
                if parse_version(node_version)[0] not in {20, 22, 24}:
                    self.add("WARN", "node-version", f"{node_version} is outside the optional Dr. Claw app engine range")
            except (OSError, subprocess.SubprocessError) as error:
                self.add("WARN", "node-optional", str(error))
        else:
            self.add("WARN", "node-optional", "not installed; router works, full Dr. Claw app does not")

        drclaw_path = self.find_command("drclaw")
        if drclaw_path:
            self.add("PASS", "drclaw-cli-optional", drclaw_path)
        else:
            self.add("WARN", "drclaw-cli-optional", "not installed; use --with-drclaw-cli if needed")

    def check_host(self) -> None:
        # Isolated --home validation must never reach the real login node's
        # Slurm control plane. A current-delta receipt still fails closed below.
        host = bounded_fqdn() if is_login_home(self.user_home) else ""
        machine = normalize_architecture(platform.machine())
        system = platform.system()
        live_delta = False
        if is_delta_hostname(host):
            try:
                identity = verify_live_delta_identity(cwd=self.repo_root)
                live_delta = True
                self.add(
                    "PASS",
                    "host",
                    f"NCSA Delta {identity['architecture']}: {identity['fqdn']}",
                )
                self.add("PASS", "slurm", "live read-only config confirms exact ClusterName=delta")
            except BootstrapError as error:
                self.add("FAIL", "host", str(error))
                self.add("FAIL", "slurm", "live Delta identity contract did not pass")
        elif system == "Linux" and machine in {"x86_64", "aarch64"}:
            self.add(
                "PASS",
                "host",
                f"supported generic Linux server: {host or 'fqdn-unavailable'} ({machine})",
            )
        else:
            self.add("FAIL", "host", f"unsupported host platform: {system} {machine} ({host})")

        recorded_profile: Optional[str] = None
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        if state_path.is_file() and not state_path.is_symlink():
            try:
                state = json.loads(state_path.read_text(encoding="utf-8"))
                if isinstance(state, dict) and isinstance(state.get("config_profile"), str):
                    recorded_profile = str(state["config_profile"])
            except (OSError, json.JSONDecodeError):
                pass
        if recorded_profile == "current-delta":
            self.add(
                "PASS" if live_delta else "FAIL",
                "current-delta-live-identity",
                "receipt high-trust profile matches the live Delta identity"
                if live_delta
                else "receipt requests current-delta but the live host is not verified NCSA Delta",
            )

    def run(self) -> int:
        self.check_repository()
        self.check_library()
        self.check_managed_files()
        self.check_host()
        if not self.args.skip_runtime:
            self.check_runtime()
        else:
            self.add("FAIL" if self.args.strict_release else "WARN", "runtime", "runtime checks skipped")

        failures = sum(check.level == "FAIL" for check in self.checks)
        warnings = sum(check.level == "WARN" for check in self.checks)
        if self.args.json:
            print(
                json.dumps(
                    {
                        "ok": failures == 0,
                        "failures": failures,
                        "warnings": warnings,
                        "checks": [check.__dict__ for check in self.checks],
                    },
                    indent=2,
                )
            )
        else:
            for check in self.checks:
                print(f"[{check.level}] {check.name}: {check.detail}")
            print(f"Summary: {failures} failure(s), {warnings} warning(s)")
        return 0 if failures == 0 else 1


def add_common_paths(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--home", help="Target user home (primarily for isolated tests)")
    parser.add_argument("--codex-home", help="Target Codex home; defaults to CODEX_HOME or <home>/.codex")
    parser.add_argument("--skip-delta-skill", action="store_true", help="Do not install or require ncsa-delta")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    install = subparsers.add_parser("install", help="Install or update the portable baseline")
    add_common_paths(install)
    install.add_argument("--dry-run", action="store_true", help="Preview without writing or downloading")
    install.add_argument("--replace", action="store_true", help="Archive conflicting managed skills before replacement")
    install.add_argument("--copy-skills", action="store_true", help="Copy managed skills instead of symlinking them")
    install.add_argument(
        "--install-codex",
        action="store_true",
        help="Run the official Codex installer if missing or below the manifest compatibility minimum",
    )
    install.add_argument("--install-plugins", action="store_true", help="Install the enabled plugin baseline recorded in the manifest")
    install.add_argument(
        "--with-drclaw-cli",
        action="store_true",
        help="Install the optional control CLI in a revision-specific hash-locked virtual environment",
    )
    install.add_argument(
        "--config-profile",
        choices=("safe", "current-delta", "preserve"),
        default="safe",
        help="Portable config policy; current-delta explicitly enables high-trust settings",
    )
    install.add_argument("--no-doctor", action="store_true", help="Do not run doctor after installation")

    doctor = subparsers.add_parser("doctor", help="Read-only verification and drift report")
    add_common_paths(doctor)
    doctor.add_argument("--check-auth", action="store_true", help="Check login status without printing its output")
    doctor.add_argument("--require-plugins", action="store_true", help="Fail if enabled baseline plugins are missing")
    doctor.add_argument(
        "--strict-release",
        action="store_true",
        help="Require a clean checkout pinned to the manifest release ref",
    )
    doctor.add_argument(
        "--require-audited-codex-version",
        action="store_true",
        help="Fail when Codex is not one of the explicitly audited versions (normally contract-compatible newer versions only warn)",
    )
    doctor.add_argument(
        "--require-clean-native-skills",
        action="store_true",
        help="Fail when ~/.agents/skills contains entries beyond the managed router/Delta baseline",
    )
    doctor.add_argument("--skip-runtime", action="store_true", help="Skip Codex/Node/CLI runtime checks")
    doctor.add_argument("--json", action="store_true", help="Emit machine-readable results")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        ensure_python()
        manifest = load_manifest()
        repo_root = find_repo_root()
        if args.command == "install":
            installer = Installer(args, repo_root, manifest)
            installer.run()
            if args.dry_run or args.no_doctor:
                return 0
            doctor_args = argparse.Namespace(
                home=args.home,
                codex_home=args.codex_home,
                skip_delta_skill=args.skip_delta_skill,
                check_auth=False,
                require_plugins=args.install_plugins,
                strict_release=False,
                require_audited_codex_version=False,
                require_clean_native_skills=False,
                skip_runtime=False,
                json=False,
            )
            return Doctor(doctor_args, repo_root, manifest).run()
        if args.command == "doctor":
            return Doctor(args, repo_root, manifest).run()
    except (BootstrapError, OSError, subprocess.SubprocessError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
