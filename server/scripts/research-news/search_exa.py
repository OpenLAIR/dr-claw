#!/usr/bin/env python3
"""
Exa AI-powered search script for the Research News feed.

Uses the Exa REST API (https://api.exa.ai/search) to perform neural/semantic
web searches and score results against a research interest configuration.
Outputs filtered/ranked results in the same JSON format used by the other
search_*.py scripts.

Requires EXA_API_KEY environment variable.
"""

import json
import os
import sys
import logging
import ssl
from datetime import datetime, timedelta
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
# Exa API configuration
# ---------------------------------------------------------------------------
EXA_API_URL = "https://api.exa.ai/search"
EXA_INTEGRATION_HEADER = "dr-claw"

# Popularity: Exa score is 0-1 range; 0.8+ maps to max popularity
EXA_SCORE_FULL_POPULARITY = 0.8


def build_ssl_context() -> ssl.SSLContext:
    if CERTIFI_CA_BUNDLE and os.path.exists(CERTIFI_CA_BUNDLE):
        return ssl.create_default_context(cafile=CERTIFI_CA_BUNDLE)
    return ssl.create_default_context()


def exa_post_json(
    url: str,
    body: Dict,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = 30,
) -> Dict:
    """POST JSON to the Exa API and return the parsed response."""
    headers = headers or {}
    data = json.dumps(body).encode("utf-8")

    if HAS_REQUESTS:
        request_kwargs = {
            "headers": headers,
            "json": body,
            "timeout": timeout,
        }
        if CERTIFI_CA_BUNDLE and os.path.exists(CERTIFI_CA_BUNDLE):
            request_kwargs["verify"] = CERTIFI_CA_BUNDLE
        response = requests.post(url, **request_kwargs)
        response.raise_for_status()
        return response.json()

    req = urllib.request.Request(
        url,
        data=data,
        headers={**headers, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout, context=build_ssl_context()) as resp:
        return json.loads(resp.read().decode("utf-8"))


def load_research_config(config_path: str) -> Dict:
    """Load research interest configuration from a JSON or YAML file."""
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


def search_exa(
    query: str,
    api_key: str,
    num_results: int = 30,
    category: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    include_domains: Optional[List[str]] = None,
    exclude_domains: Optional[List[str]] = None,
    max_retries: int = 3,
) -> List[Dict]:
    """
    Search using the Exa REST API.

    Args:
        query: Search query string.
        api_key: Exa API key.
        num_results: Number of results to request.
        category: Optional Exa category filter (e.g. "research paper", "news").
        start_date: ISO 8601 date string for start of date range.
        end_date: ISO 8601 date string for end of date range.
        include_domains: Restrict results to these domains.
        exclude_domains: Exclude results from these domains.
        max_retries: Maximum retry attempts.

    Returns:
        List of result dicts from the Exa API.
    """
    headers = {
        "x-api-key": api_key,
        "x-exa-integration": EXA_INTEGRATION_HEADER,
        "Content-Type": "application/json",
        "User-Agent": "ResearchNews-ExaFetcher/1.0",
    }

    body: Dict = {
        "query": query,
        "type": "auto",
        "numResults": num_results,
        "contents": {
            "text": {"maxCharacters": 1000},
            "highlights": {"maxCharacters": 300},
            "summary": {"query": query},
        },
    }

    if category:
        body["category"] = category
    if start_date:
        body["startPublishedDate"] = start_date
    if end_date:
        body["endPublishedDate"] = end_date
    if include_domains:
        body["includeDomains"] = include_domains
    if exclude_domains:
        body["excludeDomains"] = exclude_domains

    logger.info("[Exa] Searching: '%s' (num_results=%d)", query, num_results)
    if category:
        logger.info("[Exa] Category filter: %s", category)

    for attempt in range(max_retries):
        try:
            data = exa_post_json(EXA_API_URL, body, headers=headers, timeout=30)
            results = data.get("results", [])
            logger.info("[Exa] Returned %d results", len(results))
            return results
        except Exception as e:
            error_msg = str(e)
            logger.warning("[Exa] Error (attempt %d/%d): %s", attempt + 1, max_retries, e)

            is_rate_limit = "429" in error_msg or "Too Many Requests" in error_msg
            if attempt < max_retries - 1:
                import time
                wait_time = 30 if is_rate_limit else (2 ** attempt) * 2
                logger.info("[Exa] Retrying in %d seconds...", wait_time)
                time.sleep(wait_time)
            else:
                logger.error("[Exa] Failed after %d attempts", max_retries)
                return []

    return []


def normalize_result(result: Dict) -> Optional[Dict]:
    """
    Normalize an Exa search result into the internal paper dict format
    used by the scoring functions.

    Args:
        result: A single result from the Exa API response.

    Returns:
        Normalized paper dict, or None if essential fields are missing.
    """
    title = result.get("title")
    url = result.get("url", "")

    if not title:
        return None

    # Extract text content
    text = result.get("text", "")
    highlights = result.get("highlights", [])
    summary_text = result.get("summary", "")

    # Use summary as abstract; fall back to highlights then truncated text
    abstract = summary_text
    if not abstract and highlights:
        abstract = " ".join(highlights)
    if not abstract and text:
        abstract = text[:500]

    # Author
    author = result.get("author", "")

    # Published date
    published_at = result.get("publishedDate", "")
    published_date = None
    if published_at:
        try:
            # Exa returns YYYY-MM-DD or ISO 8601
            date_str = published_at[:10]  # Take YYYY-MM-DD portion
            published_date = datetime.strptime(date_str, "%Y-%m-%d")
        except (ValueError, TypeError):
            pass

    # Exa relevance score (0-1 range, higher is better)
    exa_score = result.get("score", 0) or 0

    return {
        "title": title,
        "url": url,
        "summary": abstract,
        "authors_str": author,
        "published": published_at,
        "published_date": published_date,
        "exa_score": exa_score,
        "highlights": highlights,
        "categories": [],
        "source": "exa",
    }


def calculate_popularity_score(exa_score: float) -> float:
    """
    Calculate popularity score from Exa's relevance score.

    Exa scores range from 0 to ~1. A score of 0.8+ maps to SCORE_MAX.

    Args:
        exa_score: Exa relevance/match score.

    Returns:
        Popularity score in [0, SCORE_MAX].
    """
    if exa_score <= 0:
        return 0.0
    return min(exa_score / EXA_SCORE_FULL_POPULARITY * SCORE_MAX, SCORE_MAX)


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
        if has_domains:
            relevance, matched_domain, matched_keywords = calculate_relevance_score(
                paper, domains, excluded_keywords
            )
            if relevance == 0:
                total_filtered += 1
                continue
        else:
            relevance = 1.0
            matched_domain = "exa_search"
            matched_keywords = []

        recency = calculate_recency_score(paper.get("published_date"))
        popularity = calculate_popularity_score(paper.get("exa_score", 0))
        summary = paper.get("summary", "")
        quality = calculate_quality_score(summary)

        final_score = calculate_recommendation_score(
            relevance, recency, popularity, quality
        )

        scored.append({
            "id": paper.get("url", ""),
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
            "link": paper.get("url", ""),
            "source": "exa",
        })

    scored.sort(key=lambda x: x["final_score"], reverse=True)
    return scored, total_filtered


def build_queries_from_config(config: Dict) -> List[str]:
    """
    Build Exa search queries from research domain configuration.

    Each domain's keywords are combined into a single query string.

    Args:
        config: Research interest configuration.

    Returns:
        List of query strings (one per domain).
    """
    domains = config.get("research_domains", {})
    if not domains:
        return []

    queries = []
    for domain_name, domain_config in domains.items():
        keywords = domain_config.get("keywords", [])
        if keywords:
            queries.append(" ".join(keywords))

    return queries


def main():
    """Main entry point."""
    import argparse

    default_config = os.environ.get("OBSIDIAN_VAULT_PATH", "")
    if default_config:
        default_config = os.path.join(
            default_config, "99_System", "Config", "research_interests.yaml"
        )

    parser = argparse.ArgumentParser(
        description="Search the web using Exa AI and score results"
    )
    parser.add_argument(
        "--config",
        type=str,
        default=default_config or None,
        help="Path to research interests config file",
    )
    parser.add_argument(
        "--output",
        type=str,
        default="exa_results.json",
        help="Output JSON file path",
    )
    parser.add_argument(
        "--top-n",
        type=int,
        default=10,
        help="Number of top results to return",
    )
    parser.add_argument(
        "--queries",
        type=str,
        default="",
        help="Comma-separated search queries (overrides config-derived queries)",
    )
    parser.add_argument(
        "--category",
        type=str,
        default="",
        help="Exa category filter (e.g. 'research paper', 'news', 'company')",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=30,
        help="Only return results published within the last N days",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    # Check for API key
    api_key = os.environ.get("EXA_API_KEY", "")
    if not api_key:
        logger.error("EXA_API_KEY environment variable is not set")
        empty_output = {
            "top_papers": [],
            "total_found": 0,
            "total_filtered": 0,
            "search_date": datetime.now().strftime("%Y-%m-%d"),
            "error": "EXA_API_KEY not configured",
        }
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(empty_output, f, ensure_ascii=False, indent=2)
        print(json.dumps(empty_output, ensure_ascii=True, indent=2))
        return 1

    # Load config
    config = None
    if args.config:
        logger.info("Loading config from: %s", args.config)
        config = load_research_config(args.config)
    else:
        logger.info("No config provided — using queries from CLI args")

    # Build query list
    if args.queries:
        queries = [q.strip() for q in args.queries.split(",") if q.strip()]
    elif config:
        queries = build_queries_from_config(config)
    else:
        queries = ["latest AI research papers"]

    if not queries:
        queries = ["latest AI research papers"]

    logger.info("Search queries: %s", queries)

    # Date range
    start_date = None
    if args.days > 0:
        start_date = (datetime.now() - timedelta(days=args.days)).strftime("%Y-%m-%dT00:00:00.000Z")
        logger.info("Date filter: last %d days (since %s)", args.days, start_date)

    # Category
    category = args.category if args.category else None

    # Search across all queries and collect results
    all_results = []
    seen_urls = set()

    for query in queries:
        results = search_exa(
            query=query,
            api_key=api_key,
            num_results=30,
            category=category,
            start_date=start_date,
        )

        for r in results:
            url = r.get("url", "")
            if url and url not in seen_urls:
                seen_urls.add(url)
                all_results.append(r)

    logger.info("Total unique results across all queries: %d", len(all_results))

    if not all_results:
        logger.warning("No results returned from Exa")
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

    # Normalize results
    papers = []
    for result in all_results:
        normalized = normalize_result(result)
        if normalized:
            papers.append(normalized)

    logger.info("Normalized %d papers from %d raw results", len(papers), len(all_results))

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
    logger.info("Top %d results:", len(top_papers))
    for i, p in enumerate(top_papers, 1):
        logger.info(
            "  %d. %s... (Score: %s)",
            i,
            p["title"][:60],
            p["final_score"],
        )

    # Also output to stdout
    print(json.dumps(output, ensure_ascii=True, indent=2, default=str))

    return 0


if __name__ == "__main__":
    sys.exit(main())
