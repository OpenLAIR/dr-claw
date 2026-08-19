#!/usr/bin/env bash
set -Eeuo pipefail

# This entrypoint is intentionally self-contained: it is designed to be piped
# from a raw URL pinned to the same immutable Git revision that it installs.
umask 077

readonly DEFAULT_REPOSITORY="https://github.com/OpenLAIR/dr-claw.git"

release_ref=""
expected_commit=""
repository="$DEFAULT_REPOSITORY"
target_home="${HOME-}"
codex_home=""
config_profile="safe"
codex_release="manifest"
allow_nonlogin_home=0
dry_run=0
install_codex=1
install_plugins=0
copy_skills=0
replace_existing=0
skip_delta_skill=0
with_drclaw_cli=0
with_app=0
app_service="auto"
start_app=0
no_doctor=0
temporary_checkout=""
dry_run_checkout=""
release_root=""

usage() {
  cat <<'EOF'
Usage:
  remote-install.sh --ref <FULL_COMMIT_SHA>
  remote-install.sh --ref <RELEASE_TAG> --expected-commit <FULL_COMMIT_SHA>

Fetch an immutable Dr. Claw release into the current Unix user's versioned
source directory, verify it, and invoke the bundled Codex bootstrap.

Required:
  --ref REF                  Full 40-hex commit, or an exact Git tag.

Pinning:
  --expected-commit SHA      Required for a tag; protects against tag movement.
  --repo-url URL             Git repository (default: public Dr. Claw GitHub).

Target and bootstrap options:
  --home PATH                Target home (defaults to the current user's HOME).
  --codex-home PATH          CODEX_HOME (defaults to <home>/.codex).
  --config-profile PROFILE   safe (default), preserve, or current-delta.
  --codex-release VERSION    Fresh-install Codex version: manifest (default),
                             an explicit X.Y.Z, or latest.
  --copy-skills              Copy the managed entry skills instead of linking.
  --replace                  Archive and replace conflicting managed skills.
  --skip-delta-skill         Do not install the NCSA Delta skill.
  --install-plugins          Ask Codex to install the approved plugin baseline.
  --with-drclaw-cli          Install the optional editable drclaw Python CLI.
  --with-app                 Install the pinned Node runtime and Dr. Claw Web.
  --full                     Install both the drclaw CLI and Dr. Claw Web.
  --app-service MODE         auto (default), user-systemd, or none; never starts
                             unless --start-app is also supplied.
  --start-app                Explicitly start the Web user service after install.
  --skip-codex-install       Require an existing Codex instead of installing it.
  --no-doctor                Skip both post-install doctors.

Safety and preview:
  --dry-run                  Resolve/verify the ref and preview without writes.
  --allow-nonlogin-home      Explicit interlock for an isolated disposable HOME.
  -h, --help                 Show this help.

Run this script as the final non-root Unix user. It never copies authentication,
connector caches, SSH material, .env files, sessions, or existing projects.
EOF
}

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 2
}

note() {
  printf '[remote-install] %s\n' "$*"
}

cleanup() {
  if [[ -n "$dry_run_checkout" ]]; then
    case "$dry_run_checkout" in
      /tmp/drclaw-remote-dry-run.*)
        if [[ -d "$dry_run_checkout" ]]; then
          rm -rf -- "$dry_run_checkout"
        fi
        ;;
    esac
  fi
  if [[ -n "$temporary_checkout" && -n "$release_root" ]]; then
    case "$temporary_checkout" in
      "$release_root"/.incoming.*)
        if [[ -d "$temporary_checkout" ]]; then
          rm -rf -- "$temporary_checkout"
        fi
        ;;
    esac
  fi
}
trap cleanup EXIT

