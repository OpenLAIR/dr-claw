#!/usr/bin/env python3
"""Shared, credential-free Codex CLI compatibility probes for Dr. Claw.

The host bootstrap and optional Web installer deliberately call this module
instead of maintaining two subtly different interpretations of the Codex
integration contract.  Every command runs in a synthetic HOME, CODEX_HOME,
and empty working directory; no user authentication, session, connector, or
research-project state is copied into the probe.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Sequence, Tuple


BEGIN_MARKER = "<!-- BEGIN DRCLAW-CODEX-BOOTSTRAP MANAGED BLOCK -->"
END_MARKER = "<!-- END DRCLAW-CODEX-BOOTSTRAP MANAGED BLOCK -->"
KNOWN_CODEX_CONTRACT_PROBES = (
    "config-load",
    "prompt-input-json",
    "global-agents-discovery",
    "managed-skill-discovery",
    "plugin-list-json",
)
CUSTOM_CA_ENV_KEYS = (
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "AWS_CA_BUNDLE",
    "GIT_SSL_CAINFO",
    "PIP_CERT",
    "NODE_EXTRA_CA_CERTS",
    "npm_config_cafile",
    "NPM_CONFIG_CAFILE",
)
TRUSTED_GIT_CANDIDATES = (Path("/usr/bin/git"), Path("/bin/git"))


class NetworkContractError(RuntimeError):
    """A fixed-message failure for unsupported/unsafe network configuration."""


class PathTrustError(RuntimeError):
    """A fixed-message failure for an unsafe target HOME/path contract."""


def _trusted_getfacl_path() -> Optional[str]:
    """Resolve getfacl only from an immutable root-owned system path."""

    for candidate in (Path("/usr/bin/getfacl"), Path("/bin/getfacl")):
        try:
            resolved = candidate.resolve(strict=True)
            info = resolved.stat()
        except OSError:
            continue
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != 0
            or stat.S_IMODE(info.st_mode) & 0o022
            or not os.access(resolved, os.X_OK)
        ):
            continue
        trusted = True
        for component in (resolved.parent, *resolved.parents):
            try:
                component_info = component.stat()
            except OSError:
                trusted = False
                break
            if (
                component_info.st_uid != 0
                or not stat.S_ISDIR(component_info.st_mode)
                or stat.S_IMODE(component_info.st_mode) & 0o022
            ):
                trusted = False
                break
        if trusted:
            return str(resolved)
    return None


def _acl_effective_permissions(permissions: str, mask: Optional[str]) -> str:
    if mask is None:
        return permissions
    return "".join(
        permission if permission != "-" and mask[index] != "-" else "-"
        for index, permission in enumerate(permissions)
    )


def _validate_root_owned_home_acl(output: str, effective_uid: int) -> None:
    """Validate a numeric getfacl -cpn result without trusting its comments."""

    entries: Dict[Tuple[bool, str, str], str] = {}
    for raw_line in output.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        fields = line.split(":")
        is_default = fields[0] == "default"
        if is_default:
            fields = fields[1:]
        if len(fields) != 3:
            raise PathTrustError("Root-owned target HOME has an invalid POSIX ACL contract.")
        tag, qualifier, permissions = fields
        if tag not in {"user", "group", "mask", "other"}:
            raise PathTrustError("Root-owned target HOME has an invalid POSIX ACL contract.")
        if tag in {"mask", "other"} and qualifier:
            raise PathTrustError("Root-owned target HOME has an invalid POSIX ACL contract.")
        if qualifier and not qualifier.isdigit():
            raise PathTrustError("Root-owned target HOME ACL must use numeric identities.")
        if not re.fullmatch(r"[r-][w-][x-]", permissions):
            raise PathTrustError("Root-owned target HOME has an invalid POSIX ACL contract.")
        key = (is_default, tag, qualifier)
        if key in entries:
            raise PathTrustError("Root-owned target HOME has duplicate POSIX ACL entries.")
        entries[key] = permissions

    required = {
        (False, "user", ""),
        (False, "user", str(effective_uid)),
        (False, "group", ""),
        (False, "mask", ""),
        (False, "other", ""),
    }
    if not required.issubset(entries):
        raise PathTrustError(
            "Root-owned target HOME must grant the current numeric uid an explicit POSIX ACL rwx entry."
        )
    default_keys = {key for key in entries if key[0]}
    if default_keys:
        required_default = {
            (True, "user", ""),
            (True, "group", ""),
            (True, "other", ""),
        }
        if not required_default.issubset(entries):
            raise PathTrustError("Root-owned target HOME has an incomplete default POSIX ACL.")
        has_default_named_entry = any(
            tag in {"user", "group"} and bool(qualifier)
            for is_default, tag, qualifier in default_keys
            if is_default
        )
        if has_default_named_entry and (True, "mask", "") not in entries:
            raise PathTrustError("Root-owned target HOME default POSIX ACL is missing its mask.")
    access_mask = entries[(False, "mask", "")]
    current_permissions = _acl_effective_permissions(
        entries[(False, "user", str(effective_uid))], access_mask
    )
    if current_permissions != "rwx":
        raise PathTrustError(
            "Root-owned target HOME POSIX ACL does not grant the current uid effective rwx."
        )

    for (is_default, tag, qualifier), permissions in entries.items():
        if is_default:
            default_mask = entries.get((True, "mask", ""))
            masked = tag == "group" or tag == "user" and bool(qualifier)
            effective = _acl_effective_permissions(permissions, default_mask if masked else None)
            foreign = (
                tag in {"group", "other"}
                or tag == "user" and qualifier not in {"", str(effective_uid)}
            )
            if foreign and "w" in effective:
                raise PathTrustError(
                    "Root-owned target HOME has a writable foreign/default POSIX ACL entry."
                )
            continue

        masked = tag == "group" or tag == "user" and bool(qualifier)
        effective = _acl_effective_permissions(permissions, access_mask if masked else None)
        foreign = (
            tag in {"group", "other"}
            or tag == "user" and qualifier not in {"", str(effective_uid)}
        )
        if foreign and "w" in effective:
            raise PathTrustError("Root-owned target HOME has a writable foreign POSIX ACL entry.")


def _validate_root_owned_acl_directory(path: Path, effective_uid: int) -> None:
    """Read and validate one root-owned directory's numeric POSIX ACL."""

    getfacl = _trusted_getfacl_path()
    if getfacl is None:
        raise PathTrustError(
            "Root-owned target HOME requires trusted getfacl and a numeric POSIX ACL; install the acl tools package."
        )
    try:
        result = subprocess.run(
            [getfacl, "-cpn", "--", str(path)],
            check=False,
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
            timeout=5,
            cwd="/",
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise PathTrustError("Cannot validate the root-owned target HOME POSIX ACL.") from error
    if result.returncode != 0 or len(result.stdout) > 65536:
        raise PathTrustError("Cannot validate the root-owned target HOME POSIX ACL.")
    _validate_root_owned_home_acl(result.stdout, effective_uid)


def validate_target_home_trust(
    home: Path,
    *,
    euid: Optional[int] = None,
) -> str:
    """Validate a normal user HOME or the audited root-owned POSIX-ACL form."""

    effective_uid = os.geteuid() if euid is None else euid
    current = Path(home.anchor)
    for component in home.absolute().parts[1:-1]:
        current /= component
        try:
            ancestor = current.lstat()
        except OSError as error:
            raise PathTrustError("Cannot inspect the target HOME path ancestry.") from error
        if stat.S_ISLNK(ancestor.st_mode) or not stat.S_ISDIR(ancestor.st_mode):
            raise PathTrustError("Target HOME ancestry contains a symlink/non-directory.")
        if ancestor.st_uid == effective_uid:
            if stat.S_IMODE(ancestor.st_mode) & 0o022:
                raise PathTrustError("Target HOME user-owned ancestry is writable by group/other.")
        elif ancestor.st_uid == 0:
            root_sticky = bool(ancestor.st_mode & stat.S_ISVTX)
            if stat.S_IMODE(ancestor.st_mode) & 0o022 and not root_sticky:
                raise PathTrustError("Target HOME system ancestry is not root-trusted.")
        else:
            raise PathTrustError("Target HOME ancestry is owned by an untrusted account.")
    try:
        metadata = home.lstat()
    except OSError as error:
        raise PathTrustError("Target HOME is unavailable.") from error
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise PathTrustError("Target HOME must be a real directory, not a symlink.")
    if metadata.st_uid == effective_uid:
        if stat.S_IMODE(metadata.st_mode) & 0o022:
            raise PathTrustError("Target HOME is writable by group/other.")
        return "user-owned"
    if metadata.st_uid != 0:
        raise PathTrustError("Target HOME is neither current-user-owned nor an approved root-owned ACL home.")

    _validate_root_owned_acl_directory(home, effective_uid)
    return "root-owned-posix-acl"


def _trusted_read_only_executable(candidate: Path, effective_uid: int) -> Optional[Path]:
    if not candidate.is_absolute():
        return None
    try:
        resolved = candidate.resolve(strict=True)
        info = resolved.stat()
    except OSError:
        return None
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_uid not in {0, effective_uid}
        or stat.S_IMODE(info.st_mode) & 0o022
        or not os.access(resolved, os.X_OK)
    ):
        return None
    for parent in resolved.parents:
        try:
            parent_info = parent.stat()
        except OSError:
            return None
        if (
            not stat.S_ISDIR(parent_info.st_mode)
            or parent_info.st_uid not in {0, effective_uid}
            or stat.S_IMODE(parent_info.st_mode) & 0o022
        ):
            return None
    return resolved


