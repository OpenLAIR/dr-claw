#!/usr/bin/env python3
"""
Shared scoring functions for paper recommendation.

Extracted from search_arxiv.py so that other modules (e.g. search_semantic_scholar)
can reuse the same scoring logic without duplication.
"""

from datetime import datetime
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# 评分常量  —— 修改权重时只需编辑这里
# ---------------------------------------------------------------------------

# 各维度原始评分的满分值（归一化基准）
SCORE_MAX = 3.0

# 相关性评分：关键词在标题 / 摘要中匹配的加分
RELEVANCE_TITLE_KEYWORD_BOOST = 0.5
RELEVANCE_SUMMARY_KEYWORD_BOOST = 0.3
RELEVANCE_CATEGORY_MATCH_BOOST = 1.0

# 新近性阈值（天） -> 对应评分
RECENCY_THRESHOLDS = [
    (30, 3.0),
    (90, 2.0),
    (180, 1.0),
]
RECENCY_DEFAULT = 0.0

# 热门度：高影响力引用数归一化到 0-SCORE_MAX
# 含义：达到此引用数时视为满分
POPULARITY_INFLUENTIAL_CITATION_FULL_SCORE = 100

# 综合推荐评分权重（普通论文）
WEIGHTS_NORMAL = {
    'relevance': 0.40,
    'recency': 0.20,
    'popularity': 0.30,
    'quality': 0.10,
}
# 综合推荐评分权重（高影响力论文：提高热门度，降低新近性）
WEIGHTS_HOT = {
    'relevance': 0.35,
    'recency': 0.10,
    'popularity': 0.45,
    'quality': 0.10,
}


def calculate_relevance_score(
    paper: Dict,
    domains: Dict,
    excluded_keywords: List[str]
) -> Tuple[float, Optional[str], List[str]]:
    """
    计算论文与研究兴趣的相关性评分

    Args:
        paper: 论文信息
        domains: 研究领域配置
        excluded_keywords: 排除关键词

    Returns:
        (相关性评分, 匹配的领域, 匹配的关键词列表)
    """
    title = paper.get('title', '').lower()
    summary = paper.get('summary', '').lower() if 'summary' in paper else paper.get('abstract', '').lower()
    categories = set(paper.get('categories', []))

    # 检查排除关键词
    for keyword in excluded_keywords:
        if keyword.lower() in title or keyword.lower() in summary:
            return 0, None, []

    max_score = 0
    best_domain = None
    matched_keywords = []

    # 遍历所有领域
    for domain_name, domain_config in domains.items():
        score = 0
        domain_matched_keywords = []

        # 关键词匹配
        keywords = domain_config.get('keywords', [])
        for keyword in keywords:
            keyword_lower = keyword.lower()
            if keyword_lower in title:
                score += RELEVANCE_TITLE_KEYWORD_BOOST
                domain_matched_keywords.append(keyword)
            elif keyword_lower in summary:
                score += RELEVANCE_SUMMARY_KEYWORD_BOOST
                domain_matched_keywords.append(keyword)

        # 类别匹配
        domain_categories = domain_config.get('arxiv_categories', [])
        for cat in domain_categories:
            if cat in categories:
                score += RELEVANCE_CATEGORY_MATCH_BOOST
                domain_matched_keywords.append(cat)

        if score > max_score:
            max_score = score
            best_domain = domain_name
            matched_keywords = domain_matched_keywords

    return max_score, best_domain, matched_keywords


def calculate_recency_score(published_date: Optional[datetime]) -> float:
    """
    根据发布日期计算新近性评分

    Args:
        published_date: 发布日期

    Returns:
        新近性评分 (0-3)
    """
    if published_date is None:
        return 0

    now = datetime.now(published_date.tzinfo) if published_date.tzinfo else datetime.now()
    days_diff = (now - published_date).days

    for max_days, score in RECENCY_THRESHOLDS:
        if days_diff <= max_days:
            return score
    return RECENCY_DEFAULT


def calculate_quality_score(summary: str) -> float:
    """
    从摘要推断质量评分

    采用更细粒度的指标：强创新词权重高于弱创新词，
    量化结果和对比实验也加分。

    Args:
        summary: 论文摘要

    Returns:
        质量评分 (0-3)
    """
    score = 0.0
    summary_lower = summary.lower()

    strong_innovation = [
        'state-of-the-art', 'sota', 'breakthrough', 'first',
        'surpass', 'outperform', 'pioneering'
    ]
    weak_innovation = [
        'novel', 'propose', 'introduce', 'new approach',
        'new method', 'innovative'
    ]
    method_indicators = [
        'framework', 'architecture', 'algorithm', 'mechanism',
        'pipeline', 'end-to-end'
    ]
    quantitative_indicators = [
        'outperforms', 'improves by', 'achieves', 'accuracy',
        'f1', 'bleu', 'rouge', 'beats', 'surpasses'
    ]
    experiment_indicators = [
        'experiment', 'evaluation', 'benchmark', 'ablation',
        'baseline', 'comparison'
    ]

    strong_count = sum(1 for ind in strong_innovation if ind in summary_lower)
    if strong_count >= 2:
        score += 1.0
    elif strong_count == 1:
        score += 0.7
    else:
        weak_count = sum(1 for ind in weak_innovation if ind in summary_lower)
        if weak_count > 0:
            score += 0.3

    if any(ind in summary_lower for ind in method_indicators):
        score += 0.5

    if any(ind in summary_lower for ind in quantitative_indicators):
        score += 0.8
    elif any(ind in summary_lower for ind in experiment_indicators):
        score += 0.4

    return min(score, SCORE_MAX)


def calculate_recommendation_score(
    relevance_score: float,
    recency_score: float,
    popularity_score: float,
    quality_score: float,
    is_hot_paper: bool = False
) -> float:
    """
    计算综合推荐评分

    权重定义在模块顶部常量 WEIGHTS_NORMAL / WEIGHTS_HOT 中。
    对于高影响力论文（来自 Semantic Scholar），使用 WEIGHTS_HOT 提高热门度权重。

    Args:
        relevance_score: 相关性评分 (0-SCORE_MAX)
        recency_score: 新近性评分 (0-SCORE_MAX)
        popularity_score: 热门度评分 (0-SCORE_MAX)
        quality_score: 质量评分 (0-SCORE_MAX)
        is_hot_paper: 是否是高影响力论文

    Returns:
        综合推荐评分 (0-10)
    """
    scores = {
        'relevance': relevance_score,
        'recency': recency_score,
        'popularity': popularity_score,
        'quality': quality_score,
    }
    # 归一化到 0-10 分
    normalized = {k: (v / SCORE_MAX) * 10 for k, v in scores.items()}

    weights = WEIGHTS_HOT if is_hot_paper else WEIGHTS_NORMAL
    final_score = sum(normalized[k] * weights[k] for k in weights)

    return round(final_score, 2)