while (($#)); do
  case "$1" in
    --ref)
      (($# >= 2)) || die "--ref requires a value"
      release_ref=$2
      shift 2
      ;;
    --expected-commit)
      (($# >= 2)) || die "--expected-commit requires a value"
      expected_commit=$2
      shift 2
      ;;
    --repo-url)
      (($# >= 2)) || die "--repo-url requires a value"
      repository=$2
      shift 2
      ;;
    --home)
      (($# >= 2)) || die "--home requires a value"
      target_home=$2
      shift 2
      ;;
    --codex-home)
      (($# >= 2)) || die "--codex-home requires a value"
      codex_home=$2
      shift 2
      ;;
    --config-profile)
      (($# >= 2)) || die "--config-profile requires a value"
      config_profile=$2
      shift 2
      ;;
    --codex-release)
      (($# >= 2)) || die "--codex-release requires a value"
      codex_release=$2
      shift 2
      ;;
    --allow-nonlogin-home)
      allow_nonlogin_home=1
      shift
      ;;
    --dry-run)
      dry_run=1
      shift
      ;;
    --skip-codex-install)
      install_codex=0
      shift
      ;;
    --install-plugins)
      install_plugins=1
      shift
      ;;
    --copy-skills)
      copy_skills=1
      shift
      ;;
    --replace)
      replace_existing=1
      shift
      ;;
    --skip-delta-skill)
      skip_delta_skill=1
      shift
      ;;
    --with-drclaw-cli)
      with_drclaw_cli=1
      shift
      ;;
    --with-app)
      with_app=1
      shift
      ;;
    --full)
      with_drclaw_cli=1
      with_app=1
      shift
      ;;
    --app-service)
      (($# >= 2)) || die "--app-service requires a value"
      app_service=$2
      with_app=1
      shift 2
      ;;
    --start-app)
      start_app=1
      with_app=1
      shift
      ;;
    --no-doctor)
      no_doctor=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --)
      shift
      (($# == 0)) || die "positional arguments are not supported"
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

[[ -n "$release_ref" ]] || die "--ref is required"
[[ -n "$target_home" ]] || die "HOME is unset; pass --home explicitly"
case "$config_profile" in
  safe|preserve|current-delta) ;;
  *) die "invalid --config-profile: $config_profile" ;;
esac
case "$app_service" in
  auto|user-systemd|none) ;;
  *) die "invalid --app-service: $app_service" ;;
esac
if ((allow_nonlogin_home && start_app)); then
  die "--start-app is forbidden with --allow-nonlogin-home; isolated tests never touch real user-systemd"
