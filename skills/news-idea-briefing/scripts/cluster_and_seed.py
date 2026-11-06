#!/usr/bin/env python3
"""
Aggregate news-results-*.json into a clustered candidate list for the
news-idea-briefing skill.

This script does the deterministic, mechanical part:
  - read every news-results-*.json under --news-data-dir
  - normalize score fields (arxiv nests under .scores.final, others use flat *_score)
  - dedupe items by canonical id (arxiv ID > repo URL > HF repo id > title hash)
  - cross-source-merge: when the same canonical id appears across sources,
    the entry's `sources[]` lists every appearance with its per-source score
  - group items into preliminary clusters keyed by (matched_domain, top-1 keyword)
  - emit candidates.json per skills/news-idea-briefing/references/contract.md

The LLM-driven cluster refinement + idea-seed generation happens in the
SKILL.md workflow. This script never invents content.

Usage:
    python cluster_and_seed.py \\
        --news-data-dir "$DRCLAW_NEWS_DATA_DIR" \\
        --output ./.cache/news-idea-briefing/candidates.json \\
        --top-n-per-cluster 6 \\
        --min-score 3.5
"""

from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

ARXIV_ID_RE = re.compile(
    r"(?:arxiv\.org/(?:abs|pdf)/|arxiv:|huggingface\.co/papers/)\s*"
    r"([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?)",
    re.I,
)
# A bare arxiv-shaped id like "2604.24927" or "2604.24927v1" — used as a
# fallback when an item's `id` field IS the arxiv id (HF Daily Papers does this).
BARE_ARXIV_ID_RE = re.compile(r"^[0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?$")
GITHUB_REPO_RE = re.compile(r"github\.com/([^/\s]+)/([^/\s#?]+)", re.I)
HF_REPO_RE = re.compile(r"huggingface\.co/(?:papers/|spaces/|datasets/)?([^/\s]+/[^/\s#?]+)", re.I)
WS_RE = re.compile(r"\s+")


# ---------------------------------------------------------------------------
# IO
# ---------------------------------------------------------------------------
def discover_results_files(news_data_dir: Path) -> List[Path]:
    pattern = "news-results-*.json"
    files = sorted(news_data_dir.glob(pattern))
    # Skip the unified.json sibling artifact (Phase 3 / Option B2 will produce
    # it; if present it would double-count).
    files = [f for f in files if f.name != "news-results-unified.json"]
    return files


def load_json(path: Path) -> Optional[Dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None
    except (json.JSONDecodeError, OSError) as exc:
        logger.warning("[news-idea-briefing] failed to read %s: %s", path, exc)
        return None


# ---------------------------------------------------------------------------
# Score normalization
# ---------------------------------------------------------------------------
def extract_score(item: Dict[str, Any]) -> float:
    """
    Source crawlers are inconsistent: arXiv nests scores under `scores.final`,
    everything else uses flat `final_score`. This unifies them into a single
    float in [0, 10].
    """
    if isinstance(item.get("scores"), dict) and "final" in item["scores"]:
        try:
            return float(item["scores"]["final"])
        except (TypeError, ValueError):
            pass
    flat = item.get("final_score")
    if flat is not None:
        try:
            return float(flat)
        except (TypeError, ValueError):
            pass
    return 0.0


def extract_subscores(item: Dict[str, Any]) -> Dict[str, float]:
    """Pull (relevance, recency, popularity, quality) wherever they live."""
    out: Dict[str, float] = {}
    if isinstance(item.get("scores"), dict):
        for k in ("relevance", "recency", "popularity", "quality"):
            if k in item["scores"]:
                try:
                    out[k] = float(item["scores"][k])
                except (TypeError, ValueError):
                    pass
    for k in ("relevance", "recency", "popularity", "quality"):
        flat = item.get(f"{k}_score")
        if flat is not None and k not in out:
            try:
                out[k] = float(flat)
            except (TypeError, ValueError):
                pass
    return out


# ---------------------------------------------------------------------------
# Canonicalization
# ---------------------------------------------------------------------------
def _title_hash(title: str) -> str:
    norm = WS_RE.sub(" ", (title or "").lower()).strip()
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:12]


