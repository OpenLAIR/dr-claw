#!/usr/bin/env python3
"""
X (Twitter) research tweet search script.

Searches recent tweets matching research-related queries using the
twitter-cli tool (https://github.com/trevorhobenshield/twitter-cli),
which handles authentication via browser cookies automatically.

Scores results using the shared scoring_utils module, producing output
compatible with the other search scripts (search_arxiv.py, etc.).
"""

import argparse
import json
import logging
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

# scoring_utils lives in the same directory
sys.path.insert(0, str(Path(__file__).resolve().parent))

from scoring_utils import (
    SCORE_MAX,
    calculate_relevance_score,
    calculate_recency_score,
    calculate_quality_score,
    calculate_recommendation_score,
)

logger = logging.getLogger(__name__)

# Popularity normalisation: 1000 total engagements == SCORE_MAX
POPULARITY_ENGAGEMENT_FULL_SCORE = 1000


# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def load_research_config(config_path: str) -> Dict:
    """Load research interest configuration from a YAML file."""
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
            "research_domains": {
                "LLM": {
                    "keywords": ["large language model", "LLM"],
                    "priority": 5,
                }
            },
            "excluded_keywords": [],
        }


# ---------------------------------------------------------------------------
# twitter-cli helpers
# ---------------------------------------------------------------------------

def _check_twitter_cli() -> str:
    """Return the path to the twitter CLI, or raise if not found."""
    path = shutil.which("twitter")
    if not path:
        raise RuntimeError(
            "twitter-cli is not installed. "
            "Run 'npm install' or install manually: uv tool install twitter-cli"
        )
    return path


def search_via_twitter_cli(query: str) -> List[Dict]:
    """
    Search tweets using twitter-cli.

    Returns a list of raw tweet dicts from the CLI JSON output.
    """
    twitter_bin = shutil.which("twitter") or "twitter"
    cmd = [twitter_bin, "search", query, "--json"]
    logger.info("[X] Running: %s", " ".join(cmd))

    result = subprocess.run(cmd, capture_output=True, timeout=120)

    if result.returncode != 0:
        logger.error("[X] CLI exited %d: %s", result.returncode, result.stderr.decode(errors="replace"))
        return []

    raw = result.stdout
    if not raw.strip():
        logger.error("[X] CLI returned empty stdout")
        return []

    # Decode and strip ANSI escape sequences (the CLI colorizes JSON output)
    stdout = raw.decode("utf-8", errors="replace")
    stdout = re.sub(r"\x1b\[[0-9;]*m", "", stdout)

    try:
        envelope = json.loads(stdout)
    except json.JSONDecodeError as e:
        logger.error("[X] Failed to parse CLI output: %s", e)
        logger.error("[X] cleaned stdout (first 200): %s", stdout[:200])
        return []

    if not envelope.get("ok"):
        err = envelope.get("error", {})
        msg = err.get("message", "") if isinstance(err, dict) else str(err)
        logger.error("[X] CLI returned error: %s", msg)
        return []

    tweets = envelope.get("data", [])
    logger.info("[X] Query '%s': got %d tweets", query[:40], len(tweets))
    return tweets


# ---------------------------------------------------------------------------
# Scoring helpers
# ---------------------------------------------------------------------------

def _tweet_engagement(tweet: Dict) -> Dict[str, int]:
    """Extract engagement metrics from a tweet.

    Supports both twitter-cli format (metrics.*) and X API v2 format
    (public_metrics.*_count) for backward compatibility.
    """
    metrics = tweet.get("metrics", {})
    pm = tweet.get("public_metrics", {})
    return {
        "likes": metrics.get("likes", pm.get("like_count", 0)),
        "retweets": metrics.get("retweets", pm.get("retweet_count", 0)),
        "replies": metrics.get("replies", pm.get("reply_count", 0)),
        "impressions": metrics.get("views", pm.get("impression_count", 0)),
    }


def _calculate_popularity_score(engagement: Dict[str, int]) -> float:
    """
    Popularity score based on total engagement.

    1000 engagements = SCORE_MAX (3.0).
    """
    total = engagement["likes"] + engagement["retweets"] + engagement["replies"]
    return min(total / (POPULARITY_ENGAGEMENT_FULL_SCORE / SCORE_MAX), SCORE_MAX)


