from __future__ import annotations

import json
import os
import re
import shlex
import shutil
import ssl
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
        self.capability_bin = self.make_capability_bin("ordinary-linux")
        self.bare_repository, self.commit = self.build_release(
            name="valid",
            tag=self.tag,
            audited_versions=["0.147.0", "0.150.2", "0.149.9"],
        )

    def make_capability_bin(
        self,
        name: str,
        *,
        os_name: str = "Linux",
        architecture: str = "x86_64",
        hostname: str = "fixture.example.invalid",
        cluster_name: Optional[str] = None,
        git_version: Optional[str] = None,
        glibc_output: Optional[str] = None,
        broken_coreutils: bool = False,
        python_missing_module: Optional[str] = None,
        local_mount_available_bytes: Optional[int] = None,
        local_mount_noexec: bool = False,
        delta_probe_timeout: bool = False,
        system_tmp_unsafe: bool = False,
        mktemp_log: Optional[Path] = None,
        home_acl_output: Optional[str] = None,
        foreign_home_ancestor: Optional[Path] = None,
        publish_race_log: Optional[Path] = None,
    ) -> Path:
        fixture_bin = self.root / f"capability-{name}-bin"
        fixture_bin.mkdir()
        (fixture_bin / "uname").write_text(
            "#!/usr/bin/env python3\n"
            "import sys\n"
            f"values = {{'-s': {os_name!r}, '-m': {architecture!r}}}\n"
            "if len(sys.argv) != 2 or sys.argv[1] not in values:\n"
            "    raise SystemExit(2)\n"
            "print(values[sys.argv[1]])\n",
            encoding="utf-8",
        )
        (fixture_bin / "hostname").write_text(
            "#!/usr/bin/env python3\n"
            "import sys\n"
            "if sys.argv[1:] != ['-f']:\n"
            "    raise SystemExit(2)\n"
            f"print({hostname!r})\n",
            encoding="utf-8",
        )
        scontrol_body = (
            "raise SystemExit(1)\n"
            if cluster_name is None
            else (
                "if sys.argv[1:] != ['show', 'config']:\n"
                "    raise SystemExit(2)\n"
                f"print('ClusterName = {cluster_name}')\n"
            )
        )
        (fixture_bin / "scontrol").write_text(
            "#!/usr/bin/env python3\n"
            "import sys\n" + scontrol_body,
            encoding="utf-8",
        )
        for command in ("uname", "hostname", "scontrol"):
            (fixture_bin / command).chmod(0o755)
        if git_version is not None:
            real_git = shutil.which("git")
            self.assertIsNotNone(real_git)
            (fixture_bin / "git").write_text(
                "#!/usr/bin/env bash\n"
                "set -Eeuo pipefail\n"
                "if [[ \"${1-}\" == \"--version\" ]]; then\n"
                f"  printf '%s\\n' {shlex.quote(git_version)}\n"
                "  exit 0\n"
                "fi\n"
                f"exec {shlex.quote(str(real_git))} \"$@\"\n",
                encoding="utf-8",
            )
            (fixture_bin / "git").chmod(0o755)
        if glibc_output is not None:
            (fixture_bin / "getconf").write_text(
                "#!/usr/bin/env python3\n"
                "import sys\n"
                "if sys.argv[1:] != ['GNU_LIBC_VERSION']:\n"
                "    raise SystemExit(2)\n"
                f"print({glibc_output!r})\n",
                encoding="utf-8",
            )
            (fixture_bin / "getconf").chmod(0o755)
        if broken_coreutils:
            real_stat = shutil.which("stat")
            self.assertIsNotNone(real_stat)
            (fixture_bin / "stat").write_text(
                "#!/usr/bin/env bash\n"
                "set -Eeuo pipefail\n"
                "if [[ \"${1-}\" == \"--version\" ]]; then\n"
                "  printf 'fixture non-GNU stat\\n'\n"
                "  exit 0\n"
                "fi\n"
                f"exec {shlex.quote(str(real_stat))} \"$@\"\n",
                encoding="utf-8",
            )
            (fixture_bin / "stat").chmod(0o755)
        injections: dict[str, str] = {}
        if python_missing_module is not None:
            self.assertIn(python_missing_module, {"ssl", "lzma"})
            injections["drclaw-python-stdlib-v1"] = (
                "import builtins as _fixture_builtins\n"
                "_fixture_original_import = _fixture_builtins.__import__\n"
                "def _fixture_import(name, *args, **kwargs):\n"
                f"    if name.split('.', 1)[0] == {python_missing_module!r}:\n"
                f"        raise ImportError('fixture missing {python_missing_module}')\n"
                "    return _fixture_original_import(name, *args, **kwargs)\n"
                "_fixture_builtins.__import__ = _fixture_import\n"
            )
        if local_mount_available_bytes is not None or local_mount_noexec:
            local_root = str(self.home / ".local")
            available = (
                local_mount_available_bytes
                if local_mount_available_bytes is not None
                else 16 * 1024**3
            )
            injections["drclaw-path-preflight-v1"] = (
                "import os as _fixture_os\n"
                "import pathlib as _fixture_pathlib\n"
                f"_fixture_local_root = {local_root!r}\n"
                f"_fixture_available_bytes = {available!r}\n"
                f"_fixture_local_noexec = {local_mount_noexec!r}\n"
                "_fixture_original_stat = _fixture_os.stat\n"
                "_fixture_original_statvfs = _fixture_os.statvfs\n"
                "def _fixture_is_local(path):\n"
                "    value = _fixture_os.path.abspath(_fixture_os.fspath(path))\n"
                "    return value == _fixture_local_root or value.startswith(_fixture_local_root + _fixture_os.sep)\n"
                "def _fixture_stat(path, *args, **kwargs):\n"
                "    if len(args) == 1 and 'follow_symlinks' not in kwargs:\n"
                "        kwargs['follow_symlinks'] = args[0]\n"
                "        args = ()\n"
                "    result = _fixture_original_stat(path, *args, **kwargs)\n"
                "    if _fixture_is_local(path):\n"
                "        values = list(result)\n"
                "        values[2] = result.st_dev + 1000003\n"
                "        return _fixture_os.stat_result(values)\n"
                "    return result\n"
                "def _fixture_statvfs(path):\n"
                "    result = _fixture_original_statvfs(path)\n"
                "    if not _fixture_is_local(path):\n"
                "        return result\n"
                "    values = list(result)\n"
                "    values[4] = _fixture_available_bytes // max(1, result.f_frsize)\n"
                "    if _fixture_local_noexec:\n"
                "        values[8] = result.f_flag | getattr(_fixture_os, 'ST_NOEXEC', 8)\n"
                "    return _fixture_os.statvfs_result(values)\n"
                "_fixture_os.stat = _fixture_stat\n"
                "_fixture_os.statvfs = _fixture_statvfs\n"
            )
        if delta_probe_timeout:
            injections["drclaw-delta-probe-v1"] = (
                "import os as _fixture_delta_os\n"
                "import subprocess as _fixture_subprocess\n"
                "_fixture_original_run = _fixture_subprocess.run\n"
                "def _fixture_timeout_run(command, *args, **kwargs):\n"
                "    executable = _fixture_delta_os.path.basename(command[0]) if command else ''\n"
                "    if executable in {'hostname', 'scontrol'}:\n"
                "        raise _fixture_subprocess.TimeoutExpired(command, kwargs.get('timeout'))\n"
                "    return _fixture_original_run(command, *args, **kwargs)\n"
                "_fixture_subprocess.run = _fixture_timeout_run\n"
            )
        if system_tmp_unsafe:
            injections["drclaw-safe-temp-v1"] = (
                "import os as _fixture_temp_os\n"
                "import stat as _fixture_temp_stat\n"
                "_fixture_temp_original_stat = _fixture_temp_os.stat\n"
                "def _fixture_temp_stat_call(path, *args, **kwargs):\n"
                "    result = _fixture_temp_original_stat(path, *args, **kwargs)\n"
                "    value = _fixture_temp_os.path.abspath(_fixture_temp_os.fspath(path))\n"
                "    if value == '/tmp':\n"
                "        values = list(result)\n"
                "        values[0] = result.st_mode & ~_fixture_temp_stat.S_ISVTX\n"
                "        return _fixture_temp_os.stat_result(values)\n"
                "    return result\n"
                "_fixture_temp_os.stat = _fixture_temp_stat_call\n"
            )
        if home_acl_output is not None:
            injections["drclaw-path-preflight-v1"] = (
                "import os as _fixture_acl_os\n"
                "import stat as _fixture_acl_stat\n"
                "import subprocess as _fixture_acl_subprocess\n"
                f"_fixture_acl_home = {str(self.home)!r}\n"
                f"_fixture_acl_output = {home_acl_output!r}\n"
                "_fixture_acl_getfacl = '/usr/bin/getfacl'\n"
                "_fixture_acl_original_stat = _fixture_acl_os.stat\n"
                "_fixture_acl_original_lstat = _fixture_acl_os.lstat\n"
                "_fixture_acl_original_run = _fixture_acl_subprocess.run\n"
                "def _fixture_acl_result(result, *, mode=None, uid=None, gid=None):\n"
                "    values = list(result)\n"
                "    if mode is not None:\n"
                "        values[0] = mode\n"
                "    if uid is not None:\n"
                "        values[4] = uid\n"
                "    if gid is not None:\n"
                "        values[5] = gid\n"
                "    return _fixture_acl_os.stat_result(values)\n"
                "def _fixture_acl_stat_call(path, *args, **kwargs):\n"
                "    if not isinstance(path, (str, bytes, _fixture_acl_os.PathLike)):\n"
                "        path, args = args[0], args[1:]\n"
                "    result = _fixture_acl_original_stat(path, *args, **kwargs)\n"
                "    value = _fixture_acl_os.path.abspath(_fixture_acl_os.fspath(path))\n"
                "    if value == _fixture_acl_home:\n"
                "        mode = _fixture_acl_stat.S_IFDIR | 0o770\n"
                "        return _fixture_acl_result(result, mode=mode, uid=0, gid=0)\n"
                "    return result\n"
                "def _fixture_acl_lstat_call(path, *args, **kwargs):\n"
                "    if not isinstance(path, (str, bytes, _fixture_acl_os.PathLike)):\n"
                "        path, args = args[0], args[1:]\n"
                "    value = _fixture_acl_os.path.abspath(_fixture_acl_os.fspath(path))\n"
                "    if value == _fixture_acl_getfacl:\n"
                "        try:\n"
                "            result = _fixture_acl_original_lstat(path, *args, **kwargs)\n"
                "        except OSError:\n"
                "            result = _fixture_acl_original_lstat('/usr/bin/python3')\n"
                "        mode = _fixture_acl_stat.S_IFREG | 0o755\n"
                "        return _fixture_acl_result(result, mode=mode, uid=0, gid=0)\n"
                "    result = _fixture_acl_original_lstat(path, *args, **kwargs)\n"
                "    if value == _fixture_acl_home:\n"
                "        mode = _fixture_acl_stat.S_IFDIR | 0o770\n"
                "        return _fixture_acl_result(result, mode=mode, uid=0, gid=0)\n"
                "    return result\n"
                "def _fixture_acl_run(command, *args, **kwargs):\n"
                "    if command and command[0] == _fixture_acl_getfacl:\n"
                "        return _fixture_acl_subprocess.CompletedProcess(command, 0, _fixture_acl_output, '')\n"
                "    return _fixture_acl_original_run(command, *args, **kwargs)\n"
                "_fixture_acl_os.stat = _fixture_acl_stat_call\n"
                "_fixture_acl_os.lstat = _fixture_acl_lstat_call\n"
                "_fixture_acl_subprocess.run = _fixture_acl_run\n"
            )
            injections["drclaw-ca-path-v1"] = injections[
                "drclaw-path-preflight-v1"
            ]
        if foreign_home_ancestor is not None:
            injections["drclaw-path-preflight-v1"] = (
                "import os as _fixture_home_os\n"
                "import stat as _fixture_home_stat\n"
                f"_fixture_foreign_parent = {str(foreign_home_ancestor)!r}\n"
                "_fixture_home_original_stat = _fixture_home_os.stat\n"
                "_fixture_home_original_lstat = _fixture_home_os.lstat\n"
                "def _fixture_home_foreign(result):\n"
                "    values = list(result)\n"
                "    values[0] = _fixture_home_stat.S_IFDIR | 0o700\n"
                "    values[4] = _fixture_home_os.geteuid() + 100003\n"
                "    return _fixture_home_os.stat_result(values)\n"
                "def _fixture_home_stat_call(path, *args, **kwargs):\n"
                "    if not isinstance(path, (str, bytes, _fixture_home_os.PathLike)):\n"
                "        path, args = args[0], args[1:]\n"
                "    result = _fixture_home_original_stat(path, *args, **kwargs)\n"
                "    value = _fixture_home_os.path.abspath(_fixture_home_os.fspath(path))\n"
                "    return _fixture_home_foreign(result) if value == _fixture_foreign_parent else result\n"
                "def _fixture_home_lstat_call(path, *args, **kwargs):\n"
                "    if not isinstance(path, (str, bytes, _fixture_home_os.PathLike)):\n"
                "        path, args = args[0], args[1:]\n"
                "    result = _fixture_home_original_lstat(path, *args, **kwargs)\n"
                "    value = _fixture_home_os.path.abspath(_fixture_home_os.fspath(path))\n"
                "    return _fixture_home_foreign(result) if value == _fixture_foreign_parent else result\n"
                "_fixture_home_os.stat = _fixture_home_stat_call\n"
                "_fixture_home_os.lstat = _fixture_home_lstat_call\n"
            )
        if injections:
            real_python = str(Path(shutil.which("python3") or "").resolve())
            self.assertTrue(real_python and Path(real_python).is_file())
            self.assertNotRegex(real_python, r"\s")
            (fixture_bin / "python3").write_text(
                f"#!{real_python}\n"
                "import os, subprocess, sys\n"
                f"injections = {injections!r}\n"
                "marker = sys.argv[2] if len(sys.argv) > 2 and sys.argv[1] == '-' else ''\n"
                "if marker in injections:\n"
                "    source = injections[marker] + sys.stdin.read()\n"
                f"    result = subprocess.run([{real_python!r}, *sys.argv[1:]], input=source, text=True)\n"
                "    raise SystemExit(result.returncode)\n"
                f"os.execv({real_python!r}, [{real_python!r}, *sys.argv[1:]])\n",
                encoding="utf-8",
            )
            (fixture_bin / "python3").chmod(0o755)
        if mktemp_log is not None:
            real_mktemp = str(Path(shutil.which("mktemp") or "").resolve())
            real_python = str(Path(shutil.which("python3") or "").resolve())
            self.assertTrue(real_mktemp and Path(real_mktemp).is_file())
            self.assertTrue(real_python and Path(real_python).is_file())
            (fixture_bin / "mktemp").write_text(
                f"#!{real_python}\n"
                "import json, os, sys\n"
                "arguments = sys.argv[1:]\n"
                "if arguments != ['--version']:\n"
                f"    with open({str(mktemp_log)!r}, 'a', encoding='utf-8') as handle:\n"
                "        handle.write(json.dumps(arguments) + '\\n')\n"
                f"os.execv({real_mktemp!r}, [{real_mktemp!r}, *arguments])\n",
                encoding="utf-8",
            )
            (fixture_bin / "mktemp").chmod(0o755)
        if publish_race_log is not None:
            real_mv = str(Path(shutil.which("mv") or "").resolve())
            real_python = str(Path(shutil.which("python3") or "").resolve())
            self.assertTrue(real_mv and Path(real_mv).is_file())
            self.assertTrue(real_python and Path(real_python).is_file())
            (fixture_bin / "mv").write_text(
                f"#!{real_python}\n"
                "import os, subprocess, sys\n"
                "arguments = sys.argv[1:]\n"
                "if len(arguments) == 4 and arguments[:2] == ['-T', '--'] and '.incoming.' in arguments[2]:\n"
                f"    result = subprocess.run([{real_mv!r}, *arguments], check=False)\n"
                "    if result.returncode != 0:\n"
                "        raise SystemExit(result.returncode)\n"
                f"    with open({str(publish_race_log)!r}, 'w', encoding='utf-8') as handle:\n"
                "        handle.write('competitor-published-before-mv-returned\\n')\n"
                "    raise SystemExit(1)\n"
                f"os.execv({real_mv!r}, [{real_mv!r}, *arguments])\n",
                encoding="utf-8",
            )
            (fixture_bin / "mv").chmod(0o755)
        return fixture_bin

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
        host_requirement_override: Optional[dict[str, Any]] = None,
        managed_state_fixture: bool = False,
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
                "server_os": "Linux",
                "server_architectures": ["x86_64", "aarch64"],
                "git_minimum": "2.25.0",
                "app_glibc_minimum": "2.28",
                "python_stdlib_capabilities": {
                    "ssl_default_context_required_for": [
                        "codex_install",
                        "drclaw_cli",
                        "app",
                    ],
                    "app_xz_roundtrip_modules": ["lzma", "tarfile"],
                },
                "minimum_free_bytes": {
                    "core": 1073741824,
                    "full": 8589934592,
                },
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
        if host_requirement_override:
            manifest["requirements"].update(host_requirement_override)
        (bootstrap_dir / "manifest.json").write_text(
            json.dumps(manifest, indent=2) + "\n",
            encoding="utf-8",
        )
        bootstrap = bootstrap_dir / "bootstrap.sh"
        managed_state_script = (
            "managed_link=\"$HOME/.agents/skills/drclaw-skill-library\"\n"
            "managed_target=\"$PWD/skills/fixture\"\n"
            "if [[ -L \"$managed_link\" ]]; then\n"
            "  current_target=$(readlink -- \"$managed_link\")\n"
            "  case \"$current_target\" in\n"
            "    \"$HOME\"/.local/share/drclaw/releases/*/skills/fixture) ;;\n"
            "    *) printf 'fixture refuses tampered managed link\\n' >&2; exit 2 ;;\n"
            "  esac\n"
            "elif [[ -e \"$managed_link\" ]]; then\n"
            "  printf 'fixture refuses non-symlink managed entry\\n' >&2\n"
            "  exit 2\n"
            "fi\n"
            "mkdir -p -- \"$(dirname -- \"$managed_link\")\" \"$CODEX_HOME\"\n"
            "ln -sfn -- \"$managed_target\" \"$managed_link\"\n"
            "printf '{\"source_commit\":\"%s\"}\\n' \"${PWD##*/}\" > \"$CODEX_HOME/drclaw-bootstrap-state.json\"\n"
            if managed_state_fixture
            else ""
        )
        bootstrap.write_text(
            "#!/usr/bin/env bash\n"
            "set -Eeuo pipefail\n"
            "for network_name in DRCLAW_CA_BUNDLE GIT_SSL_CAINFO SSL_CERT_FILE CURL_CA_BUNDLE PIP_CERT NODE_EXTRA_CA_CERTS; do\n"
            "  if [[ -n \"${!network_name-}\" ]]; then printf 'FIXTURE_NETWORK_ENV=%s\\n' \"$network_name\"; fi\n"
            "done\n"
            "for argument in \"$@\"; do\n"
            "  if [[ \"$argument\" == \"--dry-run\" ]]; then\n"
            "    printf 'FIXTURE_BOOTSTRAP_DRY_RUN PWD=%s\\n' \"$PWD\"\n"
            "    for item in \"$@\"; do printf 'FIXTURE_BOOTSTRAP_ARG=%s\\n' \"$item\"; done\n"
            "    exit 0\n"
            "  fi\n"
            "done\n"
            + managed_state_script
            + "count_file=\"$HOME/bootstrap-invocation-count.txt\"\n"
            "count=0\n"
            "if [[ -f \"$count_file\" ]]; then read -r count < \"$count_file\"; fi\n"
            "printf '%s\\n' \"$((count + 1))\" > \"$count_file\"\n"
            "{\n"
            "  printf 'CODEX_RELEASE=%s\\n' \"${CODEX_RELEASE-}\"\n"
            "  printf 'HOME=%s\\n' \"$HOME\"\n"
            "  printf 'CODEX_HOME=%s\\n' \"${CODEX_HOME-}\"\n"
            "  printf 'PWD=%s\\n' \"$PWD\"\n"
            "  for argument in \"$@\"; do printf 'ARG=%s\\n' \"$argument\"; done\n"
            "} > \"$HOME/bootstrap-last-invocation.txt\"\n"
            "{\n"
            "  printf 'BEGIN\\n'\n"
            "  for argument in \"$@\"; do printf 'ARG=%s\\n' \"$argument\"; done\n"
            "  printf 'END\\n'\n"
            "} >> \"$HOME/bootstrap-invocations.txt\"\n",
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
            "'\\n'.join('ARG=' + item for item in sys.argv[1:]) + '\\n')\n"
            "with (home / 'app-invocations.txt').open('a', encoding='utf-8') as handle:\n"
            "    handle.write('BEGIN\\n')\n"
            "    handle.writelines('ARG=' + item + '\\n' for item in sys.argv[1:])\n"
            "    handle.write('END\\n')\n",
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
        capability_bin: Optional[Path] = None,
        environment_overrides: Optional[dict[str, str]] = None,
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
        for name in (
            "HTTP_PROXY",
            "http_proxy",
            "HTTPS_PROXY",
            "https_proxy",
            "NO_PROXY",
            "no_proxy",
            "DRCLAW_CA_BUNDLE",
            "SSL_CERT_FILE",
            "SSL_CERT_DIR",
            "REQUESTS_CA_BUNDLE",
            "AWS_CA_BUNDLE",
            "PIP_CERT",
            "NODE_EXTRA_CA_CERTS",
            "CURL_CA_BUNDLE",
            "GIT_SSL_CAINFO",
            "npm_config_cafile",
            "NPM_CONFIG_CAFILE",
            "ALL_PROXY",
            "all_proxy",
            "PIP_INDEX_URL",
            "PIP_EXTRA_INDEX_URL",
            "PIP_TRUSTED_HOST",
            "NPM_CONFIG_REGISTRY",
            "npm_config_registry",
            "NPM_CONFIG_PROXY",
            "npm_config_proxy",
            "NPM_CONFIG_HTTPS_PROXY",
            "npm_config_https_proxy",
            "TMPDIR",
            "XDG_RUNTIME_DIR",
            "PYTHONHOME",
            "PYTHONPATH",
            "PYTHONDONTWRITEBYTECODE",
            "PYTHONNOUSERSITE",
        ):
            environment.pop(name, None)
        environment.update(
            {
                "HOME": str(self.home),
                "CODEX_HOME": str(self.codex_home),
                "PATH": str(capability_bin or self.capability_bin)
                + os.pathsep
                + environment.get("PATH", ""),
            }
        )
        if environment_overrides:
            environment.update(environment_overrides)
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

    def read_invocations(self, path: Path) -> list[list[str]]:
        blocks: list[list[str]] = []
        current: Optional[list[str]] = None
        for line in path.read_text(encoding="utf-8").splitlines():
            if line == "BEGIN":
                self.assertIsNone(current, msg=f"nested invocation marker in {path}")
                current = []
            elif line == "END":
                self.assertIsNotNone(current, msg=f"orphan invocation marker in {path}")
                assert current is not None
                blocks.append(current)
                current = None
            else:
                self.assertIsNotNone(current, msg=f"unframed invocation line in {path}: {line}")
                assert current is not None
                self.assertTrue(line.startswith("ARG="), msg=f"invalid invocation line: {line}")
                current.append(line.removeprefix("ARG="))
        self.assertIsNone(current, msg=f"unterminated invocation marker in {path}")
        return blocks

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

    def test_dry_run_does_not_refresh_a_stale_existing_checkout_index(self) -> None:
        installed = self.run_installer("--no-doctor")
        self.assert_success(installed)
        checkout = self.release_checkout()
        tracked = checkout / "AGENTS.md"
        index = checkout / ".git" / "index"
        touched_mtime = max(tracked.stat().st_mtime_ns + 2_000_000_000, 2_000_000_000)
        os.utime(tracked, ns=(touched_mtime, touched_mtime))
        before_bytes = index.read_bytes()
        before_stat = index.lstat()

        preview = self.run_installer("--dry-run")
        self.assert_success(preview)

        after_stat = index.lstat()
        self.assertEqual(index.read_bytes(), before_bytes)
        self.assertEqual(after_stat.st_ino, before_stat.st_ino)
        self.assertEqual(after_stat.st_size, before_stat.st_size)
        self.assertEqual(after_stat.st_mtime_ns, before_stat.st_mtime_ns)
        self.assertEqual(after_stat.st_ctime_ns, before_stat.st_ctime_ns)
        self.assertEqual(tracked.stat().st_mtime_ns, touched_mtime)
        self.assert_unrelated_state_unchanged()

    def test_git_config_and_python_import_hooks_are_disabled_for_installer_children(
        self,
    ) -> None:
        git_marker = self.root / "git-fsmonitor-must-not-run"
        fsmonitor = self.root / "fake-fsmonitor"
        fsmonitor.write_text(
            "#!/usr/bin/env bash\n"
            "set -Eeuo pipefail\n"
            f"printf 'executed\\n' > {shlex.quote(str(git_marker))}\n"
            "printf '0\\n'\n",
            encoding="utf-8",
        )
        fsmonitor.chmod(0o755)
        global_config = self.root / "hostile-global.gitconfig"
        global_config.write_text(
            "[core]\n"
            f"\tfsmonitor = {fsmonitor}\n",
            encoding="utf-8",
        )

        python_marker = self.root / "python-sitecustomize-must-not-run"
        hostile_python = self.root / "hostile-python-path"
        hostile_python.mkdir()
        (hostile_python / "sitecustomize.py").write_text(
            "from pathlib import Path\n"
            f"Path({str(python_marker)!r}).write_text('executed\\n', encoding='utf-8')\n",
            encoding="utf-8",
        )
        hostile_environment = {
            "GIT_CONFIG_GLOBAL": str(global_config),
            "PYTHONHOME": str(hostile_python),
            "PYTHONPATH": str(hostile_python),
        }
        installed = self.run_installer(
            "--full",
            "--app-service",
            "none",
            "--no-doctor",
            environment_overrides=hostile_environment,
        )
        self.assert_success(installed)
        checkout = self.release_checkout()
        self.git("config", "core.fsmonitor", str(fsmonitor), cwd=checkout)

        preview = self.run_installer(
            "--dry-run",
            environment_overrides=hostile_environment,
        )
        self.assert_success(preview)
        legacy_git = self.make_capability_bin(
            "legacy-git-fsmonitor",
            git_version="git version 2.25.0",
        )
        legacy_preview = self.run_installer(
            "--dry-run",
            capability_bin=legacy_git,
            environment_overrides=hostile_environment,
        )
        self.assertEqual(legacy_preview.returncode, 2)
        self.assertIn("fsmonitor unsupported by this Git version", legacy_preview.stderr)
        generated_python = [
            path
            for path in checkout.rglob("*")
            if path.name == "__pycache__" or path.suffix in {".pyc", ".pyo"}
        ]
        self.assertEqual(generated_python, [])
        # Local Git config is machine state rather than a tracked source file;
        # the immutable worktree itself remains clean.
        self.assertEqual(
            self.git(
                "config",
                "--unset",
                "core.fsmonitor",
                cwd=checkout,
            ),
            "",
        )
        self.assertEqual(self.git("status", "--porcelain", cwd=checkout), "")
        self.assertFalse(git_marker.exists())
        self.assertFalse(python_marker.exists())
        self.assert_unrelated_state_unchanged()

    def test_atomic_publish_race_reuses_winner_without_nested_incoming_tree(self) -> None:
        race_log = self.root / "publish-race.log"
        capability_bin = self.make_capability_bin(
            "publish-race",
            publish_race_log=race_log,
        )
        result = self.run_installer("--no-doctor", capability_bin=capability_bin)
        self.assert_success(result)
        self.assertIn("won the atomic publish race", result.stdout)
        self.assertEqual(
            race_log.read_text(encoding="utf-8"),
            "competitor-published-before-mv-returned\n",
        )
        checkout = self.release_checkout()
        self.assertTrue(checkout.is_dir())
        self.assertEqual(list(checkout.glob(".incoming.*")), [])
        self.assertEqual(list(checkout.parent.glob(".incoming.*")), [])
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=checkout), self.commit)
        self.assertEqual(self.git("status", "--porcelain", cwd=checkout), "")
        self.assert_unrelated_state_unchanged()

    def test_default_upgrade_and_rollback_retarget_managed_skill_without_replace(
        self,
    ) -> None:
        tag_a = "drclaw-managed-state-a"
        tag_b = "drclaw-managed-state-b"
        repository_a, commit_a = self.build_release(
            name="managed-state-a",
            tag=tag_a,
            audited_versions=["0.147.0"],
            managed_state_fixture=True,
        )
        repository_b, commit_b = self.build_release(
            name="managed-state-b",
            tag=tag_b,
            audited_versions=["0.147.0"],
            managed_state_fixture=True,
        )

        def install(repository: Path, tag: str, commit: str):
            return self.run_installer(
                "--no-doctor",
                ref=tag,
                expected_commit=commit,
                repository=repository,
            )

        link = self.home / ".agents" / "skills" / "drclaw-skill-library"
        receipt = self.codex_home / "drclaw-bootstrap-state.json"
        checkout_a = self.release_checkout(commit_a)
        checkout_b = self.release_checkout(commit_b)

        first = install(repository_a, tag_a, commit_a)
        self.assert_success(first)
        self.assertEqual(link.resolve(), checkout_a / "skills" / "fixture")
        self.assertEqual(json.loads(receipt.read_text())["source_commit"], commit_a)

        upgraded = install(repository_b, tag_b, commit_b)
        self.assert_success(upgraded)
        self.assertEqual(link.resolve(), checkout_b / "skills" / "fixture")
        self.assertEqual(json.loads(receipt.read_text())["source_commit"], commit_b)
        self.assertTrue(checkout_a.is_dir())
        self.assertTrue(checkout_b.is_dir())
        self.assertNotIn(
            "ARG=--replace\n",
            (self.home / "bootstrap-last-invocation.txt").read_text(encoding="utf-8"),
        )

        rolled_back = install(repository_a, tag_a, commit_a)
        self.assert_success(rolled_back)
        self.assertEqual(link.resolve(), checkout_a / "skills" / "fixture")
        self.assertEqual(json.loads(receipt.read_text())["source_commit"], commit_a)
        self.assertTrue(checkout_b.is_dir())

        external = self.root / "tampered-managed-skill"
        external.mkdir()
        link.unlink()
        link.symlink_to(external, target_is_directory=True)
        receipt_before = receipt.read_bytes()
        invocation_count_before = (
            self.home / "bootstrap-invocation-count.txt"
        ).read_bytes()
        refused = install(repository_b, tag_b, commit_b)
        self.assertEqual(refused.returncode, 2)
        self.assertIn("refuses tampered managed link", refused.stderr)
        self.assertEqual(link.readlink(), external)
        self.assertEqual(receipt.read_bytes(), receipt_before)
        self.assertEqual(
            (self.home / "bootstrap-invocation-count.txt").read_bytes(),
            invocation_count_before,
        )
        self.assertTrue(checkout_a.is_dir())
        self.assertTrue(checkout_b.is_dir())
        self.assert_unrelated_state_unchanged()

    def test_release_workflow_run_blocks_have_valid_shell_and_heredocs(self) -> None:
        workflow = REPO_ROOT / ".github" / "workflows" / "codex-bootstrap-release.yml"
        lines = workflow.read_text(encoding="utf-8").splitlines()
        scripts: list[tuple[int, str]] = []
        index = 0
        while index < len(lines):
            match = re.match(r"^(\s*)run:\s*\|\s*$", lines[index])
            if match is None:
                index += 1
                continue
            field_indent = len(match.group(1))
            block_indent = field_indent + 2
            start = index + 2
            index += 1
            block: list[str] = []
            while index < len(lines):
                raw = lines[index]
                if raw.strip() and len(raw) - len(raw.lstrip()) <= field_indent:
                    break
                block.append(raw[block_indent:] if len(raw) >= block_indent else "")
                index += 1
            scripts.append((start, "\n".join(block) + "\n"))

        self.assertTrue(scripts, msg="release workflow contains no shell run blocks")
        for start, script in scripts:
            with self.subTest(workflow_line=start):
                pending: Optional[str] = None
                completed_terminators: set[str] = set()
                for offset, line in enumerate(script.splitlines()):
                    stripped = line.strip()
                    if pending is not None:
                        if stripped == pending:
                            completed_terminators.add(pending)
                            pending = None
                        continue
                    opener = re.search(
                        r"<<-?\s*['\"]?([A-Za-z_][A-Za-z0-9_]*)['\"]?",
                        line,
                    )
                    if opener is not None:
                        pending = opener.group(1)
                    elif stripped in completed_terminators:
                        self.fail(
                            f"orphan repeated heredoc terminator at workflow line {start + offset}"
                        )
                self.assertIsNone(
                    pending,
                    msg=f"unterminated heredoc in workflow run block starting line {start}",
                )
                shell_source = re.sub(r"\$\{\{.*?\}\}", "GITHUB_EXPRESSION", script)
                lint = subprocess.run(
                    ["bash", "-n"],
                    input=shell_source,
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
                self.assertEqual(
                    lint.returncode,
                    0,
                    msg=(
                        f"bash syntax failure in workflow run block starting line {start}:\n"
                        f"{lint.stderr}"
                    ),
                )

        workflow_text = workflow.read_text(encoding="utf-8")
        self.assertIn('id: release-output', workflow_text)
        self.assertIn(
            'release_parent=$(mktemp -d -- "${RUNNER_TEMP}/drclaw-release-artifacts.XXXXXXXX")',
            workflow_text,
        )
        self.assertIn('chmod 700 -- "${release_parent}"', workflow_text)
        self.assertIn(
            '--output "${{ steps.release-output.outputs.parent }}/release-artifacts"',
            workflow_text,
        )
        self.assertIn(
            'path: ${{ steps.release-output.outputs.parent }}/release-artifacts/',
            workflow_text,
        )
        self.assertNotIn(
            'git -C "${app_home}/release" checkout --quiet --detach "${RELEASE_TAG}"',
            workflow_text,
        )
        self.assertEqual(
            workflow_text.count(
                'git -C "${app_home}/release" checkout --quiet --detach "${release_commit}"'
            ),
            2,
        )
        web_blocks = [script for _, script in scripts if 'app_home="${RUNNER_TEMP}/drclaw-' in script]
        self.assertEqual(len(web_blocks), 2)
        for script in web_blocks:
            self.assertIn('bootstrap/codex/bootstrap.py"', script)
            self.assertLess(script.index('bootstrap/codex/bootstrap.py"'), script.index('install_app.py"'))
            self.assertGreaterEqual(script.count('install_app.py"'), 2)

        arm_blocks = [
            script
            for _, script in scripts
            if 'remote_home="${RUNNER_TEMP}/drclaw-arm64-remote-preview"' in script
        ]
        self.assertEqual(len(arm_blocks), 1)
        arm_block = arm_blocks[0]
        for variable in (
            "DRCLAW_CA_BUNDLE",
            "SSL_CERT_FILE",
            "PIP_INDEX_URL",
            "PIP_EXTRA_INDEX_URL",
            "PIP_TRUSTED_HOST",
            "NPM_CONFIG_REGISTRY",
            "npm_config_registry",
        ):
            with self.subTest(environment_variable=variable):
                self.assertIn(f"-u {variable}", arm_block)
        self.assertLess(
            arm_block.index("-u PIP_INDEX_URL"),
            arm_block.index("bash bootstrap/codex/remote-install.sh"),
        )

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
        self.assertIn("ARG=doctor\n", invocation)
        self.assertIn("ARG=--strict-release\n", invocation)
        self.assertIn("ARG=--require-clean-native-skills\n", invocation)
        self.assertNotIn("ARG=--no-doctor\n", invocation)
        self.assertIn("pre-activation acceptance passed", result.stdout)
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
        staging_root = self.root / "isolated-failure-staging"
        staging_root.mkdir(mode=0o700)
        result = self.run_installer(
            "--dry-run",
            ref="f" * 40,
            expected_commit="",
            environment_overrides={"TMPDIR": str(staging_root)},
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("cannot fetch approved commit", result.stderr)
        self.assertEqual(list(staging_root.iterdir()), [])
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

        wrong_tag_object = self.run_installer("--expected-tag-object", "0" * 40)
        self.assertEqual(wrong_tag_object.returncode, 2)
        self.assertIn("tag object moved", wrong_tag_object.stderr)
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

    def test_delta_skill_auto_detection_and_explicit_override_are_host_capability_driven(
        self,
    ) -> None:
        ordinary = self.run_installer("--dry-run")
        self.assert_success(ordinary)
        self.assertIn("exec_status=passed", ordinary.stdout)
        self.assertIn("delta_verified=0 delta_skill=omitted-auto-unverified", ordinary.stdout)
        self.assertIn("FIXTURE_BOOTSTRAP_ARG=--skip-delta-skill", ordinary.stdout)

        delta_bin = self.make_capability_bin(
            "verified-delta",
            hostname="dt-login99.delta.ncsa.illinois.edu",
            cluster_name="delta",
        )
        delta = self.run_installer("--dry-run", capability_bin=delta_bin)
        self.assert_success(delta)
        self.assertIn("delta_verified=1 delta_skill=included-auto-verified", delta.stdout)
        self.assertNotIn("FIXTURE_BOOTSTRAP_ARG=--skip-delta-skill", delta.stdout)

        explicit = self.run_installer("--dry-run", "--include-delta-skill")
        self.assert_success(explicit)
        self.assertIn("delta_verified=0 delta_skill=included-explicit", explicit.stdout)
        self.assertNotIn("FIXTURE_BOOTSTRAP_ARG=--skip-delta-skill", explicit.stdout)

        conflict = self.run_installer(
            "--dry-run", "--include-delta-skill", "--skip-delta-skill"
        )
        self.assertEqual(conflict.returncode, 2)
        self.assertIn("conflicts", conflict.stderr)
        self.assert_unrelated_state_unchanged()

    def test_current_delta_profile_requires_live_identity_before_target_writes(self) -> None:
        before = self.target_home_snapshot()
        refused = self.run_installer("--config-profile", "current-delta")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("requires a live verified NCSA Delta", refused.stderr)
        self.assertEqual(self.target_home_snapshot(), before)
        self.assertFalse((self.home / ".local").exists())
        self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())

        delta_bin = self.make_capability_bin(
            "current-delta",
            hostname="dt-login01.delta.ncsa.illinois.edu",
            cluster_name="DeLtA",
        )
        accepted = self.run_installer(
            "--dry-run",
            "--config-profile",
            "current-delta",
            capability_bin=delta_bin,
        )
        self.assert_success(accepted)
        self.assertIn("FIXTURE_BOOTSTRAP_ARG=current-delta", accepted.stdout)
        self.assertNotIn("FIXTURE_BOOTSTRAP_ARG=--skip-delta-skill", accepted.stdout)
        self.assert_unrelated_state_unchanged()

    def test_host_os_arch_git_and_space_gates_fail_before_target_writes(self) -> None:
        cases = [
            (
                self.make_capability_bin("unsupported-os", os_name="Darwin"),
                (),
                "unsupported operating system",
            ),
            (
                self.make_capability_bin("unsupported-arch", architecture="riscv64"),
                (),
                "unsupported Linux architecture",
            ),
            (
                self.make_capability_bin("old-git", git_version="git version 2.24.9"),
                (),
                "Git 2.25.0 or newer",
            ),
            (
                self.make_capability_bin("malformed-git", git_version="not a Git version"),
                (),
                "cannot parse the Git version",
            ),
            (
                self.make_capability_bin("non-gnu-coreutils", broken_coreutils=True),
                (),
                "GNU coreutils stat",
            ),
            (
                self.capability_bin,
                ("--minimum-free-bytes", "999999999999999999"),
                "insufficient free space",
            ),
        ]
        for capability_bin, arguments, expected_error in cases:
            with self.subTest(expected_error=expected_error):
                before = self.target_home_snapshot()
                result = self.run_installer(*arguments, capability_bin=capability_bin)
                self.assertEqual(result.returncode, 2)
                self.assertIn(expected_error, result.stderr)
                self.assertEqual(self.target_home_snapshot(), before)
                self.assertFalse((self.home / ".local").exists())
                self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())
                self.assert_unrelated_state_unchanged()

    def test_app_requires_glibc_2_28_but_core_does_not(self) -> None:
        old_glibc = self.make_capability_bin("old-glibc", glibc_output="glibc 2.27")
        unknown_libc = self.make_capability_bin("unknown-libc", glibc_output="musl 1.2.5")
        for capability_bin, expected_error in (
            (old_glibc, "requires glibc 2.28 or newer"),
            (unknown_libc, "cannot parse glibc capability"),
        ):
            with self.subTest(expected_error=expected_error):
                before = self.target_home_snapshot()
                result = self.run_installer("--full", capability_bin=capability_bin)
                self.assertEqual(result.returncode, 2)
                self.assertIn(expected_error, result.stderr)
                self.assertEqual(self.target_home_snapshot(), before)
                self.assertFalse((self.home / ".local").exists())
                self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())

        core = self.run_installer("--dry-run", capability_bin=unknown_libc)
        self.assert_success(core)
        self.assertIn("glibc=not-required", core.stdout)
        self.assert_unrelated_state_unchanged()

    def test_python_stdlib_capabilities_fail_before_target_writes(self) -> None:
        missing_ssl = self.make_capability_bin(
            "missing-python-ssl", python_missing_module="ssl"
        )
        for arguments in ((), ("--skip-codex-install", "--with-drclaw-cli")):
            with self.subTest(arguments=arguments):
                before = self.target_home_snapshot()
                result = self.run_installer(*arguments, capability_bin=missing_ssl)
                self.assertEqual(result.returncode, 2)
                self.assertIn("ssl import and default trust context", result.stderr)
                self.assertEqual(self.target_home_snapshot(), before)
                self.assertFalse((self.home / ".local").exists())
                self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())

        core_without_codex = self.run_installer(
            "--skip-codex-install", "--dry-run", capability_bin=missing_ssl
        )
        self.assert_success(core_without_codex)
        self.assertIn("python_ssl=not-required,app_xz=not-required", core_without_codex.stdout)

        missing_lzma = self.make_capability_bin(
            "missing-python-lzma", python_missing_module="lzma"
        )
        before = self.target_home_snapshot()
        app = self.run_installer(
            "--skip-codex-install", "--with-app", capability_bin=missing_lzma
        )
        self.assertEqual(app.returncode, 2)
        self.assertIn("lzma and tarfile XZ support", app.stderr)
        self.assertEqual(self.target_home_snapshot(), before)
        self.assertFalse((self.home / ".local").exists())
        self.assert_unrelated_state_unchanged()

    def test_network_environment_policy_accepts_safe_inputs_and_never_echoes_secrets(
        self,
    ) -> None:
        default_ca = ssl.get_default_verify_paths().cafile
        self.assertIsNotNone(default_ca)
        self.assertTrue(Path(str(default_ca)).is_file())
        ca_bundle = self.root / "approved-ca-bundle.pem"
        shutil.copyfile(str(default_ca), ca_bundle)
        ca_bundle.chmod(0o600)
        safe_environment = {
            "HTTPS_PROXY": "http://proxy.example.invalid:8080",
            "NO_PROXY": "localhost,.example.invalid",
            "DRCLAW_CA_BUNDLE": str(ca_bundle),
        }
        accepted = self.run_installer(
            "--dry-run", environment_overrides=safe_environment
        )
        self.assert_success(accepted)
        self.assertIn("network=credential-safe", accepted.stdout)
        self.assertIn("https_proxy=configured", accepted.stdout)
        self.assertIn("ca=custom", accepted.stdout)
        for name in (
            "DRCLAW_CA_BUNDLE",
            "GIT_SSL_CAINFO",
            "SSL_CERT_FILE",
            "CURL_CA_BUNDLE",
            "PIP_CERT",
            "NODE_EXTRA_CA_CERTS",
        ):
            self.assertIn(f"FIXTURE_NETWORK_ENV={name}", accepted.stdout)
        self.assertNotIn(str(ca_bundle), accepted.stdout + accepted.stderr)

        secret = "FAKE-PROXY-CREDENTIAL-DO-NOT-LOG"
        alternate_ca_keys = (
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
        for name in alternate_ca_keys:
            with self.subTest(alternate_ca=name):
                before = self.target_home_snapshot()
                refused = self.run_installer(
                    "--dry-run",
                    environment_overrides={name: f"/tmp/{secret}.pem"},
                )
                self.assertEqual(refused.returncode, 2)
                combined = refused.stdout + refused.stderr
                self.assertIn("unsupported custom CA environment variable", combined)
                self.assertNotIn(secret, combined)
                self.assertEqual(self.target_home_snapshot(), before)
                self.assertFalse((self.home / ".local").exists())

        unsafe_ca_parent = self.root / "writable-ca-parent"
        unsafe_ca_parent.mkdir()
        unsafe_ca_parent.chmod(0o777)
        unsafe_ca = unsafe_ca_parent / "ca.pem"
        shutil.copyfile(str(default_ca), unsafe_ca)
        unsafe_ca.chmod(0o600)
        before = self.target_home_snapshot()
        unsafe_ca_result = self.run_installer(
            "--dry-run",
            environment_overrides={"DRCLAW_CA_BUNDLE": str(unsafe_ca)},
        )
        self.assertEqual(unsafe_ca_result.returncode, 2)
        self.assertIn("untrusted writable ancestor", unsafe_ca_result.stderr)
        self.assertEqual(self.target_home_snapshot(), before)

        for environment, expected_error in (
            (
                {"HTTPS_PROXY": f"http://user:{secret}@proxy.example.invalid:8080"},
                "credential-free HTTP(S) proxy URL",
            ),
            (
                {"PIP_INDEX_URL": f"https://user:{secret}@mirror.example.invalid/simple"},
                "unsupported proxy or private-mirror environment variable",
            ),
        ):
            with self.subTest(expected_error=expected_error):
                before = self.target_home_snapshot()
                refused = self.run_installer(
                    "--dry-run", environment_overrides=environment
                )
                self.assertEqual(refused.returncode, 2)
                combined = refused.stdout + refused.stderr
                self.assertIn(expected_error, combined)
                self.assertNotIn(secret, combined)
                self.assertEqual(self.target_home_snapshot(), before)
                self.assertFalse((self.home / ".local").exists())
        self.assert_unrelated_state_unchanged()

    def test_safe_temporary_root_policy_rejects_unsafe_roots_before_writes(self) -> None:
        private_root = self.root / "private-temp"
        private_root.mkdir(mode=0o700)
        symlink_root = self.root / "symlink-temp"
        symlink_root.symlink_to(private_root, target_is_directory=True)
        non_sticky_root = self.root / "non-sticky-temp"
        non_sticky_root.mkdir()
        non_sticky_root.chmod(0o777)

        for value, expected_error in (
            (".", "temporary root must be absolute"),
            (str(symlink_root), "must not traverse a symlink"),
            (str(non_sticky_root), "current-user-owned/private or root-owned mode 1777"),
        ):
            with self.subTest(value=value):
                before = self.target_home_snapshot()
                refused = self.run_installer(
                    "--dry-run", environment_overrides={"TMPDIR": value}
                )
                self.assertEqual(refused.returncode, 2)
                self.assertIn(expected_error, refused.stderr)
                self.assertEqual(self.target_home_snapshot(), before)

        accepted = self.run_installer(
            "--dry-run", environment_overrides={"TMPDIR": "/tmp"}
        )
        self.assert_success(accepted)
        self.assert_unrelated_state_unchanged()

    def test_dry_run_stages_outside_target_local_tmp_without_mutating_it(self) -> None:
        target_tmp = self.home / "tmp"
        target_tmp.mkdir(mode=0o700)
        sentinel = target_tmp / "keep.txt"
        sentinel.write_text("unchanged\n", encoding="utf-8")
        mktemp_log = self.root / "mktemp-invocations.jsonl"
        capability_bin = self.make_capability_bin(
            "target-local-temp",
            mktemp_log=mktemp_log,
        )

        before_tree = self.target_home_snapshot()
        before_tmp = target_tmp.lstat()
        before_sentinel = sentinel.lstat()
        result = self.run_installer(
            "--dry-run",
            capability_bin=capability_bin,
            environment_overrides={"TMPDIR": str(target_tmp)},
        )
        self.assert_success(result)

        after_tmp = target_tmp.lstat()
        after_sentinel = sentinel.lstat()
        self.assertEqual(self.target_home_snapshot(), before_tree)
        self.assertEqual(after_tmp.st_ino, before_tmp.st_ino)
        self.assertEqual(after_tmp.st_mtime_ns, before_tmp.st_mtime_ns)
        self.assertEqual(after_tmp.st_ctime_ns, before_tmp.st_ctime_ns)
        self.assertEqual(after_sentinel.st_ino, before_sentinel.st_ino)
        self.assertEqual(after_sentinel.st_mtime_ns, before_sentinel.st_mtime_ns)

        invocations = [
            json.loads(line)
            for line in mktemp_log.read_text(encoding="utf-8").splitlines()
        ]
        templates = [
            Path(argument)
            for invocation in invocations
            for argument in invocation
            if argument.startswith("/") and "drclaw-" in Path(argument).name
        ]
        self.assertGreaterEqual(len(templates), 2)
        for template in templates:
            self.assertEqual(template.parent, Path("/tmp"))
            self.assertNotEqual(template, target_tmp)
            self.assertNotIn(self.home, template.parents)
        self.assertNotIn(str(target_tmp), mktemp_log.read_text(encoding="utf-8"))
        self.assert_unrelated_state_unchanged()

    def test_dry_run_fails_before_writes_when_no_external_temp_root_is_safe(
        self,
    ) -> None:
        target_tmp = self.home / "tmp"
        target_tmp.mkdir(mode=0o700)
        sentinel = target_tmp / "keep.txt"
        sentinel.write_text("unchanged\n", encoding="utf-8")
        capability_bin = self.make_capability_bin(
            "unsafe-system-temp",
            system_tmp_unsafe=True,
        )
        before_tree = self.target_home_snapshot()
        before_tmp = target_tmp.lstat()

        refused = self.run_installer(
            "--dry-run",
            capability_bin=capability_bin,
            environment_overrides={"TMPDIR": str(target_tmp)},
        )

        self.assertEqual(refused.returncode, 2)
        self.assertIn("temporary staging root failed", refused.stderr)
        after_tmp = target_tmp.lstat()
        self.assertEqual(self.target_home_snapshot(), before_tree)
        self.assertEqual(after_tmp.st_ino, before_tmp.st_ino)
        self.assertEqual(after_tmp.st_mtime_ns, before_tmp.st_mtime_ns)
        self.assertEqual(after_tmp.st_ctime_ns, before_tmp.st_ctime_ns)
        self.assertFalse(self.release_checkout().exists())
        self.assert_unrelated_state_unchanged()

    def test_target_local_atomic_staging_requires_private_release_root(self) -> None:
        release_root = self.home / ".local" / "share" / "drclaw" / "releases"
        release_root.mkdir(parents=True)
        release_root.chmod(0o755)
        before = self.target_home_snapshot()
        refused = self.run_installer("--no-doctor")
        self.assertEqual(refused.returncode, 2)
        self.assertIn("release staging root must be private", refused.stderr)
        self.assertEqual(self.target_home_snapshot(), before)
        self.assertFalse(self.release_checkout().exists())
        self.assert_unrelated_state_unchanged()

    def test_delta_probe_timeout_is_bounded_and_fail_closed_for_current_delta(
        self,
    ) -> None:
        timeout_bin = self.make_capability_bin(
            "delta-timeout",
            hostname="dt-login01.delta.ncsa.illinois.edu",
            cluster_name="delta",
            delta_probe_timeout=True,
        )
        auto = self.run_installer("--dry-run", capability_bin=timeout_bin)
        self.assert_success(auto)
        self.assertIn("delta_probe=hostname-timeout,scontrol-timeout", auto.stdout)
        self.assertIn("delta_verified=0 delta_skill=omitted-auto-unverified", auto.stdout)

        before = self.target_home_snapshot()
        strict = self.run_installer(
            "--dry-run",
            "--config-profile",
            "current-delta",
            capability_bin=timeout_bin,
        )
        self.assertEqual(strict.returncode, 2)
        self.assertIn("requires a live verified NCSA Delta", strict.stderr)
        self.assertEqual(self.target_home_snapshot(), before)
        self.assert_unrelated_state_unchanged()

    def test_independent_local_mount_space_and_noexec_are_probed(self) -> None:
        local_root = self.home / ".local"
        local_root.mkdir(mode=0o700)
        for capability_bin, arguments, expected_error in (
            (
                self.make_capability_bin(
                    "local-low-space", local_mount_available_bytes=4096
                ),
                ("--dry-run",),
                "insufficient free space",
            ),
            (
                self.make_capability_bin(
                    "local-noexec", local_mount_noexec=True
                ),
                ("--dry-run", "--skip-space-check"),
                "mounted noexec",
            ),
        ):
            with self.subTest(expected_error=expected_error):
                before = self.target_home_snapshot()
                result = self.run_installer(*arguments, capability_bin=capability_bin)
                self.assertEqual(result.returncode, 2)
                self.assertIn(expected_error, result.stderr)
                self.assertEqual(self.target_home_snapshot(), before)
                self.assertFalse((self.home / "bootstrap-invocation-count.txt").exists())
        self.assert_unrelated_state_unchanged()

    def test_space_check_override_is_explicit_and_visible(self) -> None:
        result = self.run_installer("--dry-run", "--skip-space-check")
        self.assert_success(result)
        self.assertIn("WARNING space-check skipped by explicit advanced override", result.stdout)
        conflict = self.run_installer(
            "--dry-run", "--skip-space-check", "--minimum-free-bytes", str(9 * 1024**3)
        )
        self.assertEqual(conflict.returncode, 2)
        self.assertIn("conflicts", conflict.stderr)
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

    def test_manifest_host_capability_contract_drift_is_refused(self) -> None:
        tag = "drclaw-codex-test-host-contract-drift"
        repository, commit = self.build_release(
            name="host-contract-drift",
            tag=tag,
            audited_versions=["0.147.0"],
            host_requirement_override={"git_minimum": "2.26.0"},
        )
        result = self.run_installer(
            "--no-doctor",
            ref=tag,
            expected_commit=commit,
            repository=repository,
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("host capability contract drifted", result.stderr)
        self.assertFalse(self.release_checkout(commit).exists())
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

    def test_full_default_runs_both_installs_before_the_unified_strict_gate(self) -> None:
        result = self.run_installer("--full", "--app-service", "none")
        self.assert_success(result)

        bootstrap_invocations = self.read_invocations(
            self.home / "bootstrap-invocations.txt"
        )
        self.assertEqual(len(bootstrap_invocations), 2)
        self.assertEqual(bootstrap_invocations[0][0], "install")
        self.assertIn("--with-drclaw-cli", bootstrap_invocations[0])
        self.assertIn("--no-doctor", bootstrap_invocations[0])
        self.assertNotIn("--strict-release", bootstrap_invocations[0])
        self.assertEqual(bootstrap_invocations[1][0], "doctor")
        self.assertIn("--strict-release", bootstrap_invocations[1])
        self.assertIn("--require-clean-native-skills", bootstrap_invocations[1])
        self.assertNotIn("--no-doctor", bootstrap_invocations[1])

        app_invocations = self.read_invocations(self.home / "app-invocations.txt")
        self.assertEqual(len(app_invocations), 2)
        self.assertIn("install", app_invocations[0])
        self.assertIn("--no-doctor", app_invocations[0])
        self.assertIn("doctor", app_invocations[1])
        self.assertNotIn("--no-doctor", app_invocations[1])
        self.assertEqual(
            (self.home / "bootstrap-invocation-count.txt").read_text(encoding="utf-8"),
            "2\n",
        )
        self.assertEqual(
            (self.home / "app-invocation-count.txt").read_text(encoding="utf-8"),
            "2\n",
        )

        install_note = result.stdout.index("invoking the verified bundled bootstrap")
        app_note = result.stdout.index("installing the pinned Dr. Claw Web application layer")
        gate_note = result.stdout.index("running the strict, credential-free pre-activation acceptance gate")
        passed_note = result.stdout.index("pre-activation acceptance passed")
        self.assertLess(install_note, app_note)
        self.assertLess(app_note, gate_note)
        self.assertLess(gate_note, passed_note)
        self.assert_unrelated_state_unchanged()

    def test_isolated_full_install_can_never_start_real_user_service(self) -> None:
        result = self.run_installer("--full", "--start-app")
        self.assertEqual(result.returncode, 2)
        self.assertIn("isolated tests never touch real user-systemd", result.stderr)
        self.assertFalse((self.home / ".local").exists())
        self.assertFalse((self.home / "app-invocation-count.txt").exists())
        self.assert_unrelated_state_unchanged()

    def test_all_installs_reject_codex_home_outside_target_home_before_writes(self) -> None:
        outside = self.root / "outside-codex-home"
        result = self.run_installer("--codex-home", str(outside))
        self.assertEqual(result.returncode, 2)
        self.assertIn("CODEX_HOME must be a dedicated path inside target home", result.stderr)
        self.assertFalse((self.home / ".local").exists())
        self.assertFalse(outside.exists())
        self.assert_unrelated_state_unchanged()

    def test_custom_codex_home_rejects_writable_existing_ancestor_before_writes(self) -> None:
        shared = self.home / "shared"
        shared.mkdir()
        shared.chmod(0o777)
        before = self.target_home_snapshot()
        result = self.run_installer(
            "--codex-home", str(shared / "nested" / "codex")
        )
        self.assertEqual(result.returncode, 2)
        self.assertIn("existing ancestors must be current-user-owned", result.stderr)
        self.assertEqual(self.target_home_snapshot(), before)
        self.assertFalse((self.home / ".local").exists())
        self.assert_unrelated_state_unchanged()

    def test_missing_managed_leaves_reject_writable_existing_ancestors_before_writes(
        self,
    ) -> None:
        cases = (
            (Path(".agents"), (), "managed skill scripts"),
            (Path(".local/share"), (), "release checkout"),
            (
                Path(".config"),
                ("--with-app", "--app-service", "none"),
                "application config",
            ),
        )
        for relative_ancestor, feature_arguments, expected_label in cases:
            top_level = self.home / relative_ancestor.parts[0]
            if top_level.exists():
                shutil.rmtree(top_level)
            ancestor = self.home / relative_ancestor
            ancestor.mkdir(mode=0o700, parents=True)
            for parent in ancestor.parents:
                if parent == self.home:
                    break
                parent.chmod(0o700)
            ancestor.chmod(0o770)

            for mode_arguments in (("--dry-run",), ("--no-doctor",)):
                with self.subTest(
                    ancestor=str(relative_ancestor),
                    mode=mode_arguments[0],
                ):
                    before = self.target_home_snapshot()
                    refused = self.run_installer(
                        *mode_arguments,
                        *feature_arguments,
                    )
                    self.assertEqual(refused.returncode, 2)
                    self.assertIn(expected_label, refused.stderr)
                    self.assertIn(
                        "existing ancestors must be current-user-owned",
                        refused.stderr,
                    )
                    self.assertEqual(self.target_home_snapshot(), before)
                    self.assertFalse(self.release_checkout().exists())
                    self.assertFalse(
                        (self.home / "bootstrap-invocation-count.txt").exists()
                    )
                    self.assertFalse((self.home / "app-invocation-count.txt").exists())
                    self.assert_unrelated_state_unchanged()
            shutil.rmtree(top_level)

    def test_root_owned_delta_style_home_acl_is_accepted_and_foreign_writes_fail(
        self,
    ) -> None:
        uid = os.geteuid()
        foreign_uid = uid + 100003
        base_acl = (
            "user::rwx\n"
            f"user:{uid}:rwx\n"
            "group::---\n"
            "mask::rwx\n"
            "other::---\n"
        )
        accepted_bin = self.make_capability_bin(
            "delta-home-acl",
            home_acl_output=base_acl,
        )
        before = self.target_home_snapshot()
        accepted = self.run_installer("--dry-run", capability_bin=accepted_bin)
        self.assert_success(accepted)
        self.assertEqual(self.target_home_snapshot(), before)

        foreign_acls = (
            base_acl.replace(
                "group::---\n",
                f"user:{foreign_uid}:rwx\ngroup::---\n",
            ),
            base_acl.replace(
                "mask::rwx\n",
                f"group:{foreign_uid}:rwx\nmask::rwx\n",
            ),
            base_acl
            + "default:user::rwx\n"
            + f"default:user:{foreign_uid}:rwx\n"
            + "default:group::---\n"
            + "default:mask::rwx\n"
            + "default:other::---\n",
        )
        for index, acl_output in enumerate(foreign_acls):
            with self.subTest(foreign_acl=index):
                capability_bin = self.make_capability_bin(
                    f"foreign-home-acl-{index}",
                    home_acl_output=acl_output,
                )
                before = self.target_home_snapshot()
                refused = self.run_installer(
                    "--dry-run",
                    capability_bin=capability_bin,
                )
                self.assertEqual(refused.returncode, 2)
                self.assertIn("foreign effective write access", refused.stderr)
                self.assertEqual(self.target_home_snapshot(), before)
                self.assertFalse(self.release_checkout().exists())
                self.assert_unrelated_state_unchanged()

    def test_home_ancestor_chain_allows_root_sticky_and_rejects_unsafe_owners(
        self,
    ) -> None:
        # The ordinary isolated HOME is below root-owned sticky /tmp and is the
        # positive shared-parent case used on every invocation in this suite.
        accepted = self.run_installer("--dry-run")
        self.assert_success(accepted)

        writable_parent = self.root / "writable-home-parent"
        writable_parent.mkdir(mode=0o700)
        writable_parent.chmod(0o777)
        unsafe_home = writable_parent / "target-home"
        unsafe_home.mkdir(mode=0o700)
        sentinel = unsafe_home / "keep.txt"
        sentinel.write_text("unchanged\n", encoding="utf-8")
        before = (sentinel.read_bytes(), sentinel.lstat().st_mtime_ns)
        refused = self.run_installer(
            "--dry-run",
            "--home",
            str(unsafe_home),
        )
        self.assertEqual(refused.returncode, 2)
        self.assertIn("HOME ancestors must not be group/world writable", refused.stderr)
        self.assertEqual((sentinel.read_bytes(), sentinel.lstat().st_mtime_ns), before)
        self.assertFalse((unsafe_home / ".local").exists())

        foreign_bin = self.make_capability_bin(
            "foreign-home-ancestor",
            foreign_home_ancestor=self.root,
        )
        before_tree = self.target_home_snapshot()
        foreign = self.run_installer("--dry-run", capability_bin=foreign_bin)
        self.assertEqual(foreign.returncode, 2)
        self.assertIn("HOME ancestors must be owned by root or the target user", foreign.stderr)
        self.assertEqual(self.target_home_snapshot(), before_tree)
        self.assert_unrelated_state_unchanged()

    def test_delta_style_acl_home_is_trusted_for_ca_only_with_safe_acl(self) -> None:
        default_ca = ssl.get_default_verify_paths().cafile
        self.assertIsNotNone(default_ca)
        ca_directory = self.home / "certificates"
        ca_directory.mkdir(mode=0o700)
        ca_bundle = ca_directory / "site-ca.pem"
        shutil.copyfile(str(default_ca), ca_bundle)
        ca_bundle.chmod(0o600)

        uid = os.geteuid()
        foreign_uid = uid + 100003
        base_acl = (
            "user::rwx\n"
            f"user:{uid}:rwx\n"
            "group::---\n"
            "mask::rwx\n"
            "other::---\n"
        )
        accepted_bin = self.make_capability_bin(
            "delta-home-ca-acl",
            home_acl_output=base_acl,
        )
        before = self.target_home_snapshot()
        accepted = self.run_installer(
            "--dry-run",
            capability_bin=accepted_bin,
            environment_overrides={"DRCLAW_CA_BUNDLE": str(ca_bundle)},
        )
        self.assert_success(accepted)
        self.assertEqual(self.target_home_snapshot(), before)

        unsafe_acls = (
            base_acl.replace(
                "group::---\n",
                f"user:{foreign_uid}:rwx\ngroup::---\n",
            ),
            base_acl.replace(
                "mask::rwx\n",
                f"group:{foreign_uid}:rwx\nmask::rwx\n",
            ),
            base_acl
            + "default:user::rwx\n"
            + f"default:user:{foreign_uid}:rwx\n"
            + "default:group::---\n"
            + "default:mask::rwx\n"
            + "default:other::---\n",
        )
        for index, acl_output in enumerate(unsafe_acls):
            with self.subTest(unsafe_acl=index):
                capability_bin = self.make_capability_bin(
                    f"unsafe-delta-home-ca-acl-{index}",
                    home_acl_output=acl_output,
                )
                before = self.target_home_snapshot()
                refused = self.run_installer(
                    "--dry-run",
                    capability_bin=capability_bin,
                    environment_overrides={"DRCLAW_CA_BUNDLE": str(ca_bundle)},
                )
                self.assertEqual(refused.returncode, 2)
                self.assertIn("foreign effective write access", refused.stderr)
                self.assertIn("local trust-file policy", refused.stderr)
                self.assertEqual(self.target_home_snapshot(), before)
                self.assertFalse(self.release_checkout().exists())
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