def canonical_id(item: Dict[str, Any]) -> str:
    """
    Resolve to a stable cross-source identifier, in priority order:
        arxiv:<id>  >  gh:owner/repo  >  hf:owner/repo  >
        wechat:<route>:<title_hash[:4]>  >  xhs:<id>  >  x:<id>  >
        title:<title_hash>
    """
    source = (item.get("source") or "").lower()
    kind = (item.get("kind") or "").lower()

    # arXiv: extract from any URL-shaped field first
    candidates = [
        item.get("id"),
        item.get("url"),
        item.get("link"),
        item.get("pdf_url"),
        item.get("pdf_link"),
        item.get("arxiv_id"),
    ]
    for c in candidates:
        if not isinstance(c, str):
            continue
        m = ARXIV_ID_RE.search(c)
        if m:
            return f"arxiv:{m.group(1)}"

    # Bare-id fallback: HF Daily Papers stores the arxiv id directly in `id`.
    # Only trust this for items we know are paper-shaped (HF papers / arxiv source).
    bare = item.get("id") or item.get("arxiv_id")
    if isinstance(bare, str) and BARE_ARXIV_ID_RE.match(bare.strip()):
        if source == "arxiv" or kind == "papers" or "paper" in kind:
            return f"arxiv:{bare.strip()}"

    # HuggingFace Hub repos (models / datasets / spaces) — non-paper kinds
    hub_id = item.get("hub_id") or item.get("repo_id")
    if isinstance(hub_id, str) and "/" in hub_id and source.startswith("huggingface"):
        return f"hf:{hub_id}"

    # GitHub
    for c in candidates:
        if not isinstance(c, str):
            continue
        m = GITHUB_REPO_RE.search(c)
        if m:
            owner, repo = m.group(1), m.group(2).rstrip(".git")
            return f"gh:{owner}/{repo}"

    # HuggingFace generic URL
    for c in candidates:
        if not isinstance(c, str):
            continue
        m = HF_REPO_RE.search(c)
        if m:
            return f"hf:{m.group(1)}"

    # WeChat 公众号
    if source == "wechat":
        route = item.get("account_route") or item.get("account_name") or "unknown"
        return f"wechat:{route}:{_title_hash(item.get('title') or '')[:4]}"

    # Xiaohongshu / X
    if source == "xiaohongshu":
        return f"xhs:{item.get('id') or _title_hash(item.get('title') or '')}"
    if source == "x":
        return f"x:{item.get('id') or _title_hash(item.get('title') or '')}"

    # Last resort: title hash
    return f"title:{_title_hash(item.get('title') or item.get('id') or '')}"


# ---------------------------------------------------------------------------
# Aggregation
# ---------------------------------------------------------------------------
def normalize_engagement(item: Dict[str, Any]) -> Dict[str, Any]:
    eng = item.get("engagement")
    if isinstance(eng, dict):
        return {
            "stars": eng.get("stars"),
            "likes": eng.get("likes"),
            "upvotes": eng.get("upvotes") or eng.get("upvote_count"),
            "downloads": eng.get("downloads"),
            "forks": eng.get("forks"),
            "collects": eng.get("collects"),
        }
    # Some sources hoist these to the top level (github)
    return {
        "stars": item.get("stars"),
        "likes": item.get("likes"),
        "upvotes": item.get("upvotes") or item.get("upvote_count"),
        "downloads": item.get("downloads"),
        "forks": item.get("forks"),
        "collects": item.get("collects"),
    }


def normalize_item(item: Dict[str, Any], source: str) -> Optional[Dict[str, Any]]:
    title = (item.get("title") or "").strip()
    if not title:
        return None
    abstract = (
        item.get("abstract")
        or item.get("summary")
        or item.get("description")
        or ""
    ).strip()
    url = item.get("url") or item.get("link") or item.get("pdf_url") or ""
    return {
        "canonicalId": canonical_id(item),
        "title": title,
        "abstract": abstract[:1200],  # cap to keep candidates.json small
        "authors": item.get("authors") or item.get("author") or [],
        "url": url,
        "publishedDate": item.get("published") or item.get("published_date") or "",
        "matchedDomain": item.get("matched_domain") or "",
        "matchedKeywords": item.get("matched_keywords") or [],
        "sources": [
            {
                "source": source,
                "score": extract_score(item),
                "subscores": extract_subscores(item),
                "matchedKeywords": item.get("matched_keywords") or [],
                "engagement": normalize_engagement(item),
            }
        ],
        "blendedScore": extract_score(item),
    }


def merge_into(bucket: Dict[str, Dict[str, Any]], normalized: Dict[str, Any]) -> None:
    cid = normalized["canonicalId"]
    if cid not in bucket:
        bucket[cid] = normalized
        return
    existing = bucket[cid]
    # Append the new source to sources[]
    existing["sources"].extend(normalized["sources"])
    # Use max as a simple cross-source blend (Option B2 will replace this).
    existing["blendedScore"] = max(existing["blendedScore"], normalized["blendedScore"])
    # Prefer the longer abstract (more context for the LLM)
    if len(normalized["abstract"]) > len(existing["abstract"]):
        existing["abstract"] = normalized["abstract"]
    # Prefer a non-empty domain
    if not existing["matchedDomain"] and normalized["matchedDomain"]:
        existing["matchedDomain"] = normalized["matchedDomain"]
    # Union matched keywords (preserve order, dedupe)
    seen = set(existing["matchedKeywords"])
    for kw in normalized["matchedKeywords"]:
        if kw not in seen:
            existing["matchedKeywords"].append(kw)
            seen.add(kw)


