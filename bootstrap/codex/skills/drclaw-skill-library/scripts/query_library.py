#!/usr/bin/env python3
"""Query the versioned Dr. Claw skill library without third-party packages."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple


WORD_RE = re.compile(r"[a-z0-9][a-z0-9+._-]*", re.IGNORECASE)
INLINE_VALUE_RE = re.compile(r"^([A-Za-z0-9_-]+):\s*(.*)$")

QUERY_ALIASES = {
    "论文": "paper writing publication manuscript",
    "写作": "writing paper scientific",
    "文献": "literature survey search retrieval paper",
    "调研": "survey research literature",
    "引用": "citation reference audit",
    "参考文献": "citation reference bibliography",
    "实验": "experiment training evaluation",
    "训练": "training fine-tuning distributed",
    "分析": "analysis evaluation results statistics",
    "结果": "results analysis claim",
    "想法": "idea ideation hypothesis brainstorming",
    "创新": "novelty idea evaluation",
    "审稿": "review reviewer rebuttal",
    "回复": "rebuttal reviewer response",
    "图表": "figure visualization plot",
    "插图": "illustration figure",
    "海报": "poster publication",
    "幻灯片": "slides presentation",
    "演示": "presentation slides",
    "数据": "data dataset processing",
    "数据集": "dataset discovery curation",
    "代码": "code implementation survey",
    "微调": "fine-tuning training peft",
    "分布式": "distributed training",
    "部署": "deployment inference serving",
    "推理": "inference serving optimization",
    "量化": "quantization optimization",
    "压缩": "compression pruning distillation quantization",
    "安全": "safety alignment guardrail",
    "生物": "bioinformatics biomedical",
    "新闻": "news research briefing",
}


def _strip_scalar(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
        return value[1:-1]
    return value


def parse_frontmatter(path: Path) -> Tuple[Optional[str], Optional[str]]:
    """Read only name/description from the simple YAML frontmatter used by skills."""
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return None, None
    if not lines or lines[0].strip() != "---":
        return None, None

    body: List[str] = []
    for line in lines[1:]:
        if line.strip() == "---":
            break
        body.append(line)

    values: Dict[str, str] = {}
    index = 0
    while index < len(body):
        match = INLINE_VALUE_RE.match(body[index])
        if not match:
            index += 1
            continue
        key, raw_value = match.groups()
        if key not in {"name", "description"}:
            index += 1
            continue
        if raw_value.strip() in {"|", "|-", ">", ">-", ">+"}:
            chunks: List[str] = []
            index += 1
            while index < len(body):
                next_line = body[index]
                if next_line and not next_line[0].isspace():
                    break
                stripped = next_line.strip()
                if stripped:
                    chunks.append(stripped)
                index += 1
            values[key] = " ".join(chunks)
            continue
        values[key] = _strip_scalar(raw_value)
        index += 1
    return values.get("name"), values.get("description")


def find_repo_root(explicit: Optional[str] = None) -> Path:
    candidates: List[Path] = []
    if explicit:
        candidates.append(Path(explicit).expanduser())
    configured = os.environ.get("DRCLAW_REPO_ROOT")
    if configured:
        candidates.append(Path(configured).expanduser())

    # Symlink installs resolve back into the checkout automatically. Copy-mode
    # installs cannot, so use the bootstrap's secret-free state file as the
    # durable pointer to the approved source tree.
    state_homes = [Path.home() / ".codex"]
    if os.environ.get("CODEX_HOME"):
        state_homes.insert(0, Path(os.environ["CODEX_HOME"]).expanduser())
    for codex_home in state_homes:
        state_path = codex_home / "drclaw-bootstrap-state.json"
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
            state_repo = state.get("repo_root")
            if isinstance(state_repo, str) and state_repo.strip():
                candidates.append(Path(state_repo).expanduser())
        except (OSError, ValueError, json.JSONDecodeError):
            pass

    candidates.extend(Path(__file__).resolve().parents)
    candidates.extend(Path.cwd().resolve().parents)
    candidates.append(Path.cwd().resolve())

    seen = set()
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved in seen:
            continue
        seen.add(resolved)
        if (resolved / "skills" / "skills-catalog-v2.json").is_file() and (
            resolved / "skills"
        ).is_dir():
            return resolved
    raise RuntimeError(
        "Could not locate the Dr. Claw repository. Set DRCLAW_REPO_ROOT or pass --repo-root."
    )


def _safe_skill_path(repo_root: Path, relative_path: str) -> Optional[Path]:
    candidate = (repo_root / relative_path).resolve()
    skills_root = (repo_root / "skills").resolve()
    try:
        candidate.relative_to(skills_root)
    except ValueError:
        return None
    return candidate if candidate.is_file() else None


def load_records(repo_root: Path) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    catalog_path = repo_root / "skills" / "skills-catalog-v2.json"
    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    catalog_items = catalog.get("skills", [])
    records_by_path: Dict[str, Dict[str, Any]] = {}

    for item in catalog_items:
        relative_path = str(item.get("legacy", {}).get("skillFile", ""))
        skill_path = _safe_skill_path(repo_root, relative_path)
        if skill_path is None:
            continue
        key = str(skill_path.relative_to(repo_root))
        records_by_path[key] = {
            "name": str(item.get("name") or skill_path.parent.name),
            "path": key,
            "summary": str(item.get("summary") or ""),
            "primary_intent": str(item.get("primaryIntent") or ""),
            "intents": list(item.get("intents") or []),
            "capabilities": list(item.get("capabilities") or []),
            "domains": list(item.get("domains") or []),
            "keywords": list(item.get("keywords") or []),
            "source": str(item.get("source") or ""),
            "status": str(item.get("status") or ""),
            "indexed": True,
        }

    disk_paths = sorted((repo_root / "skills").rglob("SKILL.md"))
    invalid: List[str] = []
    for skill_path in disk_paths:
        relative = skill_path.relative_to(repo_root)
        if any(part.startswith(".") for part in relative.parts):
            continue
        key = str(relative)
        name, description = parse_frontmatter(skill_path)
        if not name or not description:
            invalid.append(key)
        if key not in records_by_path:
            records_by_path[key] = {
                "name": name or skill_path.parent.name,
                "path": key,
                "summary": description or "",
                "primary_intent": "",
                "intents": [],
                "capabilities": [],
                "domains": [],
                "keywords": [],
                "source": "filesystem",
                "status": "unindexed",
                "indexed": False,
            }

    records = sorted(records_by_path.values(), key=lambda item: (item["name"], item["path"]))
    meta = {
        "repo_root": str(repo_root),
        "catalog_path": str(catalog_path),
        "catalog_declared_count": catalog.get("totalSkills"),
        "catalog_loaded_count": len(catalog_items),
        "disk_skill_count": len(disk_paths),
        "record_count": len(records),
        "unindexed_paths": [record["path"] for record in records if not record["indexed"]],
        "invalid_frontmatter_paths": invalid,
    }
    return records, meta


def expand_query(query: str) -> str:
    additions = [english for chinese, english in QUERY_ALIASES.items() if chinese in query]
    return " ".join([query] + additions)


def tokenize(text: str) -> List[str]:
    return sorted(set(token.lower() for token in WORD_RE.findall(text)))


def score_record(record: Dict[str, Any], query: str) -> Tuple[int, List[str]]:
    expanded = expand_query(query)
    tokens = tokenize(expanded)
    if not tokens:
        return 0, []

    name = record["name"].lower()
    path = record["path"].lower()
    summary = record["summary"].lower()
    primary = record["primary_intent"].lower()
    keywords = {str(value).lower() for value in record["keywords"]}
    intents = {str(value).lower() for value in record["intents"]}
    capabilities = {str(value).lower() for value in record["capabilities"]}
    domains = {str(value).lower() for value in record["domains"]}

    score = 0
    reasons: List[str] = []
    normalized_query = "-".join(tokens)
    if normalized_query == name or expanded.strip().lower() == name:
        score += 100
        reasons.append("exact-name")

    for token in tokens:
        token_score = 0
        if token == name or token in name.split("-"):
            token_score += 14
        elif token in name:
            token_score += 9
        if token in path:
            token_score += 3
        if token == primary:
            token_score += 8
        if token in keywords:
            token_score += 7
        if token in intents:
            token_score += 6
        if token in capabilities:
            token_score += 6
        if token in domains:
            token_score += 4
        if token in summary:
            token_score += 2
        if token_score:
            score += token_score
            reasons.append(f"{token}:{token_score}")
    return score, reasons


def ranked_records(records: Sequence[Dict[str, Any]], query: str) -> List[Dict[str, Any]]:
    ranked: List[Dict[str, Any]] = []
    for record in records:
        score, reasons = score_record(record, query)
        if score <= 0:
            continue
        candidate = dict(record)
        candidate["score"] = score
        candidate["match_reasons"] = reasons
        ranked.append(candidate)
    return sorted(ranked, key=lambda item: (-item["score"], item["name"], item["path"]))


def resolve_managed_skill(repo_root: Path, value: str) -> List[Dict[str, Any]]:
    """Resolve an exact bootstrap-managed companion skill outside `skills/`."""

    manifest_path = repo_root / "bootstrap" / "codex" / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = manifest.get("components", {}).get("user_skills", [])
    except (OSError, ValueError, json.JSONDecodeError, AttributeError):
        return []

    needle = value.strip().lower()
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name") or "")
        source = str(entry.get("source") or "")
        if needle not in {name.lower(), Path(source).name.lower()}:
            continue
        candidate = (repo_root / source / "SKILL.md").resolve()
        try:
            relative = candidate.relative_to(repo_root.resolve())
        except ValueError:
            continue
        if not candidate.is_file():
            continue
        frontmatter_name, description = parse_frontmatter(candidate)
        return [
            {
                "name": frontmatter_name or name,
                "path": str(relative),
                "summary": description or "Bootstrap-managed companion skill",
                "primary_intent": "",
                "intents": [],
                "capabilities": [],
                "domains": [],
                "keywords": [],
                "source": "bootstrap-managed",
                "status": "managed",
                "indexed": True,
            }
        ]
    return []


def resolve_record(
    records: Sequence[Dict[str, Any]], value: str, repo_root: Path
) -> List[Dict[str, Any]]:
    needle = value.strip().lower()
    exact = [record for record in records if record["name"].lower() == needle]
    if exact:
        return exact
    aliases = [
        record
        for record in records
        if Path(record["path"]).parent.name.lower() == needle
        or record["path"].lower() == needle
    ]
    return aliases or resolve_managed_skill(repo_root, value)


def markdown(records: Sequence[Dict[str, Any]], repo_root: Path, include_score: bool) -> str:
    headers = ["Skill", "Path", "Summary"]
    if include_score:
        headers.insert(0, "Score")
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join(["---"] * len(headers)) + "|"]
    for record in records:
        summary = re.sub(r"\s+", " ", record["summary"]).replace("|", "/").strip()
        if len(summary) > 180:
            summary = summary[:177] + "..."
        row = [record["name"], str(repo_root / record["path"]), summary]
        if include_score:
            row.insert(0, str(record.get("score", "")))
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def emit(records: Sequence[Dict[str, Any]], meta: Dict[str, Any], output_format: str, query: str) -> None:
    repo_root = Path(meta["repo_root"])
    if output_format == "json":
        payload = dict(meta)
        payload.update({"query": query, "results": list(records)})
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    if output_format == "paths":
        for record in records:
            print(repo_root / record["path"])
        return
    print(markdown(records, repo_root, include_score=bool(query)))


def validation_report(records: Sequence[Dict[str, Any]], meta: Dict[str, Any]) -> int:
    names: Dict[str, List[str]] = {}
    for record in records:
        names.setdefault(record["name"], []).append(record["path"])
    duplicates = {name: paths for name, paths in names.items() if len(paths) > 1}

    report = dict(meta)
    report["duplicate_names"] = duplicates
    report["valid"] = not meta["invalid_frontmatter_paths"] and not duplicates
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["valid"] else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", help="Explicit Dr. Claw repository root")
    parser.add_argument("--query", default="", help="Task terms to match")
    parser.add_argument("--limit", type=int, default=5, help="Maximum query results")
    parser.add_argument("--format", choices=("markdown", "json", "paths"), default="markdown")
    parser.add_argument("--all", action="store_true", help="List the complete compact index")
    parser.add_argument("--resolve", help="Resolve an exact skill or directory name")
    parser.add_argument("--validate", action="store_true", help="Validate disk/catalog structure")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_parser().parse_args(argv)
    if args.limit < 1:
        raise SystemExit("--limit must be at least 1")
    try:
        repo_root = find_repo_root(args.repo_root)
        records, meta = load_records(repo_root)
    except (OSError, ValueError, json.JSONDecodeError, RuntimeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 2

    if args.validate:
        return validation_report(records, meta)
    if args.resolve:
        resolved = resolve_record(records, args.resolve, repo_root)
        if not resolved:
            print(f"No exact skill match for: {args.resolve}", file=sys.stderr)
            return 3
        emit(resolved, meta, args.format, args.resolve)
        return 0
    if args.all:
        emit(records, meta, args.format, "")
        return 0
    if not args.query.strip():
        print("Provide --query, --resolve, --all, or --validate.", file=sys.stderr)
        return 2

    ranked = ranked_records(records, args.query)[: args.limit]
    if not ranked:
        print("No positive match. Refine the query or use --all.", file=sys.stderr)
        return 3
    emit(ranked, meta, args.format, args.query)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