def resolve_read_only_git(
    source: Optional[Mapping[str, str]] = None,
    *,
    euid: Optional[int] = None,
) -> Path:
    """Resolve Git once to a trusted absolute executable, including site PATHs."""

    effective_uid = os.geteuid() if euid is None else euid
    candidates = list(TRUSTED_GIT_CANDIDATES)
    path_source = os.environ if source is None else source
    for entry in path_source.get("PATH", "").split(os.pathsep):
        if entry and Path(entry).is_absolute():
            candidate = Path(entry) / "git"
            if candidate not in candidates:
                candidates.append(candidate)
    for candidate in candidates:
        trusted = _trusted_read_only_executable(candidate, effective_uid)
        if trusted is not None:
            return trusted
    raise FileNotFoundError(
        "No trusted absolute Git executable is available for read-only receipt verification."
    )


def read_only_git_environment() -> Dict[str, str]:
    """A credential-minimal Git environment that forbids optional index locks."""

    return {
        "HOME": "/",
        "XDG_CONFIG_HOME": "/",
        "PATH": "/usr/local/bin:/usr/bin:/bin",
        "LANG": "C",
        "LC_ALL": "C",
        "GIT_OPTIONAL_LOCKS": "0",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_GLOBAL": os.devnull,
        "GIT_ATTR_NOSYSTEM": "1",
        "GIT_PAGER": "cat",
    }


