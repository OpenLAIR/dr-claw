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
HF_MODELS_URL = "https://huggingface.co/api/models"
HF_DATASETS_URL = "https://huggingface.co/api/datasets"
HF_SPACES_URL = "https://huggingface.co/api/spaces"

# Popularity: 50+ upvotes = max score (SCORE_MAX) for papers
HF_UPVOTES_FULL_SCORE = 50
# Popularity: 200+ likes = max score for repos (models/datasets/spaces)
HF_REPO_LIKES_FULL_SCORE = 200
# Popularity: 100k+ downloads contributes a small bonus
HF_DOWNLOADS_FULL_SCORE = 100_000

VALID_MODES = ("papers", "models", "datasets", "spaces")


def hf_auth_headers(extra: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    """Build request headers, attaching `HF_TOKEN` / `HUGGINGFACE_TOKEN` if set."""
    headers = {"User-Agent": "ResearchNews-HFFetcher/1.0"}
    if extra:
        headers.update(extra)
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


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


# ---------------------------------------------------------------------------
# HuggingFace Hub repos (models / datasets / spaces)
# ---------------------------------------------------------------------------
def fetch_hub_repos(kind: str, limit: int = 50, sort: str = "likes7d") -> List[Dict]:
    """
    Fetch entries from the HuggingFace Hub API for a given repo kind.

    Args:
        kind: One of "models", "datasets", "spaces".
        limit: Number of entries to request.
        sort: "likes7d" (trending), "likes", "downloads", "lastModified".

    Returns:
        List of raw JSON entries (empty on failure).
    """
    if kind not in {"models", "datasets", "spaces"}:
        return []
    url = {
        "models": HF_MODELS_URL,
        "datasets": HF_DATASETS_URL,
        "spaces": HF_SPACES_URL,
    }[kind]
    params = urllib.parse.urlencode({
        "sort": sort,
        "direction": "-1",
        "limit": limit,
        "full": "true",
    })
    try:
        data = http_get_json(f"{url}?{params}", headers=hf_auth_headers(), timeout=30)
        if isinstance(data, list):
            logger.info("[HF/%s] fetched %d entries", kind, len(data))
            return data
        return []
    except Exception as exc:
        logger.warning("[HF/%s] fetch failed: %s", kind, exc)
        return []


def normalize_hub_repo(entry: Dict, kind: str) -> Optional[Dict]:
    """Normalize a HF Hub repo (model/dataset/space) into the internal shape."""
    repo_id = entry.get("id") or entry.get("modelId")
    if not repo_id:
        return None

    author = entry.get("author") or (repo_id.split("/")[0] if "/" in repo_id else "")
    summary = entry.get("description") or ""
    likes = entry.get("likes", 0) or 0
    downloads = entry.get("downloads", 0) or 0
    pipeline_tag = entry.get("pipeline_tag", "") or ""
    tags = entry.get("tags", []) or []

    last_modified = entry.get("lastModified") or entry.get("createdAt") or ""
    last_dt = None
    if last_modified:
        try:
            last_dt = datetime.fromisoformat(last_modified.replace("Z", "+00:00"))
        except (ValueError, TypeError):
            pass

    if kind == "models":
        link = f"https://huggingface.co/{repo_id}"
    else:
        link = f"https://huggingface.co/{kind}/{repo_id}"

    # Build a friendly category list: pipeline tag first, then a few tags
    # (skip noisy license: prefixes).
    categories: List[str] = []
    if pipeline_tag:
        categories.append(pipeline_tag)
    for t in tags:
        if not t or ":" in t:
            continue
        if t in categories:
            continue
        categories.append(t)
        if len(categories) >= 6:
            break

    return {
        "id": f"{kind}:{repo_id}",
        "title": repo_id,
        "summary": summary,
        "authors_str": author,
        "published": last_modified,
        "published_date": last_dt,
        # We reuse "upvotes" so it flows through the existing scoring path.
        "upvotes": likes,
        "downloads": downloads,
        "thumbnail": "",
        "num_comments": 0,
        "submitted_by_name": author,
        "submitted_by_avatar": "",
        "organization": author,
        "categories": categories,
        "tags": tags,
        "pipeline_tag": pipeline_tag,
        "kind": kind,
        "link": link,
        "source": "huggingface",
    }


def calculate_repo_popularity_score(likes: int, downloads: int = 0) -> float:
    """Combine HF Hub likes (primary) + downloads (bonus) into a 0..SCORE_MAX score."""
    if likes <= 0 and downloads <= 0:
        return 0.0
    likes_part = min(likes / HF_REPO_LIKES_FULL_SCORE * SCORE_MAX, SCORE_MAX)
    download_part = 0.0
    if downloads > 0:
        import math as _math
        download_part = min(
            _math.log10(downloads + 1) / _math.log10(HF_DOWNLOADS_FULL_SCORE) * 1.5,
            1.5,
        )
    # 70% likes, plus a small download bonus, capped at SCORE_MAX
    return min(likes_part * 0.7 + download_part, SCORE_MAX)


def score_hub_repos(
    repos: List[Dict],
    config: Optional[Dict],
    kind: str,
) -> Tuple[List[Dict], int]:
    """
    Score HF Hub repos. If config has research_domains, repos with relevance 0
    are kept with a soft floor (these are trending entries; we don't want to
    drop everything just because the user's keywords are narrow).
    """
    domains = (config or {}).get("research_domains", {})
    excluded_keywords = (config or {}).get("excluded_keywords", [])
    has_domains = bool(domains)

    scored: List[Dict] = []

    for repo in repos:
        if has_domains:
            relevance, matched_domain, matched_keywords = calculate_relevance_score(
                {
                    "title": repo["title"],
                    "summary": repo["summary"],
                    "categories": repo["categories"],
                },
                domains,
                excluded_keywords,
            )
            if relevance == 0:
                relevance = 0.5
                matched_domain = f"hf_{kind}"
                matched_keywords = []
        else:
            relevance = 1.0
            matched_domain = f"hf_{kind}"
            matched_keywords = []

        recency = calculate_recency_score(repo.get("published_date"))
        popularity = calculate_repo_popularity_score(
            repo.get("upvotes", 0), repo.get("downloads", 0),
        )
        quality = calculate_quality_score(repo.get("summary", ""))
        if repo.get("pipeline_tag"):
            quality = min(quality + 0.3, SCORE_MAX)

        final_score = calculate_recommendation_score(
            relevance, recency, popularity, quality,
        )

        repo_id_clean = repo["id"].split(":", 1)[-1]
        scored.append({
            "id": repo["id"],
            "title": repo["title"],
            "authors": repo.get("authors_str", ""),
            "abstract": repo.get("summary") or f"{kind.capitalize()} on Hugging Face Hub.",
            "published": repo.get("published", ""),
            "categories": repo.get("categories", []),
            "relevance_score": round(relevance, 2),
            "recency_score": round(recency, 2),
            "popularity_score": round(popularity, 2),
            "quality_score": round(quality, 2),
            "final_score": final_score,
            "matched_domain": matched_domain,
            "matched_keywords": matched_keywords,
            "link": repo["link"],
            "source": "huggingface",
            "media_urls": [],
            "engagement": {
                "likes": repo.get("upvotes", 0),
                "comments": 0,
                "downloads": repo.get("downloads", 0),
            },
            "submitted_by": repo.get("submitted_by_name", ""),
            "organization": repo.get("organization", ""),
            # HF Hub-specific extras (consumed by the HF card branch)
            "kind": kind,
            "pipeline_tag": repo.get("pipeline_tag", ""),
            "downloads": repo.get("downloads", 0),
            "hub_id": repo_id_clean,
        })

    return scored, 0


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
    parser.add_argument(
        "--modes",
        type=str,
        default="papers",
        help=(
            "Comma-separated list of HF Hub modes to fetch. "
            "Valid: papers, models, datasets, spaces. Default: papers."
        ),
    )
    parser.add_argument(
        "--per-mode-limit",
        type=int,
        default=40,
        help="Number of raw entries to fetch per non-paper mode before scoring.",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    # Config is optional — without it we show all daily papers / trending repos
    config = None
    if args.config:
        logger.info("Loading config from: %s", args.config)
        config = load_research_config(args.config)
    else:
        logger.info("No config provided — using trending defaults")

    # Parse and validate modes
    requested_modes = [
        m.strip().lower() for m in (args.modes or "papers").split(",") if m.strip()
    ]
    modes = [m for m in requested_modes if m in VALID_MODES]
    if not modes:
        modes = ["papers"]
    logger.info("[HF] active modes: %s", ", ".join(modes))

    if os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN"):
        logger.info("[HF] using HF token for higher rate limits")

    aggregated: List[Dict] = []
    total_found = 0
    total_filtered = 0
    seen_ids: set = set()

    # ---- Papers (Daily Papers API) ----
    if "papers" in modes:
        logger.info("[HF/papers] fetching Daily Papers...")
        raw_entries = fetch_daily_papers()
        papers = []
        for entry in raw_entries:
            normalized = normalize_paper(entry)
            if normalized:
                papers.append(normalized)
        logger.info(
            "[HF/papers] normalized %d papers from %d raw entries",
            len(papers), len(raw_entries),
        )
        scored_papers, paper_filtered = score_papers(papers, config)
        total_found += len(papers)
        total_filtered += paper_filtered
        for p in scored_papers:
            if p["id"] in seen_ids:
                continue
            seen_ids.add(p["id"])
            # Tag papers with kind so the UI can render uniformly.
            p.setdefault("kind", "papers")
            aggregated.append(p)
        logger.info(
            "[HF/papers] kept %d (filtered %d)",
            len(scored_papers), paper_filtered,
        )

    # ---- Hub repos (models / datasets / spaces) ----
    for kind in ("models", "datasets", "spaces"):
        if kind not in modes:
            continue
        raw_repos = fetch_hub_repos(kind, limit=args.per_mode_limit, sort="likes7d")
        normalized_repos: List[Dict] = []
        for entry in raw_repos:
            r = normalize_hub_repo(entry, kind)
            if r:
                normalized_repos.append(r)
        scored_repos, _ = score_hub_repos(normalized_repos, config, kind)
        total_found += len(normalized_repos)
        for r in scored_repos:
            if r["id"] in seen_ids:
                continue
            seen_ids.add(r["id"])
            aggregated.append(r)
        logger.info(
            "[HF/%s] kept %d repos", kind, len(scored_repos),
        )

    if not aggregated:
        logger.warning("[HF] no entries collected across modes: %s", modes)
        output = {
            "top_papers": [],
            "total_found": 0,
            "total_filtered": 0,
            "search_date": datetime.now().strftime("%Y-%m-%d"),
            "modes": modes,
        }
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(json.dumps(output, ensure_ascii=True, indent=2))
        return 0

    aggregated.sort(key=lambda x: x.get("final_score", 0), reverse=True)
    top = aggregated[: args.top_n]

    output = {
        "top_papers": top,
        "total_found": total_found,
        "total_filtered": total_filtered,
        "search_date": datetime.now().strftime("%Y-%m-%d"),
        "modes": modes,
    }

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)

    logger.info("Results saved to: %s", args.output)
    logger.info("Top %d entries (modes=%s):", len(top), modes)
    for i, p in enumerate(top, 1):
        kind_tag = p.get("kind", "papers")
        logger.info(
            "  %d. [%s] %s... (Score: %s, Pop: %s)",
            i, kind_tag, p["title"][:54], p["final_score"], p["popularity_score"],
        )

    print(json.dumps(output, ensure_ascii=True, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
