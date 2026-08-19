#!/usr/bin/env bash
set -Eeuo pipefail

if ((BASH_VERSINFO[0] < 4)); then
  printf 'ERROR: Bash 4.0 or newer is required\n' >&2
  exit 2
fi

# This entrypoint is intentionally self-contained: it is designed to be piped
# from a raw URL pinned to the same immutable Git revision that it installs.
umask 077
unset PYTHONHOME PYTHONPATH
export PYTHONDONTWRITEBYTECODE=1
export PYTHONNOUSERSITE=1
export GIT_OPTIONAL_LOCKS=0

readonly DEFAULT_REPOSITORY="https://github.com/OpenLAIR/dr-claw.git"
readonly SUPPORTED_SERVER_OS="Linux"
readonly SUPPORTED_ARCHITECTURES_CSV="x86_64,aarch64"
readonly MINIMUM_GIT_VERSION="2.25.0"
readonly CORE_MINIMUM_FREE_BYTES=1073741824
readonly FULL_MINIMUM_FREE_BYTES=8589934592
readonly APP_GLIBC_MINIMUM="2.28"

release_ref=""
expected_commit=""
expected_tag_object=""
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
delta_skill_policy="auto"
delta_skill_policy_was_set=0
skip_delta_skill=0
with_drclaw_cli=0
with_app=0
app_service="auto"
start_app=0
no_doctor=0
skip_space_check=0
minimum_free_bytes=""
temporary_checkout=""
dry_run_checkout=""
tag_probe_checkout=""
release_root=""
safe_temp_root=""
git_boolean_fsmonitor=0

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
  --expected-tag-object SHA  Optional annotated-tag object pin (the offline kit
                             always supplies it).
  --repo-url URL             Git repository (default: public Dr. Claw GitHub).