def cluster_key_for(item: Dict[str, Any]) -> Tuple[str, str]:
    """Preliminary clustering key: (domain, primary keyword)."""
    domain = (item.get("matchedDomain") or "").strip() or "Uncategorized"
    kws = item.get("matchedKeywords") or []
    primary = kws[0] if kws else ""
    return domain, primary


def slugify(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")
    return s or "uncategorized"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Aggregate news-results-*.json into clustered candidates.",
    )
    parser.add_argument("--news-data-dir", required=True, type=Path,
                        help="Directory holding news-results-*.json files")
    parser.add_argument("--output", required=True, type=Path,
                        help="Where to write candidates.json")
    parser.add_argument("--top-n-per-cluster", type=int, default=6,
                        help="Cap items per preliminary cluster (default 6)")
    parser.add_argument("--min-score", type=float, default=0.0,
                        help="Drop items with blended score below this threshold")
    parser.add_argument("--max-clusters", type=int, default=20,
                        help="Cap total preliminary clusters before LLM refinement")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    news_data_dir = args.news_data_dir.expanduser().resolve()
    if not news_data_dir.exists():
        logger.error("[news-idea-briefing] news-data-dir does not exist: %s", news_data_dir)
        return 2

    files = discover_results_files(news_data_dir)
    if not files:
        logger.warning("[news-idea-briefing] no news-results-*.json found in %s", news_data_dir)

    bucket: Dict[str, Dict[str, Any]] = {}
    total_scanned = 0
    per_source_counts: Dict[str, int] = defaultdict(int)
    for f in files:
        data = load_json(f)
        if not data:
            continue
        # source name from filename: news-results-<source>.json
        m = re.match(r"news-results-(.+)\.json$", f.name)
        source = m.group(1) if m else f.stem
        items = data.get("top_papers") or []
        for it in items:
            total_scanned += 1
            normalized = normalize_item(it, source)
            if not normalized:
                continue
            if normalized["blendedScore"] < args.min_score:
                continue
            merge_into(bucket, normalized)
            per_source_counts[source] += 1

    unique_items = list(bucket.values())
    unique_items.sort(key=lambda x: x["blendedScore"], reverse=True)

    # Preliminary clustering
    cluster_map: Dict[Tuple[str, str], Dict[str, Any]] = {}
    for it in unique_items:
        key = cluster_key_for(it)
        if key not in cluster_map:
            domain, primary = key
            label = f"{domain}: {primary}" if primary else domain
            cluster_map[key] = {
                "clusterKey": f"{slugify(domain)}__{slugify(primary)}" if primary else slugify(domain),
                "clusterLabel": label,
                "matchedDomain": domain,
                "primaryKeyword": primary,
                "items": [],
            }
        cluster = cluster_map[key]
        if len(cluster["items"]) < args.top_n_per_cluster:
            cluster["items"].append(it)

    clusters = list(cluster_map.values())
    # Order clusters by their best-item score, then trim to max-clusters
    clusters.sort(
        key=lambda c: max((i["blendedScore"] for i in c["items"]), default=0.0),
        reverse=True,
    )
    clusters = clusters[: args.max_clusters]

    output_payload = {
        "schemaVersion": "1.0",
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "newsDataDir": str(news_data_dir),
        "totalScanned": total_scanned,
        "totalUnique": len(unique_items),
        "perSourceCounts": dict(per_source_counts),
        "clusters": clusters,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8") as f:
        json.dump(output_payload, f, ensure_ascii=False, indent=2, default=str)

    logger.info(
        "[news-idea-briefing] scanned=%d unique=%d clusters=%d → %s",
        total_scanned, len(unique_items), len(clusters), args.output,
    )
    if args.verbose:
        for c in clusters[:5]:
            logger.debug(
                "  cluster %r: %d items, top score %.2f",
                c["clusterLabel"], len(c["items"]),
                c["items"][0]["blendedScore"] if c["items"] else 0.0,
            )

    # Print a tiny summary to stdout (so the route can parse it cheaply)
    summary = {
        "totalScanned": total_scanned,
        "totalUnique": len(unique_items),
        "clusterCount": len(clusters),
        "clusters": [
            {
                "label": c["clusterLabel"],
                "size": len(c["items"]),
                "topScore": c["items"][0]["blendedScore"] if c["items"] else 0.0,
            }
            for c in clusters
        ],
        "outputPath": str(args.output),
    }
    print(json.dumps(summary, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