def read_only_git_command(arguments: Sequence[str]) -> list[str]:
    """Build a Git command that disables repository-configured executors."""

    return [
        str(resolve_read_only_git()),
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=/dev/null",
        "-c",
        "diff.external=",
        *arguments,
    ]


def _without_package_lock_peer_metadata(value: Any) -> Any:
    """Return a structural lockfile view without npm's non-semantic peer flag."""

    if isinstance(value, dict):
        return {
            key: _without_package_lock_peer_metadata(item)
            for key, item in value.items()
            if key != "peer"
        }
    if isinstance(value, list):
        return [_without_package_lock_peer_metadata(item) for item in value]
    return value


def legacy_v01_peer_metadata_only_lock_drift(repo_root: Path, expected_revision: str) -> bool:
    """Recognize the sole audited v0.1 checkout mutation without trusting it broadly.

    npm 10 can rewrite only the ``peer`` booleans in a v0.1 lockfile during
    ``npm ci``.  That historical installer wrote the bootstrap receipt before
    the app build, so a retained otherwise-immutable v0.1 checkout can appear
    dirty.  This function accepts only that exact metadata normalization:
    same commit, exactly one tracked changed path (``package-lock.json``), no
    nonignored untracked files or mode changes, and JSON equality after every
    ``peer`` key is removed.  It is intentionally a predicate; callers still
    validate their own receipt, source digests, paths, and ownership.
    """

    if not re.fullmatch(r"[0-9a-f]{40}", expected_revision):
        return False
    lock_path = repo_root / "package-lock.json"
    try:
        if lock_path.is_symlink() or not lock_path.is_file():
            return False
        commands = (
            ["-C", str(repo_root), "rev-parse", "HEAD"],
            [
                "-C",
                str(repo_root),
                "diff",
                "--name-only",
                "--no-ext-diff",
                "--no-textconv",
                "HEAD",
            ],
            ["-C", str(repo_root), "diff", "--summary", "HEAD", "--", "package-lock.json"],
            ["-C", str(repo_root), "ls-files", "--others", "--exclude-standard", "-z"],
            ["-C", str(repo_root), "show", "HEAD:package-lock.json"],
        )
        results = []
        for command in commands:
            result = subprocess.run(
                read_only_git_command(command),
                cwd="/",
                check=True,
                capture_output=True,
                timeout=30,
                stdin=subprocess.DEVNULL,
                env=read_only_git_environment(),
            )
            results.append(result.stdout)
        revision, changed_paths, summary, untracked, baseline = results
        if revision.decode("ascii", errors="strict").strip().lower() != expected_revision:
            return False
        names = [line for line in changed_paths.decode("utf-8", errors="strict").splitlines() if line]
        if names != ["package-lock.json"] or summary or untracked:
            return False
        baseline_json = json.loads(baseline.decode("utf-8", errors="strict"))
        current_json = json.loads(lock_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, subprocess.SubprocessError):
        return False
    return _without_package_lock_peer_metadata(baseline_json) == _without_package_lock_peer_metadata(
        current_json
    )


