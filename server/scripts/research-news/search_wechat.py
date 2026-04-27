#!/usr/bin/env python3
"""
WeChat 公众号 news search via RSSHub (or any RSS instance).

Fetches RSS feeds from a configurable RSSHub instance, normalizes WeChat
公众号 articles into the same shape used by the rest of the news pipeline,
and scores them against the user's research_domains.

Why RSSHub:
- WeChat doesn't expose a public read API for articles you don't own.
- RSSHub is open source, self-hostable, and exposes WeChat 公众号 articles
  as standard RSS/Atom — no QR scan, no cookie scraping.
- The instance URL is user-configurable, so users can point at their own
  Docker-hosted RSSHub when the public one is rate-limited.

Usage:
    python search_wechat.py \\
        --instance https://rsshub.app \\
        --accounts wechat/ce/huxiu_com,wechat/ce/ifanr \\
        --config research_interests.json \\
        --output wechat_results.json \\
        --top-n 12

Routes:
    Each entry in --accounts is either:
      - A relative RSSHub path:  wechat/ce/huxiu_com
      - A full URL:              https://rsshub.app/wechat/ce/huxiu_com
      - A bare ID:               huxiu_com  (treated as wechat/ce/<id>)

Auth:
    --access-key foo  → appended as ?key=foo to every request (some private
    RSSHub instances require this).
"""

from __future__ import annotations

import argparse
import html as html_mod
import json
import logging
import os
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from xml.etree import ElementTree as ET

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

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from scoring_utils import (
    SCORE_MAX,
    calculate_relevance_score,
    calculate_recency_score,
    calculate_quality_score,
    calculate_recommendation_score,
)

DEFAULT_INSTANCE = "https://rsshub.app"
DEFAULT_TIMEOUT = 25
USER_AGENT = "ResearchNews-WeChatFetcher/1.0 (RSSHub-compatible)"
TAG_RE = re.compile(r"<[^>]+>")
WHITESPACE_RE = re.compile(r"\s+")


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------
def build_ssl_context() -> ssl.SSLContext:
    if CERTIFI_CA_BUNDLE and os.path.exists(CERTIFI_CA_BUNDLE):
        return ssl.create_default_context(cafile=CERTIFI_CA_BUNDLE)
    return ssl.create_default_context()


def http_get_text(
    url: str,
    headers: Optional[Dict[str, str]] = None,
    timeout: int = DEFAULT_TIMEOUT,
) -> str:
    headers = {"User-Agent": USER_AGENT, **(headers or {})}
    if HAS_REQUESTS:
        kwargs = {"headers": headers, "timeout": timeout}
        if CERTIFI_CA_BUNDLE and os.path.exists(CERTIFI_CA_BUNDLE):
            kwargs["verify"] = CERTIFI_CA_BUNDLE
        resp = requests.get(url, **kwargs)
        resp.raise_for_status()
        # RSSHub returns UTF-8 by default; trust the server's declared encoding.
        if not resp.encoding or resp.encoding.lower() == "iso-8859-1":
            resp.encoding = resp.apparent_encoding or "utf-8"
        return resp.text

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout, context=build_ssl_context()) as resp:
        raw = resp.read()
        # Try to honor charset from Content-Type header.
        ctype = resp.headers.get("Content-Type", "")
        encoding = "utf-8"
        if "charset=" in ctype:
            encoding = ctype.split("charset=", 1)[1].strip().split(";")[0].strip() or "utf-8"
        return raw.decode(encoding, errors="replace")


# ---------------------------------------------------------------------------
# Route normalization
# ---------------------------------------------------------------------------
def normalize_account_to_url(account: str, instance: str, access_key: str = "") -> Optional[str]:
    """
    Resolve a user-provided account spec to a fully-qualified URL.

    Examples:
        ("wechat/ce/huxiu_com", "https://rsshub.app", "")
            → "https://rsshub.app/wechat/ce/huxiu_com"
        ("https://rsshub.app/wechat/ce/huxiu_com", ...)
            → unchanged
        ("huxiu_com", ...)
            → "https://rsshub.app/wechat/ce/huxiu_com"  (bare-ID heuristic)
    """
    if not account:
        return None

    account = account.strip()
    instance = (instance or DEFAULT_INSTANCE).rstrip("/")

    if account.startswith(("http://", "https://")):
        url = account
    else:
        path = account.lstrip("/")
        # Bare ID heuristic: no slash → assume wechat/ce/<id> (chuansongme proxy,
        # the most stable RSSHub WeChat route as of 2026).
        if "/" not in path:
            path = f"wechat/ce/{path}"
        url = f"{instance}/{path}"

    if access_key:
        sep = "&" if "?" in url else "?"
        url = f"{url}{sep}key={urllib.parse.quote(access_key, safe='')}"
    return url


# ---------------------------------------------------------------------------
# RSS parsing
# ---------------------------------------------------------------------------
ATOM_NS = "{http://www.w3.org/2005/Atom}"
DC_NS = "{http://purl.org/dc/elements/1.1/}"
CONTENT_NS = "{http://purl.org/rss/1.0/modules/content/}"