fi
if [[ "$codex_release" != "manifest" && "$codex_release" != "latest" \
  && ! "$codex_release" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "--codex-release must be manifest, latest, or an X.Y.Z version"
fi

for command_name in git python3; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
done

python3 - <<'PY' || die "Python 3.9 or newer is required"
import sys
raise SystemExit(0 if sys.version_info >= (3, 9) else 1)
PY

((EUID != 0)) || die "refusing to provision as root; become the final target user first"

repository_label=$(python3 - "$repository" <<'PY'
import os
import re
import sys
from urllib.parse import urlsplit

value = sys.argv[1]
if any(character in value for character in ("\n", "\r", "\x00")):
    raise SystemExit("repository location contains a forbidden control character")

if "://" in value:
    parsed = urlsplit(value)
    if parsed.scheme not in {"https", "ssh", "file"}:
        raise SystemExit("repository URL scheme must be https, ssh, or file")
    if parsed.query or parsed.fragment:
        raise SystemExit("repository URL must not contain a query or fragment")
    if parsed.password is not None:
        raise SystemExit("repository URL must not embed a password or token")
    if parsed.scheme == "https" and parsed.username is not None:
        raise SystemExit("HTTPS repository URL must not embed user information")
    if parsed.scheme == "ssh" and parsed.username not in (None, "git"):
        raise SystemExit("SSH repository URL may use only the non-secret git username")
    if parsed.scheme in {"https", "ssh"} and not parsed.hostname:
        raise SystemExit("repository URL has no hostname")
    if parsed.scheme == "file" and (parsed.username is not None or parsed.hostname not in (None, "", "localhost")):
        raise SystemExit("file repository URL must be local and contain no user information")
    host = parsed.hostname or "local"
    print(f"{parsed.scheme} Git repository host={host}")
elif re.match(r"^[^/\\s@]+@[^/:\\s]+:", value):
    if not value.startswith("git@"):
        raise SystemExit("scp-style repository URLs may use only the non-secret git username")
    host = value.split("@", 1)[1].split(":", 1)[0]
    print(f"ssh Git repository host={host}")
else:
    # Local paths are useful for air-gapped mirrors and isolated tests. Never
    # echo the caller-controlled path because path components can be sensitive.
    if not value or value.startswith("-"):
        raise SystemExit("local repository path must be non-empty and must not begin with a dash")
    print("local Git repository")
PY
) || die "repository location failed the credential-safe policy"

is_full_commit=0
if [[ "$release_ref" =~ ^[0-9A-Fa-f]{40}$ ]]; then
  is_full_commit=1
  release_ref=${release_ref,,}
else
  git check-ref-format "refs/tags/$release_ref" >/dev/null 2>&1 \
    || die "--ref must be a full commit or a valid exact tag"
  [[ -n "$expected_commit" ]] \
    || die "a tag requires --expected-commit with the approved 40-hex commit"
fi

if [[ -n "$expected_commit" ]]; then
  [[ "$expected_commit" =~ ^[0-9A-Fa-f]{40}$ ]] \
    || die "--expected-commit must contain exactly 40 hexadecimal characters"
  expected_commit=${expected_commit,,}
  if ((is_full_commit)) && [[ "$expected_commit" != "$release_ref" ]]; then
    die "--expected-commit does not equal the commit supplied in --ref"
  fi
fi

if [[ -z "$codex_home" ]]; then
  codex_home="$target_home/.codex"
fi

normalized_paths=$(python3 - \
  "$target_home" "$codex_home" "$allow_nonlogin_home" "$dry_run" "$with_app" <<'PY'
import os
import pwd
import stat
import sys
from pathlib import Path

raw_home, raw_codex_home, raw_allow, raw_dry_run, raw_with_app = sys.argv[1:]
uid = os.geteuid()
allow_nonlogin = raw_allow == "1"
dry_run = raw_dry_run == "1"
with_app = raw_with_app == "1"

def lexical_absolute(raw: str) -> Path:
    expanded = os.path.expanduser(raw)
    if "\n" in expanded or "\r" in expanded or "\x00" in expanded:
        raise SystemExit("path contains a forbidden control character")
    return Path(os.path.abspath(expanded))

def first_symlink(path: Path):
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        if os.path.lexists(current) and current.is_symlink():
            return current
    return None

def validate_path(label: str, path: Path) -> None:
    forbidden = {
        Path("/"), Path("/bin"), Path("/boot"), Path("/dev"), Path("/etc"),
        Path("/home"), Path("/lib"), Path("/lib64"), Path("/opt"),
        Path("/proc"), Path("/root"), Path("/run"), Path("/sbin"),
        Path("/sys"), Path("/tmp"), Path("/u"), Path("/usr"), Path("/var"),
    }
    protected = {
        Path("/bin"), Path("/boot"), Path("/dev"), Path("/etc"),
        Path("/lib"), Path("/lib64"), Path("/opt"), Path("/proc"),
        Path("/root"), Path("/run"), Path("/sbin"), Path("/sys"),
        Path("/usr"), Path("/var"),
    }
    if path in forbidden or any(root == path or root in path.parents for root in protected):
        raise SystemExit(f"refusing broad/system {label}: {path}")
    symlink = first_symlink(path)
    if symlink is not None:
        raise SystemExit(f"refusing {label} through symlink component: {symlink}")
    if path.exists():
        info = path.stat()
        if not stat.S_ISDIR(info.st_mode):
            raise SystemExit(f"{label} is not a directory: {path}")
        if info.st_uid != uid:
            raise SystemExit(f"{label} is not owned by the current user: {path}")
        if info.st_mode & 0o022:
            raise SystemExit(f"{label} is writable by group or other: {path}")

target_home = lexical_absolute(raw_home)
target_codex_home = lexical_absolute(raw_codex_home)
login_home = Path(pwd.getpwuid(uid).pw_dir).absolute()

validate_path("home", target_home)
validate_path("CODEX_HOME", target_codex_home)
if not allow_nonlogin and target_home != login_home:
    raise SystemExit(
        f"--home must equal the current user's login home ({login_home}); "
        "use --allow-nonlogin-home only for an isolated disposable test"
    )
if target_codex_home == target_home:
    raise SystemExit("refusing to use the entire target home as CODEX_HOME")
if with_app:
    try:
        target_codex_home.relative_to(target_home)
    except ValueError:
        raise SystemExit("--with-app/--full requires CODEX_HOME to be a dedicated path inside target home")

if not dry_run:
    target_home.mkdir(mode=0o700, parents=True, exist_ok=True)
    validate_path("home", target_home)

release_root = target_home / ".local" / "share" / "drclaw" / "releases"
validate_path("release root", release_root)
print(target_home)
print(target_codex_home)
print(release_root)
PY
) || die "target path validation failed"

mapfile -t normalized_path_lines <<<"$normalized_paths"
((${#normalized_path_lines[@]} == 3)) || die "target path validation returned an invalid result"
target_home=${normalized_path_lines[0]}
codex_home=${normalized_path_lines[1]}
release_root=${normalized_path_lines[2]}

export GIT_TERMINAL_PROMPT=0
resolved_commit=""
if ((is_full_commit)); then
  resolved_commit=$release_ref
else
  remote_refs=$(git ls-remote --exit-code "$repository" \
    "refs/tags/$release_ref" "refs/tags/$release_ref^{}" 2>/dev/null) \
    || die "the exact release tag is unavailable from the repository: $release_ref"
  direct_object=""
  peeled_commit=""
  while IFS=$'\t' read -r object_id ref_name; do
    case "$ref_name" in
      "refs/tags/$release_ref") direct_object=$object_id ;;
      "refs/tags/$release_ref^{}") peeled_commit=$object_id ;;
    esac
  done <<<"$remote_refs"
  resolved_commit=${peeled_commit:-$direct_object}
  [[ "$resolved_commit" =~ ^[0-9A-Fa-f]{40}$ ]] \
    || die "the tag did not resolve to a Git object"
  resolved_commit=${resolved_commit,,}
  [[ "$resolved_commit" == "$expected_commit" ]] \
    || die "release tag moved or --expected-commit is wrong (resolved $resolved_commit)"
fi

release_checkout="$release_root/$resolved_commit"

verify_checkout() {
  local checkout=$1
  [[ ! -L "$checkout" ]] || die "release checkout must not be a symlink"
  [[ -d "$checkout" && $(stat -c '%u' "$checkout") == "$(id -u)" ]] \
    || die "release checkout must be a current-user-owned directory"
  [[ -d "$checkout/.git" && ! -L "$checkout/.git" ]] \
    || die "release checkout must contain a real .git directory"
  local checkout_head
  checkout_head=$(git -C "$checkout" rev-parse --verify HEAD^{commit} 2>/dev/null) \
    || die "cannot resolve the release checkout HEAD: $checkout"
  checkout_head=${checkout_head,,}
  [[ "$checkout_head" == "$resolved_commit" ]] \
    || die "release checkout points to $checkout_head, expected $resolved_commit"
  local status
  status=$(git -C "$checkout" status --porcelain --untracked-files=all 2>/dev/null) \
    || die "cannot inspect release checkout status: $checkout"
  [[ -z "$status" ]] || die "release checkout is dirty; refusing to install from it: $checkout"

  python3 - "$checkout" "$release_ref" "$resolved_commit" <<'PY' \
    || die "release source verification failed: $checkout"
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
requested_ref = sys.argv[2]
resolved_commit = sys.argv[3]
manifest_path = root / "bootstrap" / "codex" / "manifest.json"
bootstrap_path = root / "bootstrap" / "codex" / "bootstrap.sh"

try:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
except (OSError, json.JSONDecodeError) as error:
    raise SystemExit(f"invalid bootstrap manifest: {error}")

release_ref = manifest.get("baseline", {}).get("bundle_release_ref")
if not isinstance(release_ref, str) or not release_ref:
    raise SystemExit("manifest baseline.bundle_release_ref is not an immutable release ref")
requested_is_commit = (
    len(requested_ref) == 40 and all(char in "0123456789abcdefABCDEF" for char in requested_ref)
)
if not requested_is_commit and release_ref != requested_ref:
    raise SystemExit(
        "manifest baseline.bundle_release_ref does not match the requested immutable release"
    )

required = manifest.get("required_repository_paths")
if not isinstance(required, list) or not required:
    raise SystemExit("manifest required_repository_paths is missing or empty")
for raw_path in required:
    if not isinstance(raw_path, str) or not raw_path:
        raise SystemExit("manifest contains an invalid required repository path")
    candidate = (root / raw_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise SystemExit(f"required path escapes the checkout: {raw_path}")
    if not candidate.exists():
        raise SystemExit(f"required repository path is missing: {raw_path}")

for required_path in (root / "AGENTS.md", root / "skills", bootstrap_path):
    if not required_path.exists():
        raise SystemExit(f"required bootstrap source is missing: {required_path.relative_to(root)}")
    resolved = required_path.resolve()
    try:
        resolved.relative_to(root)
    except ValueError:
        raise SystemExit(f"bootstrap source escapes the checkout: {required_path.relative_to(root)}")
if not bootstrap_path.is_file() or not os.access(bootstrap_path, os.X_OK):
    raise SystemExit("bootstrap/codex/bootstrap.sh must be an executable regular file")

source_policy = manifest.get("source_policy", {})
if not isinstance(source_policy, dict):
    raise SystemExit("manifest source_policy must be an object")
allowed_gitlinks = source_policy.get("allowed_uninitialized_gitlinks", {})
if not isinstance(allowed_gitlinks, dict):
    raise SystemExit("source_policy.allowed_uninitialized_gitlinks must be an object")
normalized_allowed_gitlinks = {}
for raw_path, raw_object in allowed_gitlinks.items():
    if not isinstance(raw_path, str) or not raw_path or not isinstance(raw_object, str):
        raise SystemExit("manifest contains an invalid allowed gitlink")
    if len(raw_object) != 40 or any(char not in "0123456789abcdefABCDEF" for char in raw_object):
        raise SystemExit(f"allowed gitlink has an invalid object id: {raw_path}")
    candidate = (root / raw_path).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise SystemExit(f"allowed gitlink escapes the checkout: {raw_path}")
    normalized_allowed_gitlinks[raw_path] = raw_object.lower()

index = subprocess.run(
    ["git", "-C", str(root), "ls-files", "--stage", "-z"],
    check=True,
    capture_output=True,
).stdout
actual_gitlinks = {}
for entry in index.split(b"\0"):
    if not entry:
        continue
    try:
        header, encoded_path = entry.split(b"\t", 1)
        mode, object_id, _stage = header.decode("ascii").split()
        tracked_path = encoded_path.decode("utf-8")
    except (UnicodeDecodeError, ValueError):
        raise SystemExit("release index contains an unsupported path encoding")
    if mode == "160000":
        actual_gitlinks[tracked_path] = object_id.lower()

if actual_gitlinks != normalized_allowed_gitlinks:
    raise SystemExit("release gitlinks do not exactly match the manifest allowlist")
for tracked_path in actual_gitlinks:
    candidate = root / tracked_path
    if candidate.is_symlink():
        raise SystemExit(f"allowed gitlink is a symlink: {tracked_path}")
    if candidate.exists() and (not candidate.is_dir() or any(candidate.iterdir())):
        raise SystemExit(f"allowed gitlink must remain uninitialized: {tracked_path}")
PY

  if git -C "$checkout" ls-files --stage | grep '^120000 ' >/dev/null; then
    die "release contains tracked symlinks; this installer requires a self-contained regular-file tree"
  fi
}

materialize_manifest_release_ref() {
  local checkout=$1
  local materialize=${2:-1}
  local manifest_release_ref
  manifest_release_ref=$(python3 - "$checkout/bootstrap/codex/manifest.json" <<'PY'
import json
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
value = manifest.get("baseline", {}).get("bundle_release_ref")
if not isinstance(value, str) or not value:
    raise SystemExit("manifest baseline.bundle_release_ref is not an immutable release ref")
if "\n" in value or "\r" in value or "\x00" in value:
    raise SystemExit("manifest baseline.bundle_release_ref contains a forbidden control character")
print(value)
PY
  ) || die "cannot read the manifest release ref from $checkout"

  if [[ "$manifest_release_ref" =~ ^[0-9A-Fa-f]{40}$ ]]; then
    local manifest_commit=${manifest_release_ref,,}
    [[ "$manifest_commit" == "$resolved_commit" ]] \
      || die "manifest release commit $manifest_commit does not match approved commit $resolved_commit"
    return
  fi

  git check-ref-format "refs/tags/$manifest_release_ref" >/dev/null 2>&1 \
    || die "manifest baseline.bundle_release_ref is not a valid exact tag"

  local manifest_remote_refs
  manifest_remote_refs=$(git ls-remote --exit-code "$repository" \
    "refs/tags/$manifest_release_ref" "refs/tags/$manifest_release_ref^{}" 2>/dev/null) \
    || die "the manifest release tag is unavailable from the repository: $manifest_release_ref"
  local direct_object=""
  local peeled_commit=""
  local object_id
  local ref_name
  while IFS=$'\t' read -r object_id ref_name; do
    case "$ref_name" in
      "refs/tags/$manifest_release_ref") direct_object=$object_id ;;
      "refs/tags/$manifest_release_ref^{}") peeled_commit=$object_id ;;
    esac
  done <<<"$manifest_remote_refs"
  local manifest_commit=${peeled_commit:-$direct_object}
  [[ "$manifest_commit" =~ ^[0-9A-Fa-f]{40}$ ]] \
    || die "the manifest release tag did not resolve to a Git object"
  manifest_commit=${manifest_commit,,}
  [[ "$manifest_commit" == "$resolved_commit" ]] \
    || die "manifest release tag $manifest_release_ref resolves to $manifest_commit, expected $resolved_commit"

  if ((materialize == 0)); then
    return
  fi

  git -C "$checkout" fetch --quiet --depth 1 "$repository" \
    "refs/tags/$manifest_release_ref:refs/tags/$manifest_release_ref" 2>/dev/null \
    || die "cannot materialize verified manifest release tag $manifest_release_ref"
  local local_manifest_commit
  local_manifest_commit=$(git -C "$checkout" rev-parse --verify "$manifest_release_ref^{commit}" 2>/dev/null) \
    || die "cannot resolve materialized manifest release tag $manifest_release_ref"
  local_manifest_commit=${local_manifest_commit,,}
  [[ "$local_manifest_commit" == "$resolved_commit" ]] \
    || die "materialized manifest release tag changed during fetch (resolved $local_manifest_commit)"
}

if ((dry_run)); then
  note "DRY-RUN target user: $(id -un) (uid $(id -u))"
  note "DRY-RUN immutable source: $repository_label @ $resolved_commit"
  note "DRY-RUN versioned checkout: $release_checkout"
  if [[ -e "$release_checkout" ]]; then
    verify_checkout "$release_checkout"
    materialize_manifest_release_ref "$release_checkout" 0
    verify_checkout "$release_checkout"
    note "DRY-RUN existing checkout is clean and verified"
  else
    dry_run_checkout=$(mktemp -d /tmp/drclaw-remote-dry-run.XXXXXXXX)
    git -C "$dry_run_checkout" init --quiet
    git -C "$dry_run_checkout" remote add origin "$repository"
    if ((is_full_commit)); then
      git -C "$dry_run_checkout" fetch --quiet --depth 1 origin "$resolved_commit" 2>/dev/null \
        || die "cannot fetch approved commit $resolved_commit"
    else
      git -C "$dry_run_checkout" fetch --quiet --depth 1 origin "refs/tags/$release_ref" 2>/dev/null \
        || die "cannot fetch approved tag $release_ref"
    fi
    git -C "$dry_run_checkout" checkout --quiet --detach "$resolved_commit" \
      || die "cannot check out approved commit $resolved_commit"
    verify_checkout "$dry_run_checkout"
    materialize_manifest_release_ref "$dry_run_checkout" 0
    verify_checkout "$dry_run_checkout"
    note "DRY-RUN temporary source is clean and verified; target checkout remains absent"
    release_checkout=$dry_run_checkout
  fi
else
  mkdir -p -- "$release_root"
  [[ $(stat -c '%u' "$release_root") == "$(id -u)" ]] \
    || die "release root is not owned by the current user: $release_root"
  if [[ -e "$release_checkout" ]]; then
    verify_checkout "$release_checkout"
    materialize_manifest_release_ref "$release_checkout"
    verify_checkout "$release_checkout"
    note "reusing verified release checkout $release_checkout"
  else
    temporary_checkout=$(mktemp -d "$release_root/.incoming.XXXXXXXX")
    git -C "$temporary_checkout" init --quiet
    git -C "$temporary_checkout" remote add origin "$repository"
    if ((is_full_commit)); then
      git -C "$temporary_checkout" fetch --quiet --depth 1 origin "$resolved_commit" 2>/dev/null \
        || die "cannot fetch approved commit $resolved_commit"
    else
      git -C "$temporary_checkout" fetch --quiet --depth 1 origin "refs/tags/$release_ref" 2>/dev/null \
        || die "cannot fetch approved tag $release_ref"
    fi
    git -C "$temporary_checkout" checkout --quiet --detach "$resolved_commit" \
      || die "cannot check out approved commit $resolved_commit"
    verify_checkout "$temporary_checkout"
    materialize_manifest_release_ref "$temporary_checkout"
    verify_checkout "$temporary_checkout"
    if [[ -e "$release_checkout" ]]; then
      verify_checkout "$release_checkout"
      materialize_manifest_release_ref "$release_checkout"
      verify_checkout "$release_checkout"
      note "another installer published the same verified checkout; reusing it"
    else
      mv -- "$temporary_checkout" "$release_checkout"
      temporary_checkout=""
      verify_checkout "$release_checkout"
      note "published verified release checkout $release_checkout"
    fi
  fi
fi

bootstrap_arguments=(
  install
  --home "$target_home"
  --codex-home "$codex_home"
  --config-profile "$config_profile"
)
((install_codex)) && bootstrap_arguments+=(--install-codex)
((install_plugins)) && bootstrap_arguments+=(--install-plugins)
((copy_skills)) && bootstrap_arguments+=(--copy-skills)
((replace_existing)) && bootstrap_arguments+=(--replace)
((skip_delta_skill)) && bootstrap_arguments+=(--skip-delta-skill)
((with_drclaw_cli)) && bootstrap_arguments+=(--with-drclaw-cli)
((no_doctor)) && bootstrap_arguments+=(--no-doctor)
((dry_run)) && bootstrap_arguments+=(--dry-run)

if ((install_codex)); then
  selected_codex_release=$codex_release
  if [[ "$selected_codex_release" == "manifest" ]]; then
    selected_codex_release=$(python3 - "$release_checkout/bootstrap/codex/manifest.json" <<'PY'
import json
import re
import sys
from pathlib import Path

manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
versions = manifest.get("requirements", {}).get("codex_cli_audited_versions")
if (
    not isinstance(versions, list)
    or not versions
    or any(
        not isinstance(version, str)
        or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version) is None
        for version in versions
    )
):
    raise SystemExit(
        "manifest requirements.codex_cli_audited_versions must be a non-empty X.Y.Z array"
    )
selected = max(versions, key=lambda version: tuple(int(part) for part in version.split(".")))
print(selected)
PY
    ) || die "cannot resolve the manifest-audited Codex release"
  fi
  if [[ "$selected_codex_release" == "latest" ]]; then
    unset CODEX_RELEASE
    note "fresh Codex install policy: current official release"
  else
    export CODEX_RELEASE="$selected_codex_release"
    note "fresh Codex install policy: pinned Codex $selected_codex_release"
  fi
fi

export HOME="$target_home"
export CODEX_HOME="$codex_home"
note "invoking the verified bundled bootstrap"
(
  cd "$release_checkout"
  bash "$release_checkout/bootstrap/codex/bootstrap.sh" "${bootstrap_arguments[@]}"
)

if ((with_app)); then
  app_arguments=(
    --repo-root "$release_checkout"
    install
    --home "$target_home"
    --codex-home "$codex_home"
    --service "$app_service"
  )
  ((start_app)) && app_arguments+=(--start)
  ((replace_existing)) && app_arguments+=(--replace)
  ((no_doctor)) && app_arguments+=(--no-doctor)
  ((dry_run)) && app_arguments+=(--dry-run)
  note "installing the pinned Dr. Claw Web application layer"
  (
    cd "$release_checkout"
    python3 "$release_checkout/bootstrap/codex/install_app.py" "${app_arguments[@]}"
  )
fi

verify_checkout "$release_checkout"
note "complete: source remains clean at $resolved_commit"
if ((dry_run)); then
  note "DRY-RUN complete: target HOME and CODEX_HOME were not provisioned"
else
  note "installation receipt: $codex_home/drclaw-bootstrap-state.json"
  if ((with_app)); then
    note "application receipt: $target_home/.local/state/drclaw/app-bootstrap-state.json"
  fi
fi
