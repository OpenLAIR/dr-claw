# Output Contracts

Two machine-readable artifacts plus one human-readable Markdown narrative.

## 1. `candidates.json` — input to the LLM (produced by `scripts/cluster_and_seed.py`)

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-04-30T16:00:00Z",
  "newsDataDir": "/abs/path/to/news/data (value of $DRCLAW_NEWS_DATA_DIR)",
  "totalScanned": 124,
  "totalUnique": 87,
  "clusters": [
    {
      "clusterKey": "llm__long-context",
      "clusterLabel": "Long-context LLMs",
      "matchedDomain": "Large Language Models",
      "primaryKeyword": "long-context",
      "items": [
        {
          "canonicalId": "arxiv:2604.12345v1",
          "title": "...",
          "abstract": "...",
          "authors": ["..."],
          "url": "https://arxiv.org/abs/2604.12345",
          "sources": [
            { "source": "arxiv", "score": 8.4, "matchedKeywords": ["long-context", "transformer"] },
            { "source": "huggingface", "score": 7.1, "matchedKeywords": ["long-context"] }
          ],
          "blendedScore": 7.95,
          "publishedDate": "2026-04-28",
          "engagement": { "stars": null, "likes": null, "upvotes": 12 }
        }
      ]
    }
  ]
}
```

**Canonical id rules** (in priority order):

1. `arxiv:<id>` if any source attaches an arXiv ID
2. `gh:<owner>/<repo>` if a GitHub repo URL
3. `hf:<repo_id>` if a HuggingFace Hub repo
4. `wechat:<account_route>:<title_hash>` for WeChat 公众号 articles
5. `xhs:<note_id>` / `x:<tweet_id>` for social posts
6. `title:<sha1(title)[:12]>` as the last-resort fallback

**Cross-source merging**: when two items resolve to the same canonical id, the helper keeps the highest scored entry as the "primary" and stacks the other source(s) into `sources[]`. `blendedScore` is the simple max across sources today (Phase 3 / Option B2 will replace this with a proper blend).

## 2. `seeds.json` — output (you produce this)

```json
{
  "schemaVersion": "1.0",
  "generatedAt": "2026-04-30T16:14:00Z",
  "candidatesFile": "./.cache/news-idea-briefing/candidates.json",
  "researchBrief": ".pipeline/docs/research_brief.json",
  "clusters": [
    {
      "name": "Sparse attention for million-token context",
      "summary": "...",
      "supportingItems": ["arxiv:2604.12345v1", "gh:foo/bar", "hf:org/model"]
    }
  ],
  "seeds": [
    {
      "id": "seed-1",
      "cluster": "Sparse attention for million-token context",
      "title": "Block-sparse retrieval head ablation on long-form QA",
      "rationale": "Item [arxiv:2604.12345v1] introduces block-sparse attention but only evaluates on …. Item [gh:foo/bar] open-sources the head but never benchmarks against the standard …. The gap is measuring whether the sparsity gain holds when …",
      "first_experiment": "Reproduce [arxiv:2604.12345v1]'s table 3 baseline, then ablate the retrieval head on the long-form QA subset of …",
      "risk": "If the gain in [arxiv:2604.12345v1] is dataset-specific, the ablation will null-result and tell us nothing new.",
      "confidence": "medium",
      "noveltyCheck": { "ran": true, "duplicates": [] }
    }
  ]
}
```

**Required fields per seed**: `id`, `cluster`, `title`, `rationale`, `first_experiment`, `risk`, `confidence`. Optional: `noveltyCheck`.

**`confidence` policy**:

- `high` — concrete gap clearly identified, ≥ 2 grounded citations, novelty check clean
- `medium` — plausible gap, ≥ 1 grounded citation, no novelty check or clean check
- `low` — speculative; or novelty check found a near-duplicate

## 3. `idea_briefing.md` — human-readable narrative

Structure (in this order, with these exact heading levels):

```markdown
# Idea Briefing — <YYYY-MM-DD>

> Generated from <N> unique items across <M> sources. <K> clusters surfaced; <S> idea seeds proposed.

## Today at a glance
- 1-paragraph overview citing 3-5 of the most striking items by canonical id

## Clusters
### <Cluster name>
**What's new** — <1-2 sentences, cited>
**Key items**
- [<canonical id>] <title> — <one-line "why this matters">
- ...
**Idea seeds**
- **<seed title>** (<confidence>) — <rationale> <first experiment> <risk>

(Repeat per cluster)

## Lateral pick (optional)
<If a cluster from an adjacent domain is included, briefly explain why.>

## Methodology note
- <how candidates were aggregated, what was excluded, what limitations to keep in mind>
```

The Markdown is the artifact a human reads. The JSON is what Option C's "Promote to Auto Research" button consumes.

## Where files land

```
<project>/
├── .cache/news-idea-briefing/
│   └── candidates.json                      # ephemeral; safe to delete
└── Ideation/
    └── proactive/
        └── 2026-04-30/
            ├── idea_briefing.md
            └── seeds.json
        └── 2026-04-30-2/                    # if a second run happens same day
            ├── ...
```

Briefings are **append-only** history. Never overwrite an existing date folder; suffix with `-2`, `-3`, etc.
