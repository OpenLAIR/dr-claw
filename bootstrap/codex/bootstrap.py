#!/usr/bin/env python3
"""Idempotent, secret-free Codex bootstrap for the Dr. Claw environment."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


BUNDLE_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = BUNDLE_DIR / "manifest.json"
BEGIN_MARKER = "<!-- BEGIN DRCLAW-CODEX-BOOTSTRAP MANAGED BLOCK -->"
END_MARKER = "<!-- END DRCLAW-CODEX-BOOTSTRAP MANAGED BLOCK -->"
TOML_SIMPLE_KEY = r'''(?:[A-Za-z0-9_-]+|"(?:[^"\\]|\\.)*"|'[^']*')'''
ROOT_ASSIGNMENT_RE = re.compile(rf"^({TOML_SIMPLE_KEY})\s*=\s*(.+?)\s*$")
ANY_ASSIGNMENT_RE = re.compile(
    rf"^({TOML_SIMPLE_KEY}(?:\s*\.\s*{TOML_SIMPLE_KEY})*)\s*=\s*(.+?)\s*$"
)
CODEX_INSTALL_URL = "https://chatgpt.com/codex/install.sh"


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


def parse_plugin_inventory(output: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
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


def parse_prompt_input(output: str) -> List[Dict[str, Any]]:
    """Validate the stable envelope emitted by `codex debug prompt-input`."""

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
            ["git", "rev-parse", "HEAD"],
            cwd=str(repo_root),
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
        dirty = subprocess.run(
            ["git", "status", "--porcelain"],
            cwd=str(repo_root),
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
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

    def find_codex(self) -> Optional[str]:
        return shutil.which("codex", path=self.target_env.get("PATH"))

    def validate_write_roots(self) -> None:
        if not self.user_home.is_dir():
            raise BootstrapError(f"Target user home does not exist or is not a directory: {self.user_home}")
        if self.user_home.stat().st_uid != os.geteuid():
            raise BootstrapError(
                f"Target user home {self.user_home} is not owned by effective uid {os.geteuid()}; "
                "run as the target Unix user."
            )
        for label, path in (
            ("CODEX_HOME", self.codex_home),
            ("native skill directory", self.user_skills),
            ("backup directory", self.backup_root.parent),
        ):
            symlink = first_symlink_component(path)
            if symlink:
                raise BootstrapError(
                    f"Refusing to write through symlinked {label} path component {symlink}. "
                    "Use an explicit resolved target path after auditing the relocation."
                )
        if self.codex_home.exists() and (
            not self.codex_home.is_dir() or self.codex_home.stat().st_uid != os.geteuid()
        ):
            raise BootstrapError(
                f"CODEX_HOME must be a directory owned by effective uid {os.geteuid()}: {self.codex_home}"
            )
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
            self.event("OK", Path(codex_path), "Codex is already on the target PATH")
            return
        if not self.args.install_codex:
            self.event("SKIP", self.user_home, "Codex missing; pass --install-codex for the official installer")
            return
        if self.args.dry_run:
            self.event("DRY-RUN", self.user_home, f"would run official installer from {CODEX_INSTALL_URL}")
            return
        with tempfile.TemporaryDirectory(prefix="drclaw-codex-install-") as temporary_dir:
            installer_path = Path(temporary_dir) / "install.sh"
            try:
                with urllib.request.urlopen(CODEX_INSTALL_URL, timeout=60) as response:
                    payload = response.read()
            except OSError as error:
                raise BootstrapError(f"Failed to download official Codex installer: {error}") from error
            if not payload.startswith(b"#!"):
                raise BootstrapError("Downloaded Codex installer did not look like a shell script.")
            installer_path.write_bytes(payload)
            subprocess.run(
                ["bash", str(installer_path)],
                check=True,
                env=self.target_env,
                cwd=str(self.repo_root),
            )
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
        command = [sys.executable, "-m", "pip", "install", "--user", "-e", str(self.repo_root / "agent-harness")]
        if self.args.dry_run:
            self.event("DRY-RUN", self.repo_root / "agent-harness", "would install editable Python CLI")
            return
        subprocess.run(command, check=True, env=self.target_env, cwd=str(self.repo_root))
        self.event("INSTALL", self.repo_root / "agent-harness", "installed editable drclaw CLI")

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
            env=self.target_env,
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
                env=self.target_env,
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
        existing_state: Dict[str, object] = {}
        if state_path.is_file() and not state_path.is_symlink():
            try:
                loaded = json.loads(state_path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    existing_state = loaded
            except (OSError, json.JSONDecodeError):
                pass
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
        self.validate_write_roots()
        self.prepare_codex_home()
        self.install_codex()
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
        self.effective_global_guidance_ok = False

    def find_command(self, name: str) -> Optional[str]:
        return shutil.which(name, path=self.target_env.get("PATH"))

    def add(self, level: str, name: str, detail: str) -> None:
        self.checks.append(Check(level, name, detail))

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
                    ["git", "rev-parse", f"{release_ref}^{{commit}}"],
                    cwd=str(self.repo_root),
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                ).stdout.strip()
                if state.get("revision") == resolved_ref:
                    self.add("PASS", "release-ref", f"checkout matches {release_ref}")
                else:
                    self.add(
                        "FAIL",
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

        provider_specific = 0
        for path in skill_paths:
            try:
                head = path.read_text(encoding="utf-8", errors="replace").lower()
            except OSError:
                continue
            if ".claude" in head or "claude mcp" in head or "claude code" in head:
                provider_specific += 1
        if provider_specific:
            self.add(
                "WARN",
                "provider-compatibility",
                f"{provider_specific} skills mention Claude-specific paths or commands; installed does not imply Codex-runnable",
            )

    def check_managed_files(self) -> None:
        if not self.user_home.is_dir():
            self.add("FAIL", "target-owner", f"missing user home {self.user_home}")
        elif self.user_home.stat().st_uid != os.geteuid():
            self.add(
                "FAIL",
                "target-owner",
                f"user home owner uid={self.user_home.stat().st_uid}, effective uid={os.geteuid()}",
            )
        else:
            self.add("PASS", "target-owner", f"effective uid owns {self.user_home}")

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
            symlink = first_symlink_component(path)
            if symlink:
                self.add("FAIL", "managed-paths", f"symlinked {label} path component: {symlink}")

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
                    if profile == "current-delta":
                        mismatched = [
                            key
                            for key, value in expected_assignments.items()
                            if normalize_toml_scalar(assignments.get(key, "")) != normalize_toml_scalar(value)
                        ]
                        if mismatched:
                            raise BootstrapError("current-delta keys differ: " + ", ".join(mismatched))
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

    def secret_free_probe_env(self, home: Path, codex_home: Path) -> Dict[str, str]:
        """Build a minimal environment that cannot expose target-host credentials."""

        environment = {
            "HOME": str(home),
            "CODEX_HOME": str(codex_home),
            "PATH": self.target_env.get("PATH", os.defpath),
            "PYTHONDONTWRITEBYTECODE": "1",
        }
        for key in ("LANG", "LC_ALL", "LC_CTYPE"):
            if self.target_env.get(key):
                environment[key] = self.target_env[key]
        return environment

    def check_codex_contracts(self, codex_path: str, required_probes: Sequence[str]) -> bool:
        """Exercise portable integration boundaries in an empty synthetic profile.

        The probe profile contains only approved Dr. Claw templates and links to
        the already-verified managed skills. It intentionally excludes auth,
        sessions, plugin caches, connector state, and every research project.
        """

        known_probes = {
            "config-load",
            "prompt-input-json",
            "global-agents-discovery",
            "managed-skill-discovery",
            "plugin-list-json",
        }
        results: Dict[str, Tuple[bool, str]] = {
            name: (False, "probe did not complete") for name in known_probes
        }
        for name in required_probes:
            if name not in known_probes:
                results[name] = (False, "manifest names an unsupported contract probe")

        try:
            with tempfile.TemporaryDirectory(prefix="drclaw-codex-contract-") as temporary:
                probe_root = Path(temporary)
                probe_home = probe_root / "home"
                probe_codex_home = probe_root / "codex-home"
                probe_work = probe_root / "empty-workspace"
                probe_skills = probe_home / ".agents" / "skills"
                probe_skills.mkdir(parents=True)
                probe_codex_home.mkdir(mode=0o700)
                probe_work.mkdir()

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
                shutil.copy2(
                    BUNDLE_DIR / "templates" / f"config.{profile}.toml",
                    probe_codex_home / "config.toml",
                )
                guidance = (BUNDLE_DIR / "templates" / "global-agents.md").read_text(
                    encoding="utf-8"
                ).strip()
                atomic_write(
                    probe_codex_home / "AGENTS.md",
                    f"{BEGIN_MARKER}\n{guidance}\n{END_MARKER}\n",
                    mode=0o600,
                )

                expected_skills = ["drclaw-skill-library"] + (
                    [] if self.args.skip_delta_skill else ["ncsa-delta"]
                )
                missing_sources: List[str] = []
                for name in expected_skills:
                    source = self.user_skills / name
                    if not (source / "SKILL.md").is_file():
                        missing_sources.append(name)
                        continue
                    (probe_skills / name).symlink_to(source.resolve(), target_is_directory=True)

                probe_env = self.secret_free_probe_env(probe_home, probe_codex_home)
                prompt = subprocess.run(
                    [codex_path, "debug", "prompt-input", "drclaw-bootstrap-contract-probe"],
                    cwd=str(probe_work),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
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
                    results["config-load"] = (True, f"Codex loaded the approved {profile} template")
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
                        for name in expected_skills:
                            expected_path = str(probe_skills / name / "SKILL.md")
                            if f"- {name}:" not in serialized or expected_path not in serialized:
                                if name not in missing_discovery:
                                    missing_discovery.append(name)
                        results["managed-skill-discovery"] = (
                            not missing_discovery,
                            "model-visible managed skills: " + ", ".join(expected_skills)
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
                    [codex_path, "plugin", "list", "--json"],
                    cwd=str(probe_work),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
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
        except (OSError, subprocess.SubprocessError) as error:
            for name in known_probes:
                if not results[name][0] and results[name][1] == "probe did not complete":
                    results[name] = (False, f"isolated probe failed: {type(error).__name__}")

        for name in required_probes:
            passed, detail = results.get(name, (False, "probe result unavailable"))
            self.add("PASS" if passed else "FAIL", f"codex-contract:{name}", detail)
        return all(results.get(name, (False, ""))[0] for name in required_probes)

    def check_runtime(self) -> None:
        codex_path = self.find_command("codex")
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
                with tempfile.TemporaryDirectory(prefix="drclaw-codex-version-") as temporary:
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
                self.add(level, "codex-cli", f"{codex_path}: {version_text}")
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
                    env=self.target_env,
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
                    env=self.target_env,
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
        host = socket.getfqdn()
        machine = platform.machine()
        if "delta.ncsa.illinois.edu" in host:
            if machine == "x86_64":
                self.add("PASS", "host", f"NCSA Delta x86_64: {host}")
            else:
                self.add("FAIL", "host", f"Delta hostname with unexpected architecture {machine}")
            scontrol_path = shutil.which("scontrol")
            if not scontrol_path:
                self.add("FAIL", "slurm", "scontrol missing on a Delta host")
            else:
                try:
                    result = subprocess.run(
                        [scontrol_path, "show", "config"],
                        check=False,
                        capture_output=True,
                        text=True,
                        timeout=20,
                        cwd=str(self.repo_root),
                    )
                    if result.returncode == 0 and re.search(r"^ClusterName\s*=\s*delta\s*$", result.stdout, re.MULTILINE):
                        self.add("PASS", "slurm", "live read-only config confirms ClusterName=delta")
                    else:
                        self.add("FAIL", "slurm", "scontrol did not confirm ClusterName=delta")
                except (OSError, subprocess.SubprocessError) as error:
                    self.add("FAIL", "slurm", f"live config probe failed: {type(error).__name__}")
        else:
            self.add("WARN", "host", f"not the audited Delta host: {host} ({machine})")

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
    install.add_argument("--install-codex", action="store_true", help="Run the current official Codex installer if missing")
    install.add_argument("--install-plugins", action="store_true", help="Install the enabled plugin baseline recorded in the manifest")
    install.add_argument("--with-drclaw-cli", action="store_true", help="Install the optional editable Python control CLI")
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