def _calculate_tweet_quality_score(tweet: Dict) -> float:
    """
    Quality score for a tweet.

    Bonus for:
    - containing URLs (especially arxiv / paper links)
    - thread indicators (e.g. "thread", "1/")
    Also delegates to the generic calculate_quality_score for text analysis.
    """
    text = tweet.get("text", "")
    text_lower = text.lower()

    # Start with the generic text-quality score from scoring_utils
    score = calculate_quality_score(text)

    # Bonus for URLs — twitter-cli puts urls as a top-level list of strings,
    # X API v2 nests them under entities.urls as objects with expanded_url.
    urls = tweet.get("urls", [])
    entities = tweet.get("entities", {})
    entity_urls = entities.get("urls", [])
    all_urls = urls + [u.get("expanded_url", "") for u in entity_urls]
    if all_urls:
        score += 0.3
        # Extra bonus for academic / paper links
        for url_str in all_urls:
            expanded = (url_str if isinstance(url_str, str) else "").lower()
            if any(domain in expanded for domain in [
                "arxiv.org", "openreview.net", "semanticscholar.org",
                "aclanthology.org", "papers.nips.cc", "proceedings.mlr.press",
                "huggingface.co/papers",
            ]):
                score += 0.5
                break

    # Bonus for thread indicators
    if any(ind in text_lower for ind in ["thread", "🧵", "1/"]):
        score += 0.2

    return min(score, SCORE_MAX)


def _parse_tweet_datetime(created_at: str) -> Optional[datetime]:
    """Parse the ISO-8601 created_at string from X API."""
    if not created_at:
        return None
    try:
        # X returns e.g. "2024-01-15T12:34:56.000Z"
        return datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except (ValueError, TypeError):
        return None


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

def build_queries(
    config: Dict,
    extra_queries: Optional[List[str]] = None,
    accounts: Optional[List[str]] = None,
) -> List[str]:
    """
    Build a list of X search queries from config domains, extra queries, and
    tracked accounts.
    """
    queries: List[str] = []

    # From research_domains config
    domains = config.get("research_domains", {})
    for domain_name, domain_config in domains.items():
        keywords = domain_config.get("keywords", [])
        for kw in keywords:
            # Wrap multi-word keywords in quotes for exact matching
            if " " in kw:
                queries.append(f'"{kw}"')
            else:
                queries.append(kw)

    # From --queries CLI arg
    if extra_queries:
        for q in extra_queries:
            q = q.strip()
            if q:
                queries.append(q)

    # From --accounts CLI arg: "from:handle" searches
    if accounts:
        for handle in accounts:
            handle = handle.strip().lstrip("@")
            if handle:
                queries.append(f"from:{handle}")

    # Deduplicate while preserving order
    seen = set()
    unique: List[str] = []
    for q in queries:
        q_lower = q.lower()
        if q_lower not in seen:
            seen.add(q_lower)
            unique.append(q)
    return unique


