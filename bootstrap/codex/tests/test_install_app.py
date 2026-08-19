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
        (self.repo / "server" / "index.js").write_text("// test server\n", encoding="utf-8")
        (self.repo / "scripts" / "native-runtime.mjs").write_text("// test native\n", encoding="utf-8")
        package = {"name": "dr-claw", "version": "1.1.4"}
        package_lock = {
            "name": "dr-claw",
            "version": "1.1.4",
            "lockfileVersion": 3,
            "packages": {"": {"name": "dr-claw", "version": "1.1.4"}},
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

    def _create_fake_runtime(self, installer):
        installer.paths.node_binary.parent.mkdir(parents=True, exist_ok=True)
        installer.paths.node_binary.write_text(
            "#!/bin/sh\nprintf '%s\\n' 'v22.23.2'\n", encoding="utf-8"
        )
        installer.paths.npm_binary.write_text(
            "#!/bin/sh\n"
            "if [ \"${1-}\" = '--version' ]; then printf '%s\\n' '10.9.9'; "
            "else printf '%s\\n' '{\"name\":\"dr-claw\",\"version\":\"1.1.4\"}'; fi\n",
            encoding="utf-8",
        )
        os.chmod(installer.paths.node_binary, 0o700)
        os.chmod(installer.paths.npm_binary, 0o700)

    def _fake_npm_install(self, installer):
        (self.repo / "dist").mkdir(exist_ok=True)
        (self.repo / "dist" / "index.html").write_text("ok\n", encoding="utf-8")
        (self.repo / "node_modules").mkdir(exist_ok=True)

    def _complete_install(self, **overrides):
        installer = install_app.AppInstaller(self.args(**overrides), self.repo, self.manifest)
        installer.ensure_node = lambda: self._create_fake_runtime(installer)
        installer.run_npm = lambda: self._fake_npm_install(installer)
        installer.run()
        return installer

    def test_manifest_pins_official_node_artifacts(self):
        node = self.manifest["node"]
        self.assertEqual(node["version"], "22.23.2")
        self.assertEqual(
            node["artifacts"]["linux-x64"]["sha256"],
            "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
        )
        self.assertEqual(
            node["artifacts"]["linux-arm64"]["sha256"],
            "fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8",
        )

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

        doctor_args = argparse.Namespace(home=str(self.home), codex_home=None, json=False)
        doctor = install_app.AppDoctor(doctor_args, self.repo, self.manifest)
        with contextlib.redirect_stdout(io.StringIO()):
            status = doctor.run()
        self.assertEqual(status, 0)
        self.assertFalse(any(item["level"] == "FAIL" for item in doctor.checks))
        self.assertNotIn(values["JWT_SECRET"], json.dumps(doctor.checks))
        self.assertIn("secret not displayed", json.dumps(doctor.checks))
        self.assertIn(install_app.MANAGED_ENV_MARKER, env_content)

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
        installer = install_app.AppInstaller(self.args(), self.repo, self.manifest)
        with self.assertRaises(install_app.AppBootstrapError):
            installer.prepare_directories()
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
            "HTTPS_PROXY": "http://secret:password@example.invalid",
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
        for call in run.call_args_list:
            child_env = call.kwargs["env"]
            for key in secret_environment:
                self.assertNotIn(key, child_env)
            self.assertEqual(child_env["npm_config_userconfig"], str(installer.paths.npm_userconfig))
            self.assertEqual(child_env["npm_config_globalconfig"], os.devnull)

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
        with mock.patch.object(install_app.shutil, "which", return_value="/usr/bin/systemctl"), mock.patch.object(
            install_app.subprocess, "run", side_effect=systemctl_run
        ) as run, mock.patch.object(install_app, "probe_loopback_health") as health:
            doctor.check_service(state, {"HOST": "127.0.0.1", "PORT": "3001"})
        self.assertTrue(any(item["name"] == "service-health" and item["level"] == "PASS" for item in doctor.checks))
        self.assertEqual(run.call_count, 2)
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
        payload = b"#!/bin/sh\n"
        with tarfile.open(archive, "w:xz") as output:
            info = tarfile.TarInfo("node-v22.23.2-linux-x64/bin/node")
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
            copied, runtime_parent, final, "node-v22.23.2-linux-x64"
        )
        self.assertTrue((final / "bin" / "node").is_file())

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
                unsafe, runtime_parent, another, "node-v22.23.2-linux-x64"
            )
        self.assertFalse(another.exists())

    def test_offline_archive_checksum_mismatch_is_deleted(self):
        source = self.root / "source.tar.xz"
        source.write_bytes(b"not a real archive")
        destination = self.root / "download.tar.xz"
        with self.assertRaises(install_app.AppBootstrapError):
            install_app.download_verified_node_archive(
                "https://nodejs.org/unused", "0" * 64, destination, local_archive=source
            )
        self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
