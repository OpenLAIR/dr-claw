#!/usr/bin/env python3
from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS))

import delta_cost  # noqa: E402
import delta_gpu_runtime_contract  # type: ignore  # noqa: E402
import delta_lint  # type: ignore  # noqa: E402
import delta_mode_projection  # type: ignore  # noqa: E402
import delta_phase_inventory  # type: ignore  # noqa: E402
import delta_time_advisor  # type: ignore  # noqa: E402

_RUNTIME_RECEIPT_SPEC = importlib.util.spec_from_file_location(
    "delta_pytorch_runtime_receipt",
    SCRIPTS / "delta-pytorch-runtime-receipt.py",
)
if _RUNTIME_RECEIPT_SPEC is None or _RUNTIME_RECEIPT_SPEC.loader is None:
    raise RuntimeError("cannot load delta-pytorch-runtime-receipt.py for tests")
delta_pytorch_runtime_receipt = importlib.util.module_from_spec(_RUNTIME_RECEIPT_SPEC)
_RUNTIME_RECEIPT_SPEC.loader.exec_module(delta_pytorch_runtime_receipt)


class DurationTests(unittest.TestCase):
    def test_parse_and_format(self) -> None:
        self.assertEqual(delta_cost.parse_duration("15"), 900)
        self.assertEqual(delta_cost.parse_duration("15m"), 900)
        self.assertEqual(delta_cost.parse_duration("01:02:03"), 3723)
        self.assertEqual(delta_cost.parse_duration("2-01:00:00"), 176400)
        self.assertEqual(delta_cost.format_duration(176400), "2-01:00:00")

    def test_bad_duration(self) -> None:
        with self.assertRaises(argparse.ArgumentTypeError):
            delta_cost.parse_duration("00:99:00")

    def test_slurm_memory_converts_to_decimal_billing_gb(self) -> None:
        self.assertAlmostEqual(
            delta_cost.parse_slurm_memory_decimal_gb("60G"),
            60 * (2**30) / 1_000_000_000,
        )
        self.assertAlmostEqual(
            delta_cost.parse_slurm_memory_decimal_gb("60000"),
            60000 * (2**20) / 1_000_000_000,
        )
        with self.assertRaises(argparse.ArgumentTypeError):
            delta_cost.parse_slurm_memory_decimal_gb("60GB/s")


class PytorchRuntimeReceiptParityTests(unittest.TestCase):
    @staticmethod
    def exact_core_runtime() -> dict[str, object]:
        prefix = "/sw/rh9.4/user/python/conda-env/pytorch-2.8-cu128"
        return {
            "python_version": "3.11.13",
            "python_executable": f"{prefix}/bin/python",
            "python_executable_resolved": f"{prefix}/bin/python3.11",
            "python_prefix": prefix,
            "torch_version": "2.8.0+cu128",
            "torch_file": f"{prefix}/lib/python3.11/site-packages/torch/__init__.py",
            "torch_cuda_version": "12.8",
        }

    def test_wrapper_fallback_drift_is_observed_but_does_not_fail_parity(self) -> None:
        login = {
            **self.exact_core_runtime(),
            "load_method": "fallback",
            "wrapper_rc": 1,
            "module_list": ["pytorch/2.8-cu128", "cudatoolkit/25.3_12.8"],
        }
        compute = {
            **self.exact_core_runtime(),
            "load_method": "wrapper",
            "wrapper_rc": 0,
            "module_list": ["pytorch-conda/2.8", "cudatoolkit/25.3_12.8"],
        }

        checks = delta_pytorch_runtime_receipt.build_login_compute_parity_checks(
            login, compute
        )
        differences = delta_pytorch_runtime_receipt.differing_observation_fields(
            login, compute
        )

        self.assertTrue(all(checks.values()))
        self.assertEqual(
            differences, ["load_method", "wrapper_rc", "module_list"]
        )
        for field in delta_pytorch_runtime_receipt.OBSERVATION_ONLY_FIELDS:
            self.assertNotIn(f"matches_login_{field}", checks)
        self.assertTrue(
            set(delta_pytorch_runtime_receipt.CORE_RUNTIME_PARITY_FIELDS).isdisjoint(
                delta_pytorch_runtime_receipt.OBSERVATION_ONLY_FIELDS
            )
        )

    def test_every_core_runtime_field_remains_fail_closed(self) -> None:
        login = self.exact_core_runtime()
        for field in delta_pytorch_runtime_receipt.CORE_RUNTIME_PARITY_FIELDS:
            with self.subTest(field=field):
                compute = self.exact_core_runtime()
                compute[field] = f"{compute[field]}-DRIFT"
                checks = (
                    delta_pytorch_runtime_receipt.build_login_compute_parity_checks(
                        login, compute
                    )
                )
                self.assertFalse(checks[f"matches_login_{field}"])
                self.assertFalse(all(checks.values()))