def score_tweets(
    tweets: List[Dict],
    config: Dict,
) -> List[Dict]:
    """
    Score and normalise a list of raw tweets from twitter-cli.

    Returns a list of scored item dicts ready for output.
    """
    domains = config.get("research_domains", {})
    excluded_keywords = config.get("excluded_keywords", [])
    scored: List[Dict] = []

    for tweet in tweets:
        tweet_id = tweet.get("id", "")
        text = tweet.get("text", "")
        created_at = tweet.get("createdAt", tweet.get("created_at", ""))

        # twitter-cli nests author info under "author"
        author = tweet.get("author", {})
        username = author.get("screenName", author.get("username", "unknown"))
        display_name = author.get("name", username)
        avatar_url = author.get("profileImageUrl", author.get("profile_image_url", ""))

        # Build a paper-like dict so calculate_relevance_score works
        paper_proxy = {
            "title": text[:100],
            "summary": text,
            "categories": [],
        }

        # -- Relevance --
        relevance, matched_domain, matched_keywords = calculate_relevance_score(
            paper_proxy, domains, excluded_keywords
        )
        # Even if relevance == 0 we still keep the tweet (it matched the
        # search query itself), but give it a floor relevance of 0.5
        if relevance == 0:
            relevance = 0.5
            matched_domain = matched_domain or "general"
            matched_keywords = matched_keywords or []

        # -- Recency --
        published_dt = _parse_tweet_datetime(created_at)
        recency = calculate_recency_score(published_dt)

        # -- Popularity --
        engagement = _tweet_engagement(tweet)
        popularity = _calculate_popularity_score(engagement)

        # -- Quality --
        quality = _calculate_tweet_quality_score(tweet)

        # -- Final score --
        final_score = calculate_recommendation_score(
            relevance, recency, popularity, quality, is_hot_paper=False
        )

        # Extract media URLs (photos only — video URLs return 403)
        media_urls = [
            m.get("url", "")
            for m in tweet.get("media", [])
            if m.get("url") and m.get("type") == "photo"
        ]

        item = {
            "id": tweet_id,
            "title": text[:100],
            "authors": f"@{username} ({display_name})",
            "abstract": text,
            "published": created_at,
            "categories": [],
            "relevance_score": round(relevance, 2),
            "recency_score": round(recency, 2),
            "popularity_score": round(popularity, 2),
            "quality_score": round(quality, 2),
            "final_score": final_score,
            "matched_domain": matched_domain,
            "matched_keywords": matched_keywords,
            "link": f"https://x.com/{username}/status/{tweet_id}",
            "source": "x",
            "engagement": engagement,
            "avatar_url": avatar_url,
            "media_urls": media_urls,
        }
        scored.append(item)

    return scored


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch and score research-related tweets from X (Twitter) API v2"
    )
    parser.add_argument(
        "--config", type=str, default=None,
        help="Path to research interests YAML config file",
    )
    parser.add_argument(
        "--output", type=str, default="x_filtered.json",
        help="Output JSON file path",
    )
    parser.add_argument(
        "--top-n", type=int, default=10,
        help="Number of top tweets to return",
    )
    parser.add_argument(
        "--queries", type=str, default=None,
        help="Comma-separated search queries (e.g. 'LLM,GPT,AI agents')",
    )
    parser.add_argument(
        "--accounts", type=str, default=None,
        help="Comma-separated X handles to track (e.g. '_akhaliq,ylaboratory')",
    )

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    # --- Check twitter-cli is installed ---
    try:
        _check_twitter_cli()
    except RuntimeError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    # --- Load config ---
    if args.config:
        config = load_research_config(args.config)
    else:
        config = {
            "research_domains": {},
            "excluded_keywords": [],
        }

    # --- Build queries ---
    extra_queries = (
        [q.strip() for q in args.queries.split(",") if q.strip()]
        if args.queries
        else None
    )
    accounts = (
        [a.strip() for a in args.accounts.split(",") if a.strip()]
        if args.accounts
        else None
    )
    queries = build_queries(config, extra_queries, accounts)

    if not queries:
        logger.error(
            "No search queries. Provide --config, --queries, or --accounts."
        )
        return 1

    logger.info("Will search %d queries: %s", len(queries), queries)

    # --- Fetch tweets ---
    all_tweets: List[Dict] = []
    seen_tweet_ids: set = set()

    for query in queries:
        tweets = search_via_twitter_cli(query)
        for t in tweets:
            tid = t.get("id")
            if tid and tid not in seen_tweet_ids:
                seen_tweet_ids.add(tid)
                all_tweets.append(t)

    total_found = len(all_tweets)
    logger.info("Total unique tweets fetched: %d", total_found)

    if total_found == 0:
        logger.warning("No tweets found for any query.")

    # --- Score ---
    scored_items = score_tweets(all_tweets, config)

    # Sort by final_score descending
    scored_items.sort(key=lambda x: x["final_score"], reverse=True)

    top_items = scored_items[: args.top_n]

    # --- Output ---
    output = {
        "top_papers": top_items,
        "total_found": total_found,
        "total_filtered": len(scored_items),
        "search_date": datetime.now().strftime("%Y-%m-%d"),
    }

    # Write to file
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    logger.info("Results saved to: %s", args.output)
    for i, item in enumerate(top_items, 1):
        logger.info(
            "  %d. @%s — %s... (score: %.2f)",
            i,
            item["authors"].split(" ")[0],
            item["title"][:50],
            item["final_score"],
        )

    # Also write to stdout for piping
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