# A handful of tolerated date formats; RFC 822 covered by parsedate_to_datetime,
# everything else handled below.
ISO_FORMATS = [
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%dT%H:%M:%SZ",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
]


def _parse_date(value: str) -> Optional[datetime]:
    if not value:
        return None
    value = value.strip()

    try:
        # Python ISO parser handles "2026-04-26T12:34:56+08:00" since 3.11
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        pass

    # RFC 822 (e.g. "Sat, 26 Apr 2026 12:34:56 +0800")
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(value)
        if dt and dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        pass

    for fmt in ISO_FORMATS:
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


def _strip_html(text: str, max_len: int = 320) -> str:
    if not text:
        return ""
    no_tags = TAG_RE.sub(" ", text)
    decoded = html_mod.unescape(no_tags)
    cleaned = WHITESPACE_RE.sub(" ", decoded).strip()
    if len(cleaned) > max_len:
        cleaned = cleaned[: max_len - 1].rstrip() + "…"
    return cleaned


def parse_rss(xml_text: str) -> Tuple[str, List[Dict]]:
    """
    Parse RSS 2.0 or Atom feed. Returns (channel_title, list_of_entries).
    Each entry: {title, link, summary, published, published_date, author}.
    """
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as exc:
        logger.warning("[WeChat] feed parse error: %s", exc)
        return "", []

    entries: List[Dict] = []

    # RSS 2.0
    channel = root.find("channel")
    if channel is not None:
        channel_title = (channel.findtext("title") or "").strip()
        for item in channel.findall("item"):
            title = (item.findtext("title") or "").strip()
            link = (item.findtext("link") or "").strip()
            description = item.findtext("description") or ""
            content_encoded = item.findtext(f"{CONTENT_NS}encoded") or ""
            body = content_encoded or description
            pub = item.findtext("pubDate") or item.findtext(f"{DC_NS}date") or ""
            author = (
                item.findtext("author")
                or item.findtext(f"{DC_NS}creator")
                or channel_title
            ).strip()
            entries.append({
                "title": title,
                "link": link,
                "summary": _strip_html(body),
                "published": pub,
                "published_date": _parse_date(pub),
                "author": author,
            })
        return channel_title, entries

    # Atom 1.0
    if root.tag.endswith("}feed") or root.tag == "feed":
        channel_title = (root.findtext(f"{ATOM_NS}title") or "").strip()
        for entry in root.findall(f"{ATOM_NS}entry"):
            title = (entry.findtext(f"{ATOM_NS}title") or "").strip()
            link_el = entry.find(f"{ATOM_NS}link")
            link = link_el.get("href", "") if link_el is not None else ""
            summary_text = (
                entry.findtext(f"{ATOM_NS}content")
                or entry.findtext(f"{ATOM_NS}summary")
                or ""
            )
            pub = (
                entry.findtext(f"{ATOM_NS}updated")
                or entry.findtext(f"{ATOM_NS}published")
                or ""
            )
            author_el = entry.find(f"{ATOM_NS}author")
            author = ""
            if author_el is not None:
                author = (author_el.findtext(f"{ATOM_NS}name") or "").strip()
            entries.append({
                "title": title,
                "link": link,
                "summary": _strip_html(summary_text),
                "published": pub,
                "published_date": _parse_date(pub),
                "author": author or channel_title,
            })
        return channel_title, entries

    logger.warning("[WeChat] unrecognized feed format (root=%s)", root.tag)
    return "", []


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------
def score_articles(
    articles: List[Dict],
    config: Optional[Dict],
) -> Tuple[List[Dict], int]:
    """
    Score WeChat articles. RSS doesn't expose engagement metrics, so popularity
    falls back to a soft floor — relevance, recency, and quality do the heavy
    lifting.
    """
    domains = (config or {}).get("research_domains", {}) or {}
    excluded = (config or {}).get("excluded_keywords", []) or []
    has_domains = bool(domains)

    scored: List[Dict] = []
    filtered = 0

    for art in articles:
        if has_domains:
            relevance, matched_domain, matched_keywords = calculate_relevance_score(
                {
                    "title": art.get("title", ""),
                    "summary": art.get("summary", ""),
                    "categories": [],
                },
                domains,
                excluded,
            )
            if relevance == 0:
                filtered += 1
                continue
        else:
            relevance = 1.5  # neutral when no domains configured
            matched_domain = "wechat"
            matched_keywords = []

        recency = calculate_recency_score(art.get("published_date"))
        quality = calculate_quality_score(art.get("summary", ""))
        # Light bonus for non-empty title (many RSSHub feeds have empty titles
        # for image-only posts; penalize those implicitly by giving nothing).
        if art.get("title"):
            quality = min(quality + 0.2, SCORE_MAX)

        # No engagement metrics in RSS — give a soft, fixed floor so popularity
        # doesn't tank the final score for everything.
        popularity = 1.0

        final_score = calculate_recommendation_score(
            relevance, recency, popularity, quality
        )

        scored.append({
            "id": art.get("link") or art.get("title", ""),
            "title": art.get("title", ""),
            "authors": art.get("author", ""),
            "abstract": art.get("summary", "") or "(no excerpt)",
            "published": art.get("published", ""),
            "categories": [],
            "relevance_score": round(relevance, 2),
            "recency_score": round(recency, 2),
            "popularity_score": round(popularity, 2),
            "quality_score": round(quality, 2),
            "final_score": final_score,
            "matched_domain": matched_domain,
            "matched_keywords": matched_keywords,
            "link": art.get("link", ""),
            "source": "wechat",
            "engagement": {},
            # WeChat-specific extras (consumed by NewsItemCard's wechat branch)
            "account_name": art.get("account_name", ""),
            "account_route": art.get("account_route", ""),
        })

    scored.sort(key=lambda x: x["final_score"], reverse=True)
    return scored, filtered


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    parser = argparse.ArgumentParser(
        description="Fetch and score WeChat 公众号 articles via RSSHub."
    )
    parser.add_argument("--config", type=str, default=None,
                        help="Path to research interests JSON config")
    parser.add_argument("--output", type=str, required=True,
                        help="Output JSON file path")
    parser.add_argument("--top-n", type=int, default=12,
                        help="Number of top articles to return")
    parser.add_argument("--instance", type=str, default=DEFAULT_INSTANCE,
                        help="RSSHub instance base URL")
    parser.add_argument("--accounts", type=str, default="",
                        help="Comma-separated WeChat 公众号 routes/IDs")
    parser.add_argument("--access-key", type=str, default="",
                        help="Optional RSSHub access key (?key=...)")
    parser.add_argument("--per-account-limit", type=int, default=20,
                        help="Max articles to keep per feed before scoring")
    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
        stream=sys.stderr,
    )

    config: Optional[Dict] = None
    if args.config:
        try:
            with open(args.config, "r", encoding="utf-8-sig") as f:
                config = json.load(f)
            logger.info("[WeChat] loaded config from %s", args.config)
        except Exception as exc:
            logger.warning("[WeChat] failed to load config %s: %s", args.config, exc)

    accounts_raw = (args.accounts or (config or {}).get("accounts") or "")
    if isinstance(accounts_raw, list):
        account_specs = [str(a).strip() for a in accounts_raw if str(a).strip()]
    else:
        account_specs = [s.strip() for s in str(accounts_raw).split(",") if s.strip()]

    if not account_specs:
        logger.warning(
            "[WeChat] no accounts configured — pass --accounts or set "
            "config.accounts. Returning empty results."
        )
        output = {
            "top_papers": [],
            "total_found": 0,
            "total_filtered": 0,
            "search_date": datetime.now().strftime("%Y-%m-%d"),
            "instance": args.instance,
            "accounts": [],
        }
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(output, f, ensure_ascii=False, indent=2)
        print(json.dumps(output, ensure_ascii=True, indent=2))
        return 0

    instance = (args.instance or DEFAULT_INSTANCE).rstrip("/")
    access_key = (args.access_key or (config or {}).get("access_key") or "").strip()

    logger.info("[WeChat] instance=%s, %d accounts", instance, len(account_specs))

    all_articles: List[Dict] = []
    seen_links: set = set()

    for spec in account_specs:
        url = normalize_account_to_url(spec, instance, access_key)
        if not url:
            continue
        logger.info("[WeChat] fetching: %s", url)
        try:
            xml_text = http_get_text(url)
        except Exception as exc:
            logger.warning("[WeChat]   fetch failed: %s", exc)
            time.sleep(1.0)
            continue

        channel_title, entries = parse_rss(xml_text)
        if not entries:
            logger.info("[WeChat]   no entries (channel=%r)", channel_title)
            continue

        added = 0
        for entry in entries[: args.per_account_limit]:
            link = entry.get("link") or ""
            dedup_key = link or entry.get("title", "")
            if dedup_key in seen_links:
                continue
            seen_links.add(dedup_key)
            entry["account_name"] = channel_title or spec
            entry["account_route"] = spec
            all_articles.append(entry)
            added += 1
        logger.info(
            "[WeChat]   +%d articles from %r", added, channel_title or spec,
        )
        # Be polite to public RSSHub instances.
        time.sleep(0.6)

    scored, filtered = score_articles(all_articles, config)
    logger.info(
        "[WeChat] scored %d articles (%d filtered)", len(scored), filtered,
    )
    top = scored[: args.top_n]

    output = {
        "top_papers": top,
        "total_found": len(all_articles),
        "total_filtered": filtered,
        "search_date": datetime.now().strftime("%Y-%m-%d"),
        "instance": instance,
        "accounts": account_specs,
    }
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)

    logger.info("[WeChat] saved %d articles to %s", len(top), args.output)
    for i, art in enumerate(top, 1):
        logger.info(
            "  %d. %s... (score=%s)",
            i, (art["title"] or "(no title)")[:60], art["final_score"],
        )

    print(json.dumps(output, ensure_ascii=True, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