class CostTests(unittest.TestCase):
    @staticmethod
    def args(**overrides: object) -> argparse.Namespace:
        values = {
            "partition": "gpuA100x4",
            "nodes": 1,
            "gpus_per_node": 1,
            "cpus_per_node": 16,
            "mem": None,
            "mem_gb_per_node": 60.0,
            "elapsed": 1200,
            "walltime": 1800,
            "exclusive": False,
            "as_json": False,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_a100_cost(self) -> None:
        result = delta_cost.estimate(self.args())
        self.assertAlmostEqual(result["effective_su_per_hour_total"], 1.0)
        self.assertAlmostEqual(result["estimated_actual_su"], 1.0 / 3.0)
        self.assertAlmostEqual(result["requested_walltime_admission_su"], 0.5)

    def test_memory_can_dominate(self) -> None:
        result = delta_cost.estimate(self.args(mem_gb_per_node=125.0))
        self.assertAlmostEqual(result["effective_su_per_hour_total"], 2.0)
        self.assertIn("memory_units", result["dominant_component"])

    def test_slurm_memory_boundary_is_not_decimal_gb(self) -> None:
        safe = delta_cost.estimate(self.args(mem="58G", mem_gb_per_node=None))
        over = delta_cost.estimate(self.args(mem="60G", mem_gb_per_node=None))
        self.assertLess(safe["request"]["mem_gb_decimal_per_node"], 62.5)
        self.assertAlmostEqual(safe["effective_su_per_hour_total"], 1.0)
        self.assertGreater(over["request"]["mem_gb_decimal_per_node"], 62.5)
        self.assertGreater(over["effective_su_per_hour_total"], 1.0)

    def test_h200_factor(self) -> None:
        result = delta_cost.estimate(
            self.args(
                partition="gpuH200x8",
                cpus_per_node=12,
                mem_gb_per_node=200.0,
                elapsed=1800,
                walltime=1800,
            )
        )
        self.assertAlmostEqual(result["effective_su_per_hour_total"], 3.0)
        self.assertAlmostEqual(result["estimated_actual_su"], 1.5)

    def test_cpu_cost(self) -> None:
        result = delta_cost.estimate(
            self.args(
                partition="cpu",
                gpus_per_node=0,
                cpus_per_node=16,
                mem_gb_per_node=64.0,
                elapsed=3600,
                walltime=3600,
            )
        )
        self.assertAlmostEqual(result["effective_su_per_hour_total"], 32.0)


class AdvisorTests(unittest.TestCase):
    def test_history_filter_and_recommendation(self) -> None:
        records = delta_time_advisor.load_input(ROOT / "tests/fixtures/sacct-history.txt", "gpuA100x4")
        self.assertEqual(len(records), 6)
        recommended, stats = delta_time_advisor.recommendation_from_history(
            [r.elapsed_seconds for r in records]
        )
        self.assertEqual(stats["count"], 6)
        self.assertGreaterEqual(recommended, 1200)
        self.assertEqual(recommended % 60, 0)

    def test_initial_15_minute_guess(self) -> None:
        recommended, stats = delta_time_advisor.recommendation_from_guess(900)
        self.assertEqual(recommended, 1800)
        self.assertIn("2x", stats["policy"])


class LintTests(unittest.TestCase):
    def test_valid_has_no_errors(self) -> None:
        findings = delta_lint.lint(
            ROOT / "tests/fixtures/valid-gpu.slurm", False, "gpuA100x4"
        )
        errors = [f for f in findings if f.severity == "ERROR"]
        self.assertEqual(errors, [])

    def test_invalid_has_expected_errors(self) -> None:
        findings = delta_lint.lint(
            ROOT / "tests/fixtures/invalid-gpu.slurm", False, "gpuA100x4"
        )
        codes = {f.code for f in findings if f.severity == "ERROR"}
        self.assertIn("GPU_MISSING", codes)
        self.assertIn("ACCOUNT_KIND", codes)

    def test_linter_detects_binary_memory_crossing_billing_boundary(self) -> None:
        original = (ROOT / "tests/fixtures/valid-gpu.slurm").read_text(encoding="utf-8")
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp) / "memory-boundary.slurm"
            script.write_text(original.replace("--mem=58G", "--mem=60G"), encoding="utf-8")
            findings = delta_lint.lint(script, False, "gpuA100x4")
        codes = {f.code for f in findings}
        self.assertIn("MEM_BILLING", codes)

    def test_linter_rejects_gpu_model_and_device_pinning(self) -> None:
        original = (ROOT / "tests/fixtures/valid-gpu.slurm").read_text(encoding="utf-8")
        pinned = original.replace(
            "#SBATCH --account=test-gpu",
            "#SBATCH --account=test-gpu\n"
            "#SBATCH --partition=gpuA100x4\n"
            "#SBATCH --gres=gpu:a100:1\n"
            "#SBATCH --nodelist=delta-gpu001",
        ).replace(
            "set -Eeuo pipefail",
            "set -Eeuo pipefail\nexport CUDA_VISIBLE_DEVICES=0",
        )
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp) / "pinned.slurm"
            script.write_text(pinned, encoding="utf-8")
            findings = delta_lint.lint(script, False)
        codes = {f.code for f in findings if f.severity == "ERROR"}
        for expected in [
            "GPU_PARTITION_PIN",
            "GPU_TYPED_GRES",
            "GPU_NODE_PIN",
            "GPU_VISIBLE_OVERRIDE",
        ]:
            self.assertIn(expected, codes)

    def test_pytorch_wrapper_requires_hidden_module_fallback_and_receipt(self) -> None:
        original = (ROOT / "tests/fixtures/valid-gpu.slurm").read_text(encoding="utf-8")
        wrapper_only = original.replace(
            "set -Eeuo pipefail",
            "set -Eeuo pipefail\nmodule load pytorch-conda/2.8",
        )
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp) / "wrapper-only.slurm"
            script.write_text(wrapper_only, encoding="utf-8")
            findings = delta_lint.lint(script, False)
        error_codes = {f.code for f in findings if f.severity == "ERROR"}
        all_codes = {f.code for f in findings}
        self.assertIn("PYTORCH_WRAPPER_HIDDEN_DEP", error_codes)
        self.assertIn("PYTORCH_RUNTIME_RECEIPT", all_codes)

        with_fallback = wrapper_only.replace(
            "module load pytorch-conda/2.8",
            "module load pytorch-conda/2.8 || {\n"
            "  module use /sw/rh9.4/user/modules/python/.conda-env\n"
            "  module load cudatoolkit/25.3_12.8 pytorch/2.8-cu128\n"
            "}\n"
            "srun bash delta-load-pytorch-2.8-cu128.sh --phase compute",
        )
        with tempfile.TemporaryDirectory() as temp:
            script = Path(temp) / "with-fallback.slurm"
            script.write_text(with_fallback, encoding="utf-8")
            findings = delta_lint.lint(script, False)
        error_codes = {f.code for f in findings if f.severity == "ERROR"}
        all_codes = {f.code for f in findings}
        self.assertNotIn("PYTORCH_WRAPPER_HIDDEN_DEP", error_codes)
        self.assertNotIn("PYTORCH_RUNTIME_RECEIPT", all_codes)
        self.assertIn("PYTORCH_WRAPPER_FALLBACK", all_codes)