def _safe_temp_root_candidate(path: Path, effective_uid: int) -> Optional[Path]:
    if not path.is_absolute():
        return None
    try:
        resolved = path.resolve(strict=True)
    except OSError:
        return None
    if resolved != path or not resolved.is_dir() or resolved.is_symlink():
        return None
    current = Path(resolved.anchor)
    components = resolved.parts[1:]
    for index, component in enumerate(components):
        current /= component
        try:
            info = os.lstat(current)
        except OSError:
            return None
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            return None
        final = index == len(components) - 1
        mode = stat.S_IMODE(info.st_mode)
        if final:
            if not (
                info.st_uid == effective_uid and mode == 0o700
                or info.st_uid == 0 and mode == 0o1777
            ):
                return None
            continue
        if info.st_uid not in {0, effective_uid}:
            return None
        writable = bool(mode & 0o022)
        root_sticky = info.st_uid == 0 and bool(info.st_mode & stat.S_ISVTX)
        if writable and not root_sticky:
            return None
    if not components or not os.access(resolved, os.W_OK | os.X_OK):
        return None
    return resolved


def select_safe_temp_root(
    source: Mapping[str, str],
    *,
    excluded_roots: Sequence[Path] = (),
    euid: Optional[int] = None,
) -> Path:
    """Choose a direct-entry temp root without trusting relative/weak TMPDIR."""

    effective_uid = os.geteuid() if euid is None else euid
    candidates = []
    for value in (source.get("TMPDIR"), source.get("TEMP"), source.get("TMP"), "/tmp", "/var/tmp"):
        if value and value not in candidates and not any(
            control in value for control in ("\x00", "\n", "\r")
        ):
            candidates.append(value)
    normalized_exclusions = [root.absolute().resolve(strict=False) for root in excluded_roots]
    for value in candidates:
        candidate = _safe_temp_root_candidate(Path(value), effective_uid)
        if candidate is None:
            continue
        if any(
            candidate == excluded
            or (
                candidate.is_relative_to(excluded)
                if hasattr(candidate, "is_relative_to")
                else str(candidate).startswith(str(excluded) + os.sep)
            )
            for excluded in normalized_exclusions
        ):
            continue
        return candidate
    raise PathTrustError(
        "No safe temporary root is available; use an absolute current-user mode-0700 TMPDIR or root mode-1777 /tmp."
    )


def _trusted_ca_path(path: Path, effective_uid: int) -> bool:
    """Require immutable-by-others ancestry, allowing only root sticky dirs."""

    for component in (path, *path.parents):
        try:
            metadata = component.lstat()
        except OSError:
            return False
        if stat.S_ISLNK(metadata.st_mode) or metadata.st_uid not in {0, effective_uid}:
            return False
        writable_by_others = bool(metadata.st_mode & (stat.S_IWGRP | stat.S_IWOTH))
        root_sticky_directory = (
            metadata.st_uid == 0
            and stat.S_ISDIR(metadata.st_mode)
            and bool(metadata.st_mode & stat.S_ISVTX)
        )
        if writable_by_others and not root_sticky_directory:
            if metadata.st_uid != 0 or not stat.S_ISDIR(metadata.st_mode):
                return False
            try:
                _validate_root_owned_acl_directory(component, effective_uid)
            except PathTrustError:
                return False
    return True


