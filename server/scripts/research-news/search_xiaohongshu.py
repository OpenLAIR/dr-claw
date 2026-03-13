#!/usr/bin/env python3
"""
Xiaohongshu (Little Red Book) research post search script.

Searches for research-related posts on Xiaohongshu using the
xiaohongshu-cli tool, which handles authentication via browser cookies
and anti-detection automatically.

Usage:
    python search_xiaohongshu.py --config research_interests.yaml --output xhs_results.json
    python search_xiaohongshu.py --keywords "LLM,大模型,transformer" --top-n 20
"""

import json
import os
import re
import shutil
import subprocess
import sys
import logging
from datetime import datetime
from typing import Dict, List, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Import shared scoring utilities
# ---------------------------------------------------------------------------
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scoring_utils import (
    SCORE_MAX,
    calculate_relevance_score,
    calculate_recency_score,
    calculate_quality_score,
    calculate_recommendation_score,
)

# Popularity scoring: total engagement (likes + collects + comments) at which
# a post receives the maximum popularity score.
POPULARITY_ENGAGEMENT_FULL_SCORE = 500

# Quality scoring thresholds based on content length (characters).
QUALITY_LENGTH_THRESHOLDS = [
    (1000, 3.0),   # >= 1000 chars: max quality
    (500, 2.0),    # >= 500 chars
    (200, 1.0),    # >= 200 chars
]
QUALITY_LENGTH_DEFAULT = 0.5


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------
def load_research_config(config_path: str) -> Dict:
    """Load research interests from a YAML config file."""
    import json

    try:
        with open(config_path, "r", encoding="utf-8") as f:
            if config_path.endswith(".json"):
                config = json.load(f)
            else:
                try:
                    import yaml
                    config = yaml.safe_load(f)
                except ImportError:
                    config = json.load(f)
        return config
    except Exception as e:
        logger.error("Error loading config: %s", e)
        return {
            "research_domains": {},
            "excluded_keywords": [],
        }


# ---------------------------------------------------------------------------
# xiaohongshu-cli helpers
# ---------------------------------------------------------------------------
def _check_xhs_cli() -> str:
    """Return the path to the xhs CLI, or raise if not found."""
    path = shutil.which("xhs")
    if not path:
        raise RuntimeError(
            "xiaohongshu-cli is not installed. "
            "Run 'npm install' or install manually: uv tool install xiaohongshu-cli"
        )
    return path


def _parse_count(value) -> int:
    """Parse an engagement count that might be a string like '1.2w' or '123'."""
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return int(value)
    s = str(value).strip().lower()
    if not s:
        return 0
    # Handle Chinese '万' (10k) and 'w' suffix
    for suffix, multiplier in [("万", 10000), ("w", 10000), ("k", 1000)]:
        if s.endswith(suffix):
            try:
                return int(float(s[:-len(suffix)]) * multiplier)
            except ValueError:
                return 0
    try:
        return int(float(s))
    except ValueError:
        return 0


def _run_xhs_cli(args: List[str], timeout: int = 120) -> Optional[Dict]:
    """Run an xhs CLI command and return parsed JSON envelope, or None on error."""
    xhs_bin = shutil.which("xhs") or "xhs"
    cmd = [xhs_bin] + args + ["--json"]
    logger.info("[XHS] Running: %s", " ".join(cmd))

    result = subprocess.run(cmd, capture_output=True, timeout=timeout)

    if result.returncode != 0:
        logger.error("[XHS] CLI exited %d: %s", result.returncode, result.stderr.decode(errors="replace"))
        return None

    raw = result.stdout
    if not raw.strip():
        logger.error("[XHS] CLI returned empty stdout")
        return None

    # Decode and strip ANSI escape sequences
    stdout = raw.decode("utf-8", errors="replace")
    stdout = re.sub(r"\x1b\[[0-9;]*m", "", stdout)

    try:
        envelope = json.loads(stdout)
    except json.JSONDecodeError as e:
        logger.error("[XHS] Failed to parse CLI output: %s", e)
        logger.error("[XHS] cleaned stdout (first 200): %s", stdout[:200])
        return None

    if not envelope.get("ok"):
        err = envelope.get("error", {})
        msg = err.get("message", "") if isinstance(err, dict) else str(err)
        logger.error("[XHS] CLI returned error: %s", msg)
        return None

    return envelope


