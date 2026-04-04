#!/usr/bin/env python3
"""
HuggingFace Daily Papers search script.

Fetches papers from the HuggingFace Daily Papers API, scores them against
research interest configuration, and outputs filtered/ranked results in the
same JSON format used by search_arxiv.py.
"""

import json
import os
import sys
import logging
import ssl
from datetime import datetime
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

try:
    import certifi
    CERTIFI_CA_BUNDLE = certifi.where()
except ImportError:
    CERTIFI_CA_BUNDLE = None

import urllib.request
import urllib.parse

# ---------------------------------------------------------------------------
# Import shared scoring utilities
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scoring_utils import (
    SCORE_MAX,
    calculate_relevance_score,
    calculate_recency_score,
    calculate_quality_score,
    calculate_recommendation_score,
)

# ---------------------------------------------------------------------------
# HuggingFace API configuration
# ---------------------------------------------------------------------------
HF_DAILY_PAPERS_URL = "https://huggingface.co/api/daily_papers"

# Popularity: 50+ upvotes = max score (SCORE_MAX)
HF_UPVOTES_FULL_SCORE = 50


def build_ssl_context() -> ssl.SSLContext:
    if CERTIFI_CA_BUNDLE and os.path.exists(CERTIFI_CA_BUNDLE):
        return ssl.create_default_context(cafile=CERTIFI_CA_BUNDLE)
    return ssl.create_default_context()


def http_get_json(url: str, headers: Optional[Dict[str, str]] = None, timeout: int = 30) -> List[Dict]:
    headers = headers or {}

    if HAS_REQUESTS:
        request_kwargs = {
            "headers": headers,
            "timeout": timeout,
        }
        if CERTIFI_CA_BUNDLE and os.path.exists(CERTIFI_CA_BUNDLE):
            request_kwargs["verify"] = CERTIFI_CA_BUNDLE
        response = requests.get(url, **request_kwargs)
        response.raise_for_status()
        return response.json()

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=build_ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_research_config(config_path: str) -> Dict:
    """
    Load research interest configuration from a YAML file.

    Args:
        config_path: Path to the YAML config file.

    Returns:
        Research configuration dictionary.
    """
    import json

    try:
        with open(config_path, "r", encoding="utf-8-sig") as f:
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
            "research_domains": {
                "LLM": {
                    "keywords": [
                        "pre-training", "foundation model", "model architecture",
                        "large language model", "LLM", "transformer",
                    ],
                    "arxiv_categories": ["cs.AI", "cs.LG", "cs.CL"],
                    "priority": 5,
                }
            },
            "excluded_keywords": ["3D", "review", "workshop", "survey"],
        }


def fetch_daily_papers(max_retries: int = 3) -> List[Dict]:
    """
    Fetch papers from the HuggingFace Daily Papers API.

    Args:
        max_retries: Maximum number of retry attempts.

    Returns:
        Raw list of paper entries from the API.
    """
    headers = {"User-Agent": "ResearchNews-HFPaperFetcher/1.0"}

    for attempt in range(max_retries):
        try:
            data = http_get_json(HF_DAILY_PAPERS_URL, headers=headers, timeout=30)

            logger.info("[HF] Fetched %d daily paper entries", len(data))
            return data

        except Exception as e:
            logger.warning("[HF] Error (attempt %d/%d): %s", attempt + 1, max_retries, e)
            if attempt < max_retries - 1:
                import time
                wait_time = (2 ** attempt) * 2
                logger.info("[HF] Retrying in %d seconds...", wait_time)
                time.sleep(wait_time)
            else:
                logger.error("[HF] Failed after %d attempts", max_retries)
                return []

    return []