def sanitized_network_environment(
    source: Mapping[str, str],
    *,
    euid: Optional[int] = None,
) -> Dict[str, str]:
    """Return credential-free proxy/CA variables or fail with fixed messages."""

    result: Dict[str, str] = {}
    if source.get("ALL_PROXY") or source.get("all_proxy"):
        raise NetworkContractError(
            "Only credential-free HTTP(S)_PROXY and NO_PROXY are supported."
        )
    for upper_key, lower_key in (
        ("HTTP_PROXY", "http_proxy"),
        ("HTTPS_PROXY", "https_proxy"),
    ):
        values = [source[key] for key in (upper_key, lower_key) if source.get(key)]
        if not values:
            continue
        if len(set(values)) != 1:
            raise NetworkContractError(
                "Upper/lower proxy settings conflict; provide one credential-free value."
            )
        value = values[0]
        try:
            parsed = urllib.parse.urlsplit(value)
            port = parsed.port
        except ValueError as error:
            raise NetworkContractError(
                "Proxy configuration is invalid or contains embedded credentials."
            ) from error
        if (
            any(control in value for control in ("\x00", "\n", "\r"))
            or parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path not in {"", "/"}
            or port is None and parsed.netloc.endswith(":")
        ):
            raise NetworkContractError(
                "Proxy configuration is invalid or contains embedded credentials."
            )
        result[upper_key] = value
        result[lower_key] = value
    no_proxy_values = [source[key] for key in ("NO_PROXY", "no_proxy") if source.get(key)]
    if no_proxy_values:
        if len(set(no_proxy_values)) != 1:
            raise NetworkContractError(
                "Upper/lower NO_PROXY settings conflict; provide one value."
            )
        value = no_proxy_values[0]
        if any(control in value for control in ("\x00", "\n", "\r")):
            raise NetworkContractError("NO_PROXY contains unsupported control characters.")
        result["NO_PROXY"] = value
        result["no_proxy"] = value

    custom_ca = source.get("DRCLAW_CA_BUNDLE")
    inherited_custom = [key for key in CUSTOM_CA_ENV_KEYS if source.get(key)]
    if inherited_custom and (
        not custom_ca or any(source.get(key) != custom_ca for key in inherited_custom)
    ):
        raise NetworkContractError(
            "Custom CA settings must use only DRCLAW_CA_BUNDLE."
        )
    if custom_ca:
        if any(control in custom_ca for control in ("\x00", "\n", "\r")):
            raise NetworkContractError("DRCLAW_CA_BUNDLE is not a safe absolute CA file.")
        ca_path = Path(custom_ca)
        effective_uid = os.geteuid() if euid is None else euid
        try:
            metadata = ca_path.stat()
        except OSError as error:
            raise NetworkContractError("DRCLAW_CA_BUNDLE is not a safe absolute CA file.") from error
        if (
            not ca_path.is_absolute()
            or not stat.S_ISREG(metadata.st_mode)
            or not _trusted_ca_path(ca_path, effective_uid)
            or metadata.st_mode & 0o022
        ):
            raise NetworkContractError("DRCLAW_CA_BUNDLE is not a safe absolute CA file.")
        ca_value = str(ca_path)
        result.update(
            {
                "SSL_CERT_FILE": ca_value,
                "REQUESTS_CA_BUNDLE": ca_value,
                "CURL_CA_BUNDLE": ca_value,
                "GIT_SSL_CAINFO": ca_value,
                "PIP_CERT": ca_value,
                "NODE_EXTRA_CA_CERTS": ca_value,
                "npm_config_cafile": ca_value,
            }
        )
    return result


def sanitized_network_opener(source: Mapping[str, str]) -> urllib.request.OpenerDirector:
    """Build an urllib opener that never consults unsanitized process settings."""

    network = sanitized_network_environment(source)
    proxy_map: Dict[str, str] = {}
    for scheme in ("http", "https"):
        value = network.get(f"{scheme.upper()}_PROXY") or network.get(f"{scheme}_proxy")
        if value:
            proxy_map[scheme] = value
    try:
        import ssl

        context = ssl.create_default_context(cafile=network.get("SSL_CERT_FILE"))
    except Exception as error:
        raise NetworkContractError("TLS context creation failed for the approved CA configuration.") from error
    return urllib.request.build_opener(
        urllib.request.ProxyHandler(proxy_map),
        urllib.request.HTTPSHandler(context=context),
    )


