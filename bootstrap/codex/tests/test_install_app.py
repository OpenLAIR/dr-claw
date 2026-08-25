import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "install_app.py"
SPEC = importlib.util.spec_from_file_location("drclaw_install_app", SCRIPT)
assert SPEC and SPEC.loader
install_app = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(install_app)


class AppBootstrapTestCase(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="drclaw-app-test-")
        self.root = Path(self.temporary.name)
        self.home = self.root / "home"
        self.home.mkdir(mode=0o700)
        self.repo = self.home / "disposable repo with spaces"
        self.repo.mkdir()
        self.manifest = install_app.load_manifest()
        self._write_minimal_repo()

    def tearDown(self):
        self.temporary.cleanup()

    def _write_minimal_repo(self):
        (self.repo / "server").mkdir()
        (self.repo / "scripts").mkdir()
        templates = self.repo / "bootstrap" / "codex" / "templates"
        router = (
            self.repo
            / "bootstrap"
            / "codex"
            / "skills"
            / "drclaw-skill-library"
        )
        templates.mkdir(parents=True)
        router.mkdir(parents=True)
        (templates / "config.safe.toml").write_text(
            'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n',
            encoding="utf-8",
        )
        (templates / "global-agents.md").write_text(
            "Use the managed Dr. Claw router.\n",
            encoding="utf-8",
        )
        (router / "SKILL.md").write_text(
            "---\nname: drclaw-skill-library\ndescription: Test router.\n---\n",
            encoding="utf-8",
        )
        (self.repo / "server" / "index.js").write_text("// test server\n", encoding="utf-8")
        (self.repo / "scripts" / "native-runtime.mjs").write_text("// test native\n", encoding="utf-8")
        codex = self.manifest["bundled_codex"]
        version = codex["version"]
        platform_contract = codex["platforms"][install_app.platform_artifact_key()]
        dependencies = {
            "@openai/codex": version,
            "@openai/codex-sdk": version,
        }
        package = {
            "name": "dr-claw",
            "version": "1.1.4",
            "engines": {"node": self.manifest["node"]["supported_package_engine"]},
            "dependencies": dependencies,
        }
        package_lock = {
            "name": "dr-claw",
            "version": "1.1.4",
            "lockfileVersion": 3,
            "packages": {
                "": {
                    "name": "dr-claw",
                    "version": "1.1.4",
                    "dependencies": dependencies,
                },
                "node_modules/@openai/codex": {
                    "version": version,
                    "integrity": "sha512-test-cli",
                    "bin": {"codex": "bin/codex.js"},
                },
                "node_modules/@openai/codex-sdk": {
                    "version": version,
                    "integrity": "sha512-test-sdk",
                    "dependencies": {"@openai/codex": version},
                },
                platform_contract["package_relative_path"]: {
                    "name": "@openai/codex",
                    "version": platform_contract["package_version"],
                    "integrity": "sha512-test-platform",
                },
            },
        }
        (self.repo / "package.json").write_text(json.dumps(package), encoding="utf-8")
        (self.repo / "package-lock.json").write_text(json.dumps(package_lock), encoding="utf-8")

    def args(self, **overrides):
        values = {
            "home": str(self.home),
            "codex_home": None,
            "host": "127.0.0.1",
            "port": 3001,
            "service": "none",
            "start": False,
            "node_archive": None,
            "replace": False,
            "dry_run": False,
            "no_doctor": True,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def _create_fake_runtime(self, installer, *, with_receipt=True):
        installer.paths.node_binary.parent.mkdir(parents=True, exist_ok=True)
        installer.paths.node_binary.write_text(
            "#!/bin/sh\n"
            "if [ \"${1-}\" = '--version' ]; then printf '%s\\n' 'v22.23.2'; exit 0; fi\n"
            "script=${1:?missing script}; shift\n"
            "exec \"$script\" \"$@\"\n",
            encoding="utf-8",
        )
        installer.paths.npm_binary.write_text(
            "#!/bin/sh\n"
            "if [ \"${1-}\" = '--version' ]; then printf '%s\\n' '10.9.9'; "
            "else printf '%s\\n' '{\"name\":\"dr-claw\",\"version\":\"1.1.4\"}'; fi\n",
            encoding="utf-8",
        )
        os.chmod(installer.paths.node_binary, 0o700)
        os.chmod(installer.paths.npm_binary, 0o700)
        layout = install_app.validate_runtime_layout(
            installer.paths.runtime_parent,
            installer.paths.node_runtime,
            installer.paths.node_binary,
            installer.paths.npm_binary,
            str(self.manifest["node"]["version"]),
        )
        if with_receipt:
            install_app.write_node_runtime_receipt(installer.paths, self.manifest, layout)

    def _archive_receipt_contract(self, final_runtime):
        artifact = self.manifest["node"]["artifacts"]["linux-x64"]
        return {
            "schema_version": self.manifest["runtime_receipt"]["schema_version"],
            "managed_by": install_app.RUNTIME_RECEIPT_MANAGED_BY,
            "node_version": self.manifest["node"]["version"],
            "artifact_key": "linux-x64",
            "artifact_filename": artifact["filename"],
            "artifact_sha256": artifact["sha256"],
            "runtime_root": str(final_runtime),
        }

    def _create_immutable_release(self, label):
        staging = self.root / f"{label}-release-staging"
        shutil.copytree(self.repo, staging)
        (staging / "server" / "index.js").write_text(
            f"// immutable {label} release\n", encoding="utf-8"
        )
        subprocess.run(["git", "init", "-q", str(staging)], check=True, timeout=20)
        subprocess.run(
            ["git", "-C", str(staging), "config", "user.name", "Dr Claw Test"],
            check=True,
            timeout=20,
        )
        subprocess.run(
            ["git", "-C", str(staging), "config", "user.email", "test@invalid.example"],
            check=True,
            timeout=20,
        )
        subprocess.run(
            ["git", "-C", str(staging), "add", "-A"], check=True, timeout=20
        )
        subprocess.run(
            ["git", "-C", str(staging), "commit", "-q", "-m", f"{label} fixture"],
            check=True,
            timeout=20,
        )
        revision = subprocess.run(
            ["git", "-C", str(staging), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        ).stdout.strip()
        release_root = self.home / ".local" / "share" / "drclaw" / "releases"
        release_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        release_root.chmod(0o700)
        checkout = release_root / revision
        staging.replace(checkout)
        checkout.chmod(0o700)
        return checkout

    def _write_legacy_v01_receipt(self, installer, old_repo, **overrides):
        dist = old_repo / "dist"
        dist.mkdir(exist_ok=True)
        (dist / "index.html").write_text("legacy build\n", encoding="utf-8")
        install_app.atomic_write(installer.paths.env_file, "legacy environment fixture\n", 0o600)
        install_app.atomic_write(installer.paths.npm_userconfig, "legacy npm fixture\n", 0o600)
        install_app.atomic_write(installer.paths.launcher, "#!/bin/sh\nexit 0\n", 0o700)
        layout = install_app.validate_runtime_layout(
            installer.paths.runtime_parent,
            installer.paths.node_runtime,
            installer.paths.node_binary,
            installer.paths.npm_binary,
            self.manifest["node"]["version"],
        )
        state = {
            "schema_version": 1,
            "managed_by": "drclaw-web-bootstrap",
            "bundle_version": "0.1.0",
            "installed_at": install_app.utc_now(),
            "repo_root": str(old_repo),
            "git": install_app.git_receipt(old_repo),
            "application_source_sha256": install_app.application_source_digest(
                old_repo, self.manifest
            ),
            "package_lock_sha256": install_app.sha256_file(old_repo / "package-lock.json"),
            "dist_sha256": install_app.directory_digest(dist),
            "node": {
                "version": self.manifest["node"]["version"],
                "artifact_key": installer.paths.artifact_key,
                "artifact_sha256": installer.paths.artifact["sha256"],
                "binary": str(installer.paths.node_binary),
                **layout,
            },
            "environment_file": str(installer.paths.env_file),
            "environment_sha256": install_app.sha256_file(installer.paths.env_file),
            "codex_home": str(installer.paths.codex_home),
            "npm_userconfig": str(installer.paths.npm_userconfig),
            "npm_userconfig_sha256": install_app.sha256_file(installer.paths.npm_userconfig),
            "database_path": str(installer.paths.database_path),
            "workspace_root": str(installer.paths.workspace_root),
            "launcher": str(installer.paths.launcher),
            "launcher_sha256": install_app.sha256_file(installer.paths.launcher),
            "service": "launcher-only-nonlogin-home",
            "unit_file": None,
            "unit_sha256": None,
            "started_by_installer": False,
        }
        state.update(overrides)
        install_app.atomic_write(
            installer.paths.receipt,
            json.dumps(state, indent=2, sort_keys=True) + "\n",
            0o600,
        )
        return state

    def _fake_npm_install(self, installer, *, reported_codex_version=None, trace_path=None):
        (self.repo / "dist").mkdir(exist_ok=True)
        (self.repo / "dist" / "index.html").write_text("ok\n", encoding="utf-8")
        bundled = self.manifest["bundled_codex"]
        version = bundled["version"]
        reported = reported_codex_version or version
        platform_contract = bundled["platforms"][install_app.platform_artifact_key()]
        cli_root = self.repo / bundled["cli_package_relative_path"]
        sdk_root = self.repo / bundled["sdk_package_relative_path"]
        platform_root = self.repo / platform_contract["package_relative_path"]
        launcher = self.repo / bundled["launcher_relative_path"]
        platform_binary = platform_root / platform_contract["binary_relative_path"]
        launcher.parent.mkdir(parents=True, exist_ok=True)
        sdk_root.mkdir(parents=True, exist_ok=True)
        platform_binary.parent.mkdir(parents=True, exist_ok=True)
        (cli_root / "package.json").write_text(
            json.dumps(
                {
                    "name": "@openai/codex",
                    "version": version,
                    "bin": {"codex": "bin/codex.js"},
                }
            ),
            encoding="utf-8",
        )
        (sdk_root / "package.json").write_text(
            json.dumps(
                {
                    "name": "@openai/codex-sdk",
                    "version": version,
                    "dependencies": {"@openai/codex": version},
                }
            ),
            encoding="utf-8",
        )
        (platform_root / "package.json").write_text(
            json.dumps(
                {
                    "name": "@openai/codex",
                    "version": platform_contract["package_version"],
                }
            ),
            encoding="utf-8",
        )
        platform_binary.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        os.chmod(platform_binary, 0o700)
        trace = str(trace_path) if trace_path else ""
        launcher.write_text(
            "#!/usr/bin/env python3\n"
            "import json, os, pathlib, sys\n"
            f"reported = {reported!r}\n"
            f"trace = {trace!r}\n"
            "args = sys.argv[1:]\n"
            "if trace:\n"
            "    with open(trace, 'a', encoding='utf-8') as handle:\n"
            "        handle.write(json.dumps({'home': os.environ.get('HOME'), "
            "'codex_home': os.environ.get('CODEX_HOME'), 'cwd': os.getcwd(), "
            "'openai_key': os.environ.get('OPENAI_API_KEY'), "
            "'gh_token': os.environ.get('GH_TOKEN'), 'entries': sorted(os.listdir('.'))}) + '\\n')\n"
            "if os.environ.get('OPENAI_API_KEY') or os.environ.get('GH_TOKEN'):\n"
            "    raise SystemExit(91)\n"
            "if args == ['--version']:\n"
            "    print('codex-cli ' + reported)\n"
            "elif args == ['debug', 'prompt-input', 'drclaw-bootstrap-contract-probe']:\n"
            "    home = pathlib.Path(os.environ['HOME'])\n"
            "    codex_home = pathlib.Path(os.environ['CODEX_HOME'])\n"
            "    skill = home / '.agents/skills/drclaw-skill-library/SKILL.md'\n"
            "    if not (codex_home / 'config.toml').is_file() or not skill.is_file():\n"
            "        raise SystemExit(92)\n"
            "    text = (codex_home / 'AGENTS.md').read_text(encoding='utf-8')\n"
            "    text += f'\\n- drclaw-skill-library: contract (file: {skill})'\n"
            "    print(json.dumps([{'type': 'message', 'role': 'developer', "
            "'content': [{'type': 'input_text', 'text': text}]}]))\n"
            "elif args == ['plugin', 'list', '--json']:\n"
            "    print(json.dumps({'installed': [], 'available': []}))\n"
            "else:\n"
            "    raise SystemExit(7)\n",
            encoding="utf-8",
        )
        os.chmod(launcher, 0o700)
        installed_router = self.home / ".agents" / "skills" / "drclaw-skill-library"
        installed_router.parent.mkdir(parents=True, exist_ok=True)
        if installed_router.is_symlink() or installed_router.exists():
            if installed_router.is_dir() and not installed_router.is_symlink():
                shutil.rmtree(installed_router)
            else:
                installed_router.unlink()
        installed_router.symlink_to(
            self.repo
            / "bootstrap"
            / "codex"
            / "skills"
            / "drclaw-skill-library",
            target_is_directory=True,
        )

    def _complete_install(self, **overrides):
        installer = install_app.AppInstaller(self.args(**overrides), self.repo, self.manifest)
        installer.ensure_node = lambda: self._create_fake_runtime(installer)
        installer.run_npm = lambda: self._fake_npm_install(installer)
        installer.run()
        return installer

    def test_manifest_pins_official_node_artifacts(self):
        node = self.manifest["node"]
        self.assertEqual(self.manifest["bundle_version"], "0.2.3")
        self.assertEqual(
            self.manifest["runtime_receipt"],
            {"schema_version": 1, "filename": ".drclaw-node-runtime.json"},
        )
        self.assertEqual(
            set(self.manifest["timeouts_seconds"]), set(install_app.REQUIRED_TIMEOUT_KEYS)
        )
        self.assertEqual(node["version"], "22.23.2")
        self.assertEqual(node["supported_package_engine"], "22.x || 24.x")
        self.assertEqual(
            node["artifacts"]["linux-x64"]["sha256"],
            "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
        )
        self.assertEqual(
            node["artifacts"]["linux-arm64"]["sha256"],
            "fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8",
        )

    def test_development_prune_rejects_retained_dev_only_package(self):
        lock_path = self.repo / "package-lock.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["packages"]["node_modules/dev-only-fixture"] = {"version": "1.0.0", "dev": True}
        lock_path.write_text(json.dumps(lock), encoding="utf-8")
        retained = self.repo / "node_modules" / "dev-only-fixture"
        retained.mkdir(parents=True)

        with self.assertRaisesRegex(install_app.AppBootstrapError, "development-only packages"):
            install_app.verify_pruned_development_dependencies(self.repo)

        shutil.rmtree(retained.parent)
        self.assertEqual(install_app.verify_pruned_development_dependencies(self.repo), 1)

    def test_validate_repo_requires_manifest_node_engine_match(self):
        package_path = self.repo / "package.json"
        package = json.loads(package_path.read_text(encoding="utf-8"))
        package["engines"]["node"] = "20.x"
        package_path.write_text(json.dumps(package), encoding="utf-8")
        with self.assertRaisesRegex(install_app.AppBootstrapError, "Node.js engine"):
            install_app.validate_repo(self.repo, self.manifest)

    def test_cli_accepts_codex_home_for_install_doctor_and_internal_launch(self):
        parser = install_app.build_parser()
        for command in ("install", "doctor", "launch"):
            args = parser.parse_args(
                [command, "--home", str(self.home), "--codex-home", str(self.home / "custom-codex")]
            )
            self.assertEqual(args.command, command)
            self.assertEqual(args.codex_home, str(self.home / "custom-codex"))

    def test_dry_run_writes_nothing_and_does_not_probe_service(self):
        installer = install_app.AppInstaller(self.args(dry_run=True), self.repo, self.manifest)
        output = io.StringIO()
        before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        with contextlib.redirect_stdout(output):
            installer.run()
        after = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        self.assertEqual(after, before)
        self.assertIn("would download", output.getvalue())
        self.assertNotIn("JWT_SECRET=", output.getvalue())

    def test_missing_ssl_or_xz_runtime_fails_before_target_writes(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        with mock.patch.object(
            install_app,
            "validate_app_python_runtime",
            side_effect=install_app.AppBootstrapError("Python SSL/XZ runtime unavailable"),
        ):
            with self.assertRaisesRegex(install_app.AppBootstrapError, "SSL/XZ runtime unavailable"):
                installer.run()
        after = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
        self.assertEqual(after, before)
        self.assertFalse((self.home / ".config").exists())

    def test_host_arch_glibc_and_noexec_gates_fail_before_target_writes(self):
        before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))

        with mock.patch.object(install_app.platform, "machine", return_value="riscv64"):
            with self.assertRaisesRegex(install_app.AppBootstrapError, "architecture"):
                install_app.AppInstaller(self.args(), self.repo, self.manifest)
        self.assertEqual(
            sorted(path.relative_to(self.home) for path in self.home.rglob("*")), before
        )

        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        with mock.patch.object(install_app.os, "confstr", return_value="glibc 2.17"):
            with self.assertRaisesRegex(install_app.AppBootstrapError, "glibc 2.28"):
                installer.run()
        self.assertEqual(
            sorted(path.relative_to(self.home) for path in self.home.rglob("*")), before
        )

        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        exec_stat = mock.Mock(f_flag=0)
        noexec_stat = mock.Mock(f_flag=install_app.LINUX_ST_NOEXEC)
        with mock.patch.object(install_app, "_glibc_version", return_value=(2, 28)), mock.patch.object(
            install_app.os, "statvfs", side_effect=[exec_stat, noexec_stat]
        ) as statvfs:
            with self.assertRaisesRegex(install_app.AppBootstrapError, "noexec"):
                installer.run()
        self.assertEqual(statvfs.call_count, 2)
        self.assertEqual(
            sorted(path.relative_to(self.home) for path in self.home.rglob("*")), before
        )
        self.assertFalse((self.home / ".config").exists())

        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        with mock.patch.object(install_app, "_glibc_version", return_value=(2, 28)), mock.patch.object(
            install_app.os,
            "statvfs",
            side_effect=[exec_stat, exec_stat, noexec_stat],
        ) as statvfs:
            with self.assertRaisesRegex(install_app.AppBootstrapError, "noexec"):
                installer.run()
        self.assertEqual(statvfs.call_count, 3)
        self.assertEqual(
            sorted(path.relative_to(self.home) for path in self.home.rglob("*")), before
        )
        self.assertFalse((self.home / ".config").exists())

    def test_home_codex_and_managed_ancestor_writes_fail_before_dry_or_real_install(self):
        cases = (
            (self.home, self.args(), None),
            (self.home / "custom-codex-parent", self.args(
                codex_home=str(self.home / "custom-codex-parent" / "codex")
            ), None),
            (self.home / ".local" / "share", self.args(), None),
            (self.home / ".local" / "state", self.args(), None),
            (self.home / ".config", self.args(), None),
            (
                self.home / ".config" / "systemd",
                self.args(service="user-systemd"),
                self.home,
            ),
        )
        for unsafe, base_args, login_home in cases:
            with self.subTest(unsafe=unsafe):
                unsafe.mkdir(parents=True, exist_ok=True, mode=0o700)
                unsafe.chmod(0o770)
                before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                for dry_run in (False, True):
                    args = argparse.Namespace(**vars(base_args))
                    args.dry_run = dry_run
                    login_patch = (
                        mock.patch.object(install_app, "login_home_path", return_value=login_home)
                        if login_home is not None
                        else contextlib.nullcontext()
                    )
                    with login_patch:
                        with self.assertRaisesRegex(
                            install_app.AppBootstrapError, "writable by group/other"
                        ):
                            install_app.AppInstaller(args, self.repo, self.manifest)
                    self.assertEqual(
                        sorted(path.relative_to(self.home) for path in self.home.rglob("*")),
                        before,
                    )
                unsafe.chmod(0o700)

    def test_complete_install_is_private_secret_free_and_doctor_passes(self):
        installer = self._complete_install()
        env_content = installer.paths.env_file.read_text(encoding="utf-8")
        values = install_app.parse_managed_env(installer.paths.env_file)
        self.assertEqual(values["HOST"], "127.0.0.1")
        self.assertEqual(values["DATABASE_PATH"], str(installer.paths.database_path))
        self.assertEqual(values["WORKSPACES_ROOT"], str(installer.paths.workspace_root))
        self.assertEqual(values["CODEX_HOME"], str(self.home / ".codex"))
        self.assertEqual(values["DR_CLAW_STRICT_PORT"], "1")
        self.assertRegex(values["JWT_SECRET"], r"^[0-9a-f]{64}$")
        self.assertEqual(stat.S_IMODE(installer.paths.env_file.stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(installer.paths.launcher.stat().st_mode), 0o700)

        receipt_text = installer.paths.receipt.read_text(encoding="utf-8")
        receipt = json.loads(receipt_text)
        self.assertNotIn(values["JWT_SECRET"], receipt_text)
        self.assertNotIn("JWT_SECRET", receipt_text)
        self.assertEqual(receipt["service"], "launcher-only-nonlogin-home")
        self.assertFalse(receipt["started_by_installer"])
        self.assertEqual(receipt["package_lock_sha256"], install_app.sha256_file(self.repo / "package-lock.json"))
        bundled_receipt = receipt["bundled_codex"]
        self.assertEqual(bundled_receipt["version"], "0.147.0")
        self.assertEqual(bundled_receipt["observed_version"], "codex-cli 0.147.0")
        self.assertEqual(
            bundled_receipt["command"],
            [str(installer.paths.node_binary), str(installer.paths.codex_launcher)],
        )
        self.assertRegex(bundled_receipt["launcher_sha256"], r"^[0-9a-f]{64}$")
        self.assertRegex(bundled_receipt["platform_binary_sha256"], r"^[0-9a-f]{64}$")

        doctor_args = argparse.Namespace(home=str(self.home), codex_home=None, json=False)
        doctor = install_app.AppDoctor(doctor_args, self.repo, self.manifest)
        with contextlib.redirect_stdout(io.StringIO()):
            status = doctor.run()
        self.assertEqual(status, 0)
        self.assertFalse(any(item["level"] == "FAIL" for item in doctor.checks))
        self.assertNotIn(values["JWT_SECRET"], json.dumps(doctor.checks))
        self.assertIn("secret not displayed", json.dumps(doctor.checks))
        self.assertIn(install_app.MANAGED_ENV_MARKER, env_content)

    def test_bundled_codex_contracts_use_only_synthetic_state_and_no_operator_secrets(self):
        trace = self.root / "bundled-codex-trace.jsonl"
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.ensure_node = lambda: self._create_fake_runtime(installer)
        installer.run_npm = lambda: self._fake_npm_install(installer, trace_path=trace)
        secret_environment = {
            "OPENAI_API_KEY": "must-not-enter-bundled-doctor",
            "GH_TOKEN": "must-not-enter-bundled-doctor",
            "SSH_AUTH_SOCK": "/tmp/private-agent.sock",
        }
        with mock.patch.dict(os.environ, secret_environment, clear=False):
            installer.run()
            doctor = install_app.AppDoctor(
                argparse.Namespace(home=str(self.home), codex_home=None, json=False),
                self.repo,
                self.manifest,
            )
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(doctor.run(), 0)

        checks = {item["name"]: item for item in doctor.checks}
        self.assertEqual(checks["bundled-codex"]["level"], "PASS")
        for probe in self.manifest["bundled_codex"]["required_probes"]:
            self.assertEqual(checks[f"bundled-codex-contract:{probe}"]["level"], "PASS")
        observations = [json.loads(line) for line in trace.read_text(encoding="utf-8").splitlines()]
        self.assertGreaterEqual(len(observations), 4)
        for observation in observations:
            self.assertNotEqual(observation["home"], str(self.home))
            self.assertNotEqual(observation["codex_home"], str(self.home / ".codex"))
            self.assertEqual(observation["entries"], [])
            self.assertIsNone(observation["openai_key"])
            self.assertIsNone(observation["gh_token"])

    def test_bundled_codex_tamper_and_symlink_escape_fail_before_execution(self):
        installer = self._complete_install()
        state = json.loads(installer.paths.receipt.read_text(encoding="utf-8"))
        marker = self.root / "tampered-bundled-cli-executed"
        installer.paths.codex_launcher.write_text(
            f"#!/bin/sh\ntouch {marker}\nprintf '%s\\n' 'codex-cli 0.147.0'\n",
            encoding="utf-8",
        )
        os.chmod(installer.paths.codex_launcher, 0o700)
        doctor = install_app.AppDoctor(
            argparse.Namespace(home=str(self.home), codex_home=None, json=False),
            self.repo,
            self.manifest,
        )
        doctor.check_runtime(state)
        doctor.checks.clear()
        doctor.check_bundled_codex(state)
        self.assertFalse(marker.exists())
        self.assertTrue(
            any(item["name"] == "bundled-codex" and item["level"] == "FAIL" for item in doctor.checks)
        )

        self._fake_npm_install(installer)
        state = json.loads(installer.paths.receipt.read_text(encoding="utf-8"))
        external = self.root / "external-codex-binary"
        external.write_text(f"#!/bin/sh\ntouch {marker}\n", encoding="utf-8")
        os.chmod(external, 0o700)
        installer.paths.codex_binary.unlink()
        installer.paths.codex_binary.symlink_to(external)
        doctor.checks.clear()
        doctor.check_bundled_codex(state)
        self.assertFalse(marker.exists())
        self.assertTrue(
            any(item["name"] == "bundled-codex" and item["level"] == "FAIL" for item in doctor.checks)
        )

    def test_bundled_codex_low_reported_version_refuses_install_receipt(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.ensure_node = lambda: self._create_fake_runtime(installer)
        installer.run_npm = lambda: self._fake_npm_install(
            installer,
            reported_codex_version="0.146.0",
        )
        with self.assertRaisesRegex(install_app.AppBootstrapError, "version mismatch"):
            installer.run()
        self.assertFalse(installer.paths.receipt.exists())

    def test_managed_service_uses_strict_requested_port(self):
        server_source = SCRIPT.parents[2] / "server" / "index.js"
        content = server_source.read_text(encoding="utf-8")
        self.assertIn("const STRICT_PORT = process.env.DR_CLAW_STRICT_PORT === '1';", content)
        self.assertIn("maxAttempts: STRICT_PORT ? 1 : undefined,", content)

    def test_idempotent_reinstall_preserves_generated_secret(self):
        first = self._complete_install()
        first_secret = install_app.parse_managed_env(first.paths.env_file)["JWT_SECRET"]
        second = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        second.ensure_node = lambda: None
        second.run_npm = lambda: self._fake_npm_install(second)
        second.run()
        second_secret = install_app.parse_managed_env(second.paths.env_file)["JWT_SECRET"]
        self.assertEqual(first_secret, second_secret)

    def test_unmanaged_environment_requires_replace_and_gets_backup(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.prepare_directories()
        installer.paths.env_file.write_text("JWT_SECRET=user-owned\n", encoding="utf-8")
        with self.assertRaises(install_app.AppBootstrapError):
            installer.write_environment()

        replacing = install_app.AppInstaller(self.args(replace=True), self.repo, self.manifest)
        replacing.write_environment()
        backups = list(replacing.paths.backup_root.glob("*/drclaw.env"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(encoding="utf-8"), "JWT_SECRET=user-owned\n")

    def test_public_bind_and_privileged_port_fail_closed(self):
        public = install_app.AppInstaller(self.args(host="0.0.0.0", dry_run=True), self.repo, self.manifest)
        with self.assertRaises(install_app.AppBootstrapError):
            public.run()
        privileged = install_app.AppInstaller(self.args(port=80, dry_run=True), self.repo, self.manifest)
        with self.assertRaises(install_app.AppBootstrapError):
            privileged.run()

    def test_target_symlink_is_refused(self):
        external = self.root / "external"
        external.mkdir()
        (self.home / ".config").symlink_to(external, target_is_directory=True)
        with self.assertRaises(install_app.AppBootstrapError):
            install_app.AppInstaller(self.args(), self.repo, self.manifest)
        self.assertEqual(list(external.iterdir()), [])

    def test_systemd_auto_falls_back_without_starting(self):
        installer = install_app.AppInstaller(self.args(service="auto"), self.repo, self.manifest)
        installer.prepare_directories()
        installer.paths.launcher.write_text("#!/bin/sh\n", encoding="utf-8")
        os.chmod(installer.paths.launcher, 0o700)
        with mock.patch.object(
            installer, "detect_user_systemd", side_effect=AssertionError("must not probe real user-systemd")
        ):
            installer.configure_service()
        self.assertEqual(installer.service_result, "launcher-only-nonlogin-home")
        self.assertFalse(installer.paths.unit_file.exists())

    def test_systemctl_path_must_be_absolute_and_root_trusted(self):
        fake = self.root / "systemctl"
        marker = self.root / "fake-systemctl-executed"
        fake.write_text(f"#!/bin/sh\ntouch {marker}\n", encoding="utf-8")
        os.chmod(fake, 0o555)
        with self.assertRaisesRegex(install_app.AppBootstrapError, "root-owned|group/world"):
            install_app.validate_trusted_systemctl_path(str(fake))
        with mock.patch.object(
            install_app.subprocess,
            "run",
            side_effect=AssertionError("untrusted systemctl must not execute"),
        ):
            with self.assertRaisesRegex(install_app.AppBootstrapError, "root-owned|group/world"):
                install_app.run_user_systemctl(
                    str(fake), ["show-environment"], self.home, self.manifest
                )
        with self.assertRaisesRegex(install_app.AppBootstrapError, "relative"):
            install_app.validate_trusted_systemctl_path("systemctl")
        with mock.patch.object(
            install_app.shutil, "which", return_value="systemctl"
        ) as locate:
            with self.assertRaisesRegex(install_app.AppBootstrapError, "relative"):
                install_app.resolve_trusted_systemctl()
        locate.assert_called_once_with("systemctl", path=install_app.TRUSTED_SYSTEM_PATH)
        self.assertFalse(marker.exists())

    def test_systemctl_calls_use_minimal_secret_free_environment_and_timeouts(self):
        installer = install_app.AppInstaller(
            self.args(service="user-systemd"), self.repo, self.manifest
        )
        installer.nonlogin_home = False
        installer.prepare_directories()
        calls = []

        def systemctl_run(command, **kwargs):
            calls.append((command, kwargs))
            returncode = 3 if "is-active" in command else 0
            return subprocess.CompletedProcess(command, returncode, "", "")

        inherited = {
            "DRCLAW_TEST_SECRET": "must-not-leak",
            "OPENAI_API_KEY": "must-not-leak",
            "PATH": str(self.root),
            "DBUS_SESSION_BUS_ADDRESS": "unix:path=/tmp/untrusted-secret-bus",
        }
        with mock.patch.dict(os.environ, inherited, clear=False), mock.patch.object(
            install_app, "resolve_trusted_systemctl", return_value="/usr/bin/systemctl"
        ), mock.patch.object(
            install_app, "validate_trusted_systemctl_path", return_value="/usr/bin/systemctl"
        ), mock.patch.object(install_app.subprocess, "run", side_effect=systemctl_run):
            installer.configure_service()

        self.assertGreaterEqual(len(calls), 5)
        allowed = {
            "HOME",
            "PATH",
            "USER",
            "LOGNAME",
            "LANG",
            "LC_ALL",
            "XDG_RUNTIME_DIR",
            "DBUS_SESSION_BUS_ADDRESS",
        }
        for command, kwargs in calls:
            self.assertEqual(command[0], "/usr/bin/systemctl")
            self.assertEqual(command[1], "--user")
            self.assertEqual(
                kwargs["timeout"], self.manifest["timeouts_seconds"]["systemctl"]
            )
            child_env = kwargs["env"]
            self.assertLessEqual(set(child_env), allowed)
            self.assertEqual(child_env["HOME"], str(self.home))
            self.assertEqual(child_env["PATH"], install_app.TRUSTED_SYSTEM_PATH)
            self.assertEqual(child_env["LANG"], "C")
            self.assertEqual(child_env["LC_ALL"], "C")
            self.assertNotIn("DRCLAW_TEST_SECRET", child_env)
            self.assertNotIn("OPENAI_API_KEY", child_env)
            self.assertNotEqual(
                child_env.get("DBUS_SESSION_BUS_ADDRESS"),
                inherited["DBUS_SESSION_BUS_ADDRESS"],
            )

    def test_systemd_runtime_directory_requires_a_private_leaf_and_trusted_chain(self):
        private_runtime = self.root / "private-runtime"
        private_runtime.mkdir(mode=0o700)
        self.assertTrue(
            install_app._trusted_user_runtime_directory(private_runtime, os.geteuid())
        )

        weak_parent = self.root / "weak-runtime-parent"
        weak_parent.mkdir(mode=0o700)
        weak_parent.chmod(0o777)
        weak_runtime = weak_parent / "runtime"
        weak_runtime.mkdir(mode=0o700)
        self.assertFalse(
            install_app._trusted_user_runtime_directory(weak_runtime, os.geteuid())
        )
        with mock.patch.dict(
            os.environ, {"XDG_RUNTIME_DIR": str(weak_runtime)}, clear=False
        ):
            environment = install_app.minimal_systemd_environment(self.home)
        self.assertNotEqual(environment.get("XDG_RUNTIME_DIR"), str(weak_runtime))

    def test_active_managed_user_service_is_restarted_but_inactive_is_not_started(self):
        for active in (True, False):
            with self.subTest(active=active):
                installer = install_app.AppInstaller(
                    self.args(service="user-systemd"), self.repo, self.manifest
                )
                installer.nonlogin_home = False
                installer.prepare_directories()
                calls = []

                def systemctl_run(command, **kwargs):
                    calls.append(command)
                    if "is-active" in command:
                        return subprocess.CompletedProcess(command, 0 if active else 3, "", "")
                    return subprocess.CompletedProcess(command, 0, "", "")

                with mock.patch.object(installer, "detect_user_systemd", return_value=True), mock.patch.object(
                    install_app.shutil, "which", return_value="/usr/bin/systemctl"
                ), mock.patch.object(
                    install_app, "validate_trusted_systemctl_path", return_value="/usr/bin/systemctl"
                ), mock.patch.object(install_app.subprocess, "run", side_effect=systemctl_run):
                    installer.configure_service()

                restart_calls = [command for command in calls if "restart" in command]
                if active:
                    self.assertEqual(len(restart_calls), 1)
                    self.assertEqual(installer.service_result, "enabled-and-restarted")
                    self.assertTrue(installer.restarted_active_service)
                else:
                    self.assertEqual(restart_calls, [])
                    self.assertEqual(installer.service_result, "enabled-not-started")
                    self.assertFalse(installer.restarted_active_service)
                self.assertLess(
                    next(index for index, command in enumerate(calls) if "is-active" in command),
                    next(index for index, command in enumerate(calls) if "daemon-reload" in command),
                )

    def test_active_managed_user_service_restart_failure_fails_install(self):
        installer = install_app.AppInstaller(
            self.args(service="user-systemd"), self.repo, self.manifest
        )
        installer.nonlogin_home = False
        installer.prepare_directories()

        def systemctl_run(command, **kwargs):
            if "is-active" in command:
                return subprocess.CompletedProcess(command, 0, "", "")
            if "restart" in command:
                raise subprocess.CalledProcessError(1, command)
            return subprocess.CompletedProcess(command, 0, "", "")

        with mock.patch.object(installer, "detect_user_systemd", return_value=True), mock.patch.object(
            install_app.shutil, "which", return_value="/usr/bin/systemctl"
        ), mock.patch.object(
            install_app, "validate_trusted_systemctl_path", return_value="/usr/bin/systemctl"
        ), mock.patch.object(install_app.subprocess, "run", side_effect=systemctl_run):
            with self.assertRaisesRegex(install_app.AppBootstrapError, "Cannot configure"):
                installer.configure_service()

    def test_systemd_unit_template_is_user_only_and_contains_no_secret(self):
        installer = install_app.AppInstaller(self.args(service="user-systemd"), self.repo, self.manifest)
        unit = installer.unit_content()
        self.assertIn("NoNewPrivileges=true", unit)
        self.assertIn("PrivateTmp=true", unit)
        self.assertIn("UMask=0077", unit)
        self.assertNotIn("JWT_SECRET", unit)
        self.assertIn('WorkingDirectory="' + str(self.repo), unit)

    def test_isolated_home_forbids_explicit_start(self):
        installer = install_app.AppInstaller(
            self.args(service="user-systemd", start=True), self.repo, self.manifest
        )
        with self.assertRaises(install_app.AppBootstrapError):
            installer.configure_service()

    def test_isolated_home_refuses_external_checkout_mutation(self):
        external_repo = self.root / "external-repo"
        shutil.copytree(self.repo, external_repo)
        installer = install_app.AppInstaller(self.args(), external_repo, self.manifest)
        with self.assertRaises(install_app.AppBootstrapError):
            installer.run()
        self.assertFalse((self.home / ".config").exists())

    def test_managed_file_symlinks_fail_without_touching_external_target(self):
        installer = self._complete_install()
        external = self.root / "external-secret"
        external.write_text("external\n", encoding="utf-8")
        os.chmod(external, 0o644)

        installer.paths.env_file.unlink()
        installer.paths.env_file.symlink_to(external)
        with self.assertRaises(install_app.AppBootstrapError):
            installer.write_environment()
        self.assertEqual(external.read_text(encoding="utf-8"), "external\n")
        self.assertEqual(stat.S_IMODE(external.stat().st_mode), 0o644)

        installer.paths.launcher.unlink()
        installer.paths.launcher.symlink_to(external)
        with self.assertRaises(install_app.AppBootstrapError):
            installer.write_launcher()
        self.assertEqual(stat.S_IMODE(external.stat().st_mode), 0o644)

        installer.paths.receipt.unlink()
        installer.paths.receipt.symlink_to(external)
        with self.assertRaises(install_app.AppBootstrapError):
            installer.write_receipt()
        self.assertEqual(stat.S_IMODE(external.stat().st_mode), 0o644)

    def test_environment_is_canonical_hashed_and_never_shell_sourced(self):
        installer = self._complete_install()
        launcher = installer.paths.launcher.read_text(encoding="utf-8")
        self.assertNotIn("drclaw.env", launcher)
        self.assertNotIn("\n. ", launcher)
        self.assertNotIn("\nsource ", launcher)
        self.assertIn("unset PYTHONHOME PYTHONPATH", launcher)
        self.assertIn(" -I -S ", launcher)

        with installer.paths.env_file.open("a", encoding="utf-8") as handle:
            handle.write("EVIL=$(id)\n")
        with self.assertRaises(install_app.AppBootstrapError):
            install_app.parse_managed_env(installer.paths.env_file)
        app_launcher = install_app.AppLauncher(
            argparse.Namespace(home=str(self.home), codex_home=None), self.repo, self.manifest
        )
        with self.assertRaises(install_app.AppBootstrapError):
            app_launcher.validate()

        doctor = install_app.AppDoctor(
            argparse.Namespace(home=str(self.home), codex_home=None, json=False), self.repo, self.manifest
        )
        with contextlib.redirect_stdout(io.StringIO()):
            status = doctor.run()
        self.assertEqual(status, 1)
        self.assertTrue(
            any(item["name"] == "environment" and item["level"] == "FAIL" for item in doctor.checks)
        )

    def test_runtime_symlink_and_escaped_npm_are_rejected_without_execution(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.prepare_directories()
        marker = self.root / "fake-runtime-executed"
        external_runtime = self.root / "external-runtime"
        (external_runtime / "bin").mkdir(parents=True)
        for name, version in (("node", "v22.23.2"), ("npm", "10.9.9")):
            target = external_runtime / "bin" / name
            target.write_text(
                f"#!/bin/sh\ntouch {marker}\nprintf '%s\\n' '{version}'\n", encoding="utf-8"
            )
            os.chmod(target, 0o700)
        installer.paths.node_runtime.symlink_to(external_runtime, target_is_directory=True)
        with self.assertRaises(install_app.AppBootstrapError):
            installer.ensure_node()
        self.assertFalse(marker.exists())

        doctor = install_app.AppDoctor(
            argparse.Namespace(home=str(self.home), codex_home=None, json=False), self.repo, self.manifest
        )
        doctor.check_runtime(None)
        self.assertFalse(marker.exists())
        self.assertTrue(any(item["name"] == "node" and item["level"] == "FAIL" for item in doctor.checks))

        installer.paths.node_runtime.unlink()
        self._create_fake_runtime(installer)
        installer.paths.npm_binary.unlink()
        external_npm = self.root / "external-npm"
        external_npm.write_text(
            f"#!/bin/sh\ntouch {marker}\nprintf '%s\\n' '10.9.9'\n", encoding="utf-8"
        )
        os.chmod(external_npm, 0o700)
        installer.paths.npm_binary.symlink_to(external_npm)
        with self.assertRaises(install_app.AppBootstrapError):
            install_app.validate_runtime_layout(
                installer.paths.runtime_parent,
                installer.paths.node_runtime,
                installer.paths.node_binary,
                installer.paths.npm_binary,
                "22.23.2",
            )
        self.assertFalse(marker.exists())

    def test_runtime_digest_is_checked_before_node_execution(self):
        installer = self._complete_install()
        marker = self.root / "tampered-node-executed"
        installer.paths.node_binary.write_text(
            f"#!/bin/sh\ntouch {marker}\nprintf '%s\\n' 'v22.23.2'\n", encoding="utf-8"
        )
        os.chmod(installer.paths.node_binary, 0o700)
        verifier = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        with self.assertRaises(install_app.AppBootstrapError):
            verifier.ensure_node()
        self.assertFalse(marker.exists())

    def test_standalone_runtime_receipt_survives_npm_failure_and_allows_retry(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.ensure_node = lambda: self._create_fake_runtime(installer)
        installer.run_npm = mock.Mock(
            side_effect=install_app.AppBootstrapError("synthetic npm build failure")
        )
        with self.assertRaisesRegex(install_app.AppBootstrapError, "synthetic npm"):
            installer.run()

        self.assertTrue(installer.paths.node_runtime_receipt.is_file())
        self.assertEqual(stat.S_IMODE(installer.paths.node_runtime_receipt.stat().st_mode), 0o600)
        self.assertFalse(installer.paths.receipt.exists())

        retry = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        retry.ensure_node()
        self.assertTrue(retry.paths.node_runtime_receipt.is_file())

    def test_v01_old_immutable_release_migrates_runtime_receipt_for_new_release(self):
        old_repo = self._create_immutable_release("old")
        new_repo = self._create_immutable_release("new")
        self.assertNotEqual(old_repo, new_repo)
        installer = install_app.AppInstaller(self.args(), new_repo, self.manifest)
        installer.prepare_directories()
        self._create_fake_runtime(installer, with_receipt=False)
        legacy = self._write_legacy_v01_receipt(installer, old_repo)

        installer.ensure_node()
        self.assertTrue(installer.paths.node_runtime_receipt.is_file())
        self.assertEqual(
            install_app.validate_node_runtime_receipt(installer.paths, self.manifest)[
                "observed_version"
            ],
            "v22.23.2",
        )
        self.assertEqual(
            json.loads(installer.paths.receipt.read_text(encoding="utf-8"))["bundle_version"],
            "0.1.0",
        )
        self.assertEqual(
            json.loads(installer.paths.receipt.read_text(encoding="utf-8")), legacy
        )
        self.assertTrue(old_repo.is_dir())

    def test_v01_peer_metadata_lock_normalization_migrates_runtime_receipt(self):
        old_repo = self._create_immutable_release("old-peer-normalization")
        new_repo = self._create_immutable_release("new-peer-normalization")
        (old_repo / ".gitignore").write_text("dist/\nnode_modules/\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(old_repo), "add", ".gitignore"], check=True, timeout=20)
        subprocess.run(["git", "-C", str(old_repo), "commit", "-q", "-m", "ignore build output"], check=True, timeout=20)
        moved_repo = old_repo.parent / subprocess.run(
            ["git", "-C", str(old_repo), "rev-parse", "HEAD"],
            check=True,
            capture_output=True,
            text=True,
            timeout=20,
        ).stdout.strip()
        old_repo.rename(moved_repo)
        old_repo = moved_repo
        lock_path = old_repo / "package-lock.json"
        lock = json.loads(lock_path.read_text(encoding="utf-8"))
        lock["packages"]["node_modules/@openai/codex"]["peer"] = True
        lock_path.write_text(json.dumps(lock), encoding="utf-8")

        installer = install_app.AppInstaller(self.args(), new_repo, self.manifest)
        installer.prepare_directories()
        self._create_fake_runtime(installer, with_receipt=False)
        legacy = self._write_legacy_v01_receipt(installer, old_repo)
        self.assertTrue(legacy["git"]["dirty"])
        self.assertTrue(
            install_app.legacy_v01_peer_metadata_only_lock_drift(old_repo, old_repo.name)
        )

        installer.ensure_node()
        self.assertTrue(installer.paths.node_runtime_receipt.is_file())

        lock["packages"]["node_modules/@openai/codex"]["version"] = "tampered"
        lock_path.write_text(json.dumps(lock), encoding="utf-8")
        self.assertFalse(
            install_app.legacy_v01_peer_metadata_only_lock_drift(old_repo, old_repo.name)
        )

    def test_v01_migration_rejects_old_release_path_and_digest_tamper(self):
        old_repo = self._create_immutable_release("old-tamper")
        new_repo = self._create_immutable_release("new-tamper")
        installer = install_app.AppInstaller(self.args(), new_repo, self.manifest)
        installer.prepare_directories()
        self._create_fake_runtime(installer, with_receipt=False)

        valid = self._write_legacy_v01_receipt(installer, old_repo)
        mutations = (
            ("recorded path", {"repo_root": str(new_repo)}, "Git provenance"),
            (
                "source digest",
                {"application_source_sha256": "0" * 64},
                "source digest",
            ),
        )
        for label, changes, expected in mutations:
            with self.subTest(label=label):
                tampered = {**valid, **changes}
                install_app.atomic_write(
                    installer.paths.receipt,
                    json.dumps(tampered, indent=2, sort_keys=True) + "\n",
                    0o600,
                )
                with self.assertRaisesRegex(install_app.AppBootstrapError, expected):
                    installer.ensure_node()
                self.assertFalse(installer.paths.node_runtime_receipt.exists())

    def test_runtime_without_trusted_receipt_and_tampered_receipt_fail_before_execution(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.prepare_directories()
        self._create_fake_runtime(installer, with_receipt=False)
        marker = self.root / "unreceipted-node-executed"
        installer.paths.node_binary.write_text(
            f"#!/bin/sh\ntouch {marker}\nprintf '%s\\n' 'v22.23.2'\n",
            encoding="utf-8",
        )
        os.chmod(installer.paths.node_binary, 0o700)
        with self.assertRaisesRegex(install_app.AppBootstrapError, "neither a standalone"):
            installer.ensure_node()
        self.assertFalse(marker.exists())

        clean = self._complete_install()
        receipt = json.loads(clean.paths.node_runtime_receipt.read_text(encoding="utf-8"))
        receipt["artifact_sha256"] = "0" * 64
        install_app.atomic_write(
            clean.paths.node_runtime_receipt,
            json.dumps(receipt, indent=2, sort_keys=True) + "\n",
            0o600,
        )
        marker = self.root / "tampered-receipt-node-executed"
        clean.paths.node_binary.write_text(
            f"#!/bin/sh\ntouch {marker}\nprintf '%s\\n' 'v22.23.2'\n",
            encoding="utf-8",
        )
        os.chmod(clean.paths.node_binary, 0o700)
        verifier = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        with self.assertRaisesRegex(install_app.AppBootstrapError, "differs from manifest"):
            verifier.ensure_node()
        self.assertFalse(marker.exists())

    def test_npm_lifecycle_environment_does_not_inherit_operator_secrets(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.prepare_directories()
        self._create_fake_runtime(installer)
        installer.write_npm_config()
        self._fake_npm_install(installer)
        secret_environment = {
            "REVIEW_FAKE_SECRET": "must-not-leak",
            "OPENAI_API_KEY": "must-not-leak",
            "NPM_TOKEN": "must-not-leak",
            "npm_config_token": "must-not-leak",
            "HTTPS_PROXY": "https://proxy.example.invalid:8443",
            "NO_PROXY": "127.0.0.1,localhost",
            "SSH_AUTH_SOCK": "/tmp/private-agent.sock",
            "NODE_OPTIONS": "--require=/tmp/untrusted.js",
        }

        def fake_run(command, **kwargs):
            stdout = '{"name":"dr-claw","version":"1.1.4"}\n' if kwargs.get("capture_output") else ""
            return subprocess.CompletedProcess(command, 0, stdout, "")

        with mock.patch.dict(os.environ, secret_environment, clear=False), mock.patch.object(
            install_app.subprocess, "run", side_effect=fake_run
        ) as run:
            installer.run_npm()
        self.assertGreaterEqual(run.call_count, 5)
        expected_timeouts = [
            self.manifest["timeouts_seconds"]["npm_install"],
            self.manifest["timeouts_seconds"]["npm_build"],
            self.manifest["timeouts_seconds"]["npm_prepare_native"],
            self.manifest["timeouts_seconds"]["npm_prune"],
            self.manifest["timeouts_seconds"]["npm_verify"],
        ]
        self.assertEqual([call.kwargs["timeout"] for call in run.call_args_list], expected_timeouts)
        for call in run.call_args_list:
            child_env = call.kwargs["env"]
            for key in secret_environment:
                if key in {"HTTPS_PROXY", "NO_PROXY"}:
                    continue
                self.assertNotIn(key, child_env)
            self.assertEqual(child_env["HTTPS_PROXY"], secret_environment["HTTPS_PROXY"])
            self.assertEqual(child_env["NO_PROXY"], secret_environment["NO_PROXY"])
            self.assertEqual(child_env["npm_config_userconfig"], str(installer.paths.npm_userconfig))
            self.assertEqual(child_env["npm_config_globalconfig"], os.devnull)
            self.assertEqual(child_env["PYTHONNOUSERSITE"], "1")
            self.assertEqual(child_env["PYTHONDONTWRITEBYTECODE"], "1")
            self.assertNotIn("PYTHONPATH", child_env)
            self.assertNotIn("PYTHONHOME", child_env)

    def test_npm_timeout_is_a_closed_install_failure(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.prepare_directories()
        self._create_fake_runtime(installer)
        installer.write_npm_config()
        with mock.patch.object(
            install_app.subprocess,
            "run",
            side_effect=subprocess.TimeoutExpired([str(installer.paths.npm_binary), "ci"], 1),
        ):
            with self.assertRaisesRegex(install_app.AppBootstrapError, "npm ci"):
                installer.run_npm()
        self.assertFalse(installer.paths.receipt.exists())

    def test_network_contract_supports_safe_proxy_and_ca_without_leaking_secrets(self):
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        installer.prepare_directories()
        ca_bundle = self.home / "private-ca.pem"
        secret_content = "CA-CONTENT-MUST-NOT-APPEAR"
        ca_bundle.write_text(secret_content + "\n", encoding="utf-8")
        ca_bundle.chmod(0o600)
        source = {
            "HTTPS_PROXY": "https://proxy.example.invalid:8443",
            "NO_PROXY": "127.0.0.1,localhost",
            "DRCLAW_CA_BUNDLE": str(ca_bundle),
            "OPENAI_API_KEY": "not-forwarded",
        }
        with mock.patch.dict(os.environ, source, clear=False):
            environment = install_app.build_npm_environment(installer.paths, self.home)
        self.assertEqual(environment["HTTPS_PROXY"], source["HTTPS_PROXY"])
        self.assertEqual(environment["NO_PROXY"], source["NO_PROXY"])
        for key in (
            "SSL_CERT_FILE",
            "CURL_CA_BUNDLE",
            "PIP_CERT",
            "NODE_EXTRA_CA_CERTS",
            "npm_config_cafile",
        ):
            self.assertEqual(environment[key], str(ca_bundle))
        self.assertNotIn("OPENAI_API_KEY", environment)
        self.assertNotIn(secret_content, json.dumps(environment))

    def test_credential_proxy_or_unapproved_ca_fails_before_app_target_writes(self):
        secret = "APP-NETWORK-CREDENTIAL-MUST-NOT-LEAK"
        for environment, expected in (
            ({"HTTPS_PROXY": f"https://user:{secret}@proxy.invalid"}, "Proxy configuration"),
            ({"SSL_CERT_FILE": str(self.home / secret)}, "DRCLAW_CA_BUNDLE"),
        ):
            with self.subTest(expected=expected), mock.patch.dict(os.environ, environment, clear=False):
                installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
                before = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                with self.assertRaises(install_app.AppBootstrapError) as caught:
                    installer.run()
                self.assertIn(expected, str(caught.exception))
                self.assertNotIn(secret, str(caught.exception))
                after = sorted(path.relative_to(self.home) for path in self.home.rglob("*"))
                self.assertEqual(after, before)

    def test_custom_codex_home_is_bound_into_env_receipt_and_doctor(self):
        custom_codex_home = self.home / "state" / "codex"
        installer = self._complete_install(codex_home=str(custom_codex_home))
        values = install_app.parse_managed_env(installer.paths.env_file)
        receipt = json.loads(installer.paths.receipt.read_text(encoding="utf-8"))
        self.assertEqual(values["CODEX_HOME"], str(custom_codex_home))
        self.assertEqual(receipt["codex_home"], str(custom_codex_home))

        doctor = install_app.AppDoctor(
            argparse.Namespace(
                home=str(self.home), codex_home=str(custom_codex_home), json=False
            ),
            self.repo,
            self.manifest,
        )
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(doctor.run(), 0)

        with self.assertRaises(install_app.AppBootstrapError):
            install_app.AppInstaller(
                self.args(codex_home=str(self.root / "outside-codex")), self.repo, self.manifest
            )
        external = self.root / "external-codex"
        external.mkdir()
        linked = self.home / "linked-codex"
        linked.symlink_to(external, target_is_directory=True)
        with self.assertRaises(install_app.AppBootstrapError):
            install_app.AppInstaller(self.args(codex_home=str(linked)), self.repo, self.manifest)

    def test_doctor_detects_source_dist_and_git_drift(self):
        if not shutil.which("git"):
            self.skipTest("git is unavailable")
        subprocess.run(["git", "init", "-q", str(self.repo)], check=True)
        subprocess.run(["git", "-C", str(self.repo), "config", "user.name", "Bootstrap Test"], check=True)
        subprocess.run(
            ["git", "-C", str(self.repo), "config", "user.email", "bootstrap-test@example.invalid"],
            check=True,
        )
        subprocess.run(["git", "-C", str(self.repo), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.repo), "commit", "-qm", "fixture"], check=True)
        installer = self._complete_install()

        (self.repo / "server" / "index.js").write_text("// changed source\n", encoding="utf-8")
        (self.repo / "dist" / "index.html").write_text("changed build\n", encoding="utf-8")
        doctor = install_app.AppDoctor(
            argparse.Namespace(home=str(self.home), json=False), self.repo, self.manifest
        )
        with contextlib.redirect_stdout(io.StringIO()):
            status = doctor.run()
        self.assertEqual(status, 1)
        failures = {item["name"] for item in doctor.checks if item["level"] == "FAIL"}
        self.assertIn("application-source", failures)
        self.assertIn("frontend-build", failures)
        self.assertIn("git-source", failures)

    def test_started_service_contract_checks_is_active_and_loopback_health(self):
        doctor = install_app.AppDoctor(
            argparse.Namespace(home=str(self.home), codex_home=None, json=False), self.repo, self.manifest
        )
        doctor.paths.unit_file.parent.mkdir(parents=True, exist_ok=True)
        doctor.paths.unit_file.write_text(
            install_app.render_unit_content(doctor.paths, self.repo, self.manifest), encoding="utf-8"
        )
        os.chmod(doctor.paths.unit_file, 0o600)

        def systemctl_run(command, **kwargs):
            if "is-enabled" in command:
                return subprocess.CompletedProcess(command, 0, "enabled\n", "")
            if "is-active" in command:
                return subprocess.CompletedProcess(command, 0, "active\n", "")
            raise AssertionError(command)

        state = {
            "service": "enabled-and-started",
            "unit_sha256": install_app.sha256_file(doctor.paths.unit_file),
        }
        with mock.patch.dict(
            os.environ, {"DRCLAW_DOCTOR_SECRET": "must-not-leak"}, clear=False
        ), mock.patch.object(
            install_app, "resolve_trusted_systemctl", return_value="/usr/bin/systemctl"
        ), mock.patch.object(
            install_app, "validate_trusted_systemctl_path", return_value="/usr/bin/systemctl"
        ), mock.patch.object(
            install_app.subprocess, "run", side_effect=systemctl_run
        ) as run, mock.patch.object(install_app, "probe_loopback_health") as health:
            doctor.check_service(state, {"HOST": "127.0.0.1", "PORT": "3001"})
        self.assertTrue(any(item["name"] == "service-health" and item["level"] == "PASS" for item in doctor.checks))
        self.assertEqual(run.call_count, 2)
        for call in run.call_args_list:
            self.assertEqual(
                call.kwargs["timeout"], self.manifest["timeouts_seconds"]["systemctl"]
            )
            self.assertNotIn("DRCLAW_DOCTOR_SECRET", call.kwargs["env"])
            self.assertEqual(call.kwargs["env"]["PATH"], install_app.TRUSTED_SYSTEM_PATH)
        health.assert_called_once_with("127.0.0.1", 3001)

    def test_service_unit_must_be_exact_and_enabled(self):
        doctor = install_app.AppDoctor(
            argparse.Namespace(home=str(self.home), codex_home=None, json=False), self.repo, self.manifest
        )
        doctor.paths.unit_file.parent.mkdir(parents=True, exist_ok=True)
        canonical = install_app.render_unit_content(doctor.paths, self.repo, self.manifest)
        doctor.paths.unit_file.write_text(canonical + "# tampered\n", encoding="utf-8")
        os.chmod(doctor.paths.unit_file, 0o600)
        state = {
            "service": "enabled-not-started",
            "unit_sha256": install_app.sha256_file(doctor.paths.unit_file),
        }
        with mock.patch.object(
            install_app.subprocess, "run", side_effect=AssertionError("must reject before systemctl")
        ):
            doctor.check_service(state, {})
        self.assertTrue(
            any(item["name"] == "service-unit" and item["level"] == "FAIL" for item in doctor.checks)
        )

        doctor.checks.clear()
        doctor.paths.unit_file.write_text(canonical, encoding="utf-8")
        state["unit_sha256"] = install_app.sha256_file(doctor.paths.unit_file)
        disabled = subprocess.CompletedProcess([], 1, "disabled\n", "")
        with mock.patch.object(install_app.shutil, "which", return_value="/usr/bin/systemctl"), mock.patch.object(
            install_app, "validate_trusted_systemctl_path", return_value="/usr/bin/systemctl"
        ), mock.patch.object(
            install_app.subprocess, "run", return_value=disabled
        ):
            doctor.check_service(state, {})
        self.assertTrue(any(item["name"] == "service" and item["level"] == "FAIL" for item in doctor.checks))

    def test_health_probe_retries_directly_and_requires_status_ok(self):
        first = mock.MagicMock()
        first.request.side_effect = OSError("not ready")
        healthy_response = mock.MagicMock(status=200)
        healthy_response.read.return_value = b'{"status":"ok"}'
        second = mock.MagicMock()
        second.getresponse.return_value = healthy_response
        with mock.patch.dict(os.environ, {"HTTP_PROXY": "http://proxy.invalid"}), mock.patch.object(
            install_app.http.client, "HTTPConnection", side_effect=[first, second]
        ) as connection:
            install_app.probe_loopback_health("127.0.0.1", 3001, attempts=2, delay=0)
        self.assertEqual(connection.call_args_list[0].args, ("127.0.0.1", 3001))
        self.assertEqual(connection.call_args_list[0].kwargs, {"timeout": 2})

        unhealthy_response = mock.MagicMock(status=200)
        unhealthy_response.read.return_value = b'{"status":"degraded"}'
        unhealthy = mock.MagicMock()
        unhealthy.getresponse.return_value = unhealthy_response
        with mock.patch.object(install_app.http.client, "HTTPConnection", return_value=unhealthy):
            with self.assertRaises(install_app.AppBootstrapError):
                install_app.probe_loopback_health("127.0.0.1", 3001, attempts=1, delay=0)

    def test_doctor_runs_npm_with_managed_node_first_on_path(self):
        installer = self._complete_install()
        state = json.loads(installer.paths.receipt.read_text(encoding="utf-8"))
        doctor = install_app.AppDoctor(
            argparse.Namespace(home=str(self.home), json=False), self.repo, self.manifest
        )

        def fake_run(command, **kwargs):
            if command[1:] == ["--version"]:
                return subprocess.CompletedProcess(command, 0, "10.9.9\n", "")
            return subprocess.CompletedProcess(command, 0, '{"name":"dr-claw"}\n', "")

        with mock.patch.object(install_app, "verify_node_binary", return_value="v22.23.2"), mock.patch.object(
            install_app, "git_receipt", return_value=state["git"]
        ), mock.patch.object(
            install_app, "application_source_digest", return_value=state["application_source_sha256"]
        ), mock.patch.object(install_app.subprocess, "run", side_effect=fake_run) as run:
            doctor.check_runtime(state)
        npm_version_call = next(call for call in run.call_args_list if call.args[0][1:] == ["--version"])
        path_entries = npm_version_call.kwargs["env"]["PATH"].split(os.pathsep)
        self.assertEqual(path_entries[0], str(installer.paths.node_runtime / "bin"))

    def test_verified_offline_archive_and_traversal_rejection(self):
        archive = self.root / "node.tar.xz"
        payload = b"#!/bin/sh\nprintf 'v22.23.2\\n'\n"
        with tarfile.open(archive, "w:xz") as output:
            for name in ("node", "npm"):
                info = tarfile.TarInfo(f"node-v22.23.2-linux-x64/bin/{name}")
                info.size = len(payload)
                info.mode = 0o755
                output.addfile(info, io.BytesIO(payload))
        checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
        copied = self.root / "copied.tar.xz"
        install_app.download_verified_node_archive(
            "https://nodejs.org/unused", checksum, copied, local_archive=archive
        )
        runtime_parent = self.root / "runtimes"
        runtime_parent.mkdir()
        final = runtime_parent / "node-v22.23.2-linux-x64"
        install_app.extract_verified_node_archive(
            copied,
            runtime_parent,
            final,
            "node-v22.23.2-linux-x64",
            "22.23.2",
            self.manifest["runtime_receipt"]["filename"],
            self._archive_receipt_contract(final),
        )
        self.assertTrue((final / "bin" / "node").is_file())
        self.assertTrue((final / self.manifest["runtime_receipt"]["filename"]).is_file())

        unsafe = self.root / "unsafe.tar.xz"
        with tarfile.open(unsafe, "w:xz") as output:
            info = tarfile.TarInfo("node-v22.23.2-linux-x64/bin/node")
            info.size = len(payload)
            output.addfile(info, io.BytesIO(payload))
            link = tarfile.TarInfo("node-v22.23.2-linux-x64/bin/escape")
            link.type = tarfile.SYMTYPE
            link.linkname = "../../../../outside"
            output.addfile(link)
        another = runtime_parent / "another"
        with self.assertRaises(install_app.AppBootstrapError):
            install_app.extract_verified_node_archive(
                unsafe,
                runtime_parent,
                another,
                "node-v22.23.2-linux-x64",
                "22.23.2",
                self.manifest["runtime_receipt"]["filename"],
                self._archive_receipt_contract(another),
            )
        self.assertFalse(another.exists())

    def test_incompatible_node_archive_is_cleaned_before_publish(self):
        archive = self.root / "incompatible-node.tar.xz"
        node_payload = b"#!/bin/sh\necho 'GLIBC_2.28 not found' >&2\nexit 127\n"
        npm_payload = b"#!/bin/sh\nexit 0\n"
        with tarfile.open(archive, "w:xz") as output:
            for name, payload in (("node", node_payload), ("npm", npm_payload)):
                info = tarfile.TarInfo(f"node-v22.23.2-linux-x64/bin/{name}")
                info.size = len(payload)
                info.mode = 0o755
                output.addfile(info, io.BytesIO(payload))

        runtime_parent = self.root / "incompatible-runtimes"
        runtime_parent.mkdir()
        final = runtime_parent / "node-v22.23.2-linux-x64"
        with self.assertRaisesRegex(install_app.AppBootstrapError, "Cannot execute managed Node"):
            install_app.extract_verified_node_archive(
                archive,
                runtime_parent,
                final,
                "node-v22.23.2-linux-x64",
                "22.23.2",
                self.manifest["runtime_receipt"]["filename"],
                self._archive_receipt_contract(final),
            )

        self.assertFalse(final.exists())
        self.assertEqual(list(runtime_parent.glob(".node-extract-*")), [])

    def test_offline_archive_checksum_mismatch_is_deleted(self):
        source = self.root / "source.tar.xz"
        source.write_bytes(b"not a real archive")
        destination = self.root / "download.tar.xz"
        with self.assertRaises(install_app.AppBootstrapError):
            install_app.download_verified_node_archive(
                "https://nodejs.org/unused", "0" * 64, destination, local_archive=source
            )
        self.assertFalse(destination.exists())

    def test_node_download_uses_explicit_sanitized_network_opener(self):
        payload = b"verified-node-archive-fixture"
        checksum = hashlib.sha256(payload).hexdigest()
        response = io.BytesIO(payload)
        response.geturl = lambda: "https://nodejs.org/dist/v22.23.2/node.tar.xz"  # type: ignore[attr-defined]
        response.headers = {"Content-Length": str(len(payload))}  # type: ignore[attr-defined]
        opener = mock.MagicMock()
        opener.open.return_value = response
        destination = self.root / "network-node.tar.xz"
        with mock.patch.object(install_app, "sanitized_network_opener", return_value=opener) as build:
            install_app.download_verified_node_archive(
                "https://nodejs.org/dist/v22.23.2/node.tar.xz",
                checksum,
                destination,
            )
        build.assert_called_once()
        self.assertEqual(destination.read_bytes(), payload)


if __name__ == "__main__":
    unittest.main()
