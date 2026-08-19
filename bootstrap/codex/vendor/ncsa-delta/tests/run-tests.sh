#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

printf '== Python syntax ==\n'
python3 -m compileall -q scripts assets/examples tests

printf '== Bash syntax ==\n'
for file in scripts/*.sh assets/templates/*.slurm assets/examples/*.sh tests/*.sh; do
  bash -n "$file"
done

printf '== Frontmatter/layout ==\n'
python3 - <<'PY'
from pathlib import Path
root = Path.cwd()
skill = (root / "SKILL.md").read_text(encoding="utf-8")
assert skill.startswith("---\n"), "SKILL.md must start with YAML frontmatter"
front = skill.split("---\n", 2)[1]
assert "name: ncsa-delta" in front
assert "description:" in front
for required in ["scripts", "references", "assets/templates", "agents/openai.yaml"]:
    assert (root / required).exists(), required
print("layout ok")
PY

printf '== Unit/integration tests ==\n'
python3 -m unittest -v tests.test_delta_tools

printf '== Linter smoke tests ==\n'
python3 scripts/delta-lint.py \
  --submission-partition gpuA100x4 \
  tests/fixtures/valid-gpu.slurm >/dev/null
set +e
python3 scripts/delta-lint.py \
  --submission-partition gpuA100x4 \
  tests/fixtures/invalid-gpu.slurm >/dev/null
bad_rc=$?
set -e
[[ $bad_rc -eq 2 ]] || { echo "invalid fixture should exit 2, got $bad_rc" >&2; exit 1; }

printf '== Runtime receipt CLI smoke test ==\n'
python3 scripts/delta-pytorch-runtime-receipt.py --help >/dev/null
bash scripts/delta-load-pytorch-2.8-cu128.sh --help >/dev/null
python3 scripts/delta-fileset-manifest.py --help >/dev/null
python3 scripts/delta-gpu-runtime-contract.py --help >/dev/null
python3 scripts/delta-mode-projection.py --help >/dev/null
python3 scripts/delta-phase-inventory.py --help >/dev/null

printf '== Placeholder inventory ==\n'
# Templates are intentionally not submit-ready; every one must remain visibly marked.
for file in assets/templates/*.slurm; do
  grep -q 'CHANGE_ME' "$file" || { echo "template lacks CHANGE_ME guard: $file" >&2; exit 1; }
done

printf 'All tests passed.\n'