def parse_plugin_inventory(output: str) -> Tuple[list[Dict[str, Any]], list[Dict[str, Any]]]:
    payload = json.loads(output)
    if not isinstance(payload, dict):
        raise ValueError("plugin inventory root is not an object")
    installed = payload.get("installed", [])
    available = payload.get("available", [])
    if not isinstance(installed, list) or not isinstance(available, list):
        raise ValueError("plugin inventory installed/available fields are not arrays")
    if any(not isinstance(item, dict) for item in installed + available):
        raise ValueError("plugin inventory entries are not objects")
    return installed, available


def parse_prompt_input(output: str) -> list[Dict[str, Any]]:
    """Validate the stable envelope emitted by ``codex debug prompt-input``."""

    payload = json.loads(output)
    if not isinstance(payload, list) or not payload:
        raise ValueError("prompt input root is not a non-empty array")
    if any(not isinstance(item, dict) for item in payload):
        raise ValueError("prompt input entries are not objects")
    messages = [item for item in payload if item.get("type") == "message"]
    if not messages:
        raise ValueError("prompt input contains no message entries")
    for message in messages:
        if not isinstance(message.get("role"), str):
            raise ValueError("prompt message role is not a string")
        content = message.get("content")
        if not isinstance(content, list) or any(not isinstance(item, dict) for item in content):
            raise ValueError("prompt message content is not an object array")
    return payload


def secret_free_probe_env(
    home: Path,
    codex_home: Path,
    *,
    base_environment: Mapping[str, str],
) -> Dict[str, str]:
    """Build a small environment without credentials or real XDG state."""

    root = home.parent
    environment = {
        "HOME": str(home),
        "CODEX_HOME": str(codex_home),
        "XDG_CONFIG_HOME": str(root / "xdg-config"),
        "XDG_CACHE_HOME": str(root / "xdg-cache"),
        "XDG_DATA_HOME": str(root / "xdg-data"),
        "PATH": base_environment.get("PATH", os.defpath),
        "PYTHONDONTWRITEBYTECODE": "1",
        "NO_COLOR": "1",
    }
    for key in ("LANG", "LC_ALL", "LC_CTYPE"):
        value = base_environment.get(key)
        if value and not any(control in value for control in ("\x00", "\n", "\r")):
            environment[key] = value
    return environment


