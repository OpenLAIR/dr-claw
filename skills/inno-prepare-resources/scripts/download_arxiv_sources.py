#!/usr/bin/env python3
"""
Download arXiv paper sources (LaTeX) by title or arXiv id.

Standard library only. For each paper it looks up the arXiv entry, downloads
the e-print archive, and extracts it into <out>/<arxiv_id>/. When arXiv only
has a PDF, the PDF is saved instead. A JSON summary is printed to stdout.

Usage:
    python3 download_arxiv_sources.py --out Ideation/references/papers \
        --title "Attention Is All You Need" --id 2010.11929
    python3 download_arxiv_sources.py --out Ideation/references/papers \
        --titles-file titles.txt

Exit code is 0 when at least one paper was saved (or nothing was requested),
1 when every request failed.
"""

import argparse
import difflib
import gzip
import io
import json
import os
import re
import sys
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

API_URL = "https://export.arxiv.org/api/query"
EPRINT_URL = "https://arxiv.org/e-print/{id}"
PDF_URL = "https://arxiv.org/pdf/{id}"
ATOM = {"a": "http://www.w3.org/2005/Atom"}
USER_AGENT = "dr-claw-skills/1.0 (inno-prepare-resources)"
REQUEST_DELAY = 3.0  # arXiv asks clients to wait 3 seconds between requests
TITLE_MATCH_THRESHOLD = 0.85
STOPWORDS = {
    "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is",
    "it", "of", "on", "or", "the", "to", "via", "with", "you", "all", "we",
}
ID_RE = re.compile(r"^(\d{4}\.\d{4,5}|[a-z\-]+(\.[A-Z]{2})?/\d{7})(v\d+)?$")

_last_request = 0.0


def _get(url, timeout=60):
    global _last_request
    wait = REQUEST_DELAY - (time.time() - _last_request)
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    finally:
        _last_request = time.time()


def _norm(title):
    return re.sub(r"[^a-z0-9]+", " ", title.lower()).strip()


def _parse_entries(xml_bytes):
    root = ET.fromstring(xml_bytes)
    entries = []
    for e in root.findall("a:entry", ATOM):
        raw_id = (e.findtext("a:id", default="", namespaces=ATOM) or "").strip()
        title = re.sub(r"\s+", " ", e.findtext("a:title", default="", namespaces=ATOM) or "").strip()
        if not raw_id or "/abs/" not in raw_id:
            continue
        arxiv_id = raw_id.split("/abs/", 1)[1]
        entries.append({
            "id": re.sub(r"v\d+$", "", arxiv_id),
            "title": title,
            "published": (e.findtext("a:published", default="", namespaces=ATOM) or "")[:10],
            "authors": [a.findtext("a:name", default="", namespaces=ATOM) for a in e.findall("a:author", ATOM)],
        })
    return entries


def find_by_title(title):
    """Return the best-matching arXiv entry for a title, or None."""
    norm = _norm(title)
    if not norm:
        return None
    # Exact phrase first; arXiv's word search drops stopwords, so fall back to
    # an AND of the content words.
    content_words = [w for w in norm.split() if w not in STOPWORDS] or norm.split()
    queries = [f'ti:"{norm}"', "ti:" + " AND ti:".join(content_words[:10])]
    for query in queries:
        url = API_URL + "?" + urllib.parse.urlencode({"search_query": query, "max_results": 10})
        best, best_score = None, 0.0
        for entry in _parse_entries(_get(url)):
            score = difflib.SequenceMatcher(None, norm, _norm(entry["title"])).ratio()
            if score > best_score:
                best, best_score = entry, score
        if best and best_score >= TITLE_MATCH_THRESHOLD:
            best["match_score"] = round(best_score, 3)
            return best
    return None


def find_by_id(arxiv_id):
    url = API_URL + "?" + urllib.parse.urlencode({"id_list": arxiv_id, "max_results": 1})
    entries = _parse_entries(_get(url))
    return entries[0] if entries else None


def _safe_extract(tar, dest):
    dest_real = os.path.realpath(dest)
    for member in tar.getmembers():
        if member.issym() or member.islnk() or member.isdev():
            continue
        target = os.path.realpath(os.path.join(dest, member.name))
        if not (target == dest_real or target.startswith(dest_real + os.sep)):
            continue
        tar.extract(member, dest)


def save_sources(entry, out_dir):
    """Download and unpack the e-print of one entry. Returns (kind, path)."""
    folder = os.path.join(out_dir, entry["id"].replace("/", "_"))
    os.makedirs(folder, exist_ok=True)
    data = _get(EPRINT_URL.format(id=entry["id"]), timeout=120)

    if data[:4] == b"%PDF":
        path = os.path.join(folder, "paper.pdf")
        with open(path, "wb") as f:
            f.write(data)
        kind = "pdf"
    else:
        try:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:*") as tar:
                _safe_extract(tar, folder)
            kind, path = "latex", folder
        except tarfile.TarError:
            try:
                text = gzip.decompress(data)
            except OSError:
                text = data
            if text[:4] == b"%PDF":
                path = os.path.join(folder, "paper.pdf")
                kind = "pdf"
            else:
                path = os.path.join(folder, "main.tex")
                kind = "latex"
            with open(path, "wb") as f:
                f.write(text)
            if kind == "latex":
                path = folder

    with open(os.path.join(folder, "paper_meta.json"), "w", encoding="utf-8") as f:
        json.dump({**entry, "source_kind": kind}, f, ensure_ascii=False, indent=2)
    return kind, path


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", required=True, help="Directory to save papers into (e.g. Ideation/references/papers)")
    parser.add_argument("--title", action="append", default=[], help="Paper title (repeatable)")
    parser.add_argument("--titles-file", help="Text file with one paper title per line")
    parser.add_argument("--id", action="append", default=[], help="arXiv id such as 1706.03762 (repeatable)")
    args = parser.parse_args()

    titles = list(args.title)
    if args.titles_file:
        with open(args.titles_file, encoding="utf-8") as f:
            titles += [line.strip() for line in f if line.strip()]
    os.makedirs(args.out, exist_ok=True)

    results = []
    requests_ = [("title", t) for t in titles] + [("id", i.strip()) for i in args.id if i.strip()]
    for kind, value in requests_:
        record = {"request": value, "by": kind}
        try:
            if kind == "id":
                if not ID_RE.match(value):
                    raise ValueError("not an arXiv id")
                entry = find_by_id(re.sub(r"v\d+$", "", value))
            else:
                entry = find_by_title(value)
            if not entry:
                record["status"] = "not_found"
            else:
                source_kind, path = save_sources(entry, args.out)
                record.update({
                    "status": "saved",
                    "arxiv_id": entry["id"],
                    "title": entry["title"],
                    "published": entry["published"],
                    "source_kind": source_kind,
                    "path": path,
                })
                if "match_score" in entry:
                    record["match_score"] = entry["match_score"]
        except (urllib.error.URLError, ET.ParseError, ValueError, OSError) as exc:
            record["status"] = "error"
            record["error"] = str(exc)
        results.append(record)
        print(f"[{record['status']}] {value}", file=sys.stderr)

    print(json.dumps({"out": args.out, "results": results}, ensure_ascii=False, indent=2))
    saved = sum(1 for r in results if r["status"] == "saved")
    return 0 if saved or not results else 1


if __name__ == "__main__":
    sys.exit(main())
