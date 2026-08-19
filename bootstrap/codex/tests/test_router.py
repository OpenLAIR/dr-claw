from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from typing import List


REPO_ROOT = Path(__file__).resolve().parents[3]
ROUTER = (
    REPO_ROOT
    / "bootstrap"
    / "codex"
    / "skills"
    / "drclaw-skill-library"
    / "scripts"
    / "query_library.py"
)


class SkillLibraryRouterTests(unittest.TestCase):
    def run_router(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        environment = os.environ.copy()
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        command: List[str] = [
            sys.executable,
            str(ROUTER),
            "--repo-root",
            str(REPO_ROOT),
            *arguments,
        ]
        return subprocess.run(
            command,
            cwd=str(REPO_ROOT),
            env=environment,
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )

    def assert_json_success(self, result: subprocess.CompletedProcess[str]) -> dict:
        self.assertEqual(result.returncode, 0, msg=f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}")
        return json.loads(result.stdout)

    def test_validation_uses_all_172_filesystem_skills(self) -> None:
        payload = self.assert_json_success(self.run_router("--validate"))
        self.assertTrue(payload["valid"])
        self.assertEqual(payload["disk_skill_count"], 172)
        self.assertEqual(payload["record_count"], 172)
        self.assertEqual(payload["invalid_frontmatter_paths"], [])
        self.assertEqual(payload["duplicate_names"], {})
        self.assertEqual(payload["unindexed_paths"], [])

    def test_canonical_name_resolves_directory_alias(self) -> None:
        payload = self.assert_json_success(
            self.run_router("--resolve", "huggingface-accelerate", "--format", "json")
        )
        self.assertEqual(len(payload["results"]), 1)
        record = payload["results"][0]
        self.assertEqual(record["name"], "huggingface-accelerate")
        self.assertEqual(record["path"], "skills/distributed-training/accelerate/SKILL.md")
        self.assertEqual(Path(record["path"]).parent.name, "accelerate")

    def test_bootstrap_managed_delta_skill_resolves_exactly(self) -> None:
        payload = self.assert_json_success(
            self.run_router("--resolve", "ncsa-delta", "--format", "json")
        )
        self.assertEqual(len(payload["results"]), 1)
        record = payload["results"][0]
        self.assertEqual(record["name"], "ncsa-delta")
        self.assertEqual(record["path"], "bootstrap/codex/vendor/ncsa-delta/SKILL.md")
        self.assertEqual(record["source"], "bootstrap-managed")

    def test_chinese_query_expands_to_relevant_ranked_skills(self) -> None:
        payload = self.assert_json_success(
            self.run_router("--query", "论文引用", "--limit", "5", "--format", "json")
        )
        results = payload["results"]
        self.assertGreater(len(results), 0)
        self.assertTrue(all(record["score"] > 0 for record in results))
        names = {record["name"] for record in results}
        self.assertIn("inno-paper-writing", names)
        self.assertIn("inno-reference-audit", names)


if __name__ == "__main__":
    unittest.main()