def search_via_xhs_cli(keyword: str) -> List[Dict]:
    """
    Search Xiaohongshu for notes matching a keyword using xiaohongshu-cli.

    Returns a list of raw note items from the CLI JSON output.
    """
    envelope = _run_xhs_cli(["search", keyword])
    if not envelope:
        return []

    items = (envelope.get("data", {}) or {}).get("items", [])
    logger.info("[XHS] keyword='%s' => %d items", keyword, len(items))
    return items


def fetch_note_detail(note_id: str, xsec_token: str = "") -> Optional[str]:
    """
    Fetch the full body text of a note via `xhs read`.

    Returns the desc (body text) string, or None on failure.
    """
    args = ["read", note_id]
    if xsec_token:
        args += ["--xsec-token", xsec_token]

    envelope = _run_xhs_cli(args, timeout=30)
    if not envelope:
        return None

    items = (envelope.get("data", {}) or {}).get("items", [])
    if not items:
        return None

    nc = items[0].get("note_card", {})
    return nc.get("desc", "")


def parse_note_item(item: Dict) -> Optional[Dict]:
    """
    Parse a raw API item into a normalized note dict.

    Returns None if the item cannot be parsed.
    """
    note_card = item.get("note_card") or {}
    note_id = item.get("id") or note_card.get("note_id") or ""
    if not note_id:
        return None

    # Title: CLI uses "display_title", raw API uses "title"
    title = (
        note_card.get("display_title")
        or note_card.get("title", "")
    ).strip()
    desc = note_card.get("desc", "").strip()
    user_info = note_card.get("user") or {}
    interact = note_card.get("interact_info") or {}

    # Parse timestamp — raw API has epoch ms in "time",
    # CLI has relative text like "2天前" in corner_tag_info
    published_dt = None
    published_str = ""
    ts = note_card.get("time")
    if ts:
        try:
            published_dt = datetime.fromtimestamp(int(ts) / 1000)
            published_str = published_dt.isoformat()
        except (ValueError, TypeError, OSError):
            pass

    if not published_str:
        # Fall back to corner_tag_info relative time text
        for tag in note_card.get("corner_tag_info") or []:
            if tag.get("type") == "publish_time":
                published_str = tag.get("text", "")
                break

    # Extract image URLs — CLI nests them under info_list[].url,
    # raw API has them directly as image_list[].url
    image_list = note_card.get("image_list") or []
    media_urls = []
    for img in image_list:
        url = img.get("url") or img.get("url_default") or ""
        if not url:
            # CLI format: pick the first info_list entry
            for info in img.get("info_list") or []:
                url = info.get("url", "")
                if url:
                    break
        if url:
            media_urls.append(url)

    likes = _parse_count(interact.get("liked_count"))
    collects = _parse_count(interact.get("collected_count"))
    comments = _parse_count(interact.get("comment_count"))

    # Add cover image if not already in media_urls
    cover = note_card.get("cover") or {}
    cover_url = cover.get("url_default", "")
    if cover_url and cover_url not in media_urls:
        media_urls.insert(0, cover_url)

    # Build link with xsec_token for authentication
    xsec_token = item.get("xsec_token", "")
    if xsec_token:
        link = (
            f"https://www.xiaohongshu.com/explore/{note_id}"
            f"?xsec_token={xsec_token}"
            f"&xsec_source=pc_search&source=web_search_result_notes"
        )
    else:
        link = f"https://www.xiaohongshu.com/explore/{note_id}"

    return {
        "id": note_id,
        "title": title or "(Untitled)",
        "desc": desc,
        "username": user_info.get("nickname") or user_info.get("nick_name", ""),
        "avatar_url": user_info.get("avatar", ""),
        "likes": likes,
        "collects": collects,
        "comments": comments,
        "published_dt": published_dt,
        "published_str": published_str,
        "media_urls": media_urls,
        "link": link,
        "xsec_token": xsec_token,
    }


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def calculate_popularity_score(likes: int, collects: int, comments: int) -> float:
    """
    Calculate popularity score based on engagement metrics.

    Total engagement = likes + collects + comments.
    Normalized so that POPULARITY_ENGAGEMENT_FULL_SCORE total = SCORE_MAX.

    Returns:
        Popularity score (0 - SCORE_MAX).
    """
    total = likes + collects + comments
    score = (total / POPULARITY_ENGAGEMENT_FULL_SCORE) * SCORE_MAX
    return min(score, SCORE_MAX)