def normalize_paper(entry: Dict) -> Optional[Dict]:
    """
    Normalize a single HuggingFace daily-papers API entry into the internal
    paper dict format used by scoring functions.

    Args:
        entry: A single entry from the HF daily papers response.

    Returns:
        Normalized paper dict, or None if essential fields are missing.
    """
    paper_data = entry.get("paper", {})

    arxiv_id = paper_data.get("id")
    title = paper_data.get("title")
    summary = paper_data.get("summary")

    if not title or not arxiv_id:
        return None

    # Authors: list of dicts with "name" key -> comma-separated string
    raw_authors = paper_data.get("authors") or []
    if isinstance(raw_authors, list):
        author_names = [a.get("name", "") if isinstance(a, dict) else str(a) for a in raw_authors]
        authors_str = ", ".join(n for n in author_names if n)
    else:
        authors_str = str(raw_authors)

    # Published date
    published_at = paper_data.get("publishedAt", "")
    published_date = None
    if published_at:
        try:
            published_date = datetime.fromisoformat(published_at.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass

    upvotes = paper_data.get("upvotes", 0) or 0

    # Extra metadata from the envelope (not inside paper_data)
    thumbnail = entry.get("thumbnail", "")
    num_comments = entry.get("numComments", 0) or 0
    submitted_by = entry.get("submittedBy", {}) or {}
    organization = entry.get("organization") or paper_data.get("organization")

    return {
        "id": arxiv_id,
        "title": title,
        "summary": summary or "",
        "authors_str": authors_str,
        "published": published_at,
        "published_date": published_date,
        "upvotes": upvotes,
        "thumbnail": thumbnail,
        "num_comments": num_comments,
        "submitted_by_name": submitted_by.get("fullname") or submitted_by.get("name", ""),
        "submitted_by_avatar": submitted_by.get("avatarUrl", ""),
        "organization": organization.get("name", "") if isinstance(organization, dict) else (organization or ""),
        "categories": [],
        "source": "huggingface",
    }


def calculate_popularity_score(upvotes: int) -> float:
    """
    Calculate popularity score based on HuggingFace upvotes.

    50+ upvotes maps to the maximum score (SCORE_MAX).

    Args:
        upvotes: Number of upvotes on HuggingFace.

    Returns:
        Popularity score in [0, SCORE_MAX].
    """
    if upvotes <= 0:
        return 0.0
    return min(upvotes / HF_UPVOTES_FULL_SCORE * SCORE_MAX, SCORE_MAX)


def score_papers(
    papers: List[Dict],
    config: Optional[Dict] = None,
) -> Tuple[List[Dict], int]:
    """
    Score papers, optionally filtering by research configuration.

    If config has research_domains, papers are filtered by relevance (unmatched
    papers are excluded). If config is None or has no domains, all papers are
    kept and scored by recency, popularity, and quality only.

    Args:
        papers: Normalized paper dicts.
        config: Research interest configuration (optional).

    Returns:
        (scored_papers sorted by final_score descending, total_filtered count)
    """
    domains = (config or {}).get("research_domains", {})
    excluded_keywords = (config or {}).get("excluded_keywords", [])
    has_domains = bool(domains)

    scored: List[Dict] = []
    total_filtered = 0

    for paper in papers:
        # Relevance
        if has_domains:
            relevance, matched_domain, matched_keywords = calculate_relevance_score(
                paper, domains, excluded_keywords
            )
            if relevance == 0:
                total_filtered += 1
                continue
        else:
            # No filtering — give all papers a baseline relevance
            relevance = 1.0
            matched_domain = "daily_papers"
            matched_keywords = []

        # Recency
        recency = calculate_recency_score(paper.get("published_date"))

        # Popularity (HF upvotes)
        popularity = calculate_popularity_score(paper.get("upvotes", 0))

        # Quality (abstract-based heuristics)
        summary = paper.get("summary", "")
        quality = calculate_quality_score(summary)

        # Final composite score
        final_score = calculate_recommendation_score(
            relevance, recency, popularity, quality
        )

        arxiv_id = paper["id"]

        scored.append({
            "id": arxiv_id,
            "title": paper["title"],
            "authors": paper.get("authors_str", ""),
            "abstract": paper.get("summary", ""),
            "published": paper.get("published", ""),
            "categories": paper.get("categories", []),
            "relevance_score": round(relevance, 2),
            "recency_score": round(recency, 2),
            "popularity_score": round(popularity, 2),
            "quality_score": round(quality, 2),
            "final_score": final_score,
            "matched_domain": matched_domain,
            "matched_keywords": matched_keywords,
            "link": f"https://huggingface.co/papers/{arxiv_id}",
            "pdf_link": f"https://arxiv.org/pdf/{arxiv_id}.pdf",
            "source": "huggingface",
            "media_urls": [paper["thumbnail"]] if paper.get("thumbnail") else [],
            "engagement": {
                "likes": paper.get("upvotes", 0),
                "comments": paper.get("num_comments", 0),
            },
            "submitted_by": paper.get("submitted_by_name", ""),
            "organization": paper.get("organization", ""),
        })

    scored.sort(key=lambda x: x["final_score"], reverse=True)
    return scored, total_filtered


def main():
    """Main entry point."""
    import argparse

    default_config = os.environ.get("OBSIDIAN_VAULT_PATH", "")
    if default_config:
        default_config = os.path.join(
            default_config, "99_System", "Config", "research_interests.yaml"
        )

    parser = argparse.ArgumentParser(
        description="Fetch and score HuggingFace Daily Papers"
    )
    parser.add_argument(
        "--config",
        type=str,
        default=default_config or None,
        help="Path to research interests YAML config file",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="hf_daily_papers.json",
        help="Output JSON file path",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=10,
        help="Number of top papers to return",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    # Config is optional — without it we show all daily papers
    config = None
    if args.config:
        logger.info("Loading config from: %s", args.config)
        config = load_research_config(args.config)
    else:
        logger.info("No config provided — showing all HuggingFace Daily Papers")

    # Fetch daily papers from HuggingFace
    logger.info("Fetching HuggingFace Daily Papers...")
    raw_entries = fetch_daily_papers()

    if not raw_entries:
        logger.warning("No papers returned from HuggingFace API")
        output = {
            "top_papers": [],
            "total_found": 0,
            "total_filtered": 0,
            "search_date": datetime.now().strftime("%Y-%m-%d"),
        }
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(json.dumps(output, ensure_ascii=True, indent=2))
        return 0

    # Normalize entries
    papers = []
    for entry in raw_entries:
        normalized = normalize_paper(entry)
        if normalized:
            papers.append(normalized)

    logger.info("Normalized %d papers from %d raw entries", len(papers), len(raw_entries))

    # Score (and optionally filter if config has domains)
    scored_papers, total_filtered = score_papers(papers, config)

    logger.info(
        "Scored %d papers (%d filtered out by relevance/exclusion)",
        len(scored_papers),
        total_filtered,
    )

    # Take top N
    top_papers = scored_papers[: args.top_n]

    # Build output
    output = {
        "top_papers": top_papers,
        "total_found": len(papers),
        "total_filtered": total_filtered,
        "search_date": datetime.now().strftime("%Y-%m-%d"),
    }

    # Save to file
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)

    logger.info("Results saved to: %s", args.output)
    logger.info("Top %d papers:", len(top_papers))
    for i, p in enumerate(top_papers, 1):
        logger.info(
            "  %d. %s... (Score: %s, Upvotes-based popularity: %s)",
            i,
            p["title"][:60],
            p["final_score"],
            p["popularity_score"],
        )

    # Also output to stdout
    print(json.dumps(output, ensure_ascii=True, indent=2, default=str))

    return 0


if __name__ == "__main__":
    sys.exit(main())
