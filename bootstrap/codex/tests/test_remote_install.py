from __future__ import annotations

import json
import os
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from typing import Any, List, Optional, Union


REPO_ROOT = Path(__file__).resolve().parents[3]
REMOTE_INSTALL = REPO_ROOT / "bootstrap" / "codex" / "remote-install.sh"


class RemoteInstallIntegrationTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="drclaw-remote-install-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / "isolated home"
        self.home.mkdir(mode=0o700)
        self.codex_home = self.home / ".codex"
        self.codex_home.mkdir(mode=0o700)
        self.auth_path = self.codex_home / "auth.json"
        self.auth_path.write_text("DO-NOT-COPY-OR-ALTER\n", encoding="utf-8")

        self.existing_project = self.root / "existing-project-never-touch"
        self.existing_project.mkdir()
        self.project_sentinel = self.existing_project / "sentinel.txt"
        self.project_sentinel.write_text("unchanged\n", encoding="utf-8")
        self.project_mtime = self.project_sentinel.stat().st_mtime_ns

        self.tag = "drclaw-codex-test-v1"
        self.bare_repository, self.commit = self.build_release(
            name="valid",
            tag=self.tag,
            audited_versions=["0.147.0", "0.150.2", "0.149.9"],
        )

    def git(self, *arguments: str, cwd: Path) -> str:
        result = subprocess.run(
            ["git", *arguments],
            cwd=str(cwd),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"git {' '.join(arguments)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        return result.stdout.strip()

    def build_release(
        self,
        *,
        name: str,
        tag: str,
        audited_versions: Any,
        manifest_release_ref: Optional[str] = None,
        allowed_gitlink: bool = False,
    ) -> tuple[Path, str]:
        worktree = self.root / f"{name}-source"
        worktree.mkdir()
        self.git("init", cwd=worktree)
        self.git("config", "user.name", "Dr Claw Test", cwd=worktree)
        self.git("config", "user.email", "drclaw-test@example.invalid", cwd=worktree)

        (worktree / "AGENTS.md").write_text("# Test release\n", encoding="utf-8")
        skill = worktree / "skills" / "fixture" / "SKILL.md"
        skill.parent.mkdir(parents=True)
        skill.write_text(
            "---\nname: fixture\ndescription: Test-only fixture skill.\n---\n",
            encoding="utf-8",
        )

        bootstrap_dir = worktree / "bootstrap" / "codex"
        bootstrap_dir.mkdir(parents=True)
        manifest = {
            "schema_version": 1,
            "bundle_version": "test",
            "baseline": {
                "repository": str(worktree),
                "bundle_release_ref": manifest_release_ref or tag,
            },
            "requirements": {
                "python": ">=3.9",
                "codex_cli_minimum": "0.147.0",
                "codex_cli_audited_versions": audited_versions,
            },
            "required_repository_paths": [
                "AGENTS.md",
                "skills/fixture/SKILL.md",
                "bootstrap/codex/bootstrap.sh",
                "bootstrap/codex/install_app.py",
                "bootstrap/codex/app-manifest.json",
            ],
        }
        if allowed_gitlink:
            gitlink_path = "community-tools/optional"
            gitlink_object = "1111111111111111111111111111111111111111"
            manifest["source_policy"] = {
                "allowed_uninitialized_gitlinks": {gitlink_path: gitlink_object}
            }
        (bootstrap_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )
        bootstrap = bootstrap_dir / "bootstrap.sh"
        bootstrap.write_text(
            "#!/usr/bin/env bash\n"
            "set -Eeuo pipefail\n"
            "for argument in \"$@\"; do\n"
            "  if [[ \"$argument\" == \"--dry-run\" ]]; then\n"
            "    printf 'FIXTURE_BOOTSTRAP_DRY_RUN PWD=%s\\n' \"$PWD\"\n"
            "    for item in \"$@\"; do printf 'FIXTURE_BOOTSTRAP_ARG=%s\\n' \"$item\"; done\n"
            "    exit 0\n"
            "  fi\n"
            "done\n"
            "count_file=\"$HOME/bootstrap-invocation-count.txt\"\n"
            "count=0\n"
            "if [[ -f \"$count_file\" ]]; then read -r count < \"$count_file\"; fi\n"
            "printf '%s\\n' \"$((count + 1))\" > \"$count_file\"\n"
            "{\n"
            "  printf 'CODEX_RELEASE=%s\\n' \"${CODEX_RELEASE-}\"\n"
            "  printf 'HOME=%s\\n' \"$HOME\"\n"
            "  printf 'CODEX_HOME=%s\\n' \"${CODEX_HOME-}\"\n"
            "  printf 'PWD=%s\\n' \"$PWD\"\n"
            "  for argument in \"$@\"; do printf 'ARG=%s\\n' \"$argument\"; done\n"
            "} > \"$HOME/bootstrap-last-invocation.txt\"\n",
            encoding="utf-8",
        )
        bootstrap.chmod(0o755)

        app_installer = bootstrap_dir / "install_app.py"
        app_installer.write_text(
            "#!/usr/bin/env python3\n"
            "import os, sys\n"
            "from pathlib import Path\n"
            "if '--dry-run' in sys.argv[1:]:\n"
            "    print('FIXTURE_APP_DRY_RUN PWD=' + os.getcwd())\n"
            "    for item in sys.argv[1:]:\n"
            "        print('FIXTURE_APP_ARG=' + item)\n"
            "    raise SystemExit(0)\n"
            "home = Path(os.environ['HOME'])\n"
            "count_path = home / 'app-invocation-count.txt'\n"
            "count = int(count_path.read_text()) if count_path.exists() else 0\n"
            "count_path.write_text(str(count + 1) + '\\n')\n"
            "(home / 'app-last-invocation.txt').write_text("
            "'PWD=' + os.getcwd() + '\\n' + "
            "'\\n'.join('ARG=' + item for item in sys.argv[1:]) + '\\n')\n",
            encoding="utf-8",
        )
        app_installer.chmod(0o755)
        (bootstrap_dir / "app-manifest.json").write_text(
            json.dumps({"schema_version": 1, "bundle_version": "test"}) + "\n",
            encoding="utf-8",
        )

        self.git("add", ".", cwd=worktree)
        if allowed_gitlink:
            self.git(
                "update-index",
                "--add",
                "--cacheinfo",
                f"160000,{gitlink_object},{gitlink_path}",
                cwd=worktree,
            )
        self.git("commit", "-m", "test release", cwd=worktree)
        # Annotated tags exercise the peeled-tag resolution path.
        self.git("tag", "-a", tag, "-m", "test release tag", cwd=worktree)
        commit = self.git("rev-parse", "HEAD", cwd=worktree)
        bare_repository = self.root / f"{name} origin bare.git"
        result = subprocess.run(
            ["git", "clone", "--quiet", "--bare", str(worktree), str(bare_repository)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        return bare_repository, commit

    def run_installer(
        self,
        *arguments: str,
        ref: Optional[str] = None,
        expected_commit: Optional[str] = None,
        repository: Optional[Union[Path, str]] = None,
        include_nonlogin_interlock: bool = True,
    ) -> subprocess.CompletedProcess[str]:
        selected_ref = self.tag if ref is None else ref
        selected_expected = self.commit if expected_commit is None else expected_commit
        selected_repository = self.bare_repository if repository is None else repository
        command: List[str] = [
            "bash",
            str(REMOTE_INSTALL),
            "--ref",
            selected_ref,
        ]
        if selected_expected:
            command.extend(["--expected-commit", selected_expected])
        command.extend(
            [
                "--repo-url",
                str(selected_repository),
                "--home",
                str(self.home),
            ]
        )
        if include_nonlogin_interlock:
            command.append("--allow-nonlogin-home")
        command.extend(arguments)
        environment = os.environ.copy()
        environment.update(
            {
                "HOME": str(self.home),
                "CODEX_HOME": str(self.codex_home),
                "PYTHONDONTWRITEBYTECODE": "1",
            }
        )
        return subprocess.run(
            command,
            cwd=str(self.existing_project),
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=90,
        )

    def assert_success(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    def release_checkout(self, commit: Optional[str] = None) -> Path:
        return self.home / ".local" / "share" / "drclaw" / "releases" / (commit or self.commit)

    def assert_unrelated_state_unchanged(self) -> None:
        self.assertEqual(self.auth_path.read_text(encoding="utf-8"), "DO-NOT-COPY-OR-ALTER\n")
        self.assertEqual(self.project_sentinel.read_text(encoding="utf-8"), "unchanged\n")
        self.assertEqual(self.project_sentinel.stat().st_mtime_ns, self.project_mtime)

    def target_home_snapshot(self) -> dict[str, tuple[bool, int, Optional[bytes]]]:
        snapshot: dict[str, tuple[bool, int, Optional[bytes]]] = {}
        for path in sorted(self.home.rglob("*")):
            relative = str(path.relative_to(self.home))
            mode = stat.S_IMODE(path.lstat().st_mode)
            snapshot[relative] = (
                path.is_dir(),
                mode,
                path.read_bytes() if path.is_file() else None,
            )
        return snapshot

    def test_tag_install_is_pinned_idempotent_and_project_isolated(self) -> None:
        first = self.run_installer("--no-doctor")
        self.assert_success(first)

        checkout = self.release_checkout()
        self.assertTrue((checkout / ".git").is_dir())
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=checkout), self.commit)
        self.assertEqual(self.git("status", "--porcelain", cwd=checkout), "")
        self.assertEqual(stat.S_IMODE(checkout.parent.stat().st_mode), 0o700)
        self.assertEqual(
            (self.home / "bootstrap-invocation-count.txt").read_text(encoding="utf-8"),
            "1\n",
        )
        invocation = (self.home / "bootstrap-last-invocation.txt").read_text(encoding="utf-8")
        self.assertIn("CODEX_RELEASE=0.150.2\n", invocation)
        self.assertIn(f"HOME={self.home}\n", invocation)
        self.assertIn(f"CODEX_HOME={self.codex_home}\n", invocation)
        self.assertIn(f"PWD={checkout}\n", invocation)
        self.assertIn("ARG=install\n", invocation)
        self.assertIn("ARG=--install-codex\n", invocation)
        self.assertIn("ARG=--config-profile\nARG=safe\n", invocation)
        self.assert_unrelated_state_unchanged()

        second = self.run_installer("--no-doctor")
        self.assert_success(second)
        self.assertIn("reusing verified release checkout", second.stdout)
        self.assertEqual(
            (self.home / "bootstrap-invocation-count.txt").read_text(encoding="utf-8"),
            "2\n",
        )
        self.assertEqual(self.git("status", "--porcelain", cwd=checkout), "")
        self.assert_unrelated_state_unchanged()

    def test_manifest_pinned_optional_gitlink_remains_uninitialized(self) -> None:
        tag = "drclaw-codex-gitlink-v1"
        repository, commit = self.build_release(
            name="allowed-gitlink",
            tag=tag,
            audited_versions=["0.147.0"],
            allowed_gitlink=True,
        )
        result = self.run_installer(
            "--no-doctor",
            ref=tag,
            expected_commit=commit,
            repository=repository,
        )
        self.assert_success(result)
        checkout = self.release_checkout(commit)
        gitlink = checkout / "community-tools" / "optional"
        self.assertTrue(gitlink.is_dir())
        self.assertEqual(list(gitlink.iterdir()), [])

    def test_full_commit_ref_materializes_manifest_tag_for_default_doctor(self) -> None:
        result = self.run_installer(
            ref=self.commit,
            expected_commit="",
        )
        self.assert_success(result)
        checkout = self.release_checkout()
        self.assertTrue(checkout.is_dir())
        self.assertEqual(
            self.git("rev-parse", f"{self.tag}^{{commit}}", cwd=checkout),
            self.commit,
        )
        invocation = (self.home / "bootstrap-last-invocation.txt").read_text(encoding="utf-8")
        self.assertNotIn("ARG=--no-doctor\n", invocation)
        self.assert_unrelated_state_unchanged()

    def test_full_commit_ref_rejects_manifest_tag_pointing_elsewhere(self) -> None:
        manifest_tag = "drclaw-codex-test-mismatched-manifest"
        repository, approved_commit = self.build_release(
            name="mismatched-manifest-commit",
            tag="drclaw-codex-test-approved-commit",
            audited_versions=["0.147.0"],
            manifest_release_ref=manifest_tag,
        )
        source = self.root / "mismatched-manifest-commit-source"
        (source / "different-commit.txt").write_text("different\n", encoding="utf-8")
        self.git("add", "different-commit.txt", cwd=source)
        self.git("commit", "-m", "different commit", cwd=source)
        self.git("tag", "-a", manifest_tag, "-m", "mismatched manifest tag", cwd=source)
        self.git("push", str(repository), f"refs/tags/{manifest_tag}", cwd=source)

        result = self.run_installer(
            ref=approved_commit,
            expected_commit="",
            repository=repository,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("resolves to", result.stderr)
        self.assertIn("expected", result.stderr)
        self.assertFalse(self.release_checkout(approved_commit).exists())
        self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())
        self.assert_unrelated_state_unchanged()

    def test_dry_run_resolves_tag_and_invokes_bundled_preview_without_target_writes(self) -> None:
        before = self.target_home_snapshot()
        result = self.run_installer("--dry-run")
        self.assert_success(result)
        self.assertIn("DRY-RUN immutable source", result.stdout)
        self.assertIn("DRY-RUN temporary source is clean and verified", result.stdout)
        self.assertIn("FIXTURE_BOOTSTRAP_DRY_RUN PWD=/tmp/drclaw-remote-dry-run.", result.stdout)
        self.assertFalse((self.home / ".local").exists())
        self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())
        self.assertEqual(self.target_home_snapshot(), before)
        self.assert_unrelated_state_unchanged()

    def test_full_sha_dry_run_verifies_source_and_previews_core_and_app_without_target_writes(
        self,
    ) -> None:
        before = self.target_home_snapshot()
        result = self.run_installer(
            "--dry-run",
            "--full",
            "--app-service",
            "none",
            ref=self.commit,
            expected_commit="",
        )
        self.assert_success(result)
        self.assertIn("DRY-RUN temporary source is clean and verified", result.stdout)
        self.assertIn("FIXTURE_BOOTSTRAP_DRY_RUN PWD=/tmp/drclaw-remote-dry-run.", result.stdout)
        self.assertIn("FIXTURE_BOOTSTRAP_ARG=--with-drclaw-cli", result.stdout)
        self.assertIn("FIXTURE_BOOTSTRAP_ARG=--dry-run", result.stdout)
        self.assertIn("FIXTURE_APP_DRY_RUN PWD=/tmp/drclaw-remote-dry-run.", result.stdout)
        self.assertIn("FIXTURE_APP_ARG=--dry-run", result.stdout)
        preview_paths = [
            Path(line.split("PWD=", 1)[1])
            for line in result.stdout.splitlines()
            if line.startswith(("FIXTURE_BOOTSTRAP_DRY_RUN PWD=", "FIXTURE_APP_DRY_RUN PWD="))
        ]
        self.assertEqual(len(preview_paths), 2)
        self.assertEqual(preview_paths[0], preview_paths[1])
        self.assertTrue(str(preview_paths[0]).startswith("/tmp/drclaw-remote-dry-run."))
        self.assertFalse(preview_paths[0].exists())
        self.assertFalse((self.home / ".local").exists())
        self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())
        self.assertFalse((self.home / "app-invocation-count.txt").exists())
        self.assertEqual(self.target_home_snapshot(), before)
        self.assert_unrelated_state_unchanged()

    def test_nonexistent_full_sha_dry_run_is_rejected_and_temporary_checkout_is_removed(
        self,
    ) -> None:
        before = self.target_home_snapshot()
        temporary_before = set(Path("/tmp").glob("drclaw-remote-dry-run.*"))
        result = self.run_installer(
            "--dry-run",
            ref="f" * 40,
            expected_commit="",
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot fetch approved commit", result.stderr)
        self.assertEqual(set(Path("/tmp").glob("drclaw-remote-dry-run.*")), temporary_before)
        self.assertFalse((self.home / ".local").exists())
        self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())
        self.assertEqual(self.target_home_snapshot(), before)
        self.assert_unrelated_state_unchanged()

    def test_dry_run_does_not_materialize_a_missing_local_manifest_tag(self) -> None:
        first = self.run_installer("--no-doctor")
        self.assert_success(first)
        checkout = self.release_checkout()
        self.git("tag", "-d", self.tag, cwd=checkout)

        dry_run = self.run_installer("--dry-run")
        self.assert_success(dry_run)
        missing = subprocess.run(
            ["git", "rev-parse", "--verify", f"refs/tags/{self.tag}"],
            cwd=str(checkout),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertNotEqual(missing.returncode, 0)
        self.assertEqual(
            (self.home / "bootstrap-invocation-count.txt").read_text(encoding="utf-8"),
            "1\n",
        )
        self.assert_unrelated_state_unchanged()

    def test_tag_requires_expected_commit_and_rejects_movement(self) -> None:
        missing = self.run_installer(expected_commit="")
        self.assertEqual(missing.returncode, 2)
        self.assertIn("tag requires --expected-commit", missing.stderr)

        wrong = self.run_installer(expected_commit="0" * 40)
        self.assertEqual(wrong.returncode, 2)
        self.assertIn("release tag moved", wrong.stderr)
        self.assertFalse((self.home / ".local").exists())
        self.assert_unrelated_state_unchanged()

    def test_branch_name_is_not_accepted_as_a_release_tag(self) -> None:
        result = self.run_installer(ref="master")
        self.assertEqual(result.returncode, 2)
        self.assertIn("exact release tag is unavailable", result.stderr)
        self.assertFalse((self.home / ".local").exists())
        self.assert_unrelated_state_unchanged()

    def test_nonlogin_home_requires_explicit_disposable_test_interlock(self) -> None:
        result = self.run_installer(include_nonlogin_interlock=False)
        self.assertEqual(result.returncode, 2)
        self.assertIn("--allow-nonlogin-home", result.stderr)
        self.assertFalse((self.home / ".local").exists())
        self.assert_unrelated_state_unchanged()

    def test_dirty_versioned_checkout_is_refused_without_bootstrap_rerun(self) -> None:
        first = self.run_installer("--no-doctor")
        self.assert_success(first)
        checkout = self.release_checkout()
        (checkout / "LOCAL-CHANGE.txt").write_text("dirty\n", encoding="utf-8")

        refused = self.run_installer("--no-doctor")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("release checkout is dirty", refused.stderr)
        self.assertEqual(
            (self.home / "bootstrap-invocation-count.txt").read_text(encoding="utf-8"),
            "1\n",
        )
        self.assert_unrelated_state_unchanged()

    def test_manifest_release_ref_mismatch_is_refused(self) -> None:
        tag = "drclaw-codex-test-wrong-manifest"
        repository, commit = self.build_release(
            name="wrong-manifest",
            tag=tag,
            audited_versions=["0.147.0"],
            manifest_release_ref="different-release-tag",
        )
        result = self.run_installer(
            ref=tag,
            expected_commit=commit,
            repository=repository,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("release source verification failed", result.stderr)
        self.assertFalse(self.release_checkout(commit).exists())
        self.assert_unrelated_state_unchanged()

    def test_malformed_audited_codex_versions_fail_before_bootstrap(self) -> None:
        tag = "drclaw-codex-test-malformed-runtime"
        repository, commit = self.build_release(
            name="malformed-runtime",
            tag=tag,
            audited_versions=["0.147.0", "latest"],
        )
        result = self.run_installer(
            "--no-doctor",
            ref=tag,
            expected_commit=commit,
            repository=repository,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot resolve the manifest-audited Codex release", result.stderr)
        self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())
        self.assert_unrelated_state_unchanged()

    def test_latest_runtime_override_does_not_export_inherited_pin(self) -> None:
        result = self.run_installer("--no-doctor", "--codex-release", "latest")
        self.assert_success(result)
        invocation = (self.home / "bootstrap-last-invocation.txt").read_text(encoding="utf-8")
        self.assertIn("CODEX_RELEASE=\n", invocation)
        self.assertIn("current official release", result.stdout)
        self.assert_unrelated_state_unchanged()

    def test_full_install_invokes_cli_and_app_without_touching_project_or_auth(self) -> None:
        result = self.run_installer("--full", "--app-service", "none", "--no-doctor")
        self.assert_success(result)

        bootstrap_invocation = (self.home / "bootstrap-last-invocation.txt").read_text(
            encoding="utf-8"
        )
        self.assertIn("ARG=--with-drclaw-cli\n", bootstrap_invocation)
        self.assertIn("ARG=--no-doctor\n", bootstrap_invocation)

        app_invocation = (self.home / "app-last-invocation.txt").read_text(encoding="utf-8")
        self.assertIn(f"PWD={self.release_checkout()}\n", app_invocation)
        self.assertIn(f"ARG={self.release_checkout()}\n", app_invocation)
        self.assertIn("ARG=install\n", app_invocation)
        self.assertIn(f"ARG={self.home}\n", app_invocation)
        self.assertIn(f"ARG={self.codex_home}\n", app_invocation)
        self.assertIn("ARG=none\n", app_invocation)
        self.assertIn("ARG=--no-doctor\n", app_invocation)
        self.assertEqual((self.home / "app-invocation-count.txt").read_text(), "1\n")
        self.assert_unrelated_state_unchanged()

    def test_isolated_full_install_can_never_start_real_user_service(self) -> None:
        result = self.run_installer("--full", "--start-app")
        self.assertEqual(result.returncode, 2)
        self.assertIn("isolated tests never touch real user-systemd", result.stderr)
        self.assertFalse((self.home / ".local").exists())
        self.assertFalse((self.home / "app-invocation-count.txt").exists())
        self.assert_unrelated_state_unchanged()

    def test_full_install_rejects_codex_home_outside_target_home_before_writes(self) -> None:
        outside = self.root / "outside-codex-home"
        result = self.run_installer("--full", "--codex-home", str(outside))
        self.assertEqual(result.returncode, 2)
        self.assertIn("requires CODEX_HOME", result.stderr)
        self.assertFalse((self.home / ".local").exists())
        self.assertFalse(outside.exists())
        self.assert_unrelated_state_unchanged()

    def test_repository_credentials_are_rejected_without_echoing_them(self) -> None:
        fake_secret = "FAKE-DO-NOT-LOG-1234567890"
        result = self.run_installer(
            "--dry-run",
            ref=self.commit,
            expected_commit="",
            repository=f"ssh://git:{fake_secret}@example.invalid/repository.git",
        )
        self.assertEqual(result.returncode, 2)
        combined = result.stdout + result.stderr
        self.assertNotIn(fake_secret, combined)
        self.assertIn("credential-safe policy", combined)
        self.assert_unrelated_state_unchanged()

    def test_local_repository_failures_do_not_echo_sensitive_paths(self) -> None:
        marker = "FAKE-SENSITIVE-PATH-DO-NOT-LOG"
        result = self.run_installer(
            "--dry-run",
            ref=self.commit,
            expected_commit="",
            repository=self.root / marker / "missing.git",
        )
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(marker, result.stdout + result.stderr)
        self.assert_unrelated_state_unchanged()

    def test_option_like_repository_value_is_rejected_by_policy(self) -> None:
        result = self.run_installer(
            "--dry-run",
            ref=self.commit,
            expected_commit="",
            repository="--upload-pack=/tmp/not-a-repository",
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("credential-safe policy", result.stderr)
        self.assert_unrelated_state_unchanged()


if __name__ == "__main__":
    unittest.main()