def calculate_content_quality_score(text: str) -> float:
    """
    Calculate quality score based on content length and depth indicators.

    Longer, more detailed posts score higher. Posts that contain research
    methodology or data-related terms get a bonus.

    Returns:
        Quality score (0 - SCORE_MAX).
    """
    length = len(text)
    score = QUALITY_LENGTH_DEFAULT
    for threshold, s in QUALITY_LENGTH_THRESHOLDS:
        if length >= threshold:
            score = s
            break

    # Bonus for depth indicators
    text_lower = text.lower()
    depth_indicators = [
        "experiment", "evaluation", "benchmark",
        "dataset", "comparison", "analysis",
        "methodology", "framework", "algorithm",
        "results", "performance", "accuracy",
        # Chinese depth indicators
        "实验", "评估", "数据集", "对比", "分析",
        "方法论", "框架", "算法", "结果", "性能",
        "论文", "研究", "模型", "训练", "推理",
    ]
    depth_count = sum(1 for ind in depth_indicators if ind in text_lower)
    if depth_count >= 5:
        score += 0.5
    elif depth_count >= 2:
        score += 0.2

    return min(score, SCORE_MAX)


def score_and_rank_notes(
    notes: List[Dict],
    config: Dict,
    keyword: str,
) -> List[Dict]:
    """
    Score and rank parsed notes using shared scoring utilities.

    Args:
        notes: List of parsed note dicts from parse_note_item.
        config: Research interests config.
        keyword: The search keyword that produced these notes.

    Returns:
        List of scored note dicts, sorted by final_score descending.
    """
    domains = config.get("research_domains", {})
    excluded_keywords = config.get("excluded_keywords", [])

    scored = []
    for note in notes:
        # Build a paper-like dict for calculate_relevance_score
        paper_like = {
            "title": note["title"],
            "summary": note["desc"],
            "categories": [],
        }

        relevance, matched_domain, matched_keywords = calculate_relevance_score(
            paper_like, domains, excluded_keywords,
        )

        # If no domain matched but the post was found via our keyword search,
        # give a baseline relevance score so it isn't dropped entirely.
        if relevance == 0 and matched_domain is None:
            # Check if the search keyword appears in title or desc
            combined = (note["title"] + " " + note["desc"]).lower()
            if keyword.lower() in combined:
                relevance = 0.5
                matched_domain = "keyword_match"
                matched_keywords = [keyword]
            else:
                # Still include but with minimal relevance
                relevance = 0.1
                matched_domain = "keyword_search"
                matched_keywords = [keyword]

        recency = calculate_recency_score(note["published_dt"])
        popularity = calculate_popularity_score(
            note["likes"], note["collects"], note["comments"],
        )
        quality = calculate_content_quality_score(note["desc"])

        final_score = calculate_recommendation_score(
            relevance, recency, popularity, quality,
            is_hot_paper=False,
        )

        scored.append({
            "id": note["id"],
            "title": note["title"],
            "authors": note["username"],
            "abstract": note["desc"],
            "published": note["published_str"],
            "categories": [],
            "relevance_score": round(relevance, 2),
            "recency_score": round(recency, 2),
            "popularity_score": round(popularity, 2),
            "quality_score": round(quality, 2),
            "final_score": final_score,
            "matched_domain": matched_domain,
            "matched_keywords": matched_keywords,
            "link": note["link"],
            "source": "xiaohongshu",
            "engagement": {
                "likes": note["likes"],
                "collects": note["collects"],
                "comments": note["comments"],
            },
            "avatar_url": note["avatar_url"],
            "media_urls": note["media_urls"],
        })

    scored.sort(key=lambda x: x["final_score"], reverse=True)
    return scored


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    import argparse

    default_config = os.environ.get("OBSIDIAN_VAULT_PATH", "")
    if default_config:
        default_config = os.path.join(
            default_config, "99_System", "Config", "research_interests.yaml"
        )

    parser = argparse.ArgumentParser(
        description="Search Xiaohongshu for research-related posts",
    )
    parser.add_argument(
        "--config", type=str,
        default=default_config or None,
        help="Path to research interests YAML config file",
    )
    parser.add_argument(
        "--output", type=str,
        default="xhs_results.json",
        help="Output JSON file path",
    )
    parser.add_argument(
        "--top-n", type=int, default=10,
        help="Number of top posts to return (default: 10)",
    )
    parser.add_argument(
        "--keywords", type=str, default=None,
        help="Comma-separated search keywords (overrides config)",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    # ---- Check xiaohongshu-cli is installed ----
    try:
        _check_xhs_cli()
    except RuntimeError as e:
        logger.error(str(e))
        return 1

    # ---- Determine search keywords ----
    search_keywords: List[str] = []

    if args.keywords:
        search_keywords = [kw.strip() for kw in args.keywords.split(",") if kw.strip()]
    elif args.config:
        logger.info("Loading config from: %s", args.config)
        config = load_research_config(args.config)
        domains = config.get("research_domains", {})
        for domain_name, domain_config in domains.items():
            kws = domain_config.get("keywords", [])
            search_keywords.extend(kws)
    else:
        logger.error(
            "No keywords specified. Use --keywords or --config to provide search terms."
        )
        return 1

    if not search_keywords:
        logger.error("No keywords found in config or arguments.")
        return 1

    # Load config for scoring (even if keywords came from CLI)
    if args.config:
        config = load_research_config(args.config)
    else:
        config = {"research_domains": {}, "excluded_keywords": []}

    logger.info("Search keywords (%d): %s", len(search_keywords), search_keywords)

    # ---- Search ----
    all_notes: List[Dict] = []
    seen_ids: set = set()

    for keyword in search_keywords:
        raw_items = search_via_xhs_cli(keyword)

        for item in raw_items:
            note = parse_note_item(item)
            if note and note["id"] not in seen_ids:
                seen_ids.add(note["id"])
                note["_search_keyword"] = keyword
                all_notes.append(note)

    logger.info("Total unique notes fetched: %d", len(all_notes))

    # ---- Enrich: fetch full body text for notes missing desc ----
    enriched_count = 0
    for note in all_notes:
        if not note["desc"]:
            logger.info("[XHS] Fetching detail for %s ...", note["id"])
            desc = fetch_note_detail(note["id"], note.get("xsec_token", ""))
            if desc:
                note["desc"] = desc
                enriched_count += 1
    if enriched_count:
        logger.info("[XHS] Enriched %d notes with full body text", enriched_count)

    if not all_notes:
        logger.warning("No posts found for any keyword.")
        output = {
            "top_papers": [],
            "total_found": 0,
            "total_filtered": 0,
            "search_date": datetime.now().strftime("%Y-%m-%d"),
        }
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return 0

    # ---- Score and rank ----
    # Group notes by their search keyword for relevance scoring context
    all_scored: List[Dict] = []
    for note in all_notes:
        kw = note.pop("_search_keyword", "")
        scored_batch = score_and_rank_notes([note], config, kw)
        all_scored.extend(scored_batch)

    # Deduplicate (already done by seen_ids, but just in case)
    final_scored: List[Dict] = []
    final_ids: set = set()
    for item in all_scored:
        if item["id"] not in final_ids:
            final_ids.add(item["id"])
            final_scored.append(item)

    # Sort by final score
    final_scored.sort(key=lambda x: x["final_score"], reverse=True)

    total_found = len(final_scored)
    top_papers = final_scored[: args.top_n]

    output = {
        "top_papers": top_papers,
        "total_found": total_found,
        "total_filtered": len(top_papers),
        "search_date": datetime.now().strftime("%Y-%m-%d"),
    }

    # ---- Save results ----
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    logger.info("Results saved to: %s", args.output)
    logger.info("Top %d posts:", len(top_papers))
    for i, p in enumerate(top_papers, 1):
        logger.info(
            "  %d. %s (Score: %.2f, Likes: %d)",
            i,
            p["title"][:50],
            p["final_score"],
            p["engagement"]["likes"],
        )

    # Also print to stdout
    print(json.dumps(output, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    sys.exit(main())
