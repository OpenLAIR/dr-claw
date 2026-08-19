from __future__ import annotations

import json
import os
import stat
import subprocess
import sys
import tempfile
import unittest
import argparse
import importlib.util
from pathlib import Path
from typing import List


REPO_ROOT = Path(__file__).resolve().parents[3]
BOOTSTRAP = REPO_ROOT / "bootstrap" / "codex" / "bootstrap.py"
ROUTER_SOURCE = REPO_ROOT / "bootstrap" / "codex" / "skills" / "drclaw-skill-library"
DELTA_SOURCE = REPO_ROOT / "bootstrap" / "codex" / "vendor" / "ncsa-delta"
BEGIN_MARKER = "<!-- BEGIN DRCLAW-CODEX-BOOTSTRAP MANAGED BLOCK -->"
END_MARKER = "<!-- END DRCLAW-CODEX-BOOTSTRAP MANAGED BLOCK -->"


class BootstrapIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="drclaw-bootstrap-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / "home"
        self.codex_home = self.root / "codex-home"
        self.home.mkdir()
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

        spec = importlib.util.spec_from_file_location("drclaw_bootstrap_test_module", BOOTSTRAP)
        self.assertIsNotNone(spec)
        self.assertIsNotNone(spec.loader if spec else None)
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
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