def run_codex_contracts(
    codex_command: Sequence[str],
    required_probes: Sequence[str],
    *,
    config_template: Path,
    guidance_template: Path,
    profile_name: str,
    skill_sources: Mapping[str, Path],
    base_environment: Mapping[str, str],
    excluded_temp_roots: Sequence[Path] = (),
    timeout: int = 30,
) -> Dict[str, Tuple[bool, str]]:
    """Exercise Codex extension boundaries in a disposable synthetic profile."""

    known_probes = set(KNOWN_CODEX_CONTRACT_PROBES)
    results: Dict[str, Tuple[bool, str]] = {
        name: (False, "probe did not complete") for name in known_probes
    }
    for name in required_probes:
        if name not in known_probes:
            results[name] = (False, "manifest names an unsupported contract probe")

    try:
        if not codex_command or any(not isinstance(item, str) or not item for item in codex_command):
            raise OSError("Codex command is empty or invalid")
        if config_template.is_symlink() or not config_template.is_file():
            raise OSError("approved Codex config template is missing or symlinked")
        if guidance_template.is_symlink() or not guidance_template.is_file():
            raise OSError("approved global AGENTS.md template is missing or symlinked")

        temp_root = select_safe_temp_root(
            base_environment,
            excluded_roots=excluded_temp_roots,
        )
        with tempfile.TemporaryDirectory(
            prefix="drclaw-codex-contract-",
            dir=str(temp_root),
        ) as temporary:
            probe_root = Path(temporary)
            probe_home = probe_root / "home"
            probe_codex_home = probe_root / "codex-home"
            probe_work = probe_root / "empty-workspace"
            probe_skills = probe_home / ".agents" / "skills"
            for directory in (
                probe_skills,
                probe_codex_home,
                probe_work,
                probe_root / "xdg-config",
                probe_root / "xdg-cache",
                probe_root / "xdg-data",
            ):
                directory.mkdir(parents=True, exist_ok=True, mode=0o700)

            shutil.copyfile(config_template, probe_codex_home / "config.toml")
            os.chmod(probe_codex_home / "config.toml", 0o600)
            guidance = guidance_template.read_text(encoding="utf-8").strip()
            agents_path = probe_codex_home / "AGENTS.md"
            agents_path.write_text(
                f"{BEGIN_MARKER}\n{guidance}\n{END_MARKER}\n",
                encoding="utf-8",
            )
            os.chmod(agents_path, 0o600)

            missing_sources = []
            for name, raw_source in skill_sources.items():
                source = raw_source.resolve()
                if not (source / "SKILL.md").is_file():
                    missing_sources.append(name)
                    continue
                (probe_skills / name).symlink_to(source, target_is_directory=True)

            probe_env = secret_free_probe_env(
                probe_home,
                probe_codex_home,
                base_environment=base_environment,
            )
            prompt = subprocess.run(
                [*codex_command, "debug", "prompt-input", "drclaw-bootstrap-contract-probe"],
                cwd=str(probe_work),
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=probe_env,
            )
            if prompt.returncode != 0:
                detail = f"codex debug prompt-input exited {prompt.returncode}; no output retained"
                for name in (
                    "config-load",
                    "prompt-input-json",
                    "global-agents-discovery",
                    "managed-skill-discovery",
                ):
                    results[name] = (False, detail)
            else:
                results["config-load"] = (
                    True,
                    f"Codex loaded the approved {profile_name} template",
                )
                try:
                    prompt_payload = parse_prompt_input(prompt.stdout)
                    results["prompt-input-json"] = (
                        True,
                        f"validated {len(prompt_payload)} model-visible JSON entries",
                    )
                    serialized = json.dumps(prompt_payload, ensure_ascii=False)
                    guidance_visible = BEGIN_MARKER in serialized and END_MARKER in serialized
                    results["global-agents-discovery"] = (
                        guidance_visible,
                        "managed global AGENTS.md block is model-visible"
                        if guidance_visible
                        else "managed global AGENTS.md block is absent from prompt input",
                    )
                    missing_discovery = list(missing_sources)
                    for name in skill_sources:
                        expected_path = str(probe_skills / name / "SKILL.md")
                        if f"- {name}:" not in serialized or expected_path not in serialized:
                            if name not in missing_discovery:
                                missing_discovery.append(name)
                    results["managed-skill-discovery"] = (
                        not missing_discovery,
                        "model-visible managed skills: " + ", ".join(skill_sources)
                        if not missing_discovery
                        else "missing from model-visible skill inventory: "
                        + ", ".join(missing_discovery),
                    )
                except (TypeError, ValueError, json.JSONDecodeError) as error:
                    results["prompt-input-json"] = (False, str(error))
                    results["global-agents-discovery"] = (
                        False,
                        "prompt JSON contract failed before guidance discovery",
                    )
                    results["managed-skill-discovery"] = (
                        False,
                        "prompt JSON contract failed before skill discovery",
                    )

            plugin_inventory = subprocess.run(
                [*codex_command, "plugin", "list", "--json"],
                cwd=str(probe_work),
                check=False,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=probe_env,
            )
            if plugin_inventory.returncode != 0:
                results["plugin-list-json"] = (
                    False,
                    f"codex plugin list --json exited {plugin_inventory.returncode}; no output retained",
                )
            else:
                try:
                    installed, available = parse_plugin_inventory(plugin_inventory.stdout)
                    results["plugin-list-json"] = (
                        True,
                        f"validated installed/available arrays ({len(installed)}/{len(available)})",
                    )
                except (TypeError, ValueError, json.JSONDecodeError) as error:
                    results["plugin-list-json"] = (False, str(error))
    except (OSError, subprocess.SubprocessError, PathTrustError) as error:
        for name in known_probes:
            if not results[name][0] and results[name][1] == "probe did not complete":
                results[name] = (False, f"isolated probe failed: {type(error).__name__}")

    return results