Target and bootstrap options:
  --home PATH                Target home (defaults to the current user's HOME).
  --codex-home PATH          Dedicated CODEX_HOME inside <home> (default:
                             <home>/.codex); external/shared paths unsupported.
  --config-profile PROFILE   safe (default), preserve, or current-delta.
  --codex-release VERSION    Fresh-install Codex version: manifest (default),
                             an explicit X.Y.Z, or latest.
  --copy-skills              Copy the managed entry skills instead of linking.
  --replace                  Archive and replace conflicting managed skills.
  --skip-delta-skill         Never install the NCSA Delta skill on this host.
  --include-delta-skill      Install the NCSA Delta skill even off Delta. The
                             default is auto: include only on verified Delta.
  --install-plugins          Ask Codex to install the approved plugin baseline.
  --with-drclaw-cli          Install the revision-specific, hash-locked drclaw
                             CLI in its managed virtual environment.
  --with-app                 Install the pinned Node runtime and Dr. Claw Web.
  --full                     Install both the drclaw CLI and Dr. Claw Web.
  --app-service MODE         auto (default), user-systemd, or none; never starts
                             unless --start-app is also supplied.
  --start-app                Explicitly start the Web user service after install.
  --skip-codex-install       Require an existing Codex instead of installing it.
  --no-doctor                Skip the strict post-install pre-activation gate.

Safety and preview:
  --dry-run                  Resolve/verify the ref and preview without writes.
  --allow-nonlogin-home      Explicit interlock for an isolated disposable HOME.
  --skip-space-check         Advanced override: skip the conservative free-space
                             gate and emit a warning.
  --minimum-free-bytes N     Raise (never lower) the free-space threshold; useful
                             for stricter sites and deterministic validation.
  -h, --help                 Show this help.

Network policy:
  Direct access, credential-free HTTP(S)_PROXY/NO_PROXY, and one optional
  DRCLAW_CA_BUNDLE are supported. Credential-bearing proxies and alternate
  custom-CA environment variables are rejected without printing their values.

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

git_safe() (
  # Repository/global config is not part of the immutable release contract.
  # Disable active integrations for both verification and temporary checkout;
  # SSH agent authentication and the explicit CA/proxy environment still work.
  unset GIT_CONFIG GIT_CONFIG_COUNT GIT_CONFIG_PARAMETERS GIT_CONFIG_SYSTEM
  export GIT_CONFIG_GLOBAL=/dev/null
  export GIT_CONFIG_NOSYSTEM=1
  export LC_ALL=C
  local -a safe_configuration=(-c core.hooksPath=/dev/null)
  if ((git_boolean_fsmonitor)); then
    safe_configuration+=(-c core.fsmonitor=false)
  fi
  command git "${safe_configuration[@]}" "$@"
)

cleanup() {
  if [[ -n "$dry_run_checkout" && -n "$safe_temp_root" ]]; then
    case "$dry_run_checkout" in
      "$safe_temp_root"/drclaw-remote-dry-run.*)
        if [[ -d "$dry_run_checkout" ]]; then
          rm -rf -- "$dry_run_checkout"
        fi
        ;;
    esac
  fi
  if [[ -n "$tag_probe_checkout" && -n "$safe_temp_root" ]]; then
    case "$tag_probe_checkout" in
      "$safe_temp_root"/drclaw-tag-probe.*)
        if [[ -d "$tag_probe_checkout" ]]; then
          rm -rf -- "$tag_probe_checkout"
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
    --expected-tag-object)
      (($# >= 2)) || die "--expected-tag-object requires a value"
      expected_tag_object=$2
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
      if ((delta_skill_policy_was_set)) && [[ "$delta_skill_policy" != "skip" ]]; then
        die "--skip-delta-skill conflicts with --include-delta-skill"
      fi
      delta_skill_policy="skip"
      delta_skill_policy_was_set=1
      shift
      ;;
    --include-delta-skill)
      if ((delta_skill_policy_was_set)) && [[ "$delta_skill_policy" != "include" ]]; then
        die "--include-delta-skill conflicts with --skip-delta-skill"
      fi
      delta_skill_policy="include"
      delta_skill_policy_was_set=1
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
    --skip-space-check)
      skip_space_check=1
      shift
      ;;
    --minimum-free-bytes)
      (($# >= 2)) || die "--minimum-free-bytes requires a value"
      minimum_free_bytes=$2
      shift 2
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
if [[ -n "$minimum_free_bytes" && ! "$minimum_free_bytes" =~ ^[0-9]+$ ]]; then
  die "--minimum-free-bytes must be a non-negative base-10 integer"
fi
if ((skip_space_check)) && [[ -n "$minimum_free_bytes" ]]; then
  die "--skip-space-check conflicts with --minimum-free-bytes"
fi

for command_name in git python3 hostname uname stat mktemp id mkdir mv rm grep; do
  command -v "$command_name" >/dev/null 2>&1 || die "required command is missing: $command_name"
done
stat_version_output=$(stat --version 2>/dev/null || true)
mktemp_version_output=$(mktemp --version 2>/dev/null || true)
mv_version_output=$(mv --version 2>/dev/null || true)
[[ "$stat_version_output" == *"GNU coreutils"* ]] \
  || die "GNU coreutils stat with -c semantics is required"
[[ "$mktemp_version_output" == *"GNU coreutils"* ]] \
  || die "GNU coreutils mktemp is required"
[[ "$mv_version_output" == *"GNU coreutils"* ]] \
  || die "GNU coreutils mv with -T semantics is required"
stat_uid_probe=$(stat -c '%u' / 2>/dev/null) \
  || die "GNU stat -c capability probe failed"
[[ "$stat_uid_probe" =~ ^[0-9]+$ ]] \
  || die "GNU stat -c capability probe returned an invalid result"

python3 - <<'PY' || die "Python 3.9 or newer is required"
import sys
raise SystemExit(0 if sys.version_info >= (3, 9) else 1)
PY

# Accept one explicit custom trust root and reject the many implicit variables
# that otherwise make Git, Python, pip, curl, Node, and npm disagree.  Values
# are never printed because proxy credentials and local CA paths can be
# sensitive even when they are rejected.
for alternate_ca_variable in \
  SSL_CERT_FILE SSL_CERT_DIR REQUESTS_CA_BUNDLE CURL_CA_BUNDLE AWS_CA_BUNDLE \
  GIT_SSL_CAINFO PIP_CERT NODE_EXTRA_CA_CERTS npm_config_cafile \
  NPM_CONFIG_CAFILE; do
  if declare -p "$alternate_ca_variable" >/dev/null 2>&1; then
    die "unsupported custom CA environment variable is set: $alternate_ca_variable; use DRCLAW_CA_BUNDLE"
  fi
done
for unsupported_network_variable in \
  ALL_PROXY all_proxy PIP_INDEX_URL PIP_EXTRA_INDEX_URL PIP_TRUSTED_HOST \
  NPM_CONFIG_REGISTRY npm_config_registry NPM_CONFIG_PROXY npm_config_proxy \
  NPM_CONFIG_HTTPS_PROXY npm_config_https_proxy; do
  if declare -p "$unsupported_network_variable" >/dev/null 2>&1; then
    die "unsupported proxy or private-mirror environment variable is set: $unsupported_network_variable"
  fi
done

network_status=$(python3 - <<'PY'
import os
import sys
from urllib.parse import urlsplit

def fail(message: str) -> None:
    print(f"network environment policy failed: {message}", file=sys.stderr)
    raise SystemExit(1)

def present(name: str):
    return os.environ.get(name) if name in os.environ else None

proxy_states = []
for upper, lower, label in (
    ("HTTP_PROXY", "http_proxy", "http_proxy"),
    ("HTTPS_PROXY", "https_proxy", "https_proxy"),
):
    upper_value = present(upper)
    lower_value = present(lower)
    if upper_value is not None and lower_value is not None and upper_value != lower_value:
        fail(f"{upper} and {lower} disagree")
    value = upper_value if upper_value is not None else lower_value
    if value is None:
        proxy_states.append(f"{label}=direct")
        continue
    if not value or any(character in value for character in ("\n", "\r", "\x00")):
        fail(f"{upper}/{lower} is empty or contains a forbidden control character")
    try:
        parsed = urlsplit(value)
        parsed.port
    except ValueError:
        fail(f"{upper}/{lower} is not a valid credential-free proxy URL")
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        fail(f"{upper}/{lower} is not a valid credential-free HTTP(S) proxy URL")
    proxy_states.append(f"{label}=configured")

no_proxy_values = [present("NO_PROXY"), present("no_proxy")]
if no_proxy_values[0] is not None and no_proxy_values[1] is not None \
        and no_proxy_values[0] != no_proxy_values[1]:
    fail("NO_PROXY and no_proxy disagree")
no_proxy = no_proxy_values[0] if no_proxy_values[0] is not None else no_proxy_values[1]
if no_proxy is None:
    proxy_states.append("no_proxy=unset")
elif any(character in no_proxy for character in ("\n", "\r", "\x00")):
    fail("NO_PROXY/no_proxy contains a forbidden control character")
else:
    proxy_states.append("no_proxy=configured")

print(",".join(proxy_states))
PY
) || die "network environment failed the credential-safe policy"
# Bound stalled HTTP(S) Git transfers without changing SSH authentication,
# credential helpers, or local-bundle behavior.
export GIT_HTTP_LOW_SPEED_LIMIT=1024
export GIT_HTTP_LOW_SPEED_TIME=30

ca_status="system"
if [[ -n ${DRCLAW_CA_BUNDLE+x} ]]; then
  custom_ca_bundle=$(python3 - "drclaw-ca-path-v1" "$target_home" <<'PY'
import os
import stat
import subprocess
import sys
from pathlib import Path

target_home = Path(os.path.abspath(os.path.expanduser(sys.argv[2])))


def validate_target_home_acl(path: Path) -> None:
    getfacl = Path("/usr/bin/getfacl")
    current = Path("/")
    for part in getfacl.parts[1:]:
        current /= part
        try:
            info = current.lstat()
        except OSError:
            raise SystemExit(
                "root-owned ACL target HOME requires /usr/bin/getfacl; install the acl package"
            )
        expected_type = stat.S_ISREG if current == getfacl else stat.S_ISDIR
        if stat.S_ISLNK(info.st_mode) or not expected_type(info.st_mode):
            raise SystemExit("trusted /usr/bin/getfacl path has an unsafe file type")
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise SystemExit("trusted /usr/bin/getfacl path must be root-owned and nonwritable")
    try:
        result = subprocess.run(
            [str(getfacl), "-cpn", "--", str(path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SystemExit("target HOME ACL inspection failed closed")
    if result.returncode != 0:
        raise SystemExit("target HOME ACL inspection failed closed")

    entries = {}
    for raw_line in result.stdout.splitlines():
        entry = raw_line.split("#", 1)[0].strip()
        if not entry:
            continue
        scope = "access"
        if entry.startswith("default:"):
            scope = "default"
            entry = entry.removeprefix("default:")
        fields = entry.split(":")
        if len(fields) != 3:
            raise SystemExit("target HOME ACL output is malformed")
        kind, qualifier, permissions = fields
        if kind not in {"user", "group", "mask", "other"}:
            raise SystemExit("target HOME ACL output contains an unknown entry")
        if kind in {"mask", "other"} and qualifier:
            raise SystemExit("target HOME ACL output is malformed")
        if kind in {"user", "group"} and qualifier:
            if not qualifier.isascii() or not qualifier.isdecimal():
                raise SystemExit("target HOME ACL identities must be numeric")
            qualifier_value = int(qualifier, 10)
        else:
            qualifier_value = None
        if (
            len(permissions) != 3
            or permissions[0] not in "r-"
            or permissions[1] not in "w-"
            or permissions[2] not in "x-"
        ):
            raise SystemExit("target HOME ACL permissions are malformed")
        key = (scope, kind, qualifier_value)
        if key in entries:
            raise SystemExit("target HOME ACL contains duplicate entries")
        entries[key] = frozenset(
            permission
            for permission, enabled in zip("rwx", permissions)
            if enabled != "-"
        )

    def required(scope: str, kind: str, qualifier=None):
        key = (scope, kind, qualifier)
        if key not in entries:
            raise SystemExit("target HOME ACL is missing a required entry")
        return entries[key]

    def effective(scope: str, kind: str, qualifier=None):
        permissions = required(scope, kind, qualifier)
        if kind == "other" or (kind == "user" and qualifier is None):
            return permissions
        mask = entries.get((scope, "mask", None))
        return permissions if mask is None else permissions & mask

    uid = os.geteuid()
    access_named = [
        key
        for key in entries
        if key[0] == "access"
        and key[1] in {"user", "group"}
        and key[2] is not None
    ]
    required("access", "user")
    required("access", "group")
    required("access", "other")
    if access_named:
        required("access", "mask")
    if effective("access", "user", uid) != frozenset("rwx"):
        raise SystemExit("target HOME ACL must grant the target user effective rwx")
    if "w" in effective("access", "group") or "w" in effective("access", "other"):
        raise SystemExit("target HOME ACL grants foreign effective write access")
    for scope, kind, qualifier in access_named:
        if kind == "user" and qualifier == uid:
            continue
        if "w" in effective(scope, kind, qualifier):
            raise SystemExit("target HOME ACL grants foreign effective write access")

    default_keys = [key for key in entries if key[0] == "default"]
    if default_keys:
        required("default", "user")
        required("default", "group")
        required("default", "other")
        default_named = [
            key
            for key in default_keys
            if key[1] in {"user", "group"} and key[2] is not None
        ]
        if default_named:
            required("default", "mask")
        if "w" in effective("default", "group") or "w" in effective("default", "other"):
            raise SystemExit("target HOME default ACL grants foreign effective write access")
        for scope, kind, qualifier in default_named:
            if kind == "user" and qualifier == uid:
                continue
            if "w" in effective(scope, kind, qualifier):
                raise SystemExit("target HOME default ACL grants foreign effective write access")


raw = os.environ.get("DRCLAW_CA_BUNDLE", "")
if not raw or any(character in raw for character in ("\n", "\r", "\x00")):
    raise SystemExit("DRCLAW_CA_BUNDLE must be a non-empty absolute path without control characters")
path = Path(raw)
if not path.is_absolute():
    raise SystemExit("DRCLAW_CA_BUNDLE must be an absolute path")
current = Path(path.anchor)
for part in path.parts[1:]:
    current /= part
    try:
        info = current.lstat()
    except OSError:
        raise SystemExit("DRCLAW_CA_BUNDLE cannot be inspected")
    if stat.S_ISLNK(info.st_mode):
        raise SystemExit("DRCLAW_CA_BUNDLE must not traverse a symlink")
    if current != path:
        if not stat.S_ISDIR(info.st_mode):
            raise SystemExit("DRCLAW_CA_BUNDLE ancestors must be real directories")
        mode = stat.S_IMODE(info.st_mode)
        owned_nonwritable = info.st_uid in {0, os.geteuid()} and mode & 0o022 == 0
        root_sticky_shared = info.st_uid == 0 and mode & stat.S_ISVTX != 0
        target_home_acl = current == target_home and info.st_uid == 0
        if target_home_acl:
            validate_target_home_acl(current)
        elif not (owned_nonwritable or root_sticky_shared):
            raise SystemExit("DRCLAW_CA_BUNDLE has an untrusted writable ancestor")
info = path.stat()
if not stat.S_ISREG(info.st_mode):
    raise SystemExit("DRCLAW_CA_BUNDLE must be a regular file")
if info.st_uid not in {0, os.geteuid()}:
    raise SystemExit("DRCLAW_CA_BUNDLE must be owned by root or the target user")
if info.st_mode & 0o022:
    raise SystemExit("DRCLAW_CA_BUNDLE must not be writable by group or other")
if not os.access(path, os.R_OK):
    raise SystemExit("DRCLAW_CA_BUNDLE is not readable")
print(path)
PY
  ) || die "DRCLAW_CA_BUNDLE failed the local trust-file policy"
  export GIT_SSL_CAINFO="$custom_ca_bundle"
  export SSL_CERT_FILE="$custom_ca_bundle"
  export CURL_CA_BUNDLE="$custom_ca_bundle"
  export PIP_CERT="$custom_ca_bundle"
  export NODE_EXTRA_CA_CERTS="$custom_ca_bundle"
  ca_status="custom"
fi

require_python_ssl=0
if ((install_codex || with_drclaw_cli || with_app)); then
  require_python_ssl=1
fi
python_stdlib_status=$(python3 - "drclaw-python-stdlib-v1" \
  "$require_python_ssl" "$with_app" <<'PY'
import io
import sys

require_ssl = sys.argv[2] == "1"
require_app_xz = sys.argv[3] == "1"

def fail(message: str) -> None:
    print(f"Python standard-library capability failed: {message}", file=sys.stderr)
    raise SystemExit(1)

ssl_status = "not-required"
if require_ssl:
    try:
        import ssl
        context = ssl.create_default_context()
        if context is None:
            fail("ssl.create_default_context returned no context")
    except Exception:
        fail("ssl import and default trust context are required for the selected install")
    ssl_status = "verified"

xz_status = "not-required"
if require_app_xz:
    try:
        import lzma
        import tarfile

        payload = b"drclaw-python-xz-capability-probe\n"
        compressed = lzma.compress(payload, format=lzma.FORMAT_XZ)
        if lzma.decompress(compressed, format=lzma.FORMAT_XZ) != payload:
            fail("lzma XZ roundtrip returned different bytes")

        archive = io.BytesIO()
        member = tarfile.TarInfo("probe.txt")
        member.size = len(payload)
        member.mode = 0o600
        member.mtime = 0
        with tarfile.open(fileobj=archive, mode="w:xz") as output:
            output.addfile(member, io.BytesIO(payload))
        archive.seek(0)
        with tarfile.open(fileobj=archive, mode="r:xz") as source:
            extracted = source.extractfile("probe.txt")
            if extracted is None or extracted.read() != payload:
                fail("tarfile XZ roundtrip returned different bytes")
    except Exception:
        fail("lzma and tarfile XZ support are required for --with-app/--full")
    xz_status = "verified"

print(f"ssl={ssl_status},app_xz={xz_status}")
PY
) || die "Python standard-library capability preflight failed"

((EUID != 0)) || die "refusing to provision as root; become the final target user first"

os_name=$(uname -s 2>/dev/null) || die "cannot determine the target operating system"
[[ "$os_name" == "$SUPPORTED_SERVER_OS" ]] \
  || die "unsupported operating system; this bootstrap requires Linux"
raw_arch=$(uname -m 2>/dev/null) || die "cannot determine the target architecture"
case "${raw_arch,,}" in
  x86_64|amd64) normalized_arch="x86_64" ;;
  aarch64|arm64) normalized_arch="aarch64" ;;
  *) die "unsupported Linux architecture; expected x86_64/amd64 or aarch64/arm64" ;;
esac

git_version_output=$(git --version 2>/dev/null) || die "cannot determine the Git version"
if [[ "$git_version_output" =~ ^git[[:space:]]version[[:space:]]([0-9]+)\.([0-9]+)(\.([0-9]+))?([.-][0-9A-Za-z.-]+)?$ ]]; then
  git_major=${BASH_REMATCH[1]}
  git_minor=${BASH_REMATCH[2]}
  git_patch=${BASH_REMATCH[4]:-0}
else
  die "cannot parse the Git version; require Git $MINIMUM_GIT_VERSION or newer"
fi
IFS=. read -r minimum_git_major minimum_git_minor minimum_git_patch \
  <<<"$MINIMUM_GIT_VERSION"
if ((git_major < minimum_git_major \
  || (git_major == minimum_git_major && git_minor < minimum_git_minor) \
  || (git_major == minimum_git_major && git_minor == minimum_git_minor \
    && git_patch < minimum_git_patch))); then
  die "Git $MINIMUM_GIT_VERSION or newer is required"
fi
git_version="$git_major.$git_minor.$git_patch"
if ((git_major > 2 || (git_major == 2 && git_minor >= 36))); then
  git_boolean_fsmonitor=1
fi

glibc_version="not-required"
if ((with_app)); then
  command -v getconf >/dev/null 2>&1 \
    || die "--with-app/--full requires glibc $APP_GLIBC_MINIMUM or newer"
  glibc_output=$(getconf GNU_LIBC_VERSION 2>/dev/null) \
    || die "--with-app/--full requires glibc $APP_GLIBC_MINIMUM or newer (musl/unknown libc is unsupported)"
  if [[ "$glibc_output" =~ ^glibc[[:space:]]([0-9]+)\.([0-9]+)$ ]]; then
    glibc_major=${BASH_REMATCH[1]}
    glibc_minor=${BASH_REMATCH[2]}
  else
    die "cannot parse glibc capability; --with-app/--full requires glibc $APP_GLIBC_MINIMUM or newer"
  fi
  IFS=. read -r minimum_glibc_major minimum_glibc_minor <<<"$APP_GLIBC_MINIMUM"
  if ((glibc_major < minimum_glibc_major \
    || (glibc_major == minimum_glibc_major && glibc_minor < minimum_glibc_minor))); then
    die "--with-app/--full requires glibc $APP_GLIBC_MINIMUM or newer"
  fi
  glibc_version="$glibc_major.$glibc_minor"
fi

is_verified_delta=0
delta_probe_output=$(python3 - "drclaw-delta-probe-v1" <<'PY'
import os
import re
import shutil
import subprocess
import sys

safe_environment = {
    "PATH": os.environ.get("PATH", ""),
    "LANG": "C",
    "LC_ALL": "C",
}

def run_probe(command, timeout):
    try:
        result = subprocess.run(
            command,
            check=False,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=timeout,
            env=safe_environment,
        )
    except subprocess.TimeoutExpired:
        return "", "timeout"
    except OSError:
        return "", "error"
    if result.returncode != 0:
        return "", "failed"
    return result.stdout, "ok"

hostname_output, hostname_status = run_probe(["hostname", "-f"], 5.0)
hostname = hostname_output.strip() if hostname_status == "ok" else ""
if "\n" in hostname or "\r" in hostname or "\x00" in hostname:
    hostname = ""
    hostname_status = "invalid"

cluster = ""
scontrol_status = "missing"
scontrol = shutil.which("scontrol", path=safe_environment["PATH"])
if scontrol:
    config_output, scontrol_status = run_probe([scontrol, "show", "config"], 10.0)
    if scontrol_status == "ok":
        for line in config_output.splitlines():
            match = re.match(r"^\s*[Cc]luster[Nn]ame\s*=\s*([^\s]+)", line)
            if match:
                cluster = match.group(1)
                break

print(hostname)
print(cluster)
print(f"hostname-{hostname_status},scontrol-{scontrol_status}")
PY
) || die "Delta identity capability probe failed"
mapfile -t delta_probe_lines <<<"$delta_probe_output"
((${#delta_probe_lines[@]} == 3)) || die "Delta identity capability probe returned an invalid result"
delta_hostname=${delta_probe_lines[0]}
delta_cluster=${delta_probe_lines[1]}
delta_probe_status=${delta_probe_lines[2]}
if [[ "${delta_hostname,,}" =~ (^|\.)delta\.ncsa\.illinois\.edu$ \
  && "$normalized_arch" == "x86_64" && "${delta_cluster,,}" == "delta" ]]; then
  is_verified_delta=1
fi
if [[ "$config_profile" == "current-delta" && "$is_verified_delta" != "1" ]]; then
  die "--config-profile current-delta requires a live verified NCSA Delta x86_64 host"
fi
case "$delta_skill_policy" in
  auto)
    if ((is_verified_delta)); then
      skip_delta_skill=0
      delta_skill_decision="included-auto-verified"
    else
      skip_delta_skill=1
      delta_skill_decision="omitted-auto-unverified"
    fi
    ;;
  include)
    skip_delta_skill=0
    delta_skill_decision="included-explicit"
    ;;
  skip)
    skip_delta_skill=1
    delta_skill_decision="omitted-explicit"
    ;;
  *) die "internal Delta skill policy error" ;;
esac
note "capability os=linux arch=$normalized_arch bash=${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]} git=$git_version gnu_coreutils=verified python_${python_stdlib_status} glibc=$glibc_version network=credential-safe proxy=$network_status ca=$ca_status delta_probe=$delta_probe_status delta_verified=$is_verified_delta delta_skill=$delta_skill_decision"

repository_metadata=$(python3 - "$repository" <<'PY'
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
    print("local" if parsed.scheme == "file" else "remote")
    print(value)
elif re.match(r"^[^/\\s@]+@[^/:\\s]+:", value):
    if not value.startswith("git@"):
        raise SystemExit("scp-style repository URLs may use only the non-secret git username")
    host = value.split("@", 1)[1].split(":", 1)[0]
    print(f"ssh Git repository host={host}")
    print("remote")
    print(value)
else:
    # Local paths are useful for air-gapped mirrors and isolated tests. Never
    # echo the caller-controlled path because path components can be sensitive.
    if not value or value.startswith("-"):
        raise SystemExit("local repository path must be non-empty and must not begin with a dash")
    print("local Git repository")
    print("local")
    print(os.path.abspath(value))
PY
) || die "repository location failed the credential-safe policy"
mapfile -t repository_metadata_lines <<<"$repository_metadata"
((${#repository_metadata_lines[@]} == 3)) \
  || die "repository location policy returned an invalid result"
repository_label=${repository_metadata_lines[0]}
repository_kind=${repository_metadata_lines[1]}
repository=${repository_metadata_lines[2]}

is_full_commit=0
if [[ "$release_ref" =~ ^[0-9A-Fa-f]{40}$ ]]; then
  is_full_commit=1
  release_ref=${release_ref,,}
else
  git_safe check-ref-format "refs/tags/$release_ref" >/dev/null 2>&1 \
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
if [[ -n "$expected_tag_object" ]]; then
  [[ "$expected_tag_object" =~ ^[0-9A-Fa-f]{40}$ ]] \
    || die "--expected-tag-object must contain exactly 40 hexadecimal characters"
  expected_tag_object=${expected_tag_object,,}
  ((is_full_commit == 0)) \
    || die "--expected-tag-object is valid only when --ref is an annotated tag"
fi

if [[ -z "$codex_home" ]]; then
  codex_home="$target_home/.codex"
fi

normalized_paths=$(python3 - "drclaw-path-preflight-v1" \
  "$target_home" "$codex_home" "$allow_nonlogin_home" "$dry_run" "$with_app" \
  "$skip_space_check" "$minimum_free_bytes" "$CORE_MINIMUM_FREE_BYTES" \
  "$FULL_MINIMUM_FREE_BYTES" <<'PY'
import os
import pwd
import stat
import subprocess
import sys
from pathlib import Path

(
    raw_home,
    raw_codex_home,
    raw_allow,
    raw_dry_run,
    raw_with_app,
    raw_skip_space,
    raw_minimum_free,
    raw_core_minimum,
    raw_full_minimum,
) = sys.argv[2:]
uid = os.geteuid()
allow_nonlogin = raw_allow == "1"
dry_run = raw_dry_run == "1"
with_app = raw_with_app == "1"
skip_space = raw_skip_space == "1"

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

def validate_root_owned_acl_home(path: Path) -> None:
    getfacl = Path("/usr/bin/getfacl")
    current = Path("/")
    for part in getfacl.parts[1:]:
        current /= part
        try:
            info = current.lstat()
        except OSError:
            raise SystemExit(
                "root-owned ACL target HOME requires /usr/bin/getfacl; install the acl package"
            )
        if stat.S_ISLNK(info.st_mode):
            raise SystemExit("trusted /usr/bin/getfacl path must not traverse symlinks")
        if current == getfacl:
            if not stat.S_ISREG(info.st_mode):
                raise SystemExit("trusted /usr/bin/getfacl must be a regular file")
        elif not stat.S_ISDIR(info.st_mode):
            raise SystemExit("trusted /usr/bin/getfacl ancestors must be directories")
        if info.st_uid != 0 or info.st_mode & 0o022:
            raise SystemExit("trusted /usr/bin/getfacl path must be root-owned and nonwritable")

    try:
        result = subprocess.run(
            [str(getfacl), "-cpn", "--", str(path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=5,
            check=False,
            env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"},
        )
    except (OSError, subprocess.TimeoutExpired):
        raise SystemExit("target HOME ACL inspection failed closed")
    if result.returncode != 0:
        raise SystemExit("target HOME ACL inspection failed closed")

    entries = {}
    for raw_line in result.stdout.splitlines():
        entry = raw_line.split("#", 1)[0].strip()
        if not entry:
            continue
        scope = "access"
        if entry.startswith("default:"):
            scope = "default"
            entry = entry.removeprefix("default:")
        fields = entry.split(":")
        if len(fields) != 3:
            raise SystemExit("target HOME ACL output is malformed")
        kind, qualifier, permissions = fields
        if kind not in {"user", "group", "mask", "other"}:
            raise SystemExit("target HOME ACL output contains an unknown entry")
        if kind in {"mask", "other"} and qualifier:
            raise SystemExit("target HOME ACL output is malformed")
        if kind in {"user", "group"} and qualifier:
            if not qualifier.isascii() or not qualifier.isdecimal():
                raise SystemExit("target HOME ACL identities must be numeric")
            qualifier_value = int(qualifier, 10)
        else:
            qualifier_value = None
        if (
            len(permissions) != 3
            or permissions[0] not in "r-"
            or permissions[1] not in "w-"
            or permissions[2] not in "x-"
        ):
            raise SystemExit("target HOME ACL permissions are malformed")
        key = (scope, kind, qualifier_value)
        if key in entries:
            raise SystemExit("target HOME ACL contains duplicate entries")
        entries[key] = frozenset(
            permission
            for permission, enabled in zip("rwx", permissions)
            if enabled != "-"
        )

    def required(scope: str, kind: str, qualifier=None):
        key = (scope, kind, qualifier)
        if key not in entries:
            raise SystemExit("target HOME ACL is missing a required entry")
        return entries[key]

    def effective(scope: str, kind: str, qualifier=None):
        permissions = required(scope, kind, qualifier)
        if kind == "other" or (kind == "user" and qualifier is None):
            return permissions
        mask = entries.get((scope, "mask", None))
        return permissions if mask is None else permissions & mask

    access_named = [
        key for key in entries if key[0] == "access" and key[1] in {"user", "group"} and key[2] is not None
    ]
    required("access", "user")
    required("access", "group")
    required("access", "other")
    if access_named:
        required("access", "mask")
    if effective("access", "user", uid) != frozenset("rwx"):
        raise SystemExit("target HOME ACL must grant the target user effective rwx")
    if "w" in effective("access", "group") or "w" in effective("access", "other"):
        raise SystemExit("target HOME ACL grants foreign effective write access")
    for scope, kind, qualifier in access_named:
        if kind == "user" and qualifier == uid:
            continue
        if "w" in effective(scope, kind, qualifier):
            raise SystemExit("target HOME ACL grants foreign effective write access")

    default_keys = [key for key in entries if key[0] == "default"]
    if default_keys:
        required("default", "user")
        required("default", "group")
        required("default", "other")
        default_named = [
            key for key in default_keys if key[1] in {"user", "group"} and key[2] is not None
        ]
        if default_named:
            required("default", "mask")
        if "w" in effective("default", "group") or "w" in effective("default", "other"):
            raise SystemExit("target HOME default ACL grants foreign effective write access")
        for scope, kind, qualifier in default_named:
            if kind == "user" and qualifier == uid:
                continue
            if "w" in effective(scope, kind, qualifier):
                raise SystemExit("target HOME default ACL grants foreign effective write access")


def validate_path(label: str, path: Path, *, allow_root_acl: bool = False) -> None:
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
        if info.st_uid == uid and info.st_mode & 0o022 == 0:
            return
        if allow_root_acl and info.st_uid == 0:
            validate_root_owned_acl_home(path)
            return
        if info.st_uid != uid:
            raise SystemExit(f"{label} is not owned by the current user: {path}")
        raise SystemExit(f"{label} is writable by group or other: {path}")

def nearest_existing_directory(path: Path) -> Path:
    candidate = path
    while not os.path.lexists(candidate):
        parent = candidate.parent
        if parent == candidate:
            raise SystemExit("cannot locate an existing filesystem parent")
        candidate = parent
    info = os.lstat(candidate)
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise SystemExit(f"nearest existing path is not a real directory: {candidate}")
    return candidate


def validate_existing_target_chain(label: str, path: Path, home: Path) -> None:
    try:
        relative = path.relative_to(home)
    except ValueError:
        raise SystemExit(f"{label} must be inside target home")
    current = home
    for part in relative.parts:
        current /= part
        if not os.path.lexists(current):
            break
        info = os.lstat(current)
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise SystemExit(f"{label} existing ancestors must be real directories")
        if info.st_uid != uid or info.st_mode & 0o022:
            raise SystemExit(
                f"{label} existing ancestors must be current-user-owned and not writable by group/other"
            )


def validate_home_ancestor_chain(home: Path) -> None:
    current = Path(home.anchor)
    ancestors = [current]
    for part in home.parts[1:-1]:
        current /= part
        ancestors.append(current)
    for current in ancestors:
        try:
            info = current.lstat()
        except OSError:
            raise SystemExit("target HOME ancestors must already exist as real directories")
        if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
            raise SystemExit("target HOME ancestors must be real directories")
        mode = stat.S_IMODE(info.st_mode)
        if info.st_uid not in {0, uid}:
            raise SystemExit("target HOME ancestors must be owned by root or the target user")
        if info.st_uid == uid and mode & 0o022:
            raise SystemExit("target-user-owned HOME ancestors must not be group/world writable")
        if info.st_uid == 0 and mode & 0o022 and mode & stat.S_ISVTX == 0:
            raise SystemExit("writable root-owned HOME ancestors must have the sticky bit")

target_home = lexical_absolute(raw_home)
target_codex_home = lexical_absolute(raw_codex_home)
login_home = Path(pwd.getpwuid(uid).pw_dir).absolute()
release_root = target_home / ".local" / "share" / "drclaw" / "releases"

validate_home_ancestor_chain(target_home)
validate_path("home", target_home, allow_root_acl=True)
validate_path("CODEX_HOME", target_codex_home)
if not allow_nonlogin and target_home != login_home:
    raise SystemExit(
        f"--home must equal the current user's login home ({login_home}); "
        "use --allow-nonlogin-home only for an isolated disposable test"
    )
if target_codex_home == target_home:
    raise SystemExit("refusing to use the entire target home as CODEX_HOME")
try:
    target_codex_home.relative_to(target_home)
except ValueError:
    raise SystemExit("CODEX_HOME must be a dedicated path inside target home")

managed_roots = [
    ("release checkout", release_root, True),
    ("managed executable bin", target_home / ".local" / "bin", True),
    ("managed runtime data", target_home / ".local" / "share" / "drclaw", True),
    ("managed skill scripts", target_home / ".agents" / "skills", True),
    ("CODEX_HOME", target_codex_home, False),
]
if with_app:
    managed_roots.extend(
        [
            ("application config", target_home / ".config" / "drclaw", False),
            ("application state", target_home / ".local" / "state" / "drclaw", False),
            ("user systemd units", target_home / ".config" / "systemd" / "user", False),
        ]
    )
for label, path, _needs_exec in managed_roots:
    validate_path(label, path)
    # A missing managed leaf does not make its existing ancestors trustworthy.
    # Validate the complete existing chain before mkdir, checkout, or bootstrap.
    validate_existing_target_chain(label, path, target_home)

base_required = int(raw_full_minimum if with_app else raw_core_minimum)
if raw_minimum_free:
    requested_required = int(raw_minimum_free)
    if requested_required < base_required:
        raise SystemExit(
            f"--minimum-free-bytes may only raise the default threshold ({base_required})"
        )
    required_bytes = requested_required
else:
    required_bytes = base_required

filesystem_capabilities = {}
noexec_flag = getattr(os, "ST_NOEXEC", None)
for label, path, needs_exec in managed_roots:
    parent = nearest_existing_directory(path)
    filesystem = os.statvfs(parent)
    available = filesystem.f_bavail * filesystem.f_frsize
    device = os.stat(parent).st_dev
    record = filesystem_capabilities.setdefault(
        device,
        {"available": available, "noexec": False, "exec_labels": []},
    )
    record["available"] = min(record["available"], available)
    if noexec_flag is not None and filesystem.f_flag & noexec_flag:
        record["noexec"] = True
    if needs_exec:
        record["exec_labels"].append(label)

if noexec_flag is not None:
    for record in filesystem_capabilities.values():
        if record["noexec"] and record["exec_labels"]:
            raise SystemExit(
                f"filesystem for executable target {record['exec_labels'][0]} is mounted noexec"
            )
exec_status = "passed" if noexec_flag is not None else "unavailable"

if skip_space:
    space_result = (
        f"required_bytes={required_bytes}|available_bytes=unknown|"
        f"filesystems={len(filesystem_capabilities)}|space_status=skipped|"
        f"exec_status={exec_status}"
    )
else:
    available_bytes = min(
        record["available"] for record in filesystem_capabilities.values()
    )
    if available_bytes < required_bytes:
        raise SystemExit(
            f"insufficient free space: required_bytes={required_bytes} available_bytes={available_bytes}"
        )
    space_result = (
        f"required_bytes={required_bytes}|available_bytes={available_bytes}|"
        f"filesystems={len(filesystem_capabilities)}|space_status=passed|exec_status={exec_status}"
    )

if not dry_run:
    target_home.mkdir(mode=0o700, parents=True, exist_ok=True)
    validate_path("home", target_home, allow_root_acl=True)

validate_path("release root", release_root)
print(target_home)
print(target_codex_home)
print(release_root)
print(space_result)
PY
) || die "target path validation failed"

mapfile -t normalized_path_lines <<<"$normalized_paths"
((${#normalized_path_lines[@]} == 4)) || die "target path validation returned an invalid result"
target_home=${normalized_path_lines[0]}
codex_home=${normalized_path_lines[1]}
release_root=${normalized_path_lines[2]}
space_result=${normalized_path_lines[3]}

# Select staging only after the managed roots are normalized.  A caller's
# TMPDIR/XDG_RUNTIME_DIR may live below HOME; using it for a dry-run would make
# the preview mutate its own target and could leave an interrupted checkout
# behind.  Keep all ephemeral Git staging outside every managed target tree.
safe_temp_root=$(python3 - "drclaw-safe-temp-v1" \
  "$target_home" "$codex_home" "$release_root" <<'PY'
import os
import stat
import sys
from pathlib import Path

managed_roots = tuple(Path(value) for value in sys.argv[2:])


def is_inside_managed_root(path: Path) -> bool:
    return any(path == root or root in path.parents for root in managed_roots)


def inspect_candidate(raw: str) -> Path:
    if not raw or any(character in raw for character in ("\n", "\r", "\x00")):
        raise SystemExit(
            "temporary root must be a non-empty absolute path without control characters"
        )
    supplied = Path(raw)
    if not supplied.is_absolute():
        raise SystemExit("temporary root must be absolute")
    path = Path(os.path.abspath(raw))
    current = Path(path.anchor)
    for part in path.parts[1:]:
        current /= part
        try:
            info = current.lstat()
        except OSError:
            raise SystemExit("temporary root must already exist")
        if stat.S_ISLNK(info.st_mode):
            raise SystemExit("temporary root must not traverse a symlink")
        if current != path:
            if not stat.S_ISDIR(info.st_mode):
                raise SystemExit("temporary root ancestors must be real directories")
            mode = stat.S_IMODE(info.st_mode)
            owned_nonwritable = (
                info.st_uid in {0, os.geteuid()} and mode & 0o022 == 0
            )
            root_sticky_shared = info.st_uid == 0 and mode & stat.S_ISVTX != 0
            if not (owned_nonwritable or root_sticky_shared):
                raise SystemExit("temporary root has an untrusted writable ancestor")
    return path


def validate_staging_root(path: Path) -> None:
    try:
        info = path.stat()
    except OSError:
        raise SystemExit("temporary root cannot be inspected")
    if not stat.S_ISDIR(info.st_mode):
        raise SystemExit("temporary root must be a directory")
    mode = stat.S_IMODE(info.st_mode)
    private_user_root = info.st_uid == os.geteuid() and mode & 0o077 == 0
    root_sticky_root = info.st_uid == 0 and mode == 0o1777
    if not (private_user_root or root_sticky_root):
        raise SystemExit(
            "temporary root must be current-user-owned/private or root-owned mode 1777"
        )
    if not os.access(path, os.W_OK | os.X_OK):
        raise SystemExit("temporary root is not writable/searchable by the target user")


candidates = []
if "TMPDIR" in os.environ:
    candidates.append(os.environ["TMPDIR"])
if "XDG_RUNTIME_DIR" in os.environ:
    candidates.append(os.environ["XDG_RUNTIME_DIR"])
candidates.append("/tmp")

seen = set()
for raw in candidates:
    path = inspect_candidate(raw)
    if path in seen:
        continue
    seen.add(path)
    if is_inside_managed_root(path):
        continue
    validate_staging_root(path)
    print(path)
    break
else:
    raise SystemExit("no safe temporary staging root exists outside managed target paths")
PY
) || die "temporary staging root failed the ownership/mode policy"
export TMPDIR="$safe_temp_root"

if ((skip_space_check)); then
  note "WARNING space-check skipped by explicit advanced override ($space_result)"
else
  note "capability space-check $space_result"
fi

export GIT_TERMINAL_PROMPT=0
resolved_tag_object=""
resolved_tag_commit=""

resolve_exact_repository_tag() {
  local exact_tag=$1
  resolved_tag_object=""
  resolved_tag_commit=""
  if [[ "$repository_kind" == "local" ]]; then
    tag_probe_checkout=$(mktemp -d -- "$safe_temp_root/drclaw-tag-probe.XXXXXXXX")
    git_safe -C "$tag_probe_checkout" init --quiet
    git_safe -C "$tag_probe_checkout" fetch --quiet --depth 1 "$repository" \
      "refs/tags/$exact_tag:refs/tags/$exact_tag" 2>/dev/null \
      || die "the exact release tag is unavailable from the local repository"
    resolved_tag_object=$(git_safe -C "$tag_probe_checkout" rev-parse --verify \
      "refs/tags/$exact_tag" 2>/dev/null) \
      || die "cannot resolve the fetched local release tag"
    local object_type
    object_type=$(git_safe -C "$tag_probe_checkout" cat-file -t "$resolved_tag_object" 2>/dev/null) \
      || die "cannot inspect the fetched local release tag"
    [[ "$object_type" == "tag" ]] \
      || die "the release tag must be an annotated tag"
    resolved_tag_commit=$(git_safe -C "$tag_probe_checkout" rev-parse --verify \
      "refs/tags/$exact_tag^{commit}" 2>/dev/null) \
      || die "the annotated local release tag does not peel to a commit"
    rm -rf -- "$tag_probe_checkout"
    tag_probe_checkout=""
  else
    local remote_refs
    remote_refs=$(git_safe ls-remote --exit-code "$repository" \
      "refs/tags/$exact_tag" "refs/tags/$exact_tag^{}" 2>/dev/null) \
      || die "the exact release tag is unavailable from the repository: $exact_tag"
    local object_id
    local ref_name
    while IFS=$'\t' read -r object_id ref_name; do
      case "$ref_name" in
        "refs/tags/$exact_tag") resolved_tag_object=$object_id ;;
        "refs/tags/$exact_tag^{}") resolved_tag_commit=$object_id ;;
      esac
    done <<<"$remote_refs"
    [[ -n "$resolved_tag_object" && -n "$resolved_tag_commit" ]] \
      || die "the release tag must be an annotated tag"
  fi
  [[ "$resolved_tag_object" =~ ^[0-9A-Fa-f]{40}$ \
    && "$resolved_tag_commit" =~ ^[0-9A-Fa-f]{40}$ ]] \
    || die "the annotated release tag returned an invalid Git object ID"
  resolved_tag_object=${resolved_tag_object,,}
  resolved_tag_commit=${resolved_tag_commit,,}
}

resolved_commit=""
if ((is_full_commit)); then
  resolved_commit=$release_ref
else
  resolve_exact_repository_tag "$release_ref"
  resolved_commit=$resolved_tag_commit
  [[ "$resolved_commit" == "$expected_commit" ]] \
    || die "release tag moved or --expected-commit is wrong (resolved $resolved_commit)"
  if [[ -n "$expected_tag_object" && "$resolved_tag_object" != "$expected_tag_object" ]]; then
    die "release tag object moved or --expected-tag-object is wrong"
  fi
fi

release_checkout="$release_root/$resolved_commit"

verify_checkout() {
  local checkout=$1
  [[ ! -L "$checkout" ]] || die "release checkout must not be a symlink"
  [[ -d "$checkout" && $(stat -c '%u' "$checkout") == "$(id -u)" ]] \
    || die "release checkout must be a current-user-owned directory"
  [[ -d "$checkout/.git" && ! -L "$checkout/.git" ]] \
    || die "release checkout must contain a real .git directory"
  if ((git_boolean_fsmonitor == 0)); then
    local fsmonitor_probe_status=0
    git_safe -C "$checkout" config --get-all core.fsmonitor \
      >/dev/null 2>&1 || fsmonitor_probe_status=$?
    if ((fsmonitor_probe_status == 0)); then
      die "release checkout config enables fsmonitor unsupported by this Git version"
    fi
    ((fsmonitor_probe_status == 1)) \
      || die "cannot inspect release checkout fsmonitor configuration"
  fi
  local checkout_head
  checkout_head=$(git_safe -C "$checkout" rev-parse --verify HEAD^{commit} 2>/dev/null) \
    || die "cannot resolve the release checkout HEAD: $checkout"
  checkout_head=${checkout_head,,}
  [[ "$checkout_head" == "$resolved_commit" ]] \
    || die "release checkout points to $checkout_head, expected $resolved_commit"
  local status
  status=$(git_safe -C "$checkout" status --porcelain --untracked-files=all 2>/dev/null) \
    || die "cannot inspect release checkout status: $checkout"
  [[ -z "$status" ]] || die "release checkout is dirty; refusing to install from it: $checkout"

  python3 - "$checkout" "$release_ref" "$resolved_commit" \
    "$SUPPORTED_SERVER_OS" "$SUPPORTED_ARCHITECTURES_CSV" "$MINIMUM_GIT_VERSION" \
    "$CORE_MINIMUM_FREE_BYTES" "$FULL_MINIMUM_FREE_BYTES" "$APP_GLIBC_MINIMUM" \
    "$git_boolean_fsmonitor" <<'PY' \
    || die "release source verification failed: $checkout"
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
requested_ref = sys.argv[2]
resolved_commit = sys.argv[3]
expected_server_os = sys.argv[4]
expected_architectures = sys.argv[5].split(",")
expected_git_minimum = sys.argv[6]
expected_core_free_bytes = int(sys.argv[7])
expected_full_free_bytes = int(sys.argv[8])
expected_app_glibc_minimum = sys.argv[9]
git_boolean_fsmonitor = sys.argv[10] == "1"
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

requirements = manifest.get("requirements")
if not isinstance(requirements, dict):
    raise SystemExit("manifest requirements must be an object")
expected_host_contract = {
    "server_os": expected_server_os,
    "server_architectures": expected_architectures,
    "git_minimum": expected_git_minimum,
    "app_glibc_minimum": expected_app_glibc_minimum,
    "minimum_free_bytes": {
        "core": expected_core_free_bytes,
        "full": expected_full_free_bytes,
    },
}
for key, expected_value in expected_host_contract.items():
    if requirements.get(key) != expected_value:
        raise SystemExit(
            f"manifest host capability contract drifted for requirements.{key}"
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

git_environment = os.environ.copy()
for variable in ("GIT_CONFIG", "GIT_CONFIG_COUNT", "GIT_CONFIG_PARAMETERS", "GIT_CONFIG_SYSTEM"):
    git_environment.pop(variable, None)
git_environment.update(
    {
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_OPTIONAL_LOCKS": "0",
        "LC_ALL": "C",
    }
)
git_command = ["git", "-c", "core.hooksPath=/dev/null"]
if git_boolean_fsmonitor:
    git_command.extend(["-c", "core.fsmonitor=false"])
index = subprocess.run(
    [
        *git_command,
        "-C",
        str(root),
        "ls-files",
        "--stage",
        "-z",
    ],
    check=True,
    capture_output=True,
    env=git_environment,
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

  if git_safe -C "$checkout" ls-files --stage | grep '^120000 ' >/dev/null; then
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

  git_safe check-ref-format "refs/tags/$manifest_release_ref" >/dev/null 2>&1 \
    || die "manifest baseline.bundle_release_ref is not a valid exact tag"

  local existing_tag_object=""
  existing_tag_object=$(git_safe -C "$checkout" rev-parse --verify \
    "refs/tags/$manifest_release_ref" 2>/dev/null || true)
  if [[ -n "$existing_tag_object" ]]; then
    local existing_tag_type
    existing_tag_type=$(git_safe -C "$checkout" cat-file -t "$existing_tag_object" 2>/dev/null) \
      || die "cannot inspect the local manifest release tag"
    [[ "$existing_tag_type" == "tag" ]] \
      || die "the local manifest release tag is not annotated"
    local existing_tag_commit
    existing_tag_commit=$(git_safe -C "$checkout" rev-parse --verify \
      "refs/tags/$manifest_release_ref^{commit}" 2>/dev/null) \
      || die "cannot peel the local manifest release tag"
    existing_tag_object=${existing_tag_object,,}
    existing_tag_commit=${existing_tag_commit,,}
    [[ "$existing_tag_commit" == "$resolved_commit" ]] \
      || die "local manifest release tag resolves to $existing_tag_commit, expected $resolved_commit"
    if [[ "$manifest_release_ref" == "$release_ref" && -n "$expected_tag_object" \
      && "$existing_tag_object" != "$expected_tag_object" ]]; then
      die "local manifest release tag object differs from the approved tag object"
    fi
    return
  fi

  resolve_exact_repository_tag "$manifest_release_ref"
  local manifest_tag_object=$resolved_tag_object
  local manifest_commit=$resolved_tag_commit
  [[ "$manifest_commit" == "$resolved_commit" ]] \
    || die "manifest release tag $manifest_release_ref resolves to $manifest_commit, expected $resolved_commit"

  if ((materialize == 0)); then
    return
  fi

  git_safe -C "$checkout" fetch --quiet --depth 1 "$repository" \
    "refs/tags/$manifest_release_ref:refs/tags/$manifest_release_ref" 2>/dev/null \
    || die "cannot materialize verified manifest release tag $manifest_release_ref"
  local local_manifest_object
  local_manifest_object=$(git_safe -C "$checkout" rev-parse --verify \
    "refs/tags/$manifest_release_ref" 2>/dev/null) \
    || die "cannot resolve the materialized manifest release tag object"
  local_manifest_object=${local_manifest_object,,}
  [[ "$local_manifest_object" == "$manifest_tag_object" ]] \
    || die "materialized manifest release tag object changed during fetch"
  local local_manifest_commit
  local_manifest_commit=$(git_safe -C "$checkout" rev-parse --verify "$manifest_release_ref^{commit}" 2>/dev/null) \
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
    dry_run_checkout=$(mktemp -d -- "$safe_temp_root/drclaw-remote-dry-run.XXXXXXXX")
    git_safe -C "$dry_run_checkout" init --quiet
    if ((is_full_commit)); then
      git_safe -C "$dry_run_checkout" fetch --quiet --depth 1 "$repository" "$resolved_commit" 2>/dev/null \
        || die "cannot fetch approved commit $resolved_commit"
    else
      git_safe -C "$dry_run_checkout" fetch --quiet --depth 1 "$repository" "refs/tags/$release_ref" 2>/dev/null \
        || die "cannot fetch approved tag $release_ref"
    fi
    git_safe -C "$dry_run_checkout" checkout --quiet --detach "$resolved_commit" \
      || die "cannot check out approved commit $resolved_commit"
    verify_checkout "$dry_run_checkout"
    materialize_manifest_release_ref "$dry_run_checkout" 0
    verify_checkout "$dry_run_checkout"
    note "DRY-RUN temporary source is clean and verified; target checkout remains absent"
    release_checkout=$dry_run_checkout
  fi
else
  mkdir -p -- "$release_root"
  release_root_mode=$(stat -c '%a' "$release_root" 2>/dev/null) \
    || die "cannot inspect the release staging root"
  [[ ! -L "$release_root" && -d "$release_root" \
    && $(stat -c '%u' "$release_root") == "$(id -u)" \
    && "$release_root_mode" =~ ^[0-7]{3,4}$ ]] \
    || die "release staging root must be a real current-user-owned directory"
  (( (8#$release_root_mode & 8#077) == 0 )) \
    || die "release staging root must be private to the target user"
  if [[ -e "$release_checkout" ]]; then
    verify_checkout "$release_checkout"
    materialize_manifest_release_ref "$release_checkout"
    verify_checkout "$release_checkout"
    note "reusing verified release checkout $release_checkout"
  else
    # Deliberate exception to the validated system TMPDIR: this incoming tree
    # stays under the revalidated private release root so the final publish is
    # an atomic same-filesystem rename. Moving it to TMPDIR would break on
    # common /tmp-versus-HOME cross-device layouts.
    temporary_checkout=$(mktemp -d "$release_root/.incoming.XXXXXXXX")
    git_safe -C "$temporary_checkout" init --quiet
    if ((is_full_commit)); then
      git_safe -C "$temporary_checkout" fetch --quiet --depth 1 "$repository" "$resolved_commit" 2>/dev/null \
        || die "cannot fetch approved commit $resolved_commit"
    else
      git_safe -C "$temporary_checkout" fetch --quiet --depth 1 "$repository" "refs/tags/$release_ref" 2>/dev/null \
        || die "cannot fetch approved tag $release_ref"
    fi
    git_safe -C "$temporary_checkout" checkout --quiet --detach "$resolved_commit" \
      || die "cannot check out approved commit $resolved_commit"
    verify_checkout "$temporary_checkout"
    materialize_manifest_release_ref "$temporary_checkout"
    verify_checkout "$temporary_checkout"
    if [[ -e "$release_checkout" ]]; then
      verify_checkout "$release_checkout"
      materialize_manifest_release_ref "$release_checkout"
      verify_checkout "$release_checkout"
      note "another installer published the same verified checkout; reusing it"
    elif mv -T -- "$temporary_checkout" "$release_checkout"; then
      temporary_checkout=""
      verify_checkout "$release_checkout"
      note "published verified release checkout $release_checkout"
    elif [[ -e "$release_checkout" ]]; then
      # A concurrent publisher may win after the pre-move existence check.
      # GNU mv -T guarantees that our incoming directory was never nested in
      # its destination; reuse only after a complete immutable-source check.
      verify_checkout "$release_checkout"
      materialize_manifest_release_ref "$release_checkout"
      verify_checkout "$release_checkout"
      note "another installer won the atomic publish race; reusing its verified checkout"
    else
      die "cannot atomically publish the verified release checkout"
    fi
  fi
fi

bootstrap_arguments=(
  install
  --home "$target_home"
  --codex-home "$codex_home"
  --config-profile "$config_profile"
  --no-doctor
)
((install_codex)) && bootstrap_arguments+=(--install-codex)
((install_plugins)) && bootstrap_arguments+=(--install-plugins)
((copy_skills)) && bootstrap_arguments+=(--copy-skills)
((replace_existing)) && bootstrap_arguments+=(--replace)
((skip_delta_skill)) && bootstrap_arguments+=(--skip-delta-skill)
((with_drclaw_cli)) && bootstrap_arguments+=(--with-drclaw-cli)
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
    --no-doctor
  )
  ((start_app)) && app_arguments+=(--start)
  ((replace_existing)) && app_arguments+=(--replace)
  ((dry_run)) && app_arguments+=(--dry-run)
  note "installing the pinned Dr. Claw Web application layer"
  (
    cd "$release_checkout"
    python3 "$release_checkout/bootstrap/codex/install_app.py" "${app_arguments[@]}"
  )
fi

if ((!dry_run && !no_doctor)); then
  core_doctor_arguments=(
    doctor
    --home "$target_home"
    --codex-home "$codex_home"
    --strict-release
    --require-clean-native-skills
  )
  ((skip_delta_skill)) && core_doctor_arguments+=(--skip-delta-skill)
  ((install_plugins)) && core_doctor_arguments+=(--require-plugins)
  note "running the strict, credential-free pre-activation acceptance gate"
  (
    cd "$release_checkout"
    bash "$release_checkout/bootstrap/codex/bootstrap.sh" "${core_doctor_arguments[@]}"
  )
  if ((with_app)); then
    (
      cd "$release_checkout"
      python3 "$release_checkout/bootstrap/codex/install_app.py" \
        --repo-root "$release_checkout" \
        doctor \
        --home "$target_home" \
        --codex-home "$codex_home"
    )
  fi
  note "pre-activation acceptance passed; identity/OAuth and a read-only model smoke remain interactive"
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
