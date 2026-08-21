from __future__ import annotations

import json
import hashlib
import os
import shlex
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
import argparse
import contextlib
import importlib.util
import io
from pathlib import Path
from typing import List
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[3]
BOOTSTRAP = REPO_ROOT / "bootstrap" / "codex" / "bootstrap.py"
BOOTSTRAP_WRAPPER = REPO_ROOT / "bootstrap" / "codex" / "bootstrap.sh"
DOCTOR_WRAPPER = REPO_ROOT / "bootstrap" / "codex" / "doctor.sh"
ROUTER_SOURCE = REPO_ROOT / "bootstrap" / "codex" / "skills" / "drclaw-skill-library"
DELTA_SOURCE = REPO_ROOT / "bootstrap" / "codex" / "vendor" / "ncsa-delta"
BEGIN_MARKER = "<!-- BEGIN DRCLAW-CODEX-BOOTSTRAP MANAGED BLOCK -->"
END_MARKER = "<!-- END DRCLAW-CODEX-BOOTSTRAP MANAGED BLOCK -->"


def load_bootstrap_module():
    module_name = "drclaw_bootstrap_test_module"
    existing = sys.modules.get(module_name)
    if existing is not None:
        return existing
    spec = importlib.util.spec_from_file_location(module_name, BOOTSTRAP)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load bootstrap module for isolated repository tests")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class BootstrapIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="drclaw-bootstrap-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / "home"
        self.home.mkdir()
        self.codex_home = self.home / "codex-home"
        self.codex_home.mkdir()

    def run_bootstrap(self, command: str, *arguments: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment.update(
            {
                "HOME": str(self.home),
                "CODEX_HOME": str(self.codex_home),
                "PYTHONDONTWRITEBYTECODE": "1",
            }
        )
        command_line: List[str] = [
            sys.executable,
            str(BOOTSTRAP),
            command,
            "--home",
            str(self.home),
            "--codex-home",
            str(self.codex_home),
            *arguments,
        ]
        return subprocess.run(
            command_line,
            cwd=str(REPO_ROOT),
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=90,
        )

    def assert_success(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(result.returncode, 0, msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}")

    def test_cli_help_smoke_builds_install_and_doctor_subcommands_once(self) -> None:
        result = subprocess.run(
            [sys.executable, str(BOOTSTRAP), "--help"],
            cwd=str(REPO_ROOT),
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("{install,doctor}", result.stdout)

    def test_shell_wrappers_isolate_python_startup_and_disable_bytecode(self) -> None:
        hostile_python = self.root / "hostile-python"
        hostile_python.mkdir()
        marker = self.root / "sitecustomize-ran"
        (hostile_python / "sitecustomize.py").write_text(
            "from pathlib import Path\n"
            f"Path({str(marker)!r}).write_text('loaded', encoding='utf-8')\n",
            encoding="utf-8",
        )
        environment = os.environ.copy()
        environment.update(
            {
                "PYTHONHOME": str(self.root / "missing-python-home"),
                "PYTHONPATH": str(hostile_python),
            }
        )
        environment.pop("PYTHONNOUSERSITE", None)
        environment.pop("PYTHONDONTWRITEBYTECODE", None)

        for wrapper in (BOOTSTRAP_WRAPPER, DOCTOR_WRAPPER):
            with self.subTest(wrapper=wrapper.name):
                result = subprocess.run(
                    [str(wrapper), "--help"],
                    cwd=str(REPO_ROOT),
                    env=environment,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=15,
                )
                self.assertEqual(result.returncode, 0, msg=result.stderr)
                self.assertIn("usage:", result.stdout)

        self.assertFalse(marker.exists())
        self.assertFalse(any(hostile_python.rglob("__pycache__")))
        self.assertFalse(any(hostile_python.rglob("*.pyc")))

    def test_root_owned_home_acl_contract_accepts_delta_shape_and_rejects_foreign_write(self) -> None:
        module = load_bootstrap_module()
        contracts = sys.modules["codex_contracts"]
        effective_uid = os.geteuid()
        real_lstat = Path.lstat

        def root_owned_home_lstat(path, *args, **kwargs):
            if Path(path) == self.home:
                return mock.Mock(st_mode=stat.S_IFDIR | 0o770, st_uid=0)
            return real_lstat(path, *args, **kwargs)

        base_acl = (
            "user::rwx\n"
            f"user:{effective_uid}:rwx\n"
            "group::---\n"
            "mask::rwx\n"
            "other::---\n"
        )
        completed = subprocess.CompletedProcess([], 0, base_acl, "")
        with mock.patch.object(Path, "lstat", root_owned_home_lstat), mock.patch.object(
            contracts, "_trusted_getfacl_path", return_value="/usr/bin/getfacl"
        ), mock.patch.object(contracts.subprocess, "run", return_value=completed) as run:
            self.assertEqual(
                module.validate_target_home_trust(self.home), "root-owned-posix-acl"
            )
            doctor = module.Doctor(
                argparse.Namespace(
                    home=str(self.home),
                    codex_home=str(self.codex_home),
                    skip_delta_skill=True,
                    require_clean_native_skills=False,
                ),
                REPO_ROOT,
                {"bundle_version": "fixture"},
            )
            doctor.check_managed_files()
            target_owner = next(check for check in doctor.checks if check.name == "target-owner")
            self.assertEqual(target_owner.level, "PASS")
            self.assertIn("root-owned-posix-acl", target_owner.detail)
        self.assertEqual(run.call_args.args[0][-1], str(self.home))
        self.assertEqual(run.call_args.kwargs["timeout"], 5)
        self.assertEqual(run.call_args.kwargs["env"]["LC_ALL"], "C")
        self.assertEqual(run.call_args.kwargs["stdin"], subprocess.DEVNULL)
        self.assertNotIn("LD_PRELOAD", run.call_args.kwargs["env"])
        self.assertNotIn("OPENAI_API_KEY", run.call_args.kwargs["env"])

        unsafe_acls = (
            (base_acl + "user:999999:rwx\n", "writable foreign"),
            (base_acl + "group:999999:-w-\n", "writable foreign"),
            (
                base_acl
                + "default:user::rwx\n"
                + "default:group::rwx\n"
                + "default:mask::rwx\n"
                + "default:other::---\n",
                "writable foreign/default",
            ),
            (base_acl + "default:user::rwx\n", "incomplete default"),
            (
                base_acl
                + "default:user::rwx\n"
                + "default:user:999999:r-x\n"
                + "default:group::r-x\n"
                + "default:other::---\n",
                "missing its mask",
            ),
            (base_acl.replace("mask::rwx", "mask::r-x"), "effective rwx"),
        )
        for unsafe_acl, expected in unsafe_acls:
            with self.subTest(unsafe_acl=unsafe_acl.splitlines()[-1]), mock.patch.object(
                Path, "lstat", root_owned_home_lstat
            ), mock.patch.object(
                contracts, "_trusted_getfacl_path", return_value="/usr/bin/getfacl"
            ), mock.patch.object(
                contracts.subprocess,
                "run",
                return_value=subprocess.CompletedProcess([], 0, unsafe_acl, ""),
            ):
                with self.assertRaisesRegex(module.PathTrustError, expected):
                    module.validate_target_home_trust(self.home)

        masked_default_foreign = (
            base_acl
            + "default:user::rwx\n"
            + "default:user:999999:rwx\n"
            + "default:group::rwx\n"
            + "default:mask::r-x\n"
            + "default:other::---\n"
        )
        with mock.patch.object(Path, "lstat", root_owned_home_lstat), mock.patch.object(
            contracts, "_trusted_getfacl_path", return_value="/usr/bin/getfacl"
        ), mock.patch.object(
            contracts.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, masked_default_foreign, ""),
        ):
            self.assertEqual(
                module.validate_target_home_trust(self.home), "root-owned-posix-acl"
            )

    def test_root_owned_acl_home_can_hold_a_private_ca_but_foreign_acl_write_is_rejected(self) -> None:
        module = load_bootstrap_module()
        contracts = sys.modules["codex_contracts"]
        effective_uid = os.geteuid()
        ca_bundle = self.home / "private-ca.pem"
        ca_bundle.write_text("fixture\n", encoding="utf-8")
        ca_bundle.chmod(0o600)
        real_lstat = Path.lstat

        def root_owned_home_lstat(path, *args, **kwargs):
            if Path(path) == self.home:
                return mock.Mock(st_mode=stat.S_IFDIR | 0o770, st_uid=0)
            return real_lstat(path, *args, **kwargs)

        safe_acl = (
            "user::rwx\n"
            f"user:{effective_uid}:rwx\n"
            "group::---\n"
            "mask::rwx\n"
            "other::---\n"
        )
        with mock.patch.object(Path, "lstat", root_owned_home_lstat), mock.patch.object(
            contracts, "_trusted_getfacl_path", return_value="/usr/bin/getfacl"
        ), mock.patch.object(
            contracts.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, safe_acl, ""),
        ):
            environment = module.credential_free_proxy_env(
                {"DRCLAW_CA_BUNDLE": str(ca_bundle)}
            )
            self.assertEqual(environment["SSL_CERT_FILE"], str(ca_bundle))

        unsafe_acl = safe_acl + "user:999999:rwx\n"
        with mock.patch.object(Path, "lstat", root_owned_home_lstat), mock.patch.object(
            contracts, "_trusted_getfacl_path", return_value="/usr/bin/getfacl"
        ), mock.patch.object(
            contracts.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, unsafe_acl, ""),
        ):
            with self.assertRaisesRegex(module.BootstrapError, "safe absolute CA file"):
                module.credential_free_proxy_env({"DRCLAW_CA_BUNDLE": str(ca_bundle)})

    def test_safe_temp_and_read_only_git_ignore_operator_injection(self) -> None:
        module = load_bootstrap_module()
        contracts = sys.modules["codex_contracts"]
        weak = self.root / "weak-tmp"
        weak.mkdir(mode=0o700)
        weak.chmod(0o777)
        symlink = self.root / "tmp-link"
        symlink.symlink_to(weak, target_is_directory=True)
        for candidate in (".", str(weak), str(symlink)):
            with self.subTest(candidate=candidate):
                selected = contracts.select_safe_temp_root(
                    {"TMPDIR": candidate},
                    excluded_roots=(REPO_ROOT, self.home, self.codex_home),
                )
                self.assertEqual(selected, Path("/tmp"))

        site_bin = self.home / "site" / "bin"
        site_bin.mkdir(parents=True)
        site_git = site_bin / "git"
        site_git.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        site_git.chmod(0o700)
        with mock.patch.object(contracts, "TRUSTED_GIT_CANDIDATES", ()), mock.patch.object(
            contracts,
            "_trusted_read_only_executable",
            side_effect=lambda candidate, _: site_git.resolve()
            if candidate == site_git
            else None,
        ), mock.patch.dict(os.environ, {"PATH": str(site_bin)}, clear=False):
            command = contracts.read_only_git_command(["status", "--porcelain"])
        self.assertEqual(command[0], str(site_git.resolve()))
        environment = contracts.read_only_git_environment()
        self.assertEqual(environment["GIT_OPTIONAL_LOCKS"], "0")
        self.assertEqual(environment["GIT_CONFIG_GLOBAL"], os.devnull)
        self.assertNotIn("OPENAI_API_KEY", environment)

    def test_read_only_git_does_not_touch_index_or_execute_local_fsmonitor(self) -> None:
        module = load_bootstrap_module()
        repository = self.root / "git-receipt-fixture"
        repository.mkdir()
        git = str(sys.modules["codex_contracts"].resolve_read_only_git())
        subprocess.run([git, "init", "-q", str(repository)], check=True)
        subprocess.run([git, "-C", str(repository), "config", "user.email", "fixture@example.invalid"], check=True)
        subprocess.run([git, "-C", str(repository), "config", "user.name", "Fixture"], check=True)
        (repository / "tracked.txt").write_text("fixture\n", encoding="utf-8")
        subprocess.run([git, "-C", str(repository), "add", "tracked.txt"], check=True)
        subprocess.run([git, "-C", str(repository), "commit", "-qm", "fixture"], check=True)
        marker = self.root / "fsmonitor-executed"
        hook = repository / "fake-fsmonitor"
        hook.write_text(f"#!/bin/sh\ntouch {shlex.quote(str(marker))}\nexit 0\n", encoding="utf-8")
        hook.chmod(0o700)
        subprocess.run(
            [git, "-C", str(repository), "config", "core.fsmonitor", str(hook)],
            check=True,
        )
        index = repository / ".git/index"
        before_bytes = index.read_bytes()
        before_mtime = index.stat().st_mtime_ns
        with mock.patch.dict(
            os.environ,
            {"OPENAI_API_KEY": "must-not-pass", "GIT_CONFIG_GLOBAL": str(self.root / "evil")},
            clear=False,
        ):
            state = module.git_state(repository)
        self.assertIsInstance(state["revision"], str)
        self.assertFalse(marker.exists())
        self.assertEqual(index.read_bytes(), before_bytes)
        self.assertEqual(index.stat().st_mtime_ns, before_mtime)

    def test_isolated_python_entrypoints_ignore_pythonpath_and_leave_no_new_pyc(self) -> None:
        malicious = self.root / "malicious-pythonpath"
        malicious.mkdir()
        marker = self.root / "sitecustomize-executed"
        (malicious / "sitecustomize.py").write_text(
            f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\n",
            encoding="utf-8",
        )
        pycache = REPO_ROOT / "bootstrap/codex/__pycache__"
        before = {
            (path.name, path.stat().st_mtime_ns, path.read_bytes())
            for path in pycache.glob("*.pyc")
        } if pycache.exists() else set()
        environment = os.environ.copy()
        environment["PYTHONPATH"] = str(malicious)
        environment.pop("PYTHONDONTWRITEBYTECODE", None)
        for script in (BOOTSTRAP, REPO_ROOT / "bootstrap/codex/install_app.py"):
            result = subprocess.run(
                [sys.executable, "-I", "-S", str(script), "--help"],
                cwd=str(REPO_ROOT),
                env=environment,
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, msg=result.stderr)
        after = {
            (path.name, path.stat().st_mtime_ns, path.read_bytes())
            for path in pycache.glob("*.pyc")
        } if pycache.exists() else set()
        self.assertFalse(marker.exists())
        self.assertEqual(after, before)
    def write_contract_fake_codex(
        self,
        version: str,
        *,
        valid_discovery: bool = True,
        plugin_payload: str = '{"installed": [], "available": []}',
    ) -> Path:
        fake_bin = self.home / ".local" / "bin"
        fake_bin.mkdir(parents=True, exist_ok=True)
        fake_codex = fake_bin / "codex"
        discovery_lines = (
            "    home = pathlib.Path(os.environ['HOME'])\n"
            f"    text = {BEGIN_MARKER!r} + '\\n' + {END_MARKER!r}\n"
            "    for name in ['drclaw-skill-library']:\n"
            "        text += f'\\n- {name}: contract (file: {home}/.agents/skills/{name}/SKILL.md)'\n"
            if valid_discovery
            else "    text = 'no managed guidance or skills'\n"
        )
        fake_codex.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, pathlib, sys\n"
            "args = sys.argv[1:]\n"
            "if args == ['--version']:\n"
            f"    print('codex-cli {version}')\n"
            "elif args == ['debug', 'prompt-input', 'drclaw-bootstrap-contract-probe']:\n"
            + discovery_lines
            + "    print(json.dumps([{'type': 'message', 'role': 'developer', "
            "'content': [{'type': 'input_text', 'text': text}]}]))\n"
            "elif args == ['plugin', 'list', '--json']:\n"
            f"    print({plugin_payload!r})\n"
            "else:\n"
            "    raise SystemExit(7)\n",
            encoding="utf-8",
        )
        fake_codex.chmod(0o755)
        return fake_codex

    def make_managed_release(self, revision: str, label: str) -> Path:
        release = self.home / ".local" / "share" / "drclaw" / "releases" / revision
        for relative, name in (
            ("bootstrap/codex/skills/drclaw-skill-library", "drclaw-skill-library"),
            ("bootstrap/codex/vendor/ncsa-delta", "ncsa-delta"),
        ):
            source = release / relative
            source.mkdir(parents=True, mode=0o700)
            (source / "SKILL.md").write_text(
                f"---\nname: {name}\ndescription: {label}\n---\n\n{label}\n",
                encoding="utf-8",
            )
        templates = release / "bootstrap" / "codex" / "templates"
        templates.mkdir(parents=True, exist_ok=True)
        shutil.copy2(REPO_ROOT / "bootstrap/codex/templates/config.safe.toml", templates)
        shutil.copy2(REPO_ROOT / "bootstrap/codex/templates/config.current-delta.toml", templates)
        return release

    def managed_installer_args(self, *extra: str):
        module = load_bootstrap_module()
        return module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
                "--no-doctor",
                *extra,
            ]
        )

    def write_managed_skill_state(
        self,
        release: Path,
        revision: str,
        *,
        mode: str = "symlink",
        names=("drclaw-skill-library", "ncsa-delta"),
        config_profile: str = "safe",
    ) -> dict:
        module = load_bootstrap_module()
        sources = {
            name: module.Installer.skill_source_in_checkout(release, name) for name in names
        }
        template = release / "bootstrap/codex/templates" / f"config.{config_profile}.toml"
        state = {
            "schema_version": 1,
            "bundle_version": "fixture",
            "installed_at": "fixture",
            "repo_root": str(release),
            "git": {
                "revision": revision,
                "dirty": False,
                "status_sha256": hashlib.sha256(b"").hexdigest(),
            },
            "config_profile": config_profile,
            "skill_install_mode": mode,
            "managed_skills": list(names),
            "managed_skill_digests": {
                name: module.directory_digest(source) for name, source in sources.items()
            },
            "managed_guidance_sha256": "0" * 64,
            "managed_config_sha256": hashlib.sha256(template.read_bytes()).hexdigest(),
            "managed_plugins": [],
        }
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        state_path.write_text(json.dumps(state), encoding="utf-8")
        state_path.chmod(0o600)
        return state

    def write_fake_managed_cli_environment(self, *, smoke_ok: bool = True):
        module = load_bootstrap_module()
        cli_root = self.home / ".local" / "share" / "drclaw" / "cli"
        environments_root = cli_root / "environments"
        environment_root = environments_root / "drclaw-cli-fixture"
        cache_root = cli_root / "pip-cache"
        temporary_root = cli_root / "tmp"
        for path in (cli_root, environments_root, environment_root, cache_root, temporary_root):
            path.mkdir(parents=True, exist_ok=True, mode=0o700)
            path.chmod(0o700)

        source_root = environment_root / "source"
        source_root.mkdir()
        (source_root / "fixture.py").write_text("VALUE = 1\n", encoding="utf-8")
        source_module = source_root / "cli_anything" / "drclaw" / "drclaw_cli.py"
        source_module.parent.mkdir(parents=True)
        source_module.write_text("# managed CLI import fixture\n", encoding="utf-8")
        lock_path = environment_root / "requirements.lock"
        shutil.copy2(module.DRCLAW_CLI_LOCK_PATH, lock_path)
        lock_path.chmod(0o400)
        repo_root_path = environment_root / "repo-root"
        repo_root_path.write_text(str(REPO_ROOT) + "\n", encoding="utf-8")
        repo_root_path.chmod(0o400)
        runner_path = environment_root / "runner.py"
        runner_path.write_text(module.drclaw_cli_runner_content(), encoding="utf-8")
        runner_path.chmod(0o500)

        python_path = environment_root / "venv" / "bin" / "python"
        python_path.parent.mkdir(parents=True)
        python_identity = {
            "version": [3, 9, 99],
            "cache_tag": "cpython-fixture",
            "system": "Linux",
            "machine": "x86_64",
            "executable": str(python_path),
            "resolved_executable": str(python_path.resolve()),
        }
        distributions = module.parse_drclaw_cli_lock(lock_path)
        smoke_identity = {"module_file": str(source_module.resolve())}
        smoke_action = (
            f"printf '%s\\n' {shlex.quote(json.dumps(smoke_identity, sort_keys=True))}"
            if smoke_ok
            else "exit 9"
        )
        help_action = "exit 0" if smoke_ok else "exit 9"
        python_path.write_text(
            "#!/bin/sh\n"
            "if [ \"$1\" = \"-m\" ]; then exit 0; fi\n"
            f"if [ \"$1\" != \"-c\" ] && [ \"$3\" = \"--help\" ]; then {help_action}; fi\n"
            "case \"$2\" in\n"
            f"  *managed_cli_import_probe*) {smoke_action} ;;\n"
            f"  *importlib.metadata*) printf '%s\\n' {shlex.quote(json.dumps(distributions, sort_keys=True))} ;;\n"
            f"  *) printf '%s\\n' {shlex.quote(json.dumps(python_identity, sort_keys=True))} ;;\n"
            "esac\n",
            encoding="utf-8",
        )
        python_path.chmod(0o700)

        launchers = {}
        bin_root = self.home / ".local" / "bin"
        bin_root.mkdir(parents=True)
        for name, entry_point in module.DRCLAW_CLI_LAUNCHERS.items():
            launcher_path = bin_root / name
            content = module.drclaw_cli_launcher_content(python_path, runner_path, entry_point)
            launcher_path.write_text(content, encoding="utf-8")
            launcher_path.chmod(0o755)
            launchers[name] = {
                "path": str(launcher_path),
                "sha256": module.hashlib.sha256(content.encode("utf-8")).hexdigest(),
            }

        current_git = module.git_state(REPO_ROOT)
        receipt = {
            "schema_version": module.DRCLAW_CLI_ENVIRONMENT_SCHEMA,
            "bundle_version": "fixture",
            "environment_id": environment_root.name,
            "environment_root": str(environment_root),
            "git_revision": str(current_git.get("revision") or "unversioned"),
            "git_dirty": current_git.get("dirty"),
            "git_status_sha256": current_git.get("status_sha256"),
            "installed_at": "2026-08-19T00:00:00+00:00",
            "repo_root": str(REPO_ROOT),
            "repo_root_path": str(repo_root_path),
            "repo_root_sha256": module.sha256_file(repo_root_path),
            "source_root": str(source_root),
            "source_sha256": module.directory_digest(source_root),
            "lock_path": str(lock_path),
            "lock_sha256": module.sha256_file(lock_path),
            "locked_dependencies": distributions,
            "observed_distributions": distributions,
            "python": python_identity,
            "runner_path": str(runner_path),
            "runner_sha256": module.sha256_file(runner_path),
            "launchers": launchers,
        }
        receipt_path = environment_root / "receipt.json"
        module.atomic_write(
            receipt_path,
            json.dumps(receipt, indent=2, sort_keys=True) + "\n",
            mode=0o600,
        )
        cli_state = {
            key: receipt[key]
            for key in (
                "environment_id",
                "environment_root",
                "git_revision",
                "git_dirty",
                "git_status_sha256",
                "repo_root",
                "repo_root_sha256",
                "source_sha256",
                "lock_sha256",
                "launchers",
            )
        }
        cli_state["receipt_sha256"] = module.sha256_file(receipt_path)
        return module, environment_root, cli_state

    def test_drclaw_cli_lock_is_exact_and_hash_complete(self) -> None:
        module = load_bootstrap_module()
        dependencies = module.parse_drclaw_cli_lock()

        self.assertEqual(set(dependencies), module.DRCLAW_CLI_LOCKED_PACKAGES)
        self.assertEqual(dependencies["pip"], "25.2")
        self.assertEqual(dependencies["setuptools"], "80.9.0")
        self.assertEqual(dependencies["wheel"], "0.45.1")
        for line in module.DRCLAW_CLI_LOCK_PATH.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                self.assertRegex(line, r"^[A-Za-z0-9_.-]+==[^\s]+ --hash=sha256:[0-9a-f]{64}$")

    def test_drclaw_cli_subprocess_environment_drops_secret_bearing_inputs(self) -> None:
        module = load_bootstrap_module()
        sentinel = "drclaw-secret-sentinel"
        secret_inputs = {
            "PIP_INDEX_URL": f"https://user:{sentinel}@example.invalid/simple",
            "PIP_EXTRA_INDEX_URL": f"https://token:{sentinel}@example.invalid/simple",
            "API_TOKEN": sentinel,
        }
        safe_network_inputs = {
            "http_proxy": "http://proxy.example.invalid:3128",
            "no_proxy": "localhost,127.0.0.1",
        }
        with mock.patch.dict(os.environ, {**secret_inputs, **safe_network_inputs}, clear=False):
            environment = module.drclaw_cli_subprocess_env(
                self.home,
                self.root / "cache",
                self.root / "tmp",
                os.environ,
            )

        serialized = json.dumps(environment, sort_keys=True)
        self.assertNotIn(sentinel, serialized)
        self.assertTrue(set(secret_inputs).isdisjoint(environment))
        self.assertEqual(environment["PIP_CONFIG_FILE"], os.devnull)
        self.assertEqual(environment["PATH"], os.defpath)
        self.assertEqual(environment["http_proxy"], safe_network_inputs["http_proxy"])
        self.assertEqual(environment["no_proxy"], safe_network_inputs["no_proxy"])

        for invalid in (
            {"HTTPS_PROXY": f"https://user:{sentinel}@proxy.invalid"},
            {"REQUESTS_CA_BUNDLE": f"/tmp/{sentinel}"},
        ):
            with self.subTest(invalid=next(iter(invalid))):
                with self.assertRaises(module.BootstrapError) as caught:
                    module.drclaw_cli_subprocess_env(
                        self.home,
                        self.root / "cache",
                        self.root / "tmp",
                        invalid,
                    )
                self.assertNotIn(sentinel, str(caught.exception))

    def test_drclaw_cli_dry_run_is_write_free_and_fail_closed_on_launcher_conflict(self) -> None:
        launcher = self.home / ".local" / "bin" / "drclaw"
        launcher.parent.mkdir(parents=True)
        original = "operator-owned launcher\n"
        launcher.write_text(original, encoding="utf-8")

        refused = self.run_bootstrap(
            "install",
            "--skip-delta-skill",
            "--with-drclaw-cli",
            "--dry-run",
        )
        self.assertEqual(refused.returncode, 2)
        self.assertIn("launcher drift or ownership conflict", refused.stderr)
        self.assertEqual(launcher.read_text(encoding="utf-8"), original)
        self.assertFalse((self.home / ".local" / "share" / "drclaw").exists())

        replace_preview = self.run_bootstrap(
            "install",
            "--skip-delta-skill",
            "--with-drclaw-cli",
            "--replace",
            "--dry-run",
        )
        self.assert_success(replace_preview)
        self.assertIn("would archive atomically", replace_preview.stdout)
        self.assertEqual(launcher.read_text(encoding="utf-8"), original)
        self.assertFalse((self.home / ".local" / "share" / "drclaw").exists())

    def test_managed_drclaw_cli_doctor_detects_launcher_drift_without_network(self) -> None:
        module, _, cli_state = self.write_fake_managed_cli_environment()
        args = argparse.Namespace(home=str(self.home), codex_home=str(self.codex_home))
        doctor = module.Doctor(args, REPO_ROOT, {"bundle_version": "fixture"})
        doctor.check_drclaw_cli({"drclaw_cli": cli_state})
        managed = next(check for check in doctor.checks if check.name == "drclaw-cli-managed")
        self.assertEqual(managed.level, "PASS")

        launcher = self.home / ".local" / "bin" / "drclaw"
        launcher.write_text("#!/bin/sh\nexit 9\n", encoding="utf-8")
        corrupted = module.Doctor(args, REPO_ROOT, {"bundle_version": "fixture"})
        corrupted.check_drclaw_cli({"drclaw_cli": cli_state})
        drift = next(check for check in corrupted.checks if check.name == "drclaw-cli-managed")
        self.assertEqual(drift.level, "FAIL")
        self.assertIn("launcher content drifted", drift.detail)

    def test_managed_drclaw_cli_doctor_requires_import_and_entrypoint_smoke(self) -> None:
        module, _, cli_state = self.write_fake_managed_cli_environment(smoke_ok=False)
        args = argparse.Namespace(home=str(self.home), codex_home=str(self.codex_home))

        doctor = module.Doctor(args, REPO_ROOT, {"bundle_version": "fixture"})
        doctor.check_drclaw_cli({"drclaw_cli": cli_state})

        managed = next(check for check in doctor.checks if check.name == "drclaw-cli-managed")
        self.assertEqual(managed.level, "FAIL")
        self.assertIn("import smoke test failed", managed.detail)

    def test_managed_drclaw_cli_doctor_rejects_writable_path_ancestor(self) -> None:
        module, _, cli_state = self.write_fake_managed_cli_environment()
        bin_root = self.home / ".local" / "bin"
        bin_root.chmod(0o777)
        args = argparse.Namespace(home=str(self.home), codex_home=str(self.codex_home))

        doctor = module.Doctor(args, REPO_ROOT, {"bundle_version": "fixture"})
        doctor.check_drclaw_cli({"drclaw_cli": cli_state})

        managed = next(check for check in doctor.checks if check.name == "drclaw-cli-managed")
        self.assertEqual(managed.level, "FAIL")
        self.assertIn("group/world writable", managed.detail)

    def test_drclaw_cli_rejects_group_writable_launcher_directory_before_writes(self) -> None:
        bin_root = self.home / ".local" / "bin"
        bin_root.mkdir(parents=True)
        bin_root.chmod(0o777)

        result = self.run_bootstrap(
            "install",
            "--skip-delta-skill",
            "--with-drclaw-cli",
            "--dry-run",
        )

        self.assertEqual(result.returncode, 2)
        self.assertIn("group/world writable", result.stderr)
        self.assertFalse((self.home / ".local" / "share" / "drclaw").exists())

    def test_drclaw_cli_runtime_preflight_precedes_every_target_write(self) -> None:
        module = load_bootstrap_module()
        args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
                "--skip-delta-skill",
                "--with-drclaw-cli",
                "--no-doctor",
            ]
        )
        installer = module.Installer(args, REPO_ROOT, module.load_manifest())
        with mock.patch.object(
            installer,
            "preflight_drclaw_cli_runtime",
            side_effect=module.BootstrapError("simulated missing venv/ensurepip"),
        ) as preflight, mock.patch.object(installer, "prepare_codex_home") as prepare:
            with self.assertRaisesRegex(module.BootstrapError, "missing venv/ensurepip"):
                installer.run()

        preflight.assert_called_once_with()
        prepare.assert_not_called()

    def test_drclaw_cli_dry_run_runtime_preflight_creates_no_target_temporary_files(self) -> None:
        module = load_bootstrap_module()
        args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
                "--with-drclaw-cli",
                "--dry-run",
                "--no-doctor",
            ]
        )
        installer = module.Installer(args, REPO_ROOT, module.load_manifest())
        before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        filesystem = mock.MagicMock(f_flag=0)

        with mock.patch.object(
            installer, "drclaw_cli_contract", return_value={}
        ), mock.patch.object(
            installer, "load_prior_drclaw_cli_state", return_value=None
        ), mock.patch.object(
            module.os, "ST_NOEXEC", 8, create=True
        ), mock.patch.object(
            module.os, "statvfs", return_value=filesystem
        ), mock.patch.object(
            module.tempfile,
            "TemporaryDirectory",
            side_effect=AssertionError("dry-run attempted a temporary target directory"),
        ) as temporary_directory, mock.patch.object(
            Path,
            "mkdir",
            side_effect=AssertionError("dry-run attempted to create a target directory"),
        ) as mkdir:
            installer.preflight_drclaw_cli_runtime()

        temporary_directory.assert_not_called()
        mkdir.assert_not_called()
        self.assertEqual(
            sorted(path.relative_to(self.home) for path in self.home.rglob("*")),
            before,
        )
        self.assertEqual(filesystem.f_flag, 0)

    def test_drclaw_cli_probe_ignores_relative_tmpdir_and_uses_target_exec_filesystem(self) -> None:
        module = load_bootstrap_module()
        args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
                "--with-drclaw-cli",
                "--no-doctor",
            ]
        )
        installer = module.Installer(args, REPO_ROOT, module.load_manifest())
        observed_roots = []

        def fake_run(command, **kwargs):
            if command[1:3] == ["-m", "venv"]:
                probe_venv = Path(command[-1])
                probe_python = probe_venv / "bin" / "python"
                probe_python.parent.mkdir(parents=True)
                probe_python.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
                probe_python.chmod(0o700)
                observed_roots.append(probe_venv.parent)
            return subprocess.CompletedProcess(command, 0, "", "")

        filesystem = mock.MagicMock(f_flag=0)
        with mock.patch.dict(os.environ, {"TMPDIR": "."}, clear=False), mock.patch.object(
            installer, "drclaw_cli_contract", return_value={}
        ), mock.patch.object(installer, "load_prior_drclaw_cli_state", return_value=None), mock.patch.object(
            module.os, "ST_NOEXEC", 8, create=True
        ), mock.patch.object(module.os, "statvfs", return_value=filesystem) as statvfs, mock.patch.object(
            module.subprocess, "run", side_effect=fake_run
        ):
            installer.preflight_drclaw_cli_runtime()

        self.assertEqual(len(observed_roots), 1)
        self.assertTrue(observed_roots[0].is_relative_to(self.home))
        self.assertFalse(observed_roots[0].exists())
        self.assertEqual(statvfs.call_args.args[0], self.home)

    def test_drclaw_cli_launcher_preserves_spaces_and_metacharacters(self) -> None:
        module = load_bootstrap_module()
        spaced_root = self.root / "managed CLI with spaces"
        python_path = spaced_root / "venv bin" / "python"
        runner_path = spaced_root / "runner with spaces.py"
        capture_path = spaced_root / "captured.json"
        python_path.parent.mkdir(parents=True)
        runner_path.write_text("# fixture\n", encoding="utf-8")
        python_path.write_text(
            "#!/bin/sh\n"
            "python3 -c 'import json, os, sys; "
            "open(os.environ[\"DRCLAW_CAPTURE\"], \"w\").write(json.dumps(sys.argv[1:]))' \"$@\"\n",
            encoding="utf-8",
        )
        python_path.chmod(0o700)
        launcher = spaced_root / "launcher"
        launcher.write_text(
            module.drclaw_cli_launcher_content(python_path, runner_path, "drclaw"),
            encoding="utf-8",
        )
        launcher.chmod(0o700)
        arguments = ["argument with spaces", "$(touch should-not-run)", "semi;colon", "single'quote"]
        environment = os.environ.copy()
        environment["DRCLAW_CAPTURE"] = str(capture_path)

        result = subprocess.run(
            [str(launcher), *arguments],
            check=False,
            capture_output=True,
            text=True,
            env=environment,
            cwd=str(self.root),
        )

        self.assert_success(result)
        captured = json.loads(capture_path.read_text(encoding="utf-8"))
        self.assertEqual(captured, [str(runner_path), "drclaw", *arguments])
        self.assertFalse((self.root / "should-not-run").exists())

    def test_drclaw_cli_runner_seals_server_path_against_operator_environment(self) -> None:
        module = load_bootstrap_module()
        environment_root = self.root / "sealed-runner"
        source_module = (
            environment_root / "source" / "cli_anything" / "drclaw" / "drclaw_cli.py"
        )
        source_module.parent.mkdir(parents=True)
        capture = environment_root / "captured-server-path"
        source_module.write_text(
            "import os\n"
            "def cli():\n"
            "    open(os.environ['DRCLAW_CAPTURE'], 'w').write(os.environ['DRCLAW_SERVER_PATH'])\n"
            "vibelab_cli = cli\n",
            encoding="utf-8",
        )
        approved_repo = "/approved/immutable/release"
        (environment_root / "repo-root").write_text(approved_repo + "\n", encoding="utf-8")
        runner = environment_root / "runner.py"
        runner.write_text(module.drclaw_cli_runner_content(), encoding="utf-8")
        environment = os.environ.copy()
        environment.update(
            {
                "DRCLAW_SERVER_PATH": "/operator/evil/path",
                "DRCLAW_CAPTURE": str(capture),
                "PYTHONDONTWRITEBYTECODE": "1",
            }
        )
        result = subprocess.run(
            [sys.executable, str(runner), "drclaw"],
            cwd=str(environment_root),
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertEqual(capture.read_text(encoding="utf-8"), approved_repo)
        launcher = module.drclaw_cli_launcher_content(
            Path("/managed/python"), Path("/managed/runner.py"), "drclaw"
        )
        self.assertIn("unset PYTHONHOME PYTHONPATH DRCLAW_SERVER_PATH", launcher)

    def test_managed_drclaw_cli_launchers_upgrade_and_roll_back_without_replace(self) -> None:
        module, old_environment, old_state = self.write_fake_managed_cli_environment()
        old_receipt = json.loads(
            (old_environment / "receipt.json").read_text(encoding="utf-8")
        )
        new_environment = old_environment.parent / "new managed environment with spaces"
        new_python = new_environment / "venv" / "bin" / "python"
        new_runner = new_environment / "runner.py"
        new_launchers = {}
        for name, entry_point in module.DRCLAW_CLI_LAUNCHERS.items():
            content = module.drclaw_cli_launcher_content(new_python, new_runner, entry_point)
            new_launchers[name] = {
                "path": str(self.home / ".local" / "bin" / name),
                "sha256": module.hashlib.sha256(content.encode("utf-8")).hexdigest(),
            }
        new_receipt = {
            "environment_root": str(new_environment),
            "runner_path": str(new_runner),
            "launchers": new_launchers,
        }
        args = argparse.Namespace(
            home=str(self.home),
            codex_home=str(self.codex_home),
            replace=False,
            dry_run=False,
        )

        upgrader = module.Installer(args, REPO_ROOT, {"bundle_version": "fixture"})
        upgrader.install_drclaw_cli_launchers(new_receipt, old_state)
        for name, entry_point in module.DRCLAW_CLI_LAUNCHERS.items():
            launcher = self.home / ".local" / "bin" / name
            self.assertEqual(
                launcher.read_text(encoding="utf-8"),
                module.drclaw_cli_launcher_content(new_python, new_runner, entry_point),
            )

        rollback_state = {"launchers": new_launchers}
        rollback = module.Installer(args, REPO_ROOT, {"bundle_version": "fixture"})
        rollback.install_drclaw_cli_launchers(old_receipt, rollback_state)
        old_python = old_environment / "venv" / "bin" / "python"
        old_runner = old_environment / "runner.py"
        for name, entry_point in module.DRCLAW_CLI_LAUNCHERS.items():
            launcher = self.home / ".local" / "bin" / name
            self.assertEqual(
                launcher.read_text(encoding="utf-8"),
                module.drclaw_cli_launcher_content(old_python, old_runner, entry_point),
            )

    def test_invalid_drclaw_cli_state_is_rejected_without_echoing_unknown_values(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        sentinel = "drclaw-cli-state-secret-sentinel"
        state["drclaw_cli"] = {"unexpected_token": sentinel}
        state_path.write_text(json.dumps(state), encoding="utf-8")

        rerun = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")

        self.assertEqual(rerun.returncode, 2)
        self.assertIn("unexpected key set", rerun.stderr)
        self.assertNotIn(sentinel, rerun.stdout + rerun.stderr)

    def test_install_codex_dry_run_updates_version_below_portable_minimum(self) -> None:
        fake_codex = self.write_contract_fake_codex("0.146.0")

        result = self.run_bootstrap("install", "--install-codex", "--dry-run")

        self.assert_success(result)
        self.assertIn(f"[UPDATE] {fake_codex}", result.stdout)
        self.assertIn("below the portable minimum 0.147.0", result.stdout)
        self.assertIn("would run official installer", result.stdout)

    def test_install_codex_preserves_compatible_newer_version(self) -> None:
        fake_codex = self.write_contract_fake_codex("0.148.0")

        result = self.run_bootstrap("install", "--install-codex", "--dry-run")

        self.assert_success(result)
        self.assertIn(f"[OK] {fake_codex}", result.stdout)
        self.assertIn("satisfies the portable minimum 0.147.0", result.stdout)
        self.assertNotIn("would run official installer", result.stdout)

    def test_install_codex_refuses_unparseable_existing_version(self) -> None:
        fake_codex = self.write_contract_fake_codex("not-a-version")

        result = self.run_bootstrap("install", "--install-codex", "--dry-run")

        self.assertEqual(result.returncode, 2)
        self.assertIn(f"Cannot determine the installed Codex version at {fake_codex}", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_official_codex_installer_request_uses_explicit_user_agent(self) -> None:
        bootstrap_module = load_bootstrap_module()
        request = bootstrap_module.codex_installer_request()

        self.assertEqual(request.full_url, "https://chatgpt.com/codex/install.sh")
        self.assertEqual(request.get_header("User-agent"), "DrClaw-Codex-Bootstrap/1.0")
        self.assertIn("text/x-shellscript", request.get_header("Accept"))

    def test_symlink_install_is_idempotent_and_preserves_unmanaged_content(self) -> None:
        agents_path = self.codex_home / "AGENTS.md"
        agents_path.write_text("# Operator policy\n\nKeep this unmanaged rule.\n", encoding="utf-8")
        config_path = self.codex_home / "config.toml"
        config_path.write_text(
            'model = "operator-selected"\n'
            'sandbox_permissions = [\n  "disk-full-read-access",\n]\n\n'
            'allowed_commands = [\n  ["git", "status"],\n]\n\n'
            '[features]\ncustom_feature = true\n',
            encoding="utf-8",
        )

        first = self.run_bootstrap("install", "--no-doctor", "--config-profile", "safe")
        self.assert_success(first)

        router = self.home / ".agents" / "skills" / "drclaw-skill-library"
        delta = self.home / ".agents" / "skills" / "ncsa-delta"
        self.assertTrue(router.is_symlink())
        self.assertTrue(delta.is_symlink())
        self.assertEqual(router.resolve(), ROUTER_SOURCE.resolve())
        self.assertEqual(delta.resolve(), DELTA_SOURCE.resolve())

        agents_after_first = agents_path.read_text(encoding="utf-8")
        config_after_first = config_path.read_text(encoding="utf-8")
        self.assertIn("Keep this unmanaged rule.", agents_after_first)
        self.assertEqual(agents_after_first.count(BEGIN_MARKER), 1)
        self.assertEqual(agents_after_first.count(END_MARKER), 1)
        self.assertIn('model = "operator-selected"', config_after_first)
        self.assertIn('sandbox_permissions = [\n  "disk-full-read-access",\n]', config_after_first)
        self.assertIn('allowed_commands = [\n  ["git", "status"],\n]', config_after_first)
        self.assertLess(config_after_first.index('approval_policy = "on-request"'), config_after_first.index("allowed_commands"))
        self.assertIn("[features]\ncustom_feature = true", config_after_first)
        self.assertIn('approval_policy = "on-request"', config_after_first)
        self.assertIn('sandbox_mode = "workspace-write"', config_after_first)
        self.assertEqual(stat.S_IMODE(config_path.stat().st_mode), 0o600)

        second = self.run_bootstrap("install", "--no-doctor", "--config-profile", "safe")
        self.assert_success(second)
        self.assertEqual(agents_path.read_text(encoding="utf-8"), agents_after_first)
        self.assertEqual(config_path.read_text(encoding="utf-8"), config_after_first)
        self.assertIn("already points to the approved source", second.stdout)

        state = json.loads((self.codex_home / "drclaw-bootstrap-state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["skill_install_mode"], "symlink")
        self.assertEqual(state["managed_skills"], ["drclaw-skill-library", "ncsa-delta"])

        doctor = self.run_bootstrap("doctor", "--skip-runtime", "--json")
        self.assert_success(doctor)
        report = json.loads(doctor.stdout)
        self.assertTrue(report["ok"])
        names = {check["name"] for check in report["checks"] if check["level"] == "PASS"}
        self.assertIn("router-validation", names)
        self.assertIn("skill:drclaw-skill-library", names)
        self.assertIn("skill:ncsa-delta", names)

    def test_copy_mode_is_complete_and_idempotent(self) -> None:
        first = self.run_bootstrap("install", "--copy-skills", "--no-doctor")
        self.assert_success(first)

        router = self.home / ".agents" / "skills" / "drclaw-skill-library"
        delta = self.home / ".agents" / "skills" / "ncsa-delta"
        self.assertTrue(router.is_dir())
        self.assertFalse(router.is_symlink())
        self.assertTrue(delta.is_dir())
        self.assertFalse(delta.is_symlink())
        self.assertTrue((router / "scripts" / "query_library.py").is_file())
        self.assertTrue((delta / "references" / "01-access-and-quickstart.md").is_file())
        self.assertTrue((delta / "scripts" / "delta-doctor.sh").is_file())

        second = self.run_bootstrap("install", "--copy-skills", "--no-doctor")
        self.assert_success(second)
        self.assertGreaterEqual(second.stdout.count("installed copy already matches"), 2)
        self.assertFalse((self.codex_home / "drclaw-backups").exists())

        state = json.loads((self.codex_home / "drclaw-bootstrap-state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["skill_install_mode"], "copy")

        # A copied router cannot discover the checkout through its own path.
        # It must follow the secret-free bootstrap state from an unrelated cwd.
        environment = os.environ.copy()
        environment.update({"HOME": str(self.home), "CODEX_HOME": str(self.codex_home)})
        query = subprocess.run(
            [
                sys.executable,
                str(router / "scripts" / "query_library.py"),
                "--resolve",
                "huggingface-accelerate",
                "--format",
                "paths",
            ],
            cwd=str(self.root),
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assert_success(query)
        self.assertIn("skills/distributed-training/accelerate/SKILL.md", query.stdout)

    def test_managed_skills_upgrade_across_releases_and_install_modes_without_replace(self) -> None:
        module = load_bootstrap_module()
        revision_a = "a" * 40
        revision_b = "b" * 40
        release_a = self.make_managed_release(revision_a, "release-a")
        release_b = self.make_managed_release(revision_b, "release-b")
        destination = self.home / ".agents/skills/drclaw-skill-library"
        destination.parent.mkdir(parents=True)
        source_a = module.Installer.skill_source_in_checkout(release_a, destination.name)
        source_b = module.Installer.skill_source_in_checkout(release_b, destination.name)
        destination.symlink_to(source_a, target_is_directory=True)
        self.write_managed_skill_state(release_a, revision_a)

        def clean_git(path):
            return {
                "revision": Path(path).name,
                "dirty": False,
                "status_sha256": hashlib.sha256(b"").hexdigest(),
            }

        with mock.patch.object(module, "git_state", side_effect=clean_git):
            atomic = module.Installer(
                self.managed_installer_args(),
                release_b,
                {"bundle_version": "fixture"},
            )
            atomic.install_skill(destination.name, source_b)
            self.assertEqual(destination.resolve(), source_b)
            self.assertTrue(atomic.skill_transaction_root().exists())
            interrupted_retry = module.Installer(
                self.managed_installer_args(),
                release_b,
                {"bundle_version": "fixture"},
            )
            interrupted_retry.recover_managed_skill_transactions()
            self.assertEqual(destination.resolve(), source_a)
            self.assertFalse(interrupted_retry.skill_transaction_root().exists())

            dry = module.Installer(
                self.managed_installer_args("--copy-skills", "--dry-run"),
                release_b,
                {"bundle_version": "fixture"},
            )
            dry.install_skill(destination.name, source_b)
            self.assertTrue(destination.is_symlink())
            self.assertEqual(destination.resolve(), source_a)

            upgrade = module.Installer(
                self.managed_installer_args("--copy-skills"),
                release_b,
                {"bundle_version": "fixture"},
            )
            upgrade.install_skill(destination.name, source_b)
            self.assertFalse(destination.is_symlink())
            self.assertEqual(module.directory_digest(destination), module.directory_digest(source_b))
            self.write_managed_skill_state(
                release_b,
                revision_b,
                mode="copy",
                names=("drclaw-skill-library", "ncsa-delta"),
            )
            upgrade.finalize_managed_skill_transactions()

            rollback = module.Installer(
                self.managed_installer_args(),
                release_a,
                {"bundle_version": "fixture"},
            )
            rollback.install_skill(destination.name, source_a)
            self.assertTrue(destination.is_symlink())
            self.assertEqual(destination.resolve(), source_a)
            self.write_managed_skill_state(release_a, revision_a)
            rollback.finalize_managed_skill_transactions()

    def test_v01_peer_metadata_lock_normalization_permits_only_managed_skill_migration(self) -> None:
        module = load_bootstrap_module()
        revision = "e" * 40
        release_root = self.home / ".local" / "share" / "drclaw" / "releases"
        old_release = release_root / revision
        old_source = old_release / "bootstrap" / "codex" / "skills" / "drclaw-skill-library"
        old_source.mkdir(parents=True, mode=0o700)
        (old_source / "SKILL.md").write_text(
            "---\nname: drclaw-skill-library\ndescription: legacy fixture\n---\n",
            encoding="utf-8",
        )
        (old_release / "package-lock.json").write_text(
            json.dumps({"lockfileVersion": 3, "packages": {"": {}, "node_modules/demo": {}}}),
            encoding="utf-8",
        )
        legacy_setup = old_release / "agent-harness" / "setup.py"
        legacy_setup.parent.mkdir(parents=True, exist_ok=True)
        legacy_setup.write_text(
            "entry_points={\n"
            "'console_scripts': [\n"
            "'drclaw=cli_anything.drclaw.drclaw_cli:cli',\n"
            "'dr-claw=cli_anything.drclaw.drclaw_cli:cli',\n"
            "'vibelab=cli_anything.drclaw.drclaw_cli:vibelab_cli',\n"
            "]\n}\n",
            encoding="utf-8",
        )
        subprocess.run(["git", "init", "-q", str(old_release)], check=True, timeout=20)
        subprocess.run(
            ["git", "-C", str(old_release), "config", "user.name", "Dr Claw Test"],
            check=True,
            timeout=20,
        )
        subprocess.run(
            ["git", "-C", str(old_release), "config", "user.email", "test@invalid.example"],
            check=True,
            timeout=20,
        )
        subprocess.run(["git", "-C", str(old_release), "add", "-A"], check=True, timeout=20)
        subprocess.run(["git", "-C", str(old_release), "commit", "-q", "-m", "legacy"], check=True, timeout=20)
        actual_revision = subprocess.run(
            ["git", "-C", str(old_release), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        ).stdout.strip()
        self.assertNotEqual(actual_revision, revision)
        renamed_release = release_root / actual_revision
        old_release.rename(renamed_release)
        old_release = renamed_release
        lock_path = old_release / "package-lock.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["packages"]["node_modules/demo"]["peer"] = True
        lock_path.write_text(json.dumps(lock), encoding="utf-8")

        state = {
            "schema_version": 1,
            "bundle_version": "0.1.0",
            "repo_root": str(old_release),
            "git": {
                "revision": actual_revision,
                "dirty": False,
                "status_sha256": hashlib.sha256(b"").hexdigest(),
            },
        }
        (self.codex_home / "drclaw-bootstrap-state.json").write_text(
            json.dumps(state), encoding="utf-8"
        )
        legacy_bin = self.home / ".local" / "bin"
        legacy_bin.mkdir(parents=True, exist_ok=True)
        for name in module.DRCLAW_CLI_LAUNCHERS:
            (legacy_bin / name).write_text(
                "#!/usr/bin/python3\n"
                f"# EASY-INSTALL-ENTRY-SCRIPT: 'cli-anything-drclaw','console_scripts','{name}'\n"
                f"sys.exit(load_entry_point('cli-anything-drclaw', 'console_scripts', '{name}')())\n",
                encoding="utf-8",
            )
            (legacy_bin / name).chmod(0o700)
        installer = module.Installer(
            self.managed_installer_args(), REPO_ROOT, {"bundle_version": "fixture"}
        )
        self.assertEqual(installer.validated_prior_repo(state), old_release)
        self.assertTrue(any(event["status"] == "MIGRATE" for event in installer.events))
        self.assertTrue(installer.legacy_v01_cli_launchers_are_intact())

        lock["packages"]["node_modules/demo"]["version"] = "tampered"
        lock_path.write_text(json.dumps(lock), encoding="utf-8")
        with self.assertRaisesRegex(module.BootstrapError, "checkout drifted"):
            installer.validated_prior_repo(state)

    def test_managed_skill_tamper_requires_replace_and_interrupted_exchange_recovers(self) -> None:
        module = load_bootstrap_module()
        revision_a = "c" * 40
        revision_b = "d" * 40
        release_a = self.make_managed_release(revision_a, "release-a")
        release_b = self.make_managed_release(revision_b, "release-b")
        name = "drclaw-skill-library"
        source_a = module.Installer.skill_source_in_checkout(release_a, name)
        source_b = module.Installer.skill_source_in_checkout(release_b, name)
        destination = self.home / ".agents/skills" / name
        destination.parent.mkdir(parents=True)
        destination.symlink_to(source_a, target_is_directory=True)
        self.write_managed_skill_state(release_a, revision_a)

        def clean_git(path):
            return {
                "revision": Path(path).name,
                "dirty": False,
                "status_sha256": hashlib.sha256(b"").hexdigest(),
            }

        destination.unlink()
        tampered = self.root / "tampered-skill"
        shutil.copytree(source_a, tampered)
        (tampered / "SKILL.md").write_text("tampered\n", encoding="utf-8")
        destination.symlink_to(tampered, target_is_directory=True)
        with mock.patch.object(module, "git_state", side_effect=clean_git):
            refused = module.Installer(
                self.managed_installer_args(), release_b, {"bundle_version": "fixture"}
            )
            with self.assertRaises(module.BootstrapError):
                refused.install_skill(name, source_b)
            replacing = module.Installer(
                self.managed_installer_args("--replace"),
                release_b,
                {"bundle_version": "fixture"},
            )
            replacing.install_skill(name, source_b)
            self.assertEqual(destination.resolve(), source_b)

            self.write_managed_skill_state(release_b, revision_b)
            destination.unlink()
            destination.symlink_to(source_b, target_is_directory=True)
            interrupted = module.Installer(
                self.managed_installer_args("--copy-skills"),
                release_a,
                {"bundle_version": "fixture"},
            )
            real_replace = module.os.replace

            def interrupt_incoming(source, target):
                if Path(source).name == f"{name}.incoming" and Path(target) == destination:
                    raise OSError("injected interruption")
                return real_replace(source, target)

            with mock.patch.object(module.os, "replace", side_effect=interrupt_incoming):
                with self.assertRaisesRegex(OSError, "injected interruption"):
                    interrupted.install_skill(name, source_a)
            self.assertFalse(os.path.lexists(destination))
            retry = module.Installer(
                self.managed_installer_args("--copy-skills"),
                release_a,
                {"bundle_version": "fixture"},
            )
            retry.recover_managed_skill_transactions()
            self.assertTrue(destination.is_symlink())
            self.assertEqual(destination.resolve(), source_b)
            self.assertFalse(retry.skill_transaction_root().exists())

    def test_delta_skill_policy_transition_is_receipt_proven_and_retryable(self) -> None:
        module = load_bootstrap_module()
        revision = "e" * 40
        release = self.make_managed_release(revision, "release")
        name = "ncsa-delta"
        source = module.Installer.skill_source_in_checkout(release, name)
        destination = self.home / ".agents/skills" / name
        destination.parent.mkdir(parents=True)
        destination.symlink_to(source, target_is_directory=True)
        self.write_managed_skill_state(release, revision)
        clean = {
            "revision": revision,
            "dirty": False,
            "status_sha256": hashlib.sha256(b"").hexdigest(),
        }
        with mock.patch.object(module, "git_state", return_value=clean):
            remover = module.Installer(
                self.managed_installer_args("--skip-delta-skill"),
                release,
                {"bundle_version": "fixture"},
            )
            remover.reconcile_removed_managed_skills()
            self.assertFalse(os.path.lexists(destination))
            retry = module.Installer(
                self.managed_installer_args("--skip-delta-skill"),
                release,
                {"bundle_version": "fixture"},
            )
            retry.recover_managed_skill_transactions()
            self.assertEqual(destination.resolve(), source)

            retry.reconcile_removed_managed_skills()
            self.write_managed_skill_state(
                release,
                revision,
                names=("drclaw-skill-library",),
            )
            retry.finalize_managed_skill_transactions()
            self.assertFalse(os.path.lexists(destination))
            self.assertTrue(list((self.codex_home / "drclaw-backups").glob("*/skills-ncsa-delta")))

            include = module.Installer(
                self.managed_installer_args(), release, {"bundle_version": "fixture"}
            )
            include.install_skill(name, source)
            self.assertEqual(destination.resolve(), source)

    def test_full_run_upgrades_both_skills_and_skip_policy_without_transaction_rollback(self) -> None:
        module = load_bootstrap_module()
        revision_a = "5" * 40
        revision_b = "6" * 40
        release_a = self.make_managed_release(revision_a, "release-a")
        release_b = self.make_managed_release(revision_b, "release-b")

        def clean_git(path):
            resolved = Path(path).resolve()
            revision = revision_a if resolved == release_a else revision_b
            return {
                "revision": revision,
                "dirty": False,
                "status_sha256": hashlib.sha256(b"").hexdigest(),
            }

        for skip_delta in (False, True):
            with self.subTest(skip_delta=skip_delta):
                skills_root = self.home / ".agents/skills"
                if skills_root.exists():
                    shutil.rmtree(skills_root.parent)
                skills_root.mkdir(parents=True)
                for name in ("drclaw-skill-library", "ncsa-delta"):
                    (skills_root / name).symlink_to(
                        module.Installer.skill_source_in_checkout(release_a, name),
                        target_is_directory=True,
                    )
                self.write_managed_skill_state(release_a, revision_a)
                config_path = self.codex_home / "config.toml"
                if config_path.exists():
                    config_path.unlink()
                arguments = []
                if skip_delta:
                    arguments.append("--skip-delta-skill")
                installer = module.Installer(
                    self.managed_installer_args(*arguments),
                    release_b,
                    module.load_manifest(),
                )
                with mock.patch.object(module, "git_state", side_effect=clean_git):
                    installer.run()
                self.assertEqual(
                    (skills_root / "drclaw-skill-library").resolve(),
                    module.Installer.skill_source_in_checkout(
                        release_b, "drclaw-skill-library"
                    ),
                )
                self.assertFalse(installer.skill_transaction_root().exists())
                state = json.loads(
                    (self.codex_home / "drclaw-bootstrap-state.json").read_text(
                        encoding="utf-8"
                    )
                )
                self.assertEqual(state["repo_root"], str(release_b))
                if skip_delta:
                    self.assertNotIn("ncsa-delta", state["managed_skills"])
                    self.assertFalse(os.path.lexists(skills_root / "ncsa-delta"))
                else:
                    self.assertEqual(
                        (skills_root / "ncsa-delta").resolve(),
                        module.Installer.skill_source_in_checkout(release_b, "ncsa-delta"),
                    )

    def test_conflict_requires_replace_and_archives_original(self) -> None:
        conflict = self.home / ".agents" / "skills" / "drclaw-skill-library"
        conflict.mkdir(parents=True)
        original = "---\nname: local-conflict\ndescription: must be archived\n---\n"
        (conflict / "SKILL.md").write_text(original, encoding="utf-8")

        refused = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("Refusing to replace existing", refused.stderr)
        self.assertEqual((conflict / "SKILL.md").read_text(encoding="utf-8"), original)

        replaced = self.run_bootstrap(
            "install",
            "--skip-delta-skill",
            "--no-doctor",
            "--replace",
        )
        self.assert_success(replaced)
        self.assertTrue(conflict.is_symlink())
        self.assertEqual(conflict.resolve(), ROUTER_SOURCE.resolve())

        archived = list(
            (self.codex_home / "drclaw-backups").glob(
                "*/skills-drclaw-skill-library/SKILL.md"
            )
        )
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0].read_text(encoding="utf-8"), original)

    def test_preserve_profile_leaves_existing_config_byte_for_byte(self) -> None:
        config_path = self.codex_home / "config.toml"
        original = (
            "# Maintained outside Dr. Claw\n"
            'approval_policy = "on-request"\n\n'
            "[mcp_servers.internal]\n"
            'command = "internal-mcp"\n'
        )
        config_path.write_text(original, encoding="utf-8")

        result = self.run_bootstrap(
            "install",
            "--skip-delta-skill",
            "--no-doctor",
            "--config-profile",
            "preserve",
        )
        self.assert_success(result)
        self.assertEqual(config_path.read_text(encoding="utf-8"), original)
        self.assertIn("configuration profile is preserve", result.stdout)
        state = json.loads((self.codex_home / "drclaw-bootstrap-state.json").read_text(encoding="utf-8"))
        self.assertEqual(state["config_profile"], "preserve")

    def test_safe_profile_rewrites_proven_managed_values_but_rejects_unmanaged_danger(self) -> None:
        module = load_bootstrap_module()
        revision_a = "1" * 40
        revision_b = "2" * 40
        release_a = self.make_managed_release(revision_a, "release-a")
        release_b = self.make_managed_release(revision_b, "release-b")
        config_path = self.codex_home / "config.toml"
        config_path.write_text(
            (release_a / "bootstrap/codex/templates/config.current-delta.toml").read_text(
                encoding="utf-8"
            ),
            encoding="utf-8",
        )
        self.write_managed_skill_state(
            release_a,
            revision_a,
            config_profile="current-delta",
        )
        clean = {
            "revision": revision_a,
            "dirty": False,
            "status_sha256": hashlib.sha256(b"").hexdigest(),
        }
        with mock.patch.object(module, "git_state", return_value=clean):
            installer = module.Installer(
                self.managed_installer_args("--config-profile", "safe"),
                release_b,
                {"bundle_version": "fixture"},
            )
            installer.install_config()
        assignments = module.config_assignments(config_path)
        self.assertEqual(module.normalize_toml_scalar(assignments["approval_policy"]), "on-request")
        self.assertEqual(module.normalize_toml_scalar(assignments["sandbox_mode"]), "workspace-write")

        (self.codex_home / "drclaw-bootstrap-state.json").unlink()
        config_path.write_text(
            'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n',
            encoding="utf-8",
        )
        unmanaged = module.Installer(
            self.managed_installer_args("--config-profile", "safe"),
            release_b,
            {"bundle_version": "fixture"},
        )
        with self.assertRaisesRegex(module.BootstrapError, "Safe profile keys differ"):
            unmanaged.install_config()
        preserving = module.Installer(
            self.managed_installer_args("--config-profile", "preserve"),
            release_b,
            {"bundle_version": "fixture"},
        )
        preserving.install_config()
        self.assertIn('approval_policy = "never"', config_path.read_text(encoding="utf-8"))

    def test_safe_profile_updates_values_proven_by_an_older_safe_template(self) -> None:
        module = load_bootstrap_module()
        revision_a = "3" * 40
        revision_b = "4" * 40
        release_a = self.make_managed_release(revision_a, "release-a")
        release_b = self.make_managed_release(revision_b, "release-b")
        old_template = release_a / "bootstrap/codex/templates/config.safe.toml"
        old_template.write_text(
            'approval_policy = "on-request"\n'
            'sandbox_mode = "workspace-write"\n'
            "project_doc_max_bytes = 32768\n",
            encoding="utf-8",
        )
        config_path = self.codex_home / "config.toml"
        config_path.write_text(old_template.read_text(encoding="utf-8"), encoding="utf-8")
        self.write_managed_skill_state(release_a, revision_a, config_profile="safe")
        clean = {
            "revision": revision_a,
            "dirty": False,
            "status_sha256": hashlib.sha256(b"").hexdigest(),
        }
        with mock.patch.object(module, "git_state", return_value=clean):
            installer = module.Installer(
                self.managed_installer_args("--config-profile", "safe"),
                release_b,
                {"bundle_version": "fixture"},
            )
            installer.install_config()
        assignments = module.config_assignments(config_path)
        self.assertEqual(
            module.normalize_toml_scalar(assignments["project_doc_max_bytes"]), "65536"
        )

    def test_doctor_rejects_safe_receipt_when_safe_values_drift(self) -> None:
        installed = self.run_bootstrap(
            "install", "--skip-delta-skill", "--no-doctor", "--config-profile", "safe"
        )
        self.assert_success(installed)
        config_path = self.codex_home / "config.toml"
        config_path.write_text(
            config_path.read_text(encoding="utf-8").replace(
                'approval_policy = "on-request"', 'approval_policy = "never"'
            ),
            encoding="utf-8",
        )
        doctor = self.run_bootstrap(
            "doctor", "--skip-delta-skill", "--skip-runtime", "--json"
        )
        self.assertEqual(doctor.returncode, 1)
        check = next(
            item for item in json.loads(doctor.stdout)["checks"] if item["name"] == "codex-config"
        )
        self.assertEqual(check["level"], "FAIL")
        self.assertIn("safe keys differ", check["detail"])

    def test_safe_merge_preserves_a_utf8_bom_at_byte_zero(self) -> None:
        config_path = self.codex_home / "config.toml"
        config_path.write_text("\ufeff[features]\ncustom_feature = true\n", encoding="utf-8")

        installed = self.run_bootstrap(
            "install", "--skip-delta-skill", "--no-doctor", "--config-profile", "safe"
        )
        self.assert_success(installed)
        merged = config_path.read_text(encoding="utf-8")
        self.assertTrue(merged.startswith("\ufeffapproval_policy = \"on-request\""))
        self.assertEqual(merged.count("\ufeff"), 1)
        self.assertIn("[features]\ncustom_feature = true", merged)

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--skip-runtime", "--json")
        self.assert_success(doctor)

    def test_safe_merge_recognizes_quoted_managed_keys(self) -> None:
        config_path = self.codex_home / "config.toml"
        config_path.write_text(
            '"approval_policy" = "on-request"\n'
            "'sandbox_mode' = \"workspace-write\"\n"
            "[features]\ncustom_feature = true\n",
            encoding="utf-8",
        )

        installed = self.run_bootstrap(
            "install", "--skip-delta-skill", "--no-doctor", "--config-profile", "safe"
        )
        self.assert_success(installed)
        merged_lines = config_path.read_text(encoding="utf-8").splitlines()
        self.assertIn('"approval_policy" = "on-request"', merged_lines)
        self.assertIn("'sandbox_mode' = \"workspace-write\"", merged_lines)
        self.assertNotIn('approval_policy = "on-request"', merged_lines)
        self.assertNotIn('sandbox_mode = "workspace-write"', merged_lines)

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--skip-runtime", "--json")
        self.assert_success(doctor)

    def test_config_scanner_ignores_brackets_inside_strings(self) -> None:
        config_path = self.codex_home / "config.toml"
        config_path.write_text(
            'project_root_markers = ["["]\n'
            'approval_policy = "on-request"\n'
            'sandbox_mode = "workspace-write"\n'
            "project_doc_max_bytes = 65536\n",
            encoding="utf-8",
        )
        installed = self.run_bootstrap(
            "install", "--skip-delta-skill", "--no-doctor", "--config-profile", "safe"
        )
        self.assert_success(installed)
        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--skip-runtime", "--json")
        self.assert_success(doctor)

    def test_doctor_detects_content_and_receipt_corruption(self) -> None:
        installed = self.run_bootstrap("install", "--copy-skills", "--no-doctor")
        self.assert_success(installed)

        agents_path = self.codex_home / "AGENTS.md"
        agents_path.write_text(
            agents_path.read_text(encoding="utf-8").replace(
                "Dr. Claw portable baseline", "tampered portable baseline"
            ),
            encoding="utf-8",
        )
        config_path = self.codex_home / "config.toml"
        config_path.write_text(
            config_path.read_text(encoding="utf-8") + "this is not TOML\n",
            encoding="utf-8",
        )
        copied_skill = self.home / ".agents" / "skills" / "drclaw-skill-library" / "SKILL.md"
        copied_skill.write_text("corrupted\n", encoding="utf-8")
        (self.codex_home / "drclaw-bootstrap-state.json").write_text("{broken\n", encoding="utf-8")

        doctor = self.run_bootstrap("doctor", "--skip-runtime", "--json")
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        failed = {check["name"] for check in report["checks"] if check["level"] == "FAIL"}
        self.assertIn("global-guidance", failed)
        self.assertIn("bootstrap-state", failed)
        self.assertIn("skill:drclaw-skill-library", failed)
        self.assertIn("codex-config", failed)

    def test_config_errors_never_echo_secret_like_content(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        fake_secret = "sk-FAKE-DO-NOT-LOG-1234567890"
        config_path = self.codex_home / "config.toml"
        config_path.write_text(
            config_path.read_text(encoding="utf-8") + f"api_key {fake_secret}\n",
            encoding="utf-8",
        )

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--skip-runtime", "--json")
        self.assertEqual(doctor.returncode, 1)
        self.assertNotIn(fake_secret, doctor.stdout)
        self.assertNotIn(fake_secret, doctor.stderr)
        report = json.loads(doctor.stdout)
        config_check = next(check for check in report["checks"] if check["name"] == "codex-config")
        self.assertEqual(config_check["level"], "FAIL")
        self.assertRegex(config_check["detail"], r"line \d+")

    def test_symlinked_config_requires_explicit_replacement(self) -> None:
        external_config = self.root / "operator-config.toml"
        original = 'model = "operator-owned"\n'
        external_config.write_text(original, encoding="utf-8")
        config_path = self.codex_home / "config.toml"
        config_path.symlink_to(external_config)

        refused = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assertEqual(refused.returncode, 2)
        self.assertTrue(config_path.is_symlink())
        self.assertEqual(external_config.read_text(encoding="utf-8"), original)

        replaced = self.run_bootstrap(
            "install", "--skip-delta-skill", "--no-doctor", "--replace"
        )
        self.assert_success(replaced)
        self.assertFalse(config_path.is_symlink())
        self.assertEqual(external_config.read_text(encoding="utf-8"), original)
        archived_links = list(
            (self.codex_home / "drclaw-backups").glob("*/codex-home-config.toml")
        )
        self.assertEqual(len(archived_links), 1)
        self.assertTrue(archived_links[0].is_symlink())

    def test_strict_native_scope_detects_a_stale_recursive_library(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        stale = self.home / ".agents" / "skills" / "library" / "stale"
        stale.mkdir(parents=True)
        (stale / "SKILL.md").write_text(
            "---\nname: stale\ndescription: stale native skill\n---\n", encoding="utf-8"
        )

        doctor = self.run_bootstrap(
            "doctor",
            "--skip-delta-skill",
            "--skip-runtime",
            "--require-clean-native-skills",
            "--json",
        )
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        scope = next(check for check in report["checks"] if check["name"] == "native-skill-scope")
        self.assertEqual(scope["level"], "FAIL")
        self.assertIn("library", scope["detail"])

    def test_strict_native_scope_detects_a_whole_library_symlink(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        stale_link = self.home / ".agents" / "skills" / "whole-library"
        stale_link.symlink_to(REPO_ROOT / "skills", target_is_directory=True)

        doctor = self.run_bootstrap(
            "doctor",
            "--skip-delta-skill",
            "--skip-runtime",
            "--require-clean-native-skills",
            "--json",
        )
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        scope = next(check for check in report["checks"] if check["name"] == "native-skill-scope")
        self.assertEqual(scope["level"], "FAIL")
        self.assertIn("whole-library", scope["detail"])

    def test_strict_native_scope_detects_root_level_skill_file(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        root_skill = self.home / ".agents" / "skills" / "SKILL.md"
        root_skill.write_text(
            "---\nname: discovery-root\ndescription: unexpected root skill\n---\n",
            encoding="utf-8",
        )

        doctor = self.run_bootstrap(
            "doctor",
            "--skip-delta-skill",
            "--skip-runtime",
            "--require-clean-native-skills",
            "--json",
        )
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        scope = next(check for check in report["checks"] if check["name"] == "native-skill-scope")
        self.assertEqual(scope["level"], "FAIL")
        self.assertIn("SKILL.md (discovery-root)", scope["detail"])

    def test_receipt_git_revision_drift_is_a_failure(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        state["git"]["revision"] = "deadbeef"
        state_path.write_text(json.dumps(state), encoding="utf-8")

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--skip-runtime", "--json")
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        receipt = next(check for check in report["checks"] if check["name"] == "bootstrap-state")
        self.assertEqual(receipt["level"], "FAIL")
        self.assertIn("revision", receipt["detail"])

    def test_invalid_reused_state_fields_fail_without_traceback(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        original = json.loads(state_path.read_text(encoding="utf-8"))
        for invalid_plugins in (42, "sites@openai-bundled"):
            with self.subTest(invalid_plugins=invalid_plugins):
                corrupted = dict(original)
                corrupted["managed_plugins"] = invalid_plugins
                state_path.write_text(json.dumps(corrupted), encoding="utf-8")
                rerun = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
                self.assertEqual(rerun.returncode, 2)
                self.assertNotIn("Traceback", rerun.stderr)
                self.assertIn("invalid managed_plugins field", rerun.stderr)

    def test_strict_release_rejects_an_unpublished_bundle(self) -> None:
        unpublished = self.root / "unpublished-repository"
        unpublished.mkdir()
        (unpublished / "AGENTS.md").write_text("# Fixture\n", encoding="utf-8")
        subprocess.run(["git", "init", "--quiet"], cwd=unpublished, check=True)
        subprocess.run(["git", "add", "AGENTS.md"], cwd=unpublished, check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Dr Claw Test",
                "-c",
                "user.email=drclaw-test@example.invalid",
                "commit",
                "--quiet",
                "-m",
                "fixture",
            ],
            cwd=unpublished,
            check=True,
        )

        module = load_bootstrap_module()
        args = argparse.Namespace(
            home=str(self.home),
            codex_home=str(self.codex_home),
            strict_release=True,
        )
        doctor = module.Doctor(
            args,
            unpublished,
            {
                "required_repository_paths": ["AGENTS.md"],
                "baseline": {"bundle_release_ref": "unpublished-fixture-v1"},
            },
        )
        doctor.check_repository()
        release = next(check for check in doctor.checks if check.name == "release-ref")
        self.assertEqual(release.level, "FAIL")
        self.assertIn("cannot resolve unpublished-fixture-v1", release.detail)

    def test_non_strict_release_warns_when_development_checkout_is_ahead(self) -> None:
        development = self.root / "development-repository"
        development.mkdir()
        agents = development / "AGENTS.md"
        agents.write_text("# Published fixture\n", encoding="utf-8")
        subprocess.run(["git", "init", "--quiet"], cwd=development, check=True)
        subprocess.run(["git", "add", "AGENTS.md"], cwd=development, check=True)
        commit_prefix = [
            "git",
            "-c",
            "user.name=Dr Claw Test",
            "-c",
            "user.email=drclaw-test@example.invalid",
        ]
        subprocess.run(
            [*commit_prefix, "commit", "--quiet", "-m", "published"],
            cwd=development,
            check=True,
        )
        subprocess.run(["git", "tag", "published-fixture-v1"], cwd=development, check=True)
        agents.write_text("# Development fixture\n", encoding="utf-8")
        subprocess.run(["git", "add", "AGENTS.md"], cwd=development, check=True)
        subprocess.run(
            [*commit_prefix, "commit", "--quiet", "-m", "development"],
            cwd=development,
            check=True,
        )

        module = load_bootstrap_module()
        manifest = {
            "required_repository_paths": ["AGENTS.md"],
            "baseline": {"bundle_release_ref": "published-fixture-v1"},
        }
        common = {
            "home": str(self.home),
            "codex_home": str(self.codex_home),
        }
        regular = module.Doctor(
            argparse.Namespace(**common, strict_release=False),
            development,
            manifest,
        )
        regular.check_repository()
        regular_release = next(check for check in regular.checks if check.name == "release-ref")
        self.assertEqual(regular_release.level, "WARN")
        self.assertIn("does not match published-fixture-v1", regular_release.detail)

        strict = module.Doctor(
            argparse.Namespace(**common, strict_release=True),
            development,
            manifest,
        )
        strict.check_repository()
        strict_release = next(check for check in strict.checks if check.name == "release-ref")
        self.assertEqual(strict_release.level, "FAIL")

    def test_skill_runtime_inventory_is_machine_readable_and_explicitly_non_activated(self) -> None:
        module = load_bootstrap_module()
        doctor = module.Doctor(
            argparse.Namespace(home=str(self.home), codex_home=str(self.codex_home)),
            REPO_ROOT,
            module.load_manifest(),
        )

        doctor.check_library()

        check = next(item for item in doctor.checks if item.name == "skill-runtime-inventory")
        self.assertEqual(check.level, "WARN")
        inventory = json.loads(check.detail)
        self.assertEqual(
            inventory,
            {
                "claude_specific": 24,
                "mcp_mentions": 33,
                "packages_with_scripts": 14,
                "source_installed_does_not_imply_dependency_activated": True,
            },
        )

    def test_live_delta_identity_gate_and_generic_host_support_matrix(self) -> None:
        module = load_bootstrap_module()
        delta_result = subprocess.CompletedProcess(
            ["scontrol", "show", "config"],
            0,
            "ClusterName = delta\nSlurmctldHost = test\n",
            "",
        )
        with mock.patch.object(module, "bounded_fqdn", return_value="dt-login04.delta.ncsa.illinois.edu"), mock.patch.object(
            module.platform, "machine", return_value="amd64"
        ), mock.patch.object(module.shutil, "which", return_value="/usr/bin/scontrol"), mock.patch.object(
            module.subprocess, "run", return_value=delta_result
        ):
            identity = module.verify_live_delta_identity(cwd=REPO_ROOT)
        self.assertEqual(identity["cluster_name"], "delta")
        self.assertEqual(identity["architecture"], "x86_64")

        doctor = module.Doctor(
            argparse.Namespace(home=str(self.home), codex_home=str(self.codex_home)),
            REPO_ROOT,
            module.load_manifest(),
        )
        for reported, canonical in (
            ("x86_64", "x86_64"),
            ("amd64", "x86_64"),
            ("aarch64", "aarch64"),
            ("arm64", "aarch64"),
        ):
            with self.subTest(reported=reported):
                doctor.checks.clear()
                with mock.patch.object(module, "bounded_fqdn", return_value="worker.example.org"), mock.patch.object(
                    module.platform, "system", return_value="Linux"
                ), mock.patch.object(module.platform, "machine", return_value=reported):
                    doctor.check_host()
                host_check = next(item for item in doctor.checks if item.name == "host")
                self.assertEqual(host_check.level, "PASS")
                self.assertIn(canonical, host_check.detail)

        doctor.checks.clear()
        with mock.patch.object(module, "bounded_fqdn", return_value="laptop.example.org"), mock.patch.object(
            module.platform, "system", return_value="Darwin"
        ), mock.patch.object(module.platform, "machine", return_value="arm64"):
            doctor.check_host()
        self.assertEqual(next(item for item in doctor.checks if item.name == "host").level, "FAIL")

    def test_bounded_fqdn_timeout_is_generic_non_delta_and_never_probes_slurm(self) -> None:
        module = load_bootstrap_module()
        timeout = subprocess.TimeoutExpired(["/usr/bin/hostname", "-f"], 5)
        with mock.patch.object(module.subprocess, "run", side_effect=timeout), mock.patch.object(
            module.shutil,
            "which",
            side_effect=AssertionError("scontrol discovery must not run for an unknown hostname"),
        ):
            self.assertEqual(module.bounded_fqdn(), "")
            with self.assertRaisesRegex(module.BootstrapError, "DNS domain"):
                module.verify_live_delta_identity(cwd=REPO_ROOT)

        doctor = module.Doctor(
            argparse.Namespace(home=str(self.home), codex_home=str(self.codex_home)),
            REPO_ROOT,
            module.load_manifest(),
        )
        with mock.patch.object(module, "bounded_fqdn", return_value=""), mock.patch.object(
            module.platform, "system", return_value="Linux"
        ), mock.patch.object(module.platform, "machine", return_value="x86_64"):
            doctor.check_host()
        host = next(item for item in doctor.checks if item.name == "host")
        self.assertEqual(host.level, "PASS")
        self.assertIn("fqdn-unavailable", host.detail)

    def test_current_delta_install_refuses_non_delta_before_any_write_and_stale_receipt_fails(self) -> None:
        module = load_bootstrap_module()
        isolated_codex_home = self.home / "new-codex-home"
        args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(isolated_codex_home),
                "--config-profile",
                "current-delta",
                "--no-doctor",
            ]
        )
        installer = module.Installer(args, REPO_ROOT, module.load_manifest())
        before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        with mock.patch.object(
            module,
            "verify_live_delta_identity",
            side_effect=module.BootstrapError("not live Delta"),
        ):
            with self.assertRaisesRegex(module.BootstrapError, "not live Delta"):
                installer.run()
        after = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        self.assertEqual(after, before)
        self.assertFalse(isolated_codex_home.exists())

        (self.codex_home / "drclaw-bootstrap-state.json").write_text(
            json.dumps({"config_profile": "current-delta"}),
            encoding="utf-8",
        )
        doctor = module.Doctor(
            argparse.Namespace(home=str(self.home), codex_home=str(self.codex_home)),
            REPO_ROOT,
            module.load_manifest(),
        )
        with mock.patch.object(module, "bounded_fqdn", return_value="worker.example.org"), mock.patch.object(
            module.platform, "system", return_value="Linux"
        ), mock.patch.object(module.platform, "machine", return_value="x86_64"):
            doctor.check_host()
        profile = next(item for item in doctor.checks if item.name == "current-delta-live-identity")
        self.assertEqual(profile.level, "FAIL")

    def test_requested_network_runtime_preflight_fails_before_target_writes(self) -> None:
        module = load_bootstrap_module()
        for flag in ("--install-codex", "--with-drclaw-cli"):
            with self.subTest(flag=flag):
                target_codex_home = self.home / ("missing-ssl-" + flag.removeprefix("--"))
                args = module.build_parser().parse_args(
                    [
                        "install",
                        "--home",
                        str(self.home),
                        "--codex-home",
                        str(target_codex_home),
                        flag,
                        "--no-doctor",
                    ]
                )
                installer = module.Installer(args, REPO_ROOT, module.load_manifest())
                before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                with mock.patch.object(
                    module,
                    "validate_python_tls_runtime",
                    side_effect=module.BootstrapError("TLS runtime unavailable"),
                ):
                    with self.assertRaisesRegex(module.BootstrapError, "TLS runtime unavailable"):
                        installer.run()
                after = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                self.assertEqual(after, before)
                self.assertFalse(target_codex_home.exists())

    def test_requested_executable_runtime_rejects_noexec_before_target_writes(self) -> None:
        module = load_bootstrap_module()
        args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
                "--install-codex",
                "--no-doctor",
            ]
        )
        installer = module.Installer(args, REPO_ROOT, module.load_manifest())
        before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        noexec_flag = getattr(module.os, "ST_NOEXEC", 8)
        filesystem = mock.MagicMock(f_flag=noexec_flag)
        with mock.patch.object(module.os, "ST_NOEXEC", noexec_flag, create=True), mock.patch.object(
            module.os, "statvfs", return_value=filesystem
        ):
            with self.assertRaisesRegex(module.BootstrapError, "mounted noexec"):
                installer.run()
        after = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        self.assertEqual(after, before)

    def test_external_or_writable_ancestor_codex_home_is_rejected_consistently(self) -> None:
        external = self.root / "external-codex-home"
        writable_parent = self.home / "shared-writable"
        writable_parent.mkdir(mode=0o770)
        writable_parent.chmod(0o770)
        nested = writable_parent / "codex-home"

        for command in ("install", "doctor"):
            for target, expected in (
                (external, "inside the target user home"),
                (nested, "group/world writable"),
            ):
                with self.subTest(command=command, target=target):
                    before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                    result = self.run_bootstrap(command, "--codex-home", str(target))
                    self.assertEqual(result.returncode, 2)
                    self.assertIn(expected, result.stderr)
                    after = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                    self.assertEqual(after, before)
                    self.assertFalse(target.exists())

    def test_codex_installer_and_plugin_commands_receive_no_operator_secrets(self) -> None:
        module = load_bootstrap_module()
        args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
                "--install-codex",
                "--install-plugins",
                "--no-doctor",
            ]
        )
        secret_marker = "DRCLAW-ENV-SECRET-MUST-NOT-LEAK"
        ca_bundle = self.home / "drclaw-ca.pem"
        ca_bundle.write_text("test CA fixture; content must never be logged\n", encoding="utf-8")
        ca_bundle.chmod(0o600)
        operator_env = {
            "REVIEW_FAKE_SECRET": secret_marker,
            "OPENAI_API_KEY": secret_marker,
            "GH_TOKEN": secret_marker,
            "SSH_AUTH_SOCK": "/tmp/private-agent.sock",
            "CODEX_RELEASE": "0.147.0",
            "HTTPS_PROXY": "https://proxy.example.invalid:8443",
            "NO_PROXY": "127.0.0.1,localhost",
            "DRCLAW_CA_BUNDLE": str(ca_bundle),
        }
        with mock.patch.dict(os.environ, operator_env, clear=False):
            installer = module.Installer(args, REPO_ROOT, module.load_manifest())
        response = mock.MagicMock()
        response.read.return_value = b"#!/bin/sh\nexit 0\n"
        context = mock.MagicMock()
        context.__enter__.return_value = response
        opener = mock.MagicMock()
        opener.open.return_value = context
        installer_environments = []

        def installer_run(command, **kwargs):
            installer_environments.append(kwargs["env"])
            return subprocess.CompletedProcess(command, 0, "", "")

        output = io.StringIO()
        with mock.patch.object(installer, "find_codex", side_effect=[None, "/managed/codex"]), mock.patch.object(
            module, "codex_installer_opener", return_value=opener
        ), mock.patch.object(module.subprocess, "run", side_effect=installer_run), contextlib.redirect_stdout(output):
            installer.install_codex()
        self.assertEqual(len(installer_environments), 1)
        installer_env = installer_environments[0]
        self.assertEqual(installer_env["CODEX_RELEASE"], "0.147.0")
        for key in ("REVIEW_FAKE_SECRET", "OPENAI_API_KEY", "GH_TOKEN", "SSH_AUTH_SOCK"):
            self.assertNotIn(key, installer_env)
        self.assertEqual(installer_env["HTTPS_PROXY"], operator_env["HTTPS_PROXY"])
        self.assertEqual(installer_env["NO_PROXY"], operator_env["NO_PROXY"])
        for key in ("SSL_CERT_FILE", "CURL_CA_BUNDLE", "PIP_CERT", "NODE_EXTRA_CA_CERTS"):
            self.assertEqual(installer_env[key], str(ca_bundle))
        self.assertNotIn(secret_marker, output.getvalue())

        cli_env = module.drclaw_cli_subprocess_env(
            self.home,
            self.home / "cli-cache",
            self.home / "cli-tmp",
            installer.target_env,
        )
        self.assertEqual(cli_env["HTTPS_PROXY"], operator_env["HTTPS_PROXY"])
        self.assertEqual(cli_env["PIP_CERT"], str(ca_bundle))
        self.assertNotIn("OPENAI_API_KEY", cli_env)
        derived_source = dict(operator_env)
        for key in (
            "SSL_CERT_FILE",
            "CURL_CA_BUNDLE",
            "GIT_SSL_CAINFO",
            "PIP_CERT",
            "NODE_EXTRA_CA_CERTS",
        ):
            derived_source[key] = str(ca_bundle)
        self.assertEqual(
            module.credential_free_proxy_env(derived_source)["SSL_CERT_FILE"],
            str(ca_bundle),
        )

        plugin_environments = []
        required_plugins = [
            plugin["id"]
            for plugin in installer.manifest["components"]["observed_plugins"]
            if plugin.get("enabled_in_audited_config")
        ]

        def plugin_run(command, **kwargs):
            plugin_environments.append(kwargs["env"])
            if command[1:4] == ["plugin", "list", "--available"]:
                payload = {
                    "installed": [],
                    "available": [{"pluginId": plugin} for plugin in required_plugins],
                }
                return subprocess.CompletedProcess(command, 0, json.dumps(payload), "")
            return subprocess.CompletedProcess(command, 0, "{}", "")

        output = io.StringIO()
        with mock.patch.object(installer, "find_codex", return_value="/managed/codex"), mock.patch.object(
            module.subprocess, "run", side_effect=plugin_run
        ), contextlib.redirect_stdout(output):
            installer.install_plugins()
        self.assertGreaterEqual(len(plugin_environments), 3)
        for environment in plugin_environments:
            for key in ("REVIEW_FAKE_SECRET", "OPENAI_API_KEY", "GH_TOKEN", "SSH_AUTH_SOCK"):
                self.assertNotIn(key, environment)
        self.assertNotIn(secret_marker, output.getvalue())

    def test_credential_proxy_and_unapproved_ca_fail_without_secret_or_target_write(self) -> None:
        module = load_bootstrap_module()
        args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.home / "network-failure-codex"),
                "--no-doctor",
            ]
        )
        secret = "NETWORK-CREDENTIAL-MUST-NOT-LEAK"
        for environment, expected in (
            ({"HTTPS_PROXY": f"https://user:{secret}@proxy.invalid"}, "Proxy configuration"),
            ({"SSL_CERT_FILE": str(self.home / secret)}, "DRCLAW_CA_BUNDLE"),
        ):
            with self.subTest(expected=expected), mock.patch.dict(os.environ, environment, clear=False):
                before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                with self.assertRaises(module.BootstrapError) as caught:
                    module.Installer(args, REPO_ROOT, module.load_manifest())
                message = str(caught.exception)
                self.assertIn(expected, message)
                self.assertNotIn(secret, message)
                after = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                self.assertEqual(after, before)

        with self.assertRaisesRegex(module.BootstrapError, "conflict"):
            module.credential_free_proxy_env(
                {
                    "HTTPS_PROXY": "https://proxy-one.invalid:8443",
                    "https_proxy": "https://proxy-two.invalid:8443",
                }
            )
        with self.assertRaisesRegex(module.BootstrapError, "NO_PROXY.*conflict"):
            module.credential_free_proxy_env(
                {"NO_PROXY": "localhost", "no_proxy": "127.0.0.1"}
            )

        weak_parent = self.home / "group-writable-ca-parent"
        weak_parent.mkdir()
        weak_parent.chmod(0o770)
        weak_ca = weak_parent / "ca.pem"
        weak_ca.write_text("fixture\n", encoding="utf-8")
        weak_ca.chmod(0o600)
        with self.assertRaisesRegex(module.BootstrapError, "safe absolute CA file"):
            module.credential_free_proxy_env({"DRCLAW_CA_BUNDLE": str(weak_ca)})

    def test_official_codex_installer_timeout_is_bounded_and_suppresses_output(self) -> None:
        module = load_bootstrap_module()
        args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
                "--install-codex",
                "--no-doctor",
            ]
        )
        installer = module.Installer(args, REPO_ROOT, module.load_manifest())
        response = mock.MagicMock()
        response.read.return_value = b"#!/bin/sh\nexit 0\n"
        context = mock.MagicMock()
        context.__enter__.return_value = response
        opener = mock.MagicMock()
        opener.open.return_value = context
        secret = "TIMED-OUT-INSTALLER-OUTPUT-MUST-NOT-LEAK"
        timeout = subprocess.TimeoutExpired(["bash", "installer"], module.CODEX_INSTALL_TIMEOUT_SECONDS)
        timeout.stdout = secret
        timeout.stderr = secret
        with mock.patch.object(installer, "find_codex", return_value=None), mock.patch.object(
            module, "codex_installer_opener", return_value=opener
        ), mock.patch.object(module.subprocess, "run", side_effect=timeout):
            with self.assertRaises(module.BootstrapError) as caught:
                installer.install_codex()
        self.assertIn("timed out", str(caught.exception))
        self.assertNotIn(secret, str(caught.exception))

    def test_site_path_codex_discovery_is_shared_by_installer_and_doctor(self) -> None:
        module = load_bootstrap_module()
        site_bin = self.root / "opt" / "codex" / "bin"
        site_bin.mkdir(parents=True)
        site_codex = site_bin / "codex"
        site_codex.write_text("#!/bin/sh\nprintf 'codex-cli 0.147.0\\n'\n", encoding="utf-8")
        site_codex.chmod(0o755)
        target_path = os.pathsep.join(("", "relative-bin", str(site_bin)))
        secret_marker = "SITE-PATH-SECRET-MUST-NOT-LEAK"

        install_args = module.build_parser().parse_args(
            [
                "install",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
                "--no-doctor",
            ]
        )
        doctor_args = module.build_parser().parse_args(
            [
                "doctor",
                "--home",
                str(self.home),
                "--codex-home",
                str(self.codex_home),
            ]
        )
        with mock.patch.dict(
            os.environ,
            {"PATH": target_path, "FAKE_OPERATOR_SECRET": secret_marker},
            clear=False,
        ):
            installer = module.Installer(install_args, REPO_ROOT, module.load_manifest())
            doctor = module.Doctor(doctor_args, REPO_ROOT, module.load_manifest())

        # A writable fake /opt tree is rejected by default.  Mocking only the
        # ownership predicate models a root-owned site/module installation.
        self.assertIsNone(installer.find_codex())
        self.assertIsNone(doctor.find_codex())
        with mock.patch.object(module, "path_chain_is_unprivileged_writable", return_value=False):
            self.assertEqual(installer.find_codex(), str(site_codex.resolve()))
            self.assertEqual(doctor.find_codex(), str(site_codex.resolve()))

        self.assertEqual(installer.codex_source, "site-path")
        self.assertEqual(doctor.codex_source, "site-path")
        self.assertIn(str(site_bin), installer.codex_env["PATH"].split(os.pathsep))
        self.assertIn(str(site_bin), doctor.codex_env["PATH"].split(os.pathsep))
        self.assertNotIn("FAKE_OPERATOR_SECRET", installer.codex_env)
        self.assertNotIn("FAKE_OPERATOR_SECRET", doctor.codex_env)
        self.assertNotIn("relative-bin", installer.codex_env["PATH"])

    def test_newer_codex_passes_isolated_contracts_with_an_audit_warning(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        self.write_contract_fake_codex("0.148.0")

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--json")
        self.assert_success(doctor)
        report = json.loads(doctor.stdout)
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["codex-version-audit"]["level"], "WARN")
        self.assertEqual(checks["codex-minimum-version"]["level"], "PASS")
        self.assertEqual(checks["codex-compatibility"]["level"], "PASS")
        for probe in (
            "config-load",
            "prompt-input-json",
            "global-agents-discovery",
            "managed-skill-discovery",
            "plugin-list-json",
        ):
            self.assertEqual(checks[f"codex-contract:{probe}"]["level"], "PASS")

    def test_nonempty_global_override_is_never_replaced_and_blocks_install(self) -> None:
        override_path = self.codex_home / "AGENTS.override.md"
        original = "# User-owned override\nKeep this private policy.\n"
        override_path.write_text(original, encoding="utf-8")

        for arguments in (
            ("--skip-delta-skill", "--no-doctor"),
            ("--skip-delta-skill", "--no-doctor", "--replace"),
        ):
            with self.subTest(arguments=arguments):
                refused = self.run_bootstrap("install", *arguments)
                self.assertEqual(refused.returncode, 2)
                self.assertIn("non-empty AGENTS.override.md shadows", refused.stderr)
                self.assertIn("will not modify or archive", refused.stderr)
                self.assertEqual(override_path.read_text(encoding="utf-8"), original)
                self.assertFalse((self.codex_home / "AGENTS.md").exists())
                self.assertFalse((self.codex_home / "drclaw-bootstrap-state.json").exists())
                self.assertFalse((self.home / ".agents" / "skills").exists())

    def test_doctor_fails_when_global_override_shadows_managed_guidance(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        self.write_contract_fake_codex("0.148.0")
        override_path = self.codex_home / "AGENTS.override.md"
        original = "# User-owned override\nShadow the managed file.\n"
        override_path.write_text(original, encoding="utf-8")

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--json")
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["global-guidance"]["level"], "PASS")
        self.assertEqual(checks["effective-global-guidance"]["level"], "FAIL")
        self.assertIn("shadows", checks["effective-global-guidance"]["detail"])
        self.assertEqual(checks["codex-contract:global-agents-discovery"]["level"], "PASS")
        self.assertEqual(checks["codex-compatibility"]["level"], "FAIL")
        self.assertEqual(override_path.read_text(encoding="utf-8"), original)

    def test_empty_global_override_does_not_shadow_managed_guidance(self) -> None:
        override_path = self.codex_home / "AGENTS.override.md"
        override_path.write_text(" \n\t\n", encoding="utf-8")
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        self.write_contract_fake_codex("0.148.0")

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--json")
        self.assert_success(doctor)
        report = json.loads(doctor.stdout)
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["effective-global-guidance"]["level"], "PASS")
        self.assertIn("is empty", checks["effective-global-guidance"]["detail"])
        self.assertEqual(checks["codex-compatibility"]["level"], "PASS")
        self.assertEqual(override_path.read_text(encoding="utf-8"), " \n\t\n")

    def test_require_audited_codex_version_rejects_a_newer_compatible_cli(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        self.write_contract_fake_codex("0.148.0")

        doctor = self.run_bootstrap(
            "doctor",
            "--skip-delta-skill",
            "--require-audited-codex-version",
            "--json",
        )
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["codex-version-audit"]["level"], "FAIL")
        self.assertEqual(checks["codex-compatibility"]["level"], "PASS")

    def test_codex_below_minimum_fails_even_when_contracts_pass(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        self.write_contract_fake_codex("0.146.9")

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--json")
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["codex-minimum-version"]["level"], "FAIL")
        self.assertEqual(checks["codex-contract:managed-skill-discovery"]["level"], "PASS")
        self.assertEqual(checks["codex-compatibility"]["level"], "FAIL")

    def test_contract_rejects_missing_agents_and_skill_discovery(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        self.write_contract_fake_codex("0.148.0", valid_discovery=False)

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--json")
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        checks = {check["name"]: check for check in report["checks"]}
        self.assertEqual(checks["codex-contract:prompt-input-json"]["level"], "PASS")
        self.assertEqual(checks["codex-contract:global-agents-discovery"]["level"], "FAIL")
        self.assertEqual(checks["codex-contract:managed-skill-discovery"]["level"], "FAIL")
        self.assertEqual(checks["codex-compatibility"]["level"], "FAIL")

    def test_doctor_rejects_symlinked_managed_files(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        for filename in ("AGENTS.md", "config.toml", "drclaw-bootstrap-state.json"):
            managed = self.codex_home / filename
            external = self.root / f"external-{filename}"
            external.write_bytes(managed.read_bytes())
            managed.unlink()
            managed.symlink_to(external)

        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--skip-runtime", "--json")
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        failed = {check["name"] for check in report["checks"] if check["level"] == "FAIL"}
        self.assertIn("global-guidance", failed)
        self.assertIn("bootstrap-state", failed)
        self.assertIn("codex-config", failed)

    def test_reversed_agents_markers_are_controlled_failures(self) -> None:
        agents_path = self.codex_home / "AGENTS.md"
        agents_path.write_text(f"{END_MARKER}\noperator text\n{BEGIN_MARKER}\n", encoding="utf-8")

        refused = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("managed markers are reversed", refused.stderr)
        self.assertNotIn("Traceback", refused.stderr)

        agents_path.unlink()
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        agents_path.write_text(f"{END_MARKER}\noperator text\n{BEGIN_MARKER}\n", encoding="utf-8")
        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--skip-runtime", "--json")
        self.assertEqual(doctor.returncode, 1)
        self.assertNotIn("Traceback", doctor.stderr)
        report = json.loads(doctor.stdout)
        guidance = next(check for check in report["checks"] if check["name"] == "global-guidance")
        self.assertEqual(guidance["level"], "FAIL")
        self.assertIn("reversed", guidance["detail"])

    def test_managed_skill_ancestor_writable_rejects_dry_and_real_install_without_writes(self) -> None:
        unsafe = self.home / ".agents"
        unsafe.mkdir(mode=0o700)
        unsafe.chmod(0o770)
        before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        for dry_run in (False, True):
            arguments = ["--skip-delta-skill", "--no-doctor"]
            if dry_run:
                arguments.append("--dry-run")
            result = self.run_bootstrap("install", *arguments)
            self.assertEqual(result.returncode, 2)
            self.assertIn("writable by group/other", result.stderr)
            self.assertEqual(
                sorted(path.relative_to(self.home) for path in self.home.rglob("*")), before
            )

    def test_cli_managed_local_share_ancestor_rejects_dry_and_real_without_writes(self) -> None:
        unsafe = self.home / ".local" / "share"
        unsafe.mkdir(parents=True, mode=0o700)
        unsafe.chmod(0o770)
        before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        for dry_run in (False, True):
            arguments = [
                "--skip-delta-skill",
                "--with-drclaw-cli",
                "--no-doctor",
            ]
            if dry_run:
                arguments.append("--dry-run")
            result = self.run_bootstrap("install", *arguments)
            self.assertEqual(result.returncode, 2)
            self.assertIn("writable by group/other", result.stderr)
            self.assertEqual(
                sorted(path.relative_to(self.home) for path in self.home.rglob("*")), before
            )

    def test_installer_refuses_derived_symlinked_write_roots(self) -> None:
        for linked_name in (".codex", ".agents"):
            with self.subTest(linked_name=linked_name):
                isolated_home = self.root / f"home-{linked_name[1:]}"
                victim = self.root / f"victim-{linked_name[1:]}"
                isolated_home.mkdir()
                victim.mkdir()
                (isolated_home / linked_name).symlink_to(victim, target_is_directory=True)
                result = subprocess.run(
                    [
                        sys.executable,
                        str(BOOTSTRAP),
                        "install",
                        "--home",
                        str(isolated_home),
                        "--skip-delta-skill",
                        "--no-doctor",
                    ],
                    cwd=str(REPO_ROOT),
                    env=os.environ.copy(),
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                self.assertEqual(result.returncode, 2)
                self.assertIn("symlink", result.stderr.lower())

        explicit_home = self.root / "explicit-home"
        explicit_home.mkdir()
        explicit_target = self.root / "explicit-codex-target"
        explicit_target.mkdir()
        explicit_link = self.root / "explicit-codex-link"
        explicit_link.symlink_to(explicit_target, target_is_directory=True)
        explicit = subprocess.run(
            [
                sys.executable,
                str(BOOTSTRAP),
                "install",
                "--home",
                str(explicit_home),
                "--codex-home",
                str(explicit_link),
                "--skip-delta-skill",
                "--no-doctor",
            ],
            cwd=str(REPO_ROOT),
            env=os.environ.copy(),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(explicit.returncode, 2)
        self.assertIn("explicit --codex-home path through symlink", explicit.stderr)

        default_target = self.root / "default-home-target"
        default_target.mkdir()
        default_link = self.root / "default-home-link"
        default_link.symlink_to(default_target, target_is_directory=True)
        default_environment = os.environ.copy()
        default_environment["HOME"] = str(default_link)
        default_environment.pop("CODEX_HOME", None)
        default = subprocess.run(
            [sys.executable, str(BOOTSTRAP), "install", "--skip-delta-skill", "--no-doctor"],
            cwd=str(REPO_ROOT),
            env=default_environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(default.returncode, 2)
        self.assertIn("default HOME path through symlink", default.stderr)

    def test_fresh_codex_home_is_private(self) -> None:
        isolated_home = self.root / "private-home"
        isolated_home.mkdir()
        environment = os.environ.copy()
        environment.pop("CODEX_HOME", None)
        result = subprocess.run(
            [
                sys.executable,
                str(BOOTSTRAP),
                "install",
                "--home",
                str(isolated_home),
                "--skip-delta-skill",
                "--no-doctor",
            ],
            cwd=str(REPO_ROOT),
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )
        self.assert_success(result)
        self.assertEqual(stat.S_IMODE((isolated_home / ".codex").stat().st_mode), 0o700)

    def test_plugin_install_skips_already_installed_entries(self) -> None:
        fake_bin = self.home / ".local" / "bin"
        fake_bin.mkdir(parents=True)
        marker = self.root / "plugin-add-was-called"
        fake_codex = fake_bin / "codex"
        fake_codex.write_text(
            "#!/usr/bin/env python3\n"
            "import json, pathlib, sys\n"
            f"marker = pathlib.Path({str(marker)!r})\n"
            "args = sys.argv[1:]\n"
            "if args[:3] == ['plugin', 'list', '--available']:\n"
            "    print(json.dumps({'installed': ["
            "{'pluginId': 'sites@openai-bundled', 'installed': True}, "
            "{'pluginId': 'visualize@openai-bundled', 'installed': True}], 'available': []}))\n"
            "elif args[:2] == ['plugin', 'add']:\n"
            "    marker.write_text('called')\n"
            "    raise SystemExit(9)\n"
            "elif args == ['--version']:\n"
            "    print('codex-cli 0.147.0')\n"
            "else:\n"
            "    print(json.dumps({'installed': [], 'available': []}))\n",
            encoding="utf-8",
        )
        fake_codex.chmod(0o755)

        result = self.run_bootstrap(
            "install",
            "--skip-delta-skill",
            "--install-plugins",
            "--no-doctor",
        )
        self.assert_success(result)
        self.assertFalse(marker.exists())
        self.assertIn("sites@openai-bundled is already installed", result.stdout)
        self.assertIn("visualize@openai-bundled is already installed", result.stdout)

    def test_preserve_plugin_followup_keeps_safe_config_provenance(self) -> None:
        first = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor", "--config-profile", "safe")
        self.assert_success(first)
        fake_bin = self.home / ".local" / "bin"
        fake_bin.mkdir(parents=True, exist_ok=True)
        fake_codex = fake_bin / "codex"
        fake_codex.write_text(
            "#!/usr/bin/env python3\n"
            "import json, sys\n"
            "if sys.argv[1:4] == ['plugin', 'list', '--available']:\n"
            "    print(json.dumps({'installed': ["
            "{'pluginId': 'sites@openai-bundled', 'installed': True}, "
            "{'pluginId': 'visualize@openai-bundled', 'installed': True}], 'available': []}))\n"
            "elif sys.argv[1:] == ['--version']:\n"
            "    print('codex-cli 0.147.0')\n"
            "else:\n"
            "    print(json.dumps({'installed': [], 'available': []}))\n",
            encoding="utf-8",
        )
        fake_codex.chmod(0o755)

        followup = self.run_bootstrap(
            "install",
            "--skip-delta-skill",
            "--install-plugins",
            "--config-profile",
            "preserve",
            "--no-doctor",
        )
        self.assert_success(followup)
        state_path = self.codex_home / "drclaw-bootstrap-state.json"
        state = json.loads(state_path.read_text(encoding="utf-8"))
        self.assertEqual(state["config_profile"], "safe")
        self.assertIsInstance(state["managed_config_sha256"], str)

        config_path = self.codex_home / "config.toml"
        managed_keys = {"approval_policy", "sandbox_mode", "project_doc_max_bytes"}
        remaining = [
            line
            for line in config_path.read_text(encoding="utf-8").splitlines()
            if line.split("=", 1)[0].strip() not in managed_keys
        ]
        config_path.write_text("\n".join(remaining).strip() + "\n", encoding="utf-8")
        doctor = self.run_bootstrap("doctor", "--skip-delta-skill", "--skip-runtime", "--json")
        self.assertEqual(doctor.returncode, 1)
        report = json.loads(doctor.stdout)
        config_check = next(check for check in report["checks"] if check["name"] == "codex-config")
        self.assertEqual(config_check["level"], "FAIL")
        self.assertIn("missing managed root keys", config_check["detail"])

    def test_plugin_inventory_shape_failures_stay_machine_readable(self) -> None:
        installed = self.run_bootstrap("install", "--skip-delta-skill", "--no-doctor")
        self.assert_success(installed)
        fake_bin = self.home / ".local" / "bin"
        fake_bin.mkdir(parents=True, exist_ok=True)
        fake_codex = fake_bin / "codex"

        for malformed_payload in ("[]", '{"installed": null, "available": []}'):
            with self.subTest(payload=malformed_payload):
                fake_codex.write_text(
                    "#!/usr/bin/env python3\n"
                    "import sys\n"
                    "if sys.argv[1:] == ['--version']:\n"
                    "    print('codex-cli 0.147.0')\n"
                    "else:\n"
                    f"    print({malformed_payload!r})\n",
                    encoding="utf-8",
                )
                fake_codex.chmod(0o755)
                doctor = self.run_bootstrap(
                    "doctor",
                    "--skip-delta-skill",
                    "--require-plugins",
                    "--json",
                )
                self.assertEqual(doctor.returncode, 1)
                self.assertNotIn("Traceback", doctor.stderr)
                report = json.loads(doctor.stdout)
                plugin_check = next(
                    check for check in report["checks"] if check["name"] == "codex-plugins"
                )
                self.assertEqual(plugin_check["level"], "FAIL")

        install_plugins = self.run_bootstrap(
            "install", "--skip-delta-skill", "--install-plugins", "--no-doctor"
        )
        self.assertEqual(install_plugins.returncode, 2)
        self.assertNotIn("Traceback", install_plugins.stderr)
        self.assertIn("marketplace entries are unavailable", install_plugins.stderr)

    def test_rejects_broad_system_targets(self) -> None:
        result = subprocess.run(
            [sys.executable, str(BOOTSTRAP), "install", "--home", "/", "--no-doctor"],
            cwd=str(REPO_ROOT),
            env=os.environ.copy(),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("Refusing broad/system --home target", result.stderr)

        protected = subprocess.run(
            [
                sys.executable,
                str(BOOTSTRAP),
                "install",
                "--home",
                "/etc/drclaw-test-user",
                "--no-doctor",
            ],
            cwd=str(REPO_ROOT),
            env=os.environ.copy(),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(protected.returncode, 2)
        self.assertIn("Refusing protected system --home target", protected.stderr)


if __name__ == "__main__":
    unittest.main()