class FileSetManifestTests(unittest.TestCase):
    def run_tool(self, *args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPTS / "delta-fileset-manifest.py"), *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
            check=check,
        )

    def test_exact_fileset_passes_and_appledouble_extra_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / "source"
            source.mkdir()
            (source / "empty").mkdir()
            (source / "nested").mkdir()
            (source / "nested/data.bin").write_bytes(b"exact-content\x00")
            (source / "note.txt").write_text("hello\n", encoding="utf-8")
            if hasattr(Path, "symlink_to"):
                (source / "note-link").symlink_to("note.txt")

            manifest = base / "EXPECTED_FILESET.json"
            self.run_tool("create", "--root", str(source), "--output", str(manifest))
            manifest_data = json.loads(manifest.read_text(encoding="utf-8"))
            self.assertTrue(manifest_data["passed"])
            self.assertEqual(manifest_data["appledouble_paths"], [])

            destination = base / "incoming" / "payload"
            shutil.copytree(source, destination, symlinks=True)
            pass_report = base / "incoming" / "FILESET_PASS.json"
            self.run_tool(
                "verify",
                "--root",
                str(destination),
                "--manifest",
                str(manifest),
                "--report",
                str(pass_report),
            )
            self.assertTrue(json.loads(pass_report.read_text(encoding="utf-8"))["passed"])

            (destination / "nested/._data.bin").write_bytes(b"AppleDouble")
            fail_report = base / "incoming" / "FILESET_FAIL.json"
            proc = self.run_tool(
                "verify",
                "--root",
                str(destination),
                "--manifest",
                str(manifest),
                "--report",
                str(fail_report),
                check=False,
            )
            self.assertEqual(proc.returncode, 3)
            failed = json.loads(fail_report.read_text(encoding="utf-8"))
            self.assertFalse(failed["passed"])
            self.assertIn("nested/._data.bin", failed["unexpected_paths"])
            self.assertIn("nested/._data.bin", failed["appledouble_paths"])
            self.assertIn("do not create final", proc.stderr)

    def test_source_manifest_rejects_existing_appledouble(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            source = base / "source"
            source.mkdir()
            (source / "._artifact").write_bytes(b"metadata")
            manifest = base / "EXPECTED_FILESET.json"
            proc = self.run_tool(
                "create",
                "--root",
                str(source),
                "--output",
                str(manifest),
                check=False,
            )
            self.assertEqual(proc.returncode, 3)
            data = json.loads(manifest.read_text(encoding="utf-8"))
            self.assertFalse(data["passed"])
            self.assertEqual(data["appledouble_paths"], ["._artifact"])


class ModeProjectionTests(unittest.TestCase):
    @staticmethod
    def write_file(path: Path, content: bytes, mode: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(mode)

    @classmethod
    def build_roots(cls, base: Path) -> dict[str, Path]:
        parent = base / "sealed-parent"
        overlay = base / "signed-overlay"
        local_full = base / "local-full"
        candidate = base / "candidate"

        cls.write_file(parent / "base-only.txt", b"base-only\n", 0o440)
        cls.write_file(parent / "replace.txt", b"old\n", 0o440)

        cls.write_file(overlay / "replace.txt", b"new\n", 0o644)
        cls.write_file(overlay / "bin/launch.sh", b"#!/bin/sh\nexit 0\n", 0o750)

        cls.write_file(local_full / "base-only.txt", b"base-only\n", 0o644)
        cls.write_file(local_full / "replace.txt", b"new\n", 0o644)
        cls.write_file(
            local_full / "bin/launch.sh", b"#!/bin/sh\nexit 0\n", 0o750
        )

        shutil.copytree(parent, candidate, copy_function=shutil.copy2)
        for source in sorted(path for path in overlay.rglob("*") if path.is_file()):
            destination = candidate / source.relative_to(overlay)
            destination.parent.mkdir(parents=True, exist_ok=True)
            temporary = destination.with_name("." + destination.name + ".overlay")
            shutil.copy2(source, temporary)
            temporary.replace(destination)
        return {
            "parent": parent,
            "overlay": overlay,
            "local_full": local_full,
            "candidate": candidate,
        }

    @staticmethod
    def rows(roots: dict[str, Path]) -> dict[str, list[dict]]:
        return {
            name: delta_mode_projection.scan_file_rows(root)
            for name, root in roots.items()
        }

    def test_inherited_0440_overlay_0644_0750_and_postpublish_digest_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            roots = self.build_roots(Path(temp))
            rows = self.rows(roots)
            stage1 = delta_mode_projection.validate_projection(
                rows["parent"],
                rows["overlay"],
                rows["candidate"],
                rows["local_full"],
                "stage1",
            )
            self.assertTrue(stage1["passed"], stage1)
            projected, _, _ = delta_mode_projection.project_rows(
                rows["parent"], rows["overlay"]
            )
            by_path = {row["path"]: row for row in projected}
            self.assertEqual(by_path["base-only.txt"]["mode_octal"], "0440")
            self.assertEqual(by_path["replace.txt"]["mode_octal"], "0644")
            self.assertEqual(by_path["bin/launch.sh"]["mode_octal"], "0750")
            self.assertTrue(stage1["local_full_comparison"]["content_equal"])
            self.assertFalse(stage1["local_full_comparison"]["modes_equal"])
            self.assertFalse(
                stage1["claim_boundary"]["naive_local_full_exact_rows_equal"]
            )
            self.assertFalse(
                stage1["claim_boundary"][
                    "local_writable_full_tree_modes_used_as_authority"
                ]
            )

            postpublish = delta_mode_projection.validate_projection(
                rows["parent"],
                rows["overlay"],
                rows["candidate"],
                rows["local_full"],
                "postpublish",
            )
            self.assertTrue(postpublish["passed"], postpublish)
            self.assertEqual(
                postpublish["digests"][
                    "postpublish_projected_rows_digest_sha256"
                ],
                postpublish["digests"]["projected_rows_sha256"],
            )

    def test_naive_local_full_exact_equality_is_rejected_as_mode_authority(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            roots = self.build_roots(Path(temp))
            rows = self.rows(roots)
            report = delta_mode_projection.validate_projection(
                rows["parent"],
                rows["overlay"],
                rows["local_full"],
                rows["local_full"],
                "stage1",
            )
            self.assertFalse(report["passed"])
            self.assertTrue(
                report["claim_boundary"]["naive_local_full_exact_rows_equal"]
            )
            self.assertIn("candidate_modes_match_projection", report["failed_checks"])
            self.assertEqual(
                report["candidate_comparison"]["mode_changed_paths"],
                ["base-only.txt"],
            )

    def test_parent_and_overlay_mode_content_path_size_tamper_fail_closed(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            roots = self.build_roots(Path(temp))
            rows = self.rows(roots)
            cases = []
            for authority, path in [
                ("parent", "base-only.txt"),
                ("overlay", "replace.txt"),
            ]:
                index = next(
                    index
                    for index, row in enumerate(rows[authority])
                    if row["path"] == path
                )
                for field in ["mode", "content", "path", "size"]:
                    parent = copy.deepcopy(rows["parent"])
                    overlay = copy.deepcopy(rows["overlay"])
                    target = parent if authority == "parent" else overlay
                    if field == "mode":
                        target[index]["mode_octal"] = "0400"
                    elif field == "content":
                        target[index]["sha256"] = "0" * 64
                    elif field == "path":
                        target[index]["path"] = "tampered-%s.txt" % authority
                    else:
                        target[index]["size"] += 1
                    cases.append((authority, field, parent, overlay))

            for authority, field, parent, overlay in cases:
                with self.subTest(authority=authority, field=field):
                    report = delta_mode_projection.validate_projection(
                        parent,
                        overlay,
                        rows["candidate"],
                        rows["local_full"],
                        "prepublish",
                    )
                    self.assertFalse(report["passed"], report)
                    self.assertTrue(
                        {
                            "candidate_paths_match_projection",
                            "candidate_content_matches_projection",
                            "candidate_modes_match_projection",
                            "local_full_content_matches_projection",
                        }
                        & set(report["failed_checks"])
                    )

    def test_postpublish_tamper_has_no_success_digest(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            roots = self.build_roots(Path(temp))
            rows = self.rows(roots)
            tampered_candidate = copy.deepcopy(rows["candidate"])
            base = next(
                row for row in tampered_candidate if row["path"] == "base-only.txt"
            )
            base["mode_octal"] = "0644"
            report = delta_mode_projection.validate_projection(
                rows["parent"],
                rows["overlay"],
                tampered_candidate,
                rows["local_full"],
                "postpublish",
            )
            self.assertFalse(report["passed"])
            self.assertIsNone(
                report["digests"]["postpublish_projected_rows_digest_sha256"]
            )

    def test_cli_manifests_and_report_are_write_once(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            roots = self.build_roots(base)
            manifests = {}
            roles = {
                "parent": "sealed_parent",
                "overlay": "signed_overlay",
                "local_full": "local_full_content_comparator",
            }
            for name, role in roles.items():
                manifest = base / (name + ".json")
                proc = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPTS / "delta-mode-projection.py"),
                        "create",
                        "--root",
                        str(roots[name]),
                        "--role",
                        role,
                        "--output",
                        str(manifest),
                    ],
                    cwd=ROOT,
                    text=True,
                    capture_output=True,
                )
                self.assertEqual(proc.returncode, 0, proc.stderr)
                manifests[name] = manifest

            report_path = base / "STAGE1_MODE_PROJECTION.json"
            command = [
                sys.executable,
                str(SCRIPTS / "delta-mode-projection.py"),
                "verify",
                "--parent-manifest",
                str(manifests["parent"]),
                "--overlay-manifest",
                str(manifests["overlay"]),
                "--local-full-manifest",
                str(manifests["local_full"]),
                "--candidate-root",
                str(roots["candidate"]),
                "--phase",
                "stage1",
                "--report",
                str(report_path),
            ]
            first = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertTrue(json.loads(report_path.read_text(encoding="utf-8"))["passed"])
            second = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(second.returncode, 4)
            self.assertIn("refusing to replace existing evidence", second.stderr)


class GeneratedArtifactPhaseInventoryTests(unittest.TestCase):
    CONFIG_PATH = "generated/canonical-config.json"
    CONFIG_SCHEMA = "generic_generated_config_v1"

    @staticmethod
    def write_file(path: Path, content: bytes, mode: int) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(mode)

    @classmethod
    def build_pre_root(cls, base: Path) -> Path:
        root = base / "pre-source"
        cls.write_file(root / "base-only.txt", b"base-only\n", 0o440)
        cls.write_file(root / "overlay.txt", b"overlay\n", 0o644)
        cls.write_file(root / "bin/launch.sh", b"#!/bin/sh\nexit 0\n", 0o750)
        return root

    @classmethod
    def write_config_authority(cls, base: Path) -> Path:
        path = base / "authority" / "canonical-config.json"
        path.parent.mkdir(parents=True)
        path.write_text(
            json.dumps(
                {
                    "schema": cls.CONFIG_SCHEMA,
                    "setting": {"enabled": True, "scale": 1.0},
                },
                sort_keys=True,
            )
            + "\n",
            encoding="utf-8",
        )
        return path

    @staticmethod
    def run_tool(*args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(SCRIPTS / "delta-phase-inventory.py"), *args],
            cwd=ROOT,
            text=True,
            capture_output=True,
        )

    def test_stage1_actually_materializes_postinventories_seals_and_replays(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            pre_root = self.build_pre_root(base)
            config = self.write_config_authority(base)
            stage1_root = base / "disposable-stage1"
            proc = self.run_tool(
                "stage1-check",
                "--pre-root",
                str(pre_root),
                "--stage1-root",
                str(stage1_root),
                "--canonical-config-path",
                self.CONFIG_PATH,
                "--expected-config-file",
                str(config),
                "--expected-schema",
                self.CONFIG_SCHEMA,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)

            evidence = stage1_root / "evidence"
            complete = json.loads(
                (evidence / "STAGE1_COMPLETE.json").read_text(encoding="utf-8")
            )
            self.assertTrue(complete["passed"])
            self.assertEqual(
                complete["transitions"],
                [
                    "pre_materialization_config_absent",
                    "disposable_materialization_created",
                    "canonical_generated_config_materialized",
                    "post_materialization_inventory_verified",
                    "whole_tree_sealed_including_generated_config",
                    "post_seal_whole_manifest_replayed",
                ],
            )

            pre = json.loads(
                (evidence / "PRE_MATERIALIZATION_INVENTORY.json").read_text(
                    encoding="utf-8"
                )
            )
            post = json.loads(
                (evidence / "POST_MATERIALIZATION_INVENTORY.json").read_text(
                    encoding="utf-8"
                )
            )
            sealed = json.loads(
                (evidence / "POST_SEAL_WHOLE_MANIFEST.json").read_text(
                    encoding="utf-8"
                )
            )
            replay = json.loads(
                (evidence / "POST_SEAL_WHOLE_MANIFEST_REPLAY.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertTrue(pre["checks"]["canonical_generated_config_absent"])
            self.assertTrue(
                post["checks"]["non_generated_projected_rows_unchanged"]
            )
            self.assertEqual(len(post["generated_artifacts"]), 1)
            generated = post["generated_artifacts"][0]
            self.assertEqual(generated["path"], self.CONFIG_PATH)
            self.assertEqual(generated["type"], "file")
            self.assertEqual(generated["config_schema"], self.CONFIG_SCHEMA)
            self.assertEqual(generated["mode_octal"], "0644")
            self.assertEqual(generated["sha256"], delta_mode_projection.sha256_file(config))
            self.assertEqual(generated["size"], config.stat().st_size)
            sealed_by_path = {row["path"]: row for row in sealed["whole_rows"]}
            self.assertEqual(sealed_by_path[self.CONFIG_PATH]["mode_octal"], "0440")
            self.assertEqual(sealed_by_path["bin/launch.sh"]["mode_octal"], "0550")
            self.assertEqual(len(sealed["whole_rows"]), 4)
            self.assertTrue(replay["whole_manifest_replay_passed"])

    def test_pre_materialization_rejects_existing_generated_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            pre_root = self.build_pre_root(base)
            self.write_file(
                pre_root / self.CONFIG_PATH,
                b'{"schema":"generic_generated_config_v1"}\n',
                0o644,
            )
            report = base / "PRE_FAIL.json"
            proc = self.run_tool(
                "pre-materialization",
                "--root",
                str(pre_root),
                "--canonical-config-path",
                self.CONFIG_PATH,
                "--output",
                str(report),
            )
            self.assertEqual(proc.returncode, 3)
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertFalse(payload["passed"])
            self.assertFalse(
                payload["checks"]["canonical_generated_config_absent"]
            )

    def test_post_materialization_rejects_nonprojected_extra_or_config_drift(self) -> None:
        cases = ["non_generated_content", "extra_generated", "config_mode", "config_schema"]
        for case in cases:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temp:
                base = Path(temp)
                pre_root = self.build_pre_root(base)
                config = self.write_config_authority(base)
                pre_manifest = base / "PRE.json"
                self.assertEqual(
                    self.run_tool(
                        "pre-materialization",
                        "--root",
                        str(pre_root),
                        "--canonical-config-path",
                        self.CONFIG_PATH,
                        "--output",
                        str(pre_manifest),
                    ).returncode,
                    0,
                )
                materialized = base / "materialized"
                shutil.copytree(pre_root, materialized, copy_function=shutil.copy2)
                destination = materialized / self.CONFIG_PATH
                destination.parent.mkdir(parents=True)
                shutil.copyfile(config, destination)
                destination.chmod(0o644)
                if case == "non_generated_content":
                    (materialized / "base-only.txt").chmod(0o640)
                    (materialized / "base-only.txt").write_bytes(b"tampered\n")
                    (materialized / "base-only.txt").chmod(0o440)
                elif case == "extra_generated":
                    self.write_file(materialized / "generated/extra.json", b"{}\n", 0o644)
                elif case == "config_mode":
                    destination.chmod(0o600)
                else:
                    destination.write_text(
                        '{"schema":"wrong_schema"}\n', encoding="utf-8"
                    )
                    destination.chmod(0o644)
                report = base / ("POST_FAIL_%s.json" % case)
                proc = self.run_tool(
                    "post-materialization",
                    "--root",
                    str(materialized),
                    "--pre-manifest",
                    str(pre_manifest),
                    "--expected-config-file",
                    str(config),
                    "--expected-schema",
                    self.CONFIG_SCHEMA,
                    "--output",
                    str(report),
                )
                self.assertEqual(proc.returncode, 3, proc.stderr)
                payload = json.loads(report.read_text(encoding="utf-8"))
                self.assertFalse(payload["passed"])
                if case == "non_generated_content":
                    self.assertIn(
                        "non_generated_projected_rows_unchanged",
                        payload["failed_checks"],
                    )
                elif case == "extra_generated":
                    self.assertIn(
                        "exactly_one_generated_artifact", payload["failed_checks"]
                    )
                elif case == "config_mode":
                    self.assertIn("generated_config_mode_exact", payload["failed_checks"])
                else:
                    self.assertIn(
                        "generated_config_schema_exact", payload["failed_checks"]
                    )

    def test_generic_or_excluded_inventory_cannot_authorize_post_materialization(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            pre_root = self.build_pre_root(base)
            config = self.write_config_authority(base)
            materialized = base / "materialized"
            shutil.copytree(pre_root, materialized, copy_function=shutil.copy2)
            destination = materialized / self.CONFIG_PATH
            destination.parent.mkdir(parents=True)
            shutil.copyfile(config, destination)
            destination.chmod(0o644)

            generic = base / "GENERIC_FILESET.json"
            generic.write_text(
                json.dumps(
                    {
                        "schema": "ncsa_delta_exact_fileset_manifest_v1",
                        "passed": True,
                        "entries": [],
                    }
                ),
                encoding="utf-8",
            )
            generic_proc = self.run_tool(
                "post-materialization",
                "--root",
                str(materialized),
                "--pre-manifest",
                str(generic),
                "--expected-config-file",
                str(config),
                "--expected-schema",
                self.CONFIG_SCHEMA,
                "--output",
                str(base / "GENERIC_FAIL.json"),
            )
            self.assertEqual(generic_proc.returncode, 2)
            self.assertIn("generic inventories", generic_proc.stderr)

            valid_pre = base / "PRE.json"
            self.assertEqual(
                self.run_tool(
                    "pre-materialization",
                    "--root",
                    str(pre_root),
                    "--canonical-config-path",
                    self.CONFIG_PATH,
                    "--output",
                    str(valid_pre),
                ).returncode,
                0,
            )
            excluded_payload = json.loads(valid_pre.read_text(encoding="utf-8"))
            excluded_payload["excluded_artifacts"] = [self.CONFIG_PATH]
            excluded = base / "PRE_WITH_EXCLUSION.json"
            excluded.write_text(
                json.dumps(excluded_payload, sort_keys=True) + "\n", encoding="utf-8"
            )
            excluded_proc = self.run_tool(
                "post-materialization",
                "--root",
                str(materialized),
                "--pre-manifest",
                str(excluded),
                "--expected-config-file",
                str(config),
                "--expected-schema",
                self.CONFIG_SCHEMA,
                "--output",
                str(base / "EXCLUDED_FAIL.json"),
            )
            self.assertEqual(excluded_proc.returncode, 2)
            self.assertIn("excluded_artifacts must be exactly empty", excluded_proc.stderr)

    def test_post_seal_and_replay_fail_on_whole_tree_mode_or_content_drift(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            pre_root = self.build_pre_root(base)
            config = self.write_config_authority(base)
            stage1 = base / "stage1"
            self.assertEqual(
                self.run_tool(
                    "stage1-check",
                    "--pre-root",
                    str(pre_root),
                    "--stage1-root",
                    str(stage1),
                    "--canonical-config-path",
                    self.CONFIG_PATH,
                    "--expected-config-file",
                    str(config),
                    "--expected-schema",
                    self.CONFIG_SCHEMA,
                ).returncode,
                0,
            )
            materialized = stage1 / "materialized"
            sealed_manifest = stage1 / "evidence/POST_SEAL_WHOLE_MANIFEST.json"
            (materialized / self.CONFIG_PATH).chmod(0o640)
            replay_report = base / "REPLAY_FAIL.json"
            replay = self.run_tool(
                "replay-sealed",
                "--root",
                str(materialized),
                "--sealed-manifest",
                str(sealed_manifest),
                "--report",
                str(replay_report),
            )
            self.assertEqual(replay.returncode, 3)
            payload = json.loads(replay_report.read_text(encoding="utf-8"))
            self.assertFalse(payload["whole_manifest_replay_passed"])
            self.assertEqual(
                payload["comparison"]["mode_changed_paths"], [self.CONFIG_PATH]
            )


class StaticFactsTests(unittest.TestCase):
    def test_machine_readable_snapshot_matches_estimator(self) -> None:
        facts_path = ROOT / "references/data/delta-static-facts-2026-08-09.json"
        facts = json.loads(facts_path.read_text(encoding="utf-8"))
        self.assertEqual(facts["last_verified"], "2026-08-09")
        self.assertEqual(set(facts["partitions"]), set(delta_cost.PARTITIONS))
        self.assertEqual(facts["unit_semantics"]["slurm_mem_bare_unit"], "MiB")
        self.assertAlmostEqual(
            facts["unit_semantics"]["boundary_examples"]["a40_a100x4_one_gpu"]["safe_request_decimal_gb"],
            delta_cost.parse_slurm_memory_decimal_gb("58G"),
        )
        for name, partition in delta_cost.PARTITIONS.items():
            snapshot = facts["partitions"][name]
            self.assertEqual(snapshot["node_type"], partition.node_type)
            self.assertAlmostEqual(snapshot["factor"], partition.factor)
            self.assertEqual(snapshot["max_hours"] * 3600, partition.max_seconds)

    def test_checkpoint_demo_resumes(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            temp_path = Path(temp)
            checkpoint_dir = temp_path / "checkpoints"
            request_file = temp_path / "checkpoint.requested"
            command = [
                sys.executable,
                str(ROOT / "assets/examples/checkpoint_signal.py"),
                "--checkpoint-dir",
                str(checkpoint_dir),
                "--request-file",
                str(request_file),
                "--seconds-per-step",
                "0",
                "--checkpoint-every",
                "1",
            ]
            subprocess.run(command + ["--steps", "3"], check=True, text=True, capture_output=True)
            first = json.loads((checkpoint_dir / "latest.json").read_text(encoding="utf-8"))
            self.assertEqual(first["next_step"], 3)
            proc = subprocess.run(command + ["--steps", "5"], check=True, text=True, capture_output=True)
            second = json.loads((checkpoint_dir / "latest.json").read_text(encoding="utf-8"))
            self.assertEqual(second["next_step"], 5)
            self.assertIn("start_step=3", proc.stdout)


class TemplateSafetyTests(unittest.TestCase):
    def test_gpu_templates_are_partition_and_device_portable(self) -> None:
        gpu_templates = []
        for path in sorted((ROOT / "assets/templates").glob("*.slurm")):
            text = path.read_text(encoding="utf-8")
            if "#SBATCH --gpus-" not in text:
                continue
            gpu_templates.append(path.name)
            directive_lines = [
                line for line in text.splitlines() if line.startswith("#SBATCH")
            ]
            directives = "\n".join(directive_lines)
            self.assertNotIn("--partition", directives, path.name)
            self.assertNotIn("--nodelist", directives, path.name)
            self.assertNotIn("--gpu-bind", directives, path.name)
            self.assertNotIn("--gres=gpu:", directives, path.name)
            self.assertNotIn("export CUDA_VISIBLE_DEVICES=", text, path.name)
            self.assertNotIn("cuda:0", text, path.name)
        self.assertGreaterEqual(len(gpu_templates), 7)

        apptainer = (ROOT / "assets/templates/gpu-apptainer.slurm").read_text(
            encoding="utf-8"
        )
        self.assertIn("gpu_runtime_flag=(--nv)", apptainer)
        self.assertIn("gpu_runtime_flag=(--rocm)", apptainer)

    def test_preempt_signals_application_steps_directly(self) -> None:
        text = (ROOT / "assets/templates/preempt-checkpoint.slurm").read_text(encoding="utf-8")
        self.assertIn("#SBATCH --signal=USR1@300", text)
        self.assertNotIn("#SBATCH --signal=B:USR1@300", text)
        self.assertIn("checkpoint_signal.py", text)

    def test_local_tmp_forwards_and_marks_only_final_copy(self) -> None:
        text = (ROOT / "assets/templates/stage-local-tmp.slurm").read_text(encoding="utf-8")
        self.assertIn("#SBATCH --signal=B:USR1@600", text)
        self.assertIn('scancel --signal="$sig" "$SLURM_JOB_ID"', text)
        self.assertIn('wait "$step_pid"', text)
        self.assertIn("copy_back normal 1", text)
        self.assertIn("Early signal syncs", text)

    def test_multinode_run_dir_is_exported_not_spliced(self) -> None:
        text = (ROOT / "assets/templates/gpu-multinode-torchrun.slurm").read_text(encoding="utf-8")
        self.assertIn("export MASTER_ADDR MASTER_PORT GPUS_PER_NODE RUN_DIR", text)
        self.assertIn('--output-dir "$RUN_DIR"', text)
        self.assertNotIn("'$RUN_DIR'", text)
        self.assertIn("bash -c '", text)
        self.assertNotIn("bash -lc '", text)


class GpuRuntimeContractTests(unittest.TestCase):
    @staticmethod
    def fixture(name: str) -> dict:
        return json.loads((ROOT / "tests/fixtures" / name).read_text(encoding="utf-8"))

    def test_idx3_to_visible0_and_idx0_to_visible0_are_both_positive(self) -> None:
        for name in [
            "gpu-runtime-contract-idx3-visible0.json",
            "gpu-runtime-contract-idx0-visible0.json",
        ]:
            with self.subTest(name=name):
                report = delta_gpu_runtime_contract.validate(self.fixture(name))
                self.assertTrue(report["passed"], report)
                self.assertEqual(report["failed_checks"], [])
                self.assertFalse(
                    report["claim_boundary"][
                        "cross_namespace_ordinal_equality_performed"
                    ]
                )
                self.assertFalse(
                    report["claim_boundary"]["gpu_model_uuid_pci_or_node_pinned"]
                )

        idx3 = delta_gpu_runtime_contract.validate(
            self.fixture("gpu-runtime-contract-idx3-visible0.json")
        )
        self.assertEqual(idx3["observed"]["scheduler_node_global"]["gres_indices"], [3])
        self.assertEqual(
            idx3["observed"]["allocation_visible"]["nvidia_smi_visible_indices"],
            [0],
        )
        self.assertEqual(idx3["observed"]["framework_local"]["torch_local_indices"], [0])

    def test_python_symlink_and_usable_memory_difference_are_valid(self) -> None:
        report = delta_gpu_runtime_contract.validate(
            self.fixture("gpu-runtime-contract-idx3-visible0.json")
        )
        self.assertTrue(report["passed"])
        self.assertFalse(report["observed"]["python"]["lexical_equals_resolved"])
        self.assertTrue(
            report["checks"]["python_lexical_launcher_matches_expected_lexical"]
        )
        self.assertTrue(
            report["checks"]["python_resolved_target_matches_expected_resolved"]
        )
        join = report["observed"]["same_allocation_observational_joins"][0]
        self.assertGreater(join["board_minus_torch_usable_bytes"], 0)
        self.assertTrue(join["meets_declared_minimum"])

    def test_required_negative_fixtures_fail_closed(self) -> None:
        base = self.fixture("gpu-runtime-contract-idx3-visible0.json")
        cases = []

        scheduler_count = copy.deepcopy(base)
        scheduler_count["scheduler"]["scontrol_gres_detail"] = (
            "gpu:nvidia_a100:2(IDX:2-3)"
        )
        cases.append(
            (scheduler_count, "scheduler_gres_count_matches_request")
        )

        uuid_mismatch = copy.deepcopy(base)
        uuid_mismatch["torch"]["devices"][0]["uuid"] = "GPU-different-observation"
        cases.append((uuid_mismatch, "same_allocation_uuid_join_unique"))

        torch_unavailable = copy.deepcopy(base)
        torch_unavailable["torch"]["available"] = False
        cases.append((torch_unavailable, "torch_accelerator_available"))

        multi_visible = copy.deepcopy(base)
        multi_visible["allocation_visible"]["cuda_visible_devices"] = "0,1"
        second_row = copy.deepcopy(
            multi_visible["allocation_visible"]["nvidia_smi_rows"][0]
        )
        second_row.update(
            {
                "visible_index": 1,
                "uuid": "GPU-second-visible",
                "pci_bus_id": "00000000:D8:00.0",
            }
        )
        multi_visible["allocation_visible"]["nvidia_smi_rows"].append(second_row)
        cases.append((multi_visible, "nvidia_visible_row_count_matches_request"))

        below_minimum = copy.deepcopy(base)
        below_minimum["minimum_usable_memory_bytes"] = (
            below_minimum["torch"]["devices"][0]["usable_memory_bytes"] + 1
        )
        cases.append((below_minimum, "torch_usable_memory_meets_declared_minimum"))

        resolved_mixed_with_lexical = copy.deepcopy(base)
        resolved_mixed_with_lexical["python"]["resolved_target"] = (
            resolved_mixed_with_lexical["python"]["lexical_launcher"]
        )
        cases.append(
            (
                resolved_mixed_with_lexical,
                "python_resolved_target_matches_expected_resolved",
            )
        )

        above_board = copy.deepcopy(base)
        above_board["torch"]["devices"][0]["usable_memory_bytes"] = (
            above_board["allocation_visible"]["nvidia_smi_rows"][0][
                "memory_total_mib"
            ]
            * 1024
            * 1024
            + 1
        )
        cases.append(
            (
                above_board,
                "torch_usable_memory_positive_and_not_above_board_total",
            )
        )

        for payload, expected_failed_check in cases:
            with self.subTest(expected_failed_check=expected_failed_check):
                report = delta_gpu_runtime_contract.validate(payload)
                self.assertFalse(report["passed"], report)
                self.assertIn(expected_failed_check, report["failed_checks"])

    def test_cli_report_is_write_once(self) -> None:
        fixture = ROOT / "tests/fixtures/gpu-runtime-contract-idx3-visible0.json"
        with tempfile.TemporaryDirectory() as temp:
            report_path = Path(temp) / "RUNTIME_CONTRACT_REPORT.json"
            command = [
                sys.executable,
                str(SCRIPTS / "delta-gpu-runtime-contract.py"),
                "--input",
                str(fixture),
                "--output",
                str(report_path),
            ]
            first = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(first.returncode, 0, first.stderr)
            self.assertTrue(json.loads(report_path.read_text(encoding="utf-8"))["passed"])
            second = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
            self.assertEqual(second.returncode, 4)
            self.assertIn("refusing to replace existing report", second.stderr)


class ConnectionGuideTests(unittest.TestCase):
    def test_connection_guide_covers_every_layer_without_personal_identity(self) -> None:
        text = (ROOT / "references/01-access-and-quickstart.md").read_text(encoding="utf-8")
        for required in [
            "Remote Control",
            "delta-codex",
            "ControlPersist 7d",
            "NCSA Kerberos",
            "NCSA Duo",
            "codex login --device-auth",
            "codex login status",
            "DELTA_CODEX_OK",
            "ssh -O check delta-codex",
            "caffeinate -is -w",
            "Connected",
        ]:
            self.assertIn(required, text)
        self.assertIn("CHANGE_ME_NCSA_USERNAME", text)

    def test_skill_description_can_trigger_for_remote_connection(self) -> None:
        text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        frontmatter = text.split("---\n", 2)[1]
        for required in ["Remote Control", "Delta SSH/Codex", "NCSA Kerberos + Duo"]:
            self.assertIn(required, frontmatter)

    def test_openai_interface_uses_supported_product_values(self) -> None:
        text = (ROOT / "agents/openai.yaml").read_text(encoding="utf-8")
        self.assertIn("  - chatgpt", text)
        self.assertIn("  - codex", text)
        self.assertIn("  - atlas", text)
        self.assertNotIn("  - api", text)


class GpuPortabilityRecoveryGuideTests(unittest.TestCase):
    def test_recovery_guide_is_routed_and_covers_safety_contract(self) -> None:
        guide_path = ROOT / "references/11-gpu-portability-and-recovery.md"
        guide = guide_path.read_text(encoding="utf-8")
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn(guide_path.name, skill)
        for required in [
            "GPU 无绑定可移植性",
            "submission-partition",
            "actual JobID",
            "GPU 型号/UUID",
            "不得检查",
            "只作观察性 receipt",
            "PENDING",
            "EndTime",
            "afterany",
            "DependencyNeverSatisfied",
            "pre-mutation engineering failure",
            "import origin",
            "--no-xattrs",
            "cluster_local",
            "sleep",
            "/projects",
            "/work/hdd",
            "/work/nvme",
        ]:
            self.assertIn(required, guide)
        for obsolete in [
            "complement-cardinality",
            "guard-window",
            "必须命中预注册 UUID",
        ]:
            self.assertNotIn(obsolete, guide)
        self.assertNotIn("Exp11", guide)
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        for required in [
            "不得随便中断、修改或重复提交正在排队的作业",
            "重新排队",
            "不得绑定 GPU 型号、物理卡、节点或固定设备编号",
        ]:
            self.assertIn(required, skill)
        self.assertEqual((ROOT / "VERSION").read_text(encoding="utf-8").strip(), "0.4.5")


class RuntimeNamespaceSingleWriterGuideTests(unittest.TestCase):
    def test_runtime_namespace_and_single_writer_guide_is_routed(self) -> None:
        guide_path = (
            ROOT / "references/13-runtime-gpu-namespaces-and-single-writer-operators.md"
        )
        guide = guide_path.read_text(encoding="utf-8")
        for routed_from in [
            ROOT / "SKILL.md",
            ROOT / "README.md",
            ROOT / "MANIFEST.md",
        ]:
            self.assertIn(guide_path.name, routed_from.read_text(encoding="utf-8"))

        for required in [
            "三个 ordinal namespace",
            "scheduler/node-global",
            "allocation-visible inventory",
            "framework/process-local",
            "IDX=3",
            "IDX=0",
            "严禁跨域 ordinal equality",
            "lexical launcher",
            "resolved target",
            "Torch usable memory",
            "board-total memory",
            "duplicate `FATAL`",
            "exact PID",
            "starttime",
            "真实 wait exit",
            "write-once",
            "aggregate `COMPLETE.json`",
            "single-writer",
        ]:
            self.assertIn(required, guide)
        for forbidden in ["Exp11", "/Users/everett", "/projects/bibp/xhu10"]:
            self.assertNotIn(forbidden, guide)

        script = ROOT / "scripts/delta-gpu-runtime-contract.py"
        implementation = ROOT / "scripts/delta_gpu_runtime_contract.py"
        self.assertTrue(script.is_file())
        self.assertTrue(implementation.is_file())
        self.assertIn("no_cross_namespace_ordinal_equality_required", implementation.read_text(encoding="utf-8"))
        self.assertEqual((ROOT / "VERSION").read_text(encoding="utf-8").strip(), "0.4.5")


class FormalDeploymentPreflightGuideTests(unittest.TestCase):
    def test_formal_deployment_guide_is_routed_and_complete(self) -> None:
        guide_path = (
            ROOT / "references/12-formal-deployment-preflight-and-runtime-closure.md"
        )
        guide = guide_path.read_text(encoding="utf-8")
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        manifest = (ROOT / "MANIFEST.md").read_text(encoding="utf-8")
        readme = (ROOT / "README.md").read_text(encoding="utf-8")

        for routed_from in [skill, manifest, readme]:
            self.assertIn(guide_path.name, routed_from)

        for required in [
            "3.9.18",
            "3.11.13",
            "module use /sw/rh9.4/user/modules/python/.conda-env",
            "module --ignore_cache load",
            "sys.executable",
            "readlink -f",
            "PYTHONNOUSERSITE=1",
            "PYTHONDONTWRITEBYTECODE=1",
            "tempfile.TemporaryDirectory",
            "formal_runtime_dependencies",
            "conversion_only_dependencies",
            "immutable hashed overlay",
            "--require-hashes",
            "COPYFILE_DISABLE=1",
            "--no-xattrs",
            "umask",
            "mode normalization",
            "unittest log",
            "failure_test_ids",
            "error_test_ids",
            "F3",
            "D03",
            "D06",
            "immutable attempt identity",
            "exact writable mirror",
            "prelaunch engineering failure",
        ]:
            self.assertIn(required, guide)

        for forbidden in ["Exp11", "/Users/everett", "/projects/bibp/xhu10"]:
            self.assertNotIn(forbidden, guide)

        for required in [
            "formal source 一旦 seal 就绝不作为测试工作目录",
            "完整日志",
            "failure/error test IDs",
        ]:
            self.assertIn(required, skill)

        self.assertEqual((ROOT / "VERSION").read_text(encoding="utf-8").strip(), "0.4.5")


class ModeProjectionGuideTests(unittest.TestCase):
    def test_mode_projection_guide_is_routed_complete_and_generic(self) -> None:
        guide_path = ROOT / "references/14-sealed-parent-overlay-mode-projection.md"
        guide = guide_path.read_text(encoding="utf-8")
        for routed_from in [ROOT / "SKILL.md", ROOT / "README.md", ROOT / "MANIFEST.md"]:
            self.assertIn(guide_path.name, routed_from.read_text(encoding="utf-8"))

        for required in [
            "sealed parent",
            "signed overlay",
            "mode-stripped content rows",
            "base-only",
            "0440",
            "0644",
            "0750",
            "local writable full-tree modes used as authority",
            "Stage1",
            "disposable",
            "postpublish_projected_rows_digest_sha256",
            "partial/incoming",
            "完整 execution identity",
            "不只换 recovery-id",
            "mode/content/path/size tamper",
            "generated artifact",
            "pre-materialization",
            "post-materialization",
            "excluded_artifacts=[]",
            "exact path/type/size/SHA256/mode/schema",
            "whole-tree manifest",
            "whole-manifest replay",
            "materialize → post-inventory → seal → replay",
        ]:
            self.assertIn(required, guide)
        for forbidden in [
            "Exp11",
            "/Users/everett",
            "/projects/bibp",
            "xhu10",
            "210",
        ]:
            self.assertNotIn(forbidden, guide)

        cli = ROOT / "scripts/delta-mode-projection.py"
        implementation = ROOT / "scripts/delta_mode_projection.py"
        phase_cli = ROOT / "scripts/delta-phase-inventory.py"
        phase_implementation = ROOT / "scripts/delta_phase_inventory.py"
        self.assertTrue(cli.is_file())
        self.assertTrue(implementation.is_file())
        self.assertTrue(phase_cli.is_file())
        self.assertTrue(phase_implementation.is_file())
        implementation_text = implementation.read_text(encoding="utf-8")
        for required in [
            "base_only_rows_inherit_sealed_parent_exactly",
            "overlay_rows_replace_with_signed_row_exactly",
            "local_full_modes_not_used_as_deployment_authority",
            "postpublish_projected_rows_digest_sha256",
        ]:
            self.assertIn(required, implementation_text)
        phase_text = phase_implementation.read_text(encoding="utf-8")
        for required in [
            "canonical_generated_config_absent",
            "non_generated_projected_rows_unchanged",
            "exactly_one_generated_artifact",
            "generated_config_schema_exact",
            "whole_tree_paths_content_and_sealed_modes_exact",
            "whole_manifest_replay_passed",
            "generic_exclusion_defaults_accepted",
            "stage1_round_trip",
        ]:
            self.assertIn(required, phase_text)
        self.assertEqual((ROOT / "VERSION").read_text(encoding="utf-8").strip(), "0.4.5")


class LiveInterfaceRegressionTests(unittest.TestCase):
    def test_jobcharge_commands_use_account_option(self) -> None:
        paths = [
            ROOT / "SKILL.md",
            ROOT / "references/02-accounts-and-accounting.md",
            ROOT / "references/09-maintenance-and-live-verification.md",
            ROOT / "scripts/delta-job-report.sh",
            ROOT / "scripts/delta-doctor.sh",
            ROOT / "scripts/delta_cost.py",
        ]
        combined = "\n".join(path.read_text(encoding="utf-8") for path in paths)
        self.assertIn("jobcharge -a <ACCOUNT>", combined)
        self.assertIn('jobcharge -a "$account"', combined)
        self.assertNotIn("jobcharge <ACCOUNT>", combined)
        self.assertNotIn("jobcharge ACCOUNT", combined)

    @unittest.skipUnless(shutil.which("jobcharge"), "NCSA jobcharge is not installed")
    def test_live_jobcharge_help_exposes_account_option(self) -> None:
        proc = subprocess.run(
            ["jobcharge", "-h"], text=True, capture_output=True, check=True
        )
        self.assertIn("-a ACCOUNT", proc.stdout)

    def test_templates_default_to_user_scoped_storage(self) -> None:
        for path in sorted((ROOT / "assets/templates").glob("*.slurm")):
            text = path.read_text(encoding="utf-8")
            if "/projects/" in text:
                self.assertIn('/${USER}', text, path.name)
            if "/work/hdd/" in text:
                self.assertIn("/%u/logs/", text, path.name)

        profile = (ROOT / "assets/examples/delta-profile.env.example").read_text(
            encoding="utf-8"
        )
        self.assertIn("/projects/CHANGE_ME_PROJECT/$USER", profile)
        self.assertIn("/work/hdd/CHANGE_ME_PROJECT/$USER", profile)
        self.assertIn("/work/nvme/CHANGE_ME_PROJECT/$USER", profile)

    def test_delta_environment_recovery_contract_is_preserved(self) -> None:
        skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
        software = (ROOT / "references/07-software-and-reproducibility.md").read_text(
            encoding="utf-8"
        )
        storage = (ROOT / "references/05-storage-and-data.md").read_text(encoding="utf-8")
        troubleshooting = (
            ROOT / "references/08-monitoring-and-troubleshooting.md"
        ).read_text(encoding="utf-8")
        slurm = (ROOT / "references/06-slurm-recipes.md").read_text(encoding="utf-8")
        combined = "\n".join([skill, software, storage, slurm, troubleshooting])
        for required in [
            "python/.conda-env/pytorch/2.8-cu128",
            "module use /sw/rh9.4/user/modules/python/.conda-env",
            "pytorch/2.8-cu128",
            "Python `3.11.13`",
            "Torch `2.8.0+cu128`",
            "Torch CUDA build `12.8`",
            "pre-application environment failure",
            "immutable attempt identity",
            "range() arg 3 must not be zero",
            "tar stream",
            "fchmodat",
            "sha256sum -c",
            "zsh",
            "`path`",
            "COPYFILE_DISABLE=1",
            "tar --no-xattrs",
            "delta-fileset-manifest.py",
            "AppleDouble `._*`",
            "3.9.18",
            "dataclass(slots=True)",
            "PROJECT_SEMANTIC_PREFLIGHT_RUNTIME.json",
            "planning JobID",
            "actual JobID",
            "SBATCH_TEST_ONLY.txt",
            "SBATCH_ACTUAL_PARSABLE.txt",
            "ACTUAL_JOB_ID.txt",
            "`load_method`",
            "`wrapper_rc`",
            "`module_list`",
            "pre-formal infrastructure false rejection",
        ]:
            self.assertIn(required, combined)

        loader = ROOT / "scripts/delta-load-pytorch-2.8-cu128.sh"
        receipt = ROOT / "scripts/delta-pytorch-runtime-receipt.py"
        fileset = ROOT / "scripts/delta-fileset-manifest.py"
        self.assertTrue(loader.exists())
        self.assertTrue(receipt.exists())
        self.assertTrue(fileset.exists())
        loader_text = loader.read_text(encoding="utf-8")
        for required in [
            "module --ignore_cache load pytorch-conda/2.8",
            "module use /sw/rh9.4/user/modules/python/.conda-env",
            "module --ignore_cache load cudatoolkit/25.3_12.8",
            "module --ignore_cache load pytorch/2.8-cu128",
        ]:
            self.assertIn(required, loader_text)
        self.assertIn("python -m PROJECT_PREFLIGHT", loader_text)
        receipt_text = receipt.read_text(encoding="utf-8")
        self.assertIn("CORE_RUNTIME_PARITY_FIELDS", receipt_text)
        self.assertIn("OBSERVATION_ONLY_FIELDS", receipt_text)
        self.assertEqual((ROOT / "VERSION").read_text(encoding="utf-8").strip(), "0.4.5")


class CliTests(unittest.TestCase):
    def run_json(self, command: list[str]) -> dict:
        proc = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=True)
        return json.loads(proc.stdout)

    def test_cost_cli(self) -> None:
        data = self.run_json(
            [
                sys.executable,
                str(SCRIPTS / "delta-cost.py"),
                "--partition",
                "gpuA100x4",
                "--nodes",
                "1",
                "--gpus-per-node",
                "1",
                "--cpus-per-node",
                "16",
                "--mem",
                "58G",
                "--elapsed",
                "20m",
                "--walltime",
                "30m",
                "--json",
            ]
        )
        self.assertAlmostEqual(data["estimated_actual_su"], 1.0 / 3.0)
        self.assertEqual(data["request"]["mem_input"], "--mem=58G")
        self.assertLess(data["request"]["mem_gb_decimal_per_node"], 62.5)

    def test_advisor_cli(self) -> None:
        data = self.run_json(
            [
                sys.executable,
                str(SCRIPTS / "delta-time-advisor.py"),
                "--input",
                str(ROOT / "tests/fixtures/sacct-history.txt"),
                "--partition",
                "gpuA100x4",
                "--json",
            ]
        )
        self.assertEqual(data["statistics"]["count"], 6)


if __name__ == "__main__":
    unittest.main(verbosity=2)
