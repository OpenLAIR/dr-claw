from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from typing import Dict, List, Optional


REPO_ROOT = Path(__file__).resolve().parents[3]
BUILDER = REPO_ROOT / "bootstrap" / "codex" / "build_release_kit.py"


class ReleaseKitTests(unittest.TestCase):
    maxDiff = None

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="drclaw-release-kit-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.tag = "codex-bootstrap-test-v1"
        self.gitlink_path = "community-tools/optional"
        self.gitlink_object = "1111111111111111111111111111111111111111"

    def git(self, cwd: Path, *arguments: str, check: bool = True) -> subprocess.CompletedProcess[bytes]:
        result = subprocess.run(
            ["git", *arguments],
            cwd=str(cwd),
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
        )
        if check:
            self.assertEqual(
                result.returncode,
                0,
                msg=(
                    f"git {' '.join(arguments)} failed\n"
                    f"stdout={result.stdout!r}\nstderr={result.stderr!r}"
                ),
            )
        return result

    def make_repository(
        self,
        name: str,
        *,
        manifest_ref: Optional[str] = None,
        annotated_tag: bool = True,
        tracked_symlink: bool = False,
        historical_machine_state: bool = False,
        historical_secret: bool = False,
        tag_secret: bool = False,
        gitlink_object: Optional[str] = None,
        include_gitmodules: bool = True,
        gitmodules_path: Optional[str] = None,
        real_remote_installer: bool = False,
    ) -> Path:
        repo = self.root / name
        repo.mkdir()
        self.git(repo, "init", "--quiet")
        self.git(repo, "config", "user.name", "Dr Claw Release Test")
        self.git(repo, "config", "user.email", "release-test@example.invalid")

        if historical_machine_state:
            auth = repo / ".codex" / "auth.json"
            auth.parent.mkdir()
            auth.write_text('{"fixture": true}\n', encoding="utf-8")
            self.git(repo, "add", ".codex/auth.json")
            self.git(repo, "commit", "--quiet", "-m", "historical machine state")
            auth.unlink()
            auth.parent.rmdir()
            self.git(repo, "add", "-u")
            self.git(repo, "commit", "--quiet", "-m", "remove historical machine state")

        if historical_secret:
            secret = repo / "notes.txt"
            # Construct the marker in pieces so this test module never embeds a
            # scanner-triggering credential signature in the real release.
            secret.write_text(
                "gh" + "p_" + ("Ab3kP9xQ2m" * 4) + "\n",
                encoding="utf-8",
            )
            self.git(repo, "add", "notes.txt")
            self.git(repo, "commit", "--quiet", "-m", "historical secret")
            secret.unlink()
            self.git(repo, "add", "-u")
            self.git(repo, "commit", "--quiet", "-m", "remove historical secret")

        (repo / "AGENTS.md").write_text("# Fixture guidance\n", encoding="utf-8")
        (repo / ".env.example").write_text("EXAMPLE_ONLY=1\n", encoding="utf-8")
        bootstrap = repo / "bootstrap" / "codex"
        bootstrap.mkdir(parents=True)
        shutil.copyfile(BUILDER, bootstrap / "build_release_kit.py")
        (bootstrap / "build_release_kit.py").chmod(0o755)
        remote = bootstrap / "remote-install.sh"
        if real_remote_installer:
            shutil.copyfile(REPO_ROOT / "bootstrap" / "codex" / "remote-install.sh", remote)
            skill = repo / "skills" / "fixture" / "SKILL.md"
            skill.parent.mkdir(parents=True)
            skill.write_text(
                "---\nname: fixture\ndescription: Release-kit fixture.\n---\n",
                encoding="utf-8",
            )
            bootstrap_stub = bootstrap / "bootstrap.sh"
            bootstrap_stub.write_text(
                "#!/usr/bin/env bash\n"
                "set -Eeuo pipefail\n"
                "printf 'FIXTURE_BOOTSTRAP_DRY_RUN PWD=%s\\n' \"$PWD\"\n",
                encoding="utf-8",
            )
            bootstrap_stub.chmod(0o755)
        else:
            remote.write_text(
                "#!/usr/bin/env bash\n"
                "set -Eeuo pipefail\n"
                "for argument in \"$@\"; do printf 'REMOTE_ARG=%s\\n' \"$argument\"; done\n",
                encoding="utf-8",
            )
        remote.chmod(0o755)

        allowed_object = gitlink_object or self.gitlink_object
        manifest = {
            "schema_version": 1,
            "bundle_version": "test",
            "baseline": {
                "repository": "https://example.invalid/dr-claw.git",
                "bundle_release_ref": manifest_ref or self.tag,
            },
            "required_repository_paths": [
                "AGENTS.md",
                "bootstrap/codex/manifest.json",
                "bootstrap/codex/build_release_kit.py",
                "bootstrap/codex/remote-install.sh",
            ]
            + (
                ["skills/fixture/SKILL.md", "bootstrap/codex/bootstrap.sh"]
                if real_remote_installer
                else []
            ),
            "requirements": {
                "python": ">=3.9",
                "codex_cli_minimum": "0.147.0",
                "codex_cli_audited_versions": ["0.147.0"],
                "server_os": "Linux",
                "server_architectures": ["x86_64", "aarch64"],
                "git_minimum": "2.25.0",
                "app_glibc_minimum": "2.28",
                "minimum_free_bytes": {
                    "core": 1073741824,
                    "full": 8589934592,
                },
            },
            "source_policy": {
                "allowed_uninitialized_gitlinks": {
                    self.gitlink_path: allowed_object,
                }
            },
        }
        (bootstrap / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )
        if include_gitmodules:
            metadata_path = gitmodules_path or self.gitlink_path
            (repo / ".gitmodules").write_text(
                f'[submodule "{metadata_path}"]\n'
                f"\tpath = {metadata_path}\n"
                f"\turl = https://example.invalid/{metadata_path}.git\n",
                encoding="utf-8",
            )
        if tracked_symlink:
            (repo / "unsafe-link").symlink_to("AGENTS.md")

        self.git(repo, "add", ".")
        self.git(
            repo,
            "update-index",
            "--add",
            "--cacheinfo",
            f"160000,{self.gitlink_object},{self.gitlink_path}",
        )
        self.git(repo, "commit", "--quiet", "-m", "release fixture")
        # A checked-out gitlink is represented by an empty directory until a
        # submodule is initialized.  Leaving it absent is reported as a dirty
        # deletion by Git and correctly trips the builder's clean-tree gate.
        (repo / self.gitlink_path).mkdir(parents=True, exist_ok=True)
        if annotated_tag:
            tag_message = (
                "release fixture " + "gh" + "p_" + ("T7mQ4zK9pL" * 4)
                if tag_secret
                else "release fixture"
            )
            self.git(repo, "tag", "-a", self.tag, "-m", tag_message)
        else:
            self.git(repo, "tag", self.tag)
        return repo

    def run_builder(
        self,
        repo: Path,
        output: Path,
        *,
        expected_commit: Optional[str] = None,
        repo_argument: Optional[Path] = None,
    ) -> subprocess.CompletedProcess[str]:
        command: List[str] = [
            sys.executable,
            str(BUILDER),
            "--repo-root",
            str(repo_argument or repo),
            "--tag",
            self.tag,
            "--output",
            str(output),
        ]
        if expected_commit is not None:
            command.extend(["--expected-commit", expected_commit])
        return subprocess.run(
            command,
            cwd=str(self.root),
            check=False,
            capture_output=True,
            text=True,
            timeout=120,
            env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        )

    def assert_success(self, result: subprocess.CompletedProcess[str]) -> None:
        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )

    @staticmethod
    def digest(path: Path) -> str:
        return hashlib.sha256(path.read_bytes()).hexdigest()

    def test_builds_deterministic_self_contained_kit_and_offline_entrypoint(self) -> None:
        repo = self.make_repository("valid-source")
        commit = self.git(repo, "rev-parse", "HEAD").stdout.decode().strip()
        tag_object = self.git(repo, "rev-parse", self.tag).stdout.decode().strip()
        outside = self.root / "unrelated-existing-project"
        outside.mkdir()
        sentinel = outside / "auth.json"
        sentinel.write_text("DO-NOT-READ-OR-CHANGE\n", encoding="utf-8")
        sentinel_mtime = sentinel.stat().st_mtime_ns

        first = self.root / "kit-one"
        second = self.root / "kit-two"
        self.assert_success(self.run_builder(repo, first, expected_commit=commit))
        self.assert_success(self.run_builder(repo, second, expected_commit=commit))

        expected_names = {
            "SHA256SUMS",
            "install.sh",
            "remote-install.sh",
            f"drclaw-{self.tag}.bundle",
            f"drclaw-{self.tag}.bundle.sha256",
            f"drclaw-{self.tag}.tar.gz",
            f"drclaw-{self.tag}.tar.gz.sha256",
            f"drclaw-{self.tag}.provenance.json",
            f"drclaw-{self.tag}.provenance.json.sha256",
        }
        self.assertEqual({path.name for path in first.iterdir()}, expected_names)
        self.assertEqual({path.name for path in second.iterdir()}, expected_names)
        for name in expected_names:
            self.assertEqual((first / name).read_bytes(), (second / name).read_bytes(), name)
            self.assertFalse((first / name).is_symlink())
            self.assertTrue(stat.S_ISREG((first / name).lstat().st_mode))

        checksum = subprocess.run(
            ["sha256sum", "--strict", "--check", "SHA256SUMS"],
            cwd=str(first),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(checksum.returncode, 0, msg=checksum.stderr)

        provenance_path = first / f"drclaw-{self.tag}.provenance.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        self.assertEqual(provenance["schema_version"], 1)
        self.assertEqual(provenance["tag"], self.tag)
        self.assertEqual(provenance["commit"], commit)
        self.assertEqual(provenance["tag_object"], tag_object)
        self.assertEqual(provenance["entrypoint"]["command"], "bash ./install.sh --full")
        self.assertEqual(
            provenance["source_audit"]["gitlinks"],
            [
                {
                    "path": self.gitlink_path,
                    "object": self.gitlink_object,
                    "content_included": False,
                }
            ],
        )
        self.assertEqual(
            provenance["source_audit"]["forbidden_machine_state_scan"],
            "passed-current-tree-and-reachable-history",
        )
        serialized_provenance = provenance_path.read_text(encoding="utf-8")
        self.assertNotIn(str(self.root), serialized_provenance)
        self.assertNotIn("DO-NOT-READ-OR-CHANGE", serialized_provenance)

        bundle = first / f"drclaw-{self.tag}.bundle"
        verify = self.git(repo, "bundle", "verify", str(bundle), check=False)
        self.assertEqual(verify.returncode, 0, msg=verify.stderr.decode())
        consumer = self.root / "bundle-consumer"
        consumer.mkdir()
        self.git(consumer, "init", "--quiet")
        self.git(
            consumer,
            "fetch",
            "--quiet",
            str(bundle),
            f"refs/tags/{self.tag}:refs/tags/{self.tag}",
        )
        fetched_object = self.git(
            consumer, "rev-parse", f"refs/tags/{self.tag}"
        ).stdout.decode().strip()
        fetched_type = self.git(consumer, "cat-file", "-t", fetched_object).stdout.decode().strip()
        fetched = self.git(
            consumer, "rev-parse", f"refs/tags/{self.tag}^{{commit}}"
        ).stdout.decode().strip()
        self.assertEqual(fetched_object, tag_object)
        self.assertEqual(fetched_type, "tag")
        self.assertEqual(fetched, commit)
        missing_gitlink_object = self.git(
            consumer,
            "cat-file",
            "-e",
            f"{self.gitlink_object}^{{commit}}",
            check=False,
        )
        self.assertNotEqual(missing_gitlink_object.returncode, 0)

        archive = first / f"drclaw-{self.tag}.tar.gz"
        with tarfile.open(archive, "r:gz") as handle:
            names = handle.getnames()
            self.assertIn(f"dr-claw/{self.gitlink_path}", names)
            self.assertFalse(
                any(name.startswith(f"dr-claw/{self.gitlink_path}/") for name in names)
            )
            self.assertFalse(any(member.issym() or member.islnk() for member in handle.getmembers()))

        wrapper = subprocess.run(
            ["bash", str(first / "install.sh"), "--full", "--dry-run"],
            cwd=str(outside),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(wrapper.returncode, 0, msg=wrapper.stderr)
        arguments = [line.removeprefix("REMOTE_ARG=") for line in wrapper.stdout.splitlines()]
        self.assertEqual(
            arguments,
            [
                "--repo-url",
                str(first / f"drclaw-{self.tag}.bundle"),
                "--ref",
                self.tag,
                "--expected-commit",
                commit,
                "--expected-tag-object",
                tag_object,
                "--full",
                "--dry-run",
            ],
        )
        reserved = subprocess.run(
            ["bash", str(first / "install.sh"), "--ref", "different"],
            cwd=str(outside),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertNotEqual(reserved.returncode, 0)
        self.assertIn("reserved identity arguments", reserved.stderr)
        reserved_equals = subprocess.run(
            ["bash", str(first / "install.sh"), "--expected-tag-object=" + ("0" * 40)],
            cwd=str(outside),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertNotEqual(reserved_equals.returncode, 0)
        self.assertIn("reserved identity arguments", reserved_equals.stderr)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "DO-NOT-READ-OR-CHANGE\n")
        self.assertEqual(sentinel.stat().st_mtime_ns, sentinel_mtime)

        extra = first / "._transport-junk"
        extra.write_text("unexpected\n", encoding="utf-8")
        unexpected = subprocess.run(
            ["bash", str(first / "install.sh"), "--dry-run"],
            cwd=str(outside),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertNotEqual(unexpected.returncode, 0)
        self.assertIn("directory inventory mismatch", unexpected.stderr)
        extra.unlink()

        with (first / "remote-install.sh").open("ab") as handle:
            handle.write(b"# tampered\n")
        tampered = subprocess.run(
            ["bash", str(first / "install.sh"), "--dry-run"],
            cwd=str(outside),
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertNotEqual(tampered.returncode, 0)
        self.assertIn("checksum verification failed", tampered.stderr)

    def test_rejects_dirty_source_and_cleans_atomic_staging(self) -> None:
        repo = self.make_repository("dirty-source")
        (repo / "untracked-auth.json").write_text("private\n", encoding="utf-8")
        output = self.root / "dirty-kit"
        result = self.run_builder(repo, output)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("source worktree is dirty", result.stderr)
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob(".dirty-kit.tmp.*")), [])

    def test_offline_wrapper_drives_real_remote_installer_from_bundle(self) -> None:
        repo = self.make_repository("real-remote-source", real_remote_installer=True)
        output = self.root / "real-remote-kit"
        self.assert_success(self.run_builder(repo, output))

        isolated_home = self.root / "isolated-target-home"
        isolated_home.mkdir(mode=0o700)
        unrelated = self.root / "existing-project-never-touch"
        unrelated.mkdir()
        sentinel = unrelated / "sentinel.txt"
        sentinel.write_text("unchanged\n", encoding="utf-8")
        sentinel_mtime = sentinel.stat().st_mtime_ns

        result = subprocess.run(
            [
                "bash",
                str(output / "install.sh"),
                "--home",
                str(isolated_home),
                "--codex-home",
                str(isolated_home / ".codex"),
                "--allow-nonlogin-home",
                "--skip-codex-install",
                "--no-doctor",
                "--dry-run",
            ],
            cwd=str(unrelated),
            check=False,
            capture_output=True,
            text=True,
            timeout=90,
            env={**os.environ, "HOME": str(isolated_home), "PYTHONDONTWRITEBYTECODE": "1"},
        )
        self.assertEqual(
            result.returncode,
            0,
            msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}",
        )
        self.assertIn("local Git repository", result.stdout)
        self.assertIn("temporary source is clean and verified", result.stdout)
        self.assertIn("FIXTURE_BOOTSTRAP_DRY_RUN", result.stdout)
        self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged\n")
        self.assertEqual(sentinel.stat().st_mtime_ns, sentinel_mtime)
        self.assertFalse((isolated_home / ".local" / "share" / "drclaw" / "releases").exists())

    def test_rejects_manifest_tag_expected_commit_and_head_mismatches(self) -> None:
        manifest_repo = self.make_repository("manifest-mismatch", manifest_ref="different-tag")
        manifest_output = self.root / "manifest-mismatch-kit"
        manifest_result = self.run_builder(manifest_repo, manifest_output)
        self.assertNotEqual(manifest_result.returncode, 0)
        self.assertIn("manifest release ref does not match", manifest_result.stderr)
        self.assertFalse(manifest_output.exists())

        expected_repo = self.make_repository("expected-mismatch")
        expected_result = self.run_builder(expected_repo, self.root / "expected-kit", expected_commit="2" * 40)
        self.assertNotEqual(expected_result.returncode, 0)
        self.assertIn("does not match --expected-commit", expected_result.stderr)

        head_repo = self.make_repository("head-mismatch")
        (head_repo / "later.txt").write_text("later\n", encoding="utf-8")
        self.git(head_repo, "add", "later.txt")
        self.git(head_repo, "commit", "--quiet", "-m", "advance HEAD")
        head_result = self.run_builder(head_repo, self.root / "head-kit")
        self.assertNotEqual(head_result.returncode, 0)
        self.assertIn("HEAD does not match", head_result.stderr)

        lightweight_repo = self.make_repository("lightweight", annotated_tag=False)
        lightweight_result = self.run_builder(lightweight_repo, self.root / "lightweight-kit")
        self.assertNotEqual(lightweight_result.returncode, 0)
        self.assertIn("must be annotated", lightweight_result.stderr)

    def test_rejects_symlinks_and_existing_output_without_overwrite(self) -> None:
        repo = self.make_repository("symlink-source")
        repo_link = self.root / "source-link"
        repo_link.symlink_to(repo, target_is_directory=True)
        linked_result = self.run_builder(
            repo,
            self.root / "linked-source-kit",
            repo_argument=repo_link,
        )
        self.assertNotEqual(linked_result.returncode, 0)
        self.assertIn("symlink", linked_result.stderr)

        tracked_repo = self.make_repository("tracked-link-source", tracked_symlink=True)
        tracked_result = self.run_builder(tracked_repo, self.root / "tracked-link-kit")
        self.assertNotEqual(tracked_result.returncode, 0)
        self.assertIn("tracked symlinks are forbidden", tracked_result.stderr)

        output_link = self.root / "output-link"
        output_link.symlink_to(self.root / "does-not-exist")
        output_result = self.run_builder(repo, output_link)
        self.assertNotEqual(output_result.returncode, 0)
        self.assertIn("output must not be a symlink", output_result.stderr)

        unsafe_parent = self.root / "group-writable-output-parent"
        unsafe_parent.mkdir(mode=0o770)
        unsafe_parent.chmod(0o770)
        unsafe_result = self.run_builder(repo, unsafe_parent / "kit")
        self.assertNotEqual(unsafe_result.returncode, 0)
        self.assertIn("output parent must be current-user-owned", unsafe_result.stderr)

        output = self.root / "immutable-kit"
        self.assert_success(self.run_builder(repo, output))
        before: Dict[str, str] = {path.name: self.digest(path) for path in output.iterdir()}
        overwrite = self.run_builder(repo, output)
        self.assertNotEqual(overwrite.returncode, 0)
        self.assertIn("refusing to overwrite", overwrite.stderr)
        after = {path.name: self.digest(path) for path in output.iterdir()}
        self.assertEqual(after, before)

    def test_rejects_gitlink_drift_and_initialized_content(self) -> None:
        mismatched = self.make_repository("gitlink-mismatch", gitlink_object="2" * 40)
        mismatch_result = self.run_builder(mismatched, self.root / "gitlink-mismatch-kit")
        self.assertNotEqual(mismatch_result.returncode, 0)
        self.assertIn("gitlinks do not exactly match", mismatch_result.stderr)

        initialized = self.make_repository("initialized-gitlink")
        gitlink_dir = initialized / self.gitlink_path
        gitlink_dir.mkdir(parents=True, exist_ok=True)
        (gitlink_dir / "payload.txt").write_text("must not travel\n", encoding="utf-8")
        initialized_result = self.run_builder(initialized, self.root / "initialized-kit")
        self.assertNotEqual(initialized_result.returncode, 0)
        # The clean-worktree gate is deliberately first; either it or the
        # explicit uninitialized-gitlink gate prevents packaging the payload.
        self.assertTrue(
            "source worktree is dirty" in initialized_result.stderr
            or "must remain uninitialized" in initialized_result.stderr
        )

    def test_rejects_missing_or_mismatched_gitlink_metadata(self) -> None:
        missing = self.make_repository("missing-gitmodules", include_gitmodules=False)
        missing_result = self.run_builder(missing, self.root / "missing-gitmodules-kit")
        self.assertNotEqual(missing_result.returncode, 0)
        self.assertIn("gitlinks but no .gitmodules metadata", missing_result.stderr)

        mismatched = self.make_repository(
            "mismatched-gitmodules",
            gitmodules_path="community-tools/not-the-gitlink",
        )
        mismatched_result = self.run_builder(mismatched, self.root / "mismatched-gitmodules-kit")
        self.assertNotEqual(mismatched_result.returncode, 0)
        self.assertIn(".gitmodules paths do not exactly match", mismatched_result.stderr)

    def test_rejects_removed_machine_state_and_secrets_in_bundle_history(self) -> None:
        state_repo = self.make_repository("historical-state", historical_machine_state=True)
        state_result = self.run_builder(state_repo, self.root / "historical-state-kit")
        self.assertNotEqual(state_result.returncode, 0)
        self.assertIn("reachable Git history contains forbidden machine state", state_result.stderr)
        self.assertFalse((self.root / "historical-state-kit").exists())

        secret_repo = self.make_repository("historical-secret", historical_secret=True)
        secret_result = self.run_builder(secret_repo, self.root / "historical-secret-kit")
        self.assertNotEqual(secret_result.returncode, 0)
        self.assertIn("high-confidence credential", secret_result.stderr)
        self.assertNotIn("Ab3kP9xQ2m" * 4, secret_result.stderr)
        self.assertFalse((self.root / "historical-secret-kit").exists())

        tag_secret_repo = self.make_repository("tag-secret", tag_secret=True)
        tag_secret_result = self.run_builder(tag_secret_repo, self.root / "tag-secret-kit")
        self.assertNotEqual(tag_secret_result.returncode, 0)
        self.assertIn("high-confidence credential", tag_secret_result.stderr)
        self.assertNotIn("T7mQ4zK9pL" * 4, tag_secret_result.stderr)
        self.assertFalse((self.root / "tag-secret-kit").exists())


if __name__ == "__main__":
    unittest.main()
