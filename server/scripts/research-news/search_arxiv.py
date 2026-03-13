#!/usr/bin/env python3
"""
arXiv + Semantic Scholar 混合架构论文搜索脚本
用于 start-my-day skill，搜索最近一个月和最近一年的极火、极热门、极优质论文
"""

import xml.etree.ElementTree as ET
import json
import re
import os
import sys
import time
import logging
from datetime import datetime, timedelta
from typing import List, Dict, Set, Optional, Tuple
from pathlib import Path
import urllib.request
import urllib.parse

logger = logging.getLogger(__name__)

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False
    logger.warning("requests library not found, using urllib for Semantic Scholar API")

# ---------------------------------------------------------------------------
# API 配置
# ---------------------------------------------------------------------------
ARXIV_NS = {
    'atom': 'http://www.w3.org/2005/Atom',
    'arxiv': 'http://arxiv.org/schemas/atom'
}

SEMANTIC_SCHOLAR_API_URL = "https://api.semanticscholar.org/graph/v1/paper/search"
SEMANTIC_SCHOLAR_FIELDS = "title,abstract,publicationDate,citationCount,influentialCitationCount,url,authors,externalIds"

ARXIV_CATEGORY_KEYWORDS = {
    "cs.AI": "artificial intelligence",
    "cs.LG": "machine learning",
    "cs.CL": "computational linguistics natural language processing",
    "cs.CV": "computer vision",
    "cs.MM": "multimedia",
    "cs.MA": "multi-agent systems",
    "cs.RO": "robotics"
}

# ---------------------------------------------------------------------------
# 评分常量与函数（从 scoring_utils 导入）
# ---------------------------------------------------------------------------
from scoring_utils import (
    SCORE_MAX, RELEVANCE_TITLE_KEYWORD_BOOST, RELEVANCE_SUMMARY_KEYWORD_BOOST,
    RELEVANCE_CATEGORY_MATCH_BOOST, RECENCY_THRESHOLDS, RECENCY_DEFAULT,
    POPULARITY_INFLUENTIAL_CITATION_FULL_SCORE, WEIGHTS_NORMAL, WEIGHTS_HOT,
    calculate_relevance_score, calculate_recency_score, calculate_quality_score,
    calculate_recommendation_score,
)

# Semantic Scholar 速率限制等待时间（秒）
S2_RATE_LIMIT_WAIT = 30
S2_CATEGORY_REQUEST_INTERVAL = 3


def load_research_config(config_path: str) -> Dict:
    """
    从 JSON 或 YAML 文件加载研究兴趣配置

    Args:
        config_path: 配置文件路径

    Returns:
        研究配置字典
    """
    import json

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            if config_path.endswith('.json'):
                config = json.load(f)
            else:
                try:
                    import yaml
                    config = yaml.safe_load(f)
                except ImportError:
                    # Fallback: try parsing as JSON even if extension is .yaml
                    config = json.load(f)
        return config
    except Exception as e:
        logger.error("Error loading config: %s", e)
        # 返回默认配置
        return {
            "research_domains": {
                "大模型": {
                    "keywords": [
                        "pre-training", "foundation model", "model architecture",
                        "large language model", "LLM", "transformer"
                    ],
                    "arxiv_categories": ["cs.AI", "cs.LG", "cs.CL"],
                    "priority": 5
                }
            },
            "excluded_keywords": ["3D", "review", "workshop", "survey"]
        }


def calculate_date_windows(target_date: Optional[datetime] = None) -> Tuple[datetime, datetime, datetime, datetime]:
    """
    计算两个时间窗口：最近30天和过去一年（除去最近30天）
    
    Args:
        target_date: 基准日期，如果为 None 则使用当前日期
        
    Returns:
        (window_30d_start, window_30d_end, window_1y_start, window_1y_end)
        - window_30d_start: 30天窗口开始日期
        - window_30d_end: 30天窗口结束日期（即 target_date）
        - window_1y_start: 一年窗口开始日期
        - window_1y_end: 一年窗口结束日期（即 31天前）
    """
    if target_date is None:
        target_date = datetime.now()
    
    # 最近30天窗口: [target_date - 30 days, target_date]
    window_30d_start = target_date - timedelta(days=30)
    window_30d_end = target_date
    
    # 过去一年窗口（除去最近30天）: [target_date - 365 days, target_date - 31 days]
    window_1y_start = target_date - timedelta(days=365)
    window_1y_end = target_date - timedelta(days=31)
    
    return window_30d_start, window_30d_end, window_1y_start, window_1y_end


def search_arxiv_by_date_range(
    categories: List[str],
    start_date: datetime,
    end_date: datetime,
    max_results: int = 200,
    max_retries: int = 3
) -> List[Dict]:
    """
    使用 arXiv API 搜索指定日期范围内的论文
    
    Args:
        categories: arXiv 分类列表
        start_date: 开始日期
        end_date: 结束日期
        max_results: 最大结果数
        max_retries: 最大重试次数
        
    Returns:
        论文列表
    """
    # 构建分类查询
    category_query = "+OR+".join([f"cat:{cat}" for cat in categories])
    
    # 构建日期范围查询 (arXiv 使用 YYYYMMDD 格式)
    date_query = f"submittedDate:[{start_date.strftime('%Y%m%d')}0000+TO+{end_date.strftime('%Y%m%d')}2359]"
    
    # 组合查询
    full_query = f"({category_query})+AND+{date_query}"
    
    # 构建 URL
    url = (
        f"https://export.arxiv.org/api/query?"
        f"search_query={full_query}&"
        f"max_results={max_results}&"
        f"sortBy=submittedDate&"
        f"sortOrder=descending"
    )
    
    logger.info("[arXiv] Searching papers from %s to %s", start_date.date(), end_date.date())
    logger.debug("[arXiv] URL: %s...", url[:120])
    
    for attempt in range(max_retries):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                xml_content = response.read().decode('utf-8')
                papers = parse_arxiv_xml(xml_content)
                logger.info("[arXiv] Found %d papers", len(papers))
                return papers
        except Exception as e:
            logger.warning("[arXiv] Error (attempt %d/%d): %s", attempt + 1, max_retries, e)
            if attempt < max_retries - 1:
                wait_time = (2 ** attempt) * 2
                logger.info("[arXiv] Retrying in %d seconds...", wait_time)
                time.sleep(wait_time)
            else:
                logger.error("[arXiv] Failed after %d attempts", max_retries)
                return []
    
    return []


def search_semantic_scholar_hot_papers(
    query: str,
    start_date: datetime,
    end_date: datetime,
    top_k: int = 20,
    max_retries: int = 3
) -> List[Dict]:
    """
    使用 Semantic Scholar API 搜索指定时间范围内的高影响力论文
    
    Args:
        query: 搜索关键词
        start_date: 开始日期
        end_date: 结束日期
        top_k: 返回前 K 篇高影响力论文
        max_retries: 最大重试次数
        
    Returns:
        按高影响力引用数排序的论文列表
    """
    # 构建日期范围 (Semantic Scholar 使用 YYYY-MM-DD:YYYY-MM-DD 格式)
    date_range = f"{start_date.strftime('%Y-%m-%d')}:{end_date.strftime('%Y-%m-%d')}"
    
    # 构建请求参数
    params = {
        "query": query,
        "publicationDateOrYear": date_range,
        "limit": 100,  # 先拉取100篇相关度最高的
        "fields": SEMANTIC_SCHOLAR_FIELDS
    }
    
    headers = {
        "User-Agent": "StartMyDay-PaperFetcher/1.0"
    }
    
    logger.info("[S2] Searching hot papers from %s to %s", start_date.date(), end_date.date())
    logger.info("[S2] Query: '%s'", query)
    
    for attempt in range(max_retries):
        try:
            if HAS_REQUESTS:
                response = requests.get(
                    SEMANTIC_SCHOLAR_API_URL,
                    params=params,
                    headers=headers,
                    timeout=15
                )
                response.raise_for_status()
                data = response.json()
            else:
                # 使用 urllib
                query_string = urllib.parse.urlencode(params)
                url = f"{SEMANTIC_SCHOLAR_API_URL}?{query_string}"
                req = urllib.request.Request(url, headers=headers)
                with urllib.request.urlopen(req, timeout=15) as response:
                    data = json.loads(response.read().decode('utf-8'))
            
            papers = data.get("data", [])
            if not papers:
                logger.info("[S2] No papers found")
                return []
            
            # 本地二次过滤与排序
            valid_papers = []
            for p in papers:
                # 过滤掉没有标题或摘要的无效条目
                if not p.get("title") or not p.get("abstract"):
                    continue
                
                # 处理可能的 None 值
                inf_cit = p.get("influentialCitationCount") or 0
                cit = p.get("citationCount") or 0
                
                p["influentialCitationCount"] = inf_cit
                p["citationCount"] = cit
                
                # 标记来源
                p["source"] = "semantic_scholar"
                p["hot_score"] = inf_cit  # 使用高影响力引用数作为热度分数
                
                valid_papers.append(p)
            
            # 按高影响力引用数倒序排列
            sorted_papers = sorted(
                valid_papers,
                key=lambda x: x["influentialCitationCount"],
                reverse=True
            )
            
            logger.info("[S2] Found %d valid papers, returning top %d", len(sorted_papers), top_k)
            return sorted_papers[:top_k]
            
        except Exception as e:
            error_msg = str(e)
            logger.warning("[S2] Error (attempt %d/%d): %s", attempt + 1, max_retries, e)
            
            # 检查是否是 429 错误（Too Many Requests）
            is_rate_limit = "429" in error_msg or "Too Many Requests" in error_msg
            
            if attempt < max_retries - 1:
                # 对于 429 错误，使用更长的等待时间
                if is_rate_limit:
                    wait_time = S2_RATE_LIMIT_WAIT
                    logger.warning("[S2] Rate limit hit. Waiting %d seconds...", wait_time)
                else:
                    wait_time = (2 ** attempt) * 2
                    logger.info("[S2] Retrying in %d seconds...", wait_time)
                time.sleep(wait_time)
            else:
                logger.error("[S2] Failed after %d attempts", max_retries)
                return []
    
    return []


def search_hot_papers_from_categories(
    categories: List[str],
    start_date: datetime,
    end_date: datetime,
    top_k_per_category: int = 5
) -> List[Dict]:
    """
    为多个 arXiv 分类搜索高影响力论文
    
    Args:
        categories: arXiv 分类列表
        start_date: 开始日期
        end_date: 结束日期
        top_k_per_category: 每个分类返回的论文数
        
    Returns:
        合并后的高影响力论文列表
    """
    all_hot_papers = []
    seen_arxiv_ids = set()
    
    for category in categories:
        # 获取对应的关键词
        query = ARXIV_CATEGORY_KEYWORDS.get(category, category)
        
        papers = search_semantic_scholar_hot_papers(
            query=query,
            start_date=start_date,
            end_date=end_date,
            top_k=top_k_per_category
        )
        
        # 去重（基于 arXiv ID）
        for p in papers:
            # 安全地从 externalIds 字典中提取 ArXiv 编号
            arxiv_id = p.get("externalIds", {}).get("ArXiv") if p.get("externalIds") else None
            
            # 统一写入 arxiv_id 字段，方便最后 Step 3 的全局去重
            p["arxiv_id"] = arxiv_id
            
            if arxiv_id and arxiv_id not in seen_arxiv_ids:
                seen_arxiv_ids.add(arxiv_id)
                all_hot_papers.append(p)
            elif not arxiv_id:
                # 没有 arXiv ID 的也保留（可能是其他来源的论文）
                all_hot_papers.append(p)
        
        time.sleep(S2_CATEGORY_REQUEST_INTERVAL)
    
    # 最终按影响力引用数排序
    all_hot_papers.sort(key=lambda x: x.get("influentialCitationCount", 0), reverse=True)
    
    return all_hot_papers


def parse_arxiv_xml(xml_content: str) -> List[Dict]:
    """
    解析 arXiv XML 结果
    
    Args:
        xml_content: XML 内容
        
    Returns:
        论文列表，每篇论文包含 ID、标题、作者、摘要等信息
    """
    papers = []
    
    try:
        root = ET.fromstring(xml_content)
        
        # 查找所有 entry 元素
        for entry in root.findall('atom:entry', ARXIV_NS):
            paper = {}
            
            # 提取 ID
            id_elem = entry.find('atom:id', ARXIV_NS)
            if id_elem is not None:
                paper['id'] = id_elem.text
                # 提取 arXiv ID（从 URL 中提取）
                match = re.search(r'arXiv:(\d+\.\d+)', paper['id'])
                if match:
                    paper['arxiv_id'] = match.group(1)
                else:
                    match = re.search(r'/(\d+\.\d+)$', paper['id'])
                    if match:
                        paper['arxiv_id'] = match.group(1)
            
            # 提取标题
            title_elem = entry.find('atom:title', ARXIV_NS)
            if title_elem is not None:
                paper['title'] = title_elem.text.strip()
            
            # 提取摘要
            summary_elem = entry.find('atom:summary', ARXIV_NS)
            if summary_elem is not None:
                paper['summary'] = summary_elem.text.strip()
            
            # 提取作者
            authors = []
            for author in entry.findall('atom:author', ARXIV_NS):
                name_elem = author.find('atom:name', ARXIV_NS)
                if name_elem is not None:
                    authors.append(name_elem.text)
            paper['authors'] = authors
            
            # 提取发布日期
            published_elem = entry.find('atom:published', ARXIV_NS)
            if published_elem is not None:
                paper['published'] = published_elem.text
                # 解析日期
                try:
                    paper['published_date'] = datetime.fromisoformat(
                        paper['published'].replace('Z', '+00:00')
                    )
                except (ValueError, TypeError):
                    paper['published_date'] = None
            
            # 提取更新日期
            updated_elem = entry.find('atom:updated', ARXIV_NS)
            if updated_elem is not None:
                paper['updated'] = updated_elem.text
            
            # 提取分类
            categories = []
            for category in entry.findall('atom:category', ARXIV_NS):
                term = category.get('term')
                if term:
                    categories.append(term)
            paper['categories'] = categories
            
            # 提取 PDF 链接
            for link in entry.findall('atom:link', ARXIV_NS):
                if link.get('title') == 'pdf':
                    paper['pdf_url'] = link.get('href')
                    break
            
            # 提取主页面链接
            if 'id' in paper:
                paper['url'] = paper['id']
            
            # 标记来源
            paper['source'] = 'arxiv'
            
            papers.append(paper)
            
    except ET.ParseError as e:
        logger.error("Error parsing XML: %s", e)
        raise
    
    return papers


def filter_and_score_papers(
    papers: List[Dict],
    config: Dict,
    target_date: Optional[datetime] = None,
    is_hot_paper_batch: bool = False
) -> List[Dict]:
    """
    筛选和评分论文

    Args:
        papers: 论文列表
        config: 研究配置
        target_date: 目标日期（用于计算新近性）
        is_hot_paper_batch: 是否是高影响力论文批次

    Returns:
        筛选和评分后的论文列表
    """
    domains = config.get('research_domains', {})
    excluded_keywords = config.get('excluded_keywords', [])

    scored_papers = []

    for paper in papers:
        # 计算相关性
        relevance, matched_domain, matched_keywords = calculate_relevance_score(
            paper, domains, excluded_keywords
        )

        # 如果相关性为0，跳过
        if relevance == 0:
            continue

        # 计算新近性
        if 'published_date' in paper:
            recency = calculate_recency_score(paper.get('published_date'))
        else:
            # 对于 Semantic Scholar 的论文，使用 publicationDate
            pub_date_str = paper.get('publicationDate')
            if pub_date_str:
                try:
                    pub_date = datetime.strptime(pub_date_str, '%Y-%m-%d')
                    recency = calculate_recency_score(pub_date)
                except (ValueError, TypeError):
                    recency = 0
            else:
                recency = 0

        # 计算热门度
        if is_hot_paper_batch:
            # 高影响力论文：使用 influentialCitationCount
            inf_cit = paper.get('influentialCitationCount', 0)
            popularity = min(
                inf_cit / (POPULARITY_INFLUENTIAL_CITATION_FULL_SCORE / SCORE_MAX),
                SCORE_MAX,
            )
        else:
            # 普通论文：基于摘要推断
            summary = paper.get('summary', '') if 'summary' in paper else paper.get('abstract', '')
            popularity = calculate_quality_score(summary)  # 临时使用质量评分作为热门度

        # 计算质量
        summary = paper.get('summary', '') if 'summary' in paper else paper.get('abstract', '')
        quality = calculate_quality_score(summary)

        # 计算综合推荐评分
        recommendation_score = calculate_recommendation_score(
            relevance, recency, popularity, quality, is_hot_paper_batch
        )

        # 添加评分信息
        paper['scores'] = {
            'relevance': round(relevance, 2),
            'recency': round(recency, 2),
            'popularity': round(popularity, 2),
            'quality': round(quality, 2),
            'recommendation': recommendation_score
        }
        # Flat score fields for the frontend
        paper['relevance_score'] = round(relevance, 2)
        paper['recency_score'] = round(recency, 2)
        paper['popularity_score'] = round(popularity, 2)
        paper['quality_score'] = round(quality, 2)
        paper['final_score'] = recommendation_score
        # Ensure 'abstract' field exists for the frontend
        if 'abstract' not in paper and 'summary' in paper:
            paper['abstract'] = paper['summary']
        paper['matched_domain'] = matched_domain
        paper['matched_keywords'] = matched_keywords
        paper['is_hot_paper'] = is_hot_paper_batch

        scored_papers.append(paper)

    # 按推荐评分排序
    scored_papers.sort(key=lambda x: x['scores']['recommendation'], reverse=True)

    return scored_papers


def main():
    """主函数"""
    import argparse

    default_config = os.environ.get('OBSIDIAN_VAULT_PATH', '')
    if default_config:
        default_config = os.path.join(default_config, '99_System', 'Config', 'research_interests.yaml')

    parser = argparse.ArgumentParser(description='Search and filter arXiv papers with Semantic Scholar integration')
    parser.add_argument('--config', type=str,
                        default=default_config or None,
                        help='Path to research interests config file (or set OBSIDIAN_VAULT_PATH env var)')
    parser.add_argument('--output', type=str, default='arxiv_filtered.json',
                        help='Output JSON file path')
    parser.add_argument('--max-results', type=int, default=200,
                        help='Maximum number of results to fetch from arXiv')
    parser.add_argument('--top-n', type=int, default=10,
                        help='Number of top papers to return')
    parser.add_argument('--target-date', type=str, default=None,
                        help='Target date (YYYY-MM-DD) for filtering')
    parser.add_argument('--categories', type=str,
                        default='cs.AI,cs.LG,cs.CL,cs.CV,cs.MM,cs.MA,cs.RO',
                        help='Comma-separated list of arXiv categories')
    parser.add_argument('--skip-hot-papers', action='store_true',
                        help='Skip searching hot papers from Semantic Scholar')

    args = parser.parse_args()

    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(message)s',
        datefmt='%H:%M:%S',
        stream=sys.stderr,
    )

    if not args.config:
        logger.error("未指定配置文件路径。请通过 --config 参数或 OBSIDIAN_VAULT_PATH 环境变量设置。")
        return 1

    logger.info("Loading config from: %s", args.config)
    config = load_research_config(args.config)

    # 解析目标日期
    target_date = None
    if args.target_date:
        try:
            target_date = datetime.strptime(args.target_date, '%Y-%m-%d')
            logger.info("Target date: %s", args.target_date)
        except ValueError:
            logger.error("Invalid target date format: %s", args.target_date)
            return 1
    else:
        target_date = datetime.now()
        logger.info("Using current date: %s", target_date.strftime('%Y-%m-%d'))

    window_30d_start, window_30d_end, window_1y_start, window_1y_end = calculate_date_windows(target_date)
    logger.info("Date windows:")
    logger.info("  Recent 30 days: %s to %s", window_30d_start.date(), window_30d_end.date())
    logger.info("  Past year (31-365 days): %s to %s", window_1y_start.date(), window_1y_end.date())

    # 解析分类
    categories = args.categories.split(',')

    all_scored_papers = []
    recent_papers = []
    hot_papers = []

    def _write_intermediate(papers_so_far, stage, total_recent=0, total_hot=0):
        """Write intermediate results to the output file so the UI can poll progress."""
        sorted_papers = sorted(papers_so_far, key=lambda x: x.get('scores', {}).get('recommendation', 0), reverse=True)
        top = sorted_papers[:args.top_n]
        intermediate = {
            'target_date': args.target_date or target_date.strftime('%Y-%m-%d'),
            'search_date': target_date.strftime('%Y-%m-%d'),
            'stage': stage,
            'total_found': total_recent + total_hot,
            'total_filtered': len(papers_so_far),
            'top_papers': top,
        }
        try:
            with open(args.output, 'w', encoding='utf-8') as f:
                json.dump(intermediate, f, ensure_ascii=False, indent=2, default=str)
        except Exception:
            pass

    # ========== 第一步：搜索最近30天的论文（arXiv）==========
    logger.info("=" * 70)
    logger.info("Step 1: Searching recent papers (last 30 days) from arXiv")
    logger.info("=" * 70)

    recent_papers = search_arxiv_by_date_range(
        categories=categories,
        start_date=window_30d_start,
        end_date=window_30d_end,
        max_results=args.max_results
    )

    if recent_papers:
        scored_recent = filter_and_score_papers(
            papers=recent_papers,
            config=config,
            target_date=target_date,
            is_hot_paper_batch=False
        )
        logger.info("Scored %d recent papers", len(scored_recent))
        all_scored_papers.extend(scored_recent)
        _write_intermediate(all_scored_papers, 'recent_done', total_recent=len(recent_papers))
    else:
        logger.warning("No recent papers found")

    # ========== 第二步：搜索过去一年的高影响力论文（Semantic Scholar）==========
    # NOTE: Disabled — currently only fetching from arXiv directly.
    # if not args.skip_hot_papers:
    #     logger.info("=" * 70)
    #     logger.info("Step 2: Searching hot papers (past year) from Semantic Scholar")
    #     logger.info("=" * 70)
    #
    #     hot_papers = search_hot_papers_from_categories(
    #         categories=categories,
    #         start_date=window_1y_start,
    #         end_date=window_1y_end,
    #         top_k_per_category=5
    #     )
    #
    #     if hot_papers:
    #         scored_hot = filter_and_score_papers(
    #             papers=hot_papers,
    #             config=config,
    #             target_date=target_date,
    #             is_hot_paper_batch=True
    #         )
    #         logger.info("Scored %d hot papers", len(scored_hot))
    #         all_scored_papers.extend(scored_hot)
    #         _write_intermediate(all_scored_papers, 'hot_done', total_recent=len(recent_papers), total_hot=len(hot_papers))
    #     else:
    #         logger.warning("No hot papers found from Semantic Scholar")
    # else:
    #     logger.info("Skipping hot paper search (disabled by user)")
    logger.info("Skipping Semantic Scholar hot paper search (disabled)")

    # ========== 第三步：合并结果并排序 ==========
    logger.info("=" * 70)
    logger.info("Step 3: Merging and ranking results")
    logger.info("=" * 70)
    
    # 按推荐评分排序
    all_scored_papers.sort(key=lambda x: x['scores']['recommendation'], reverse=True)
    
    # 去重（基于 arXiv ID）
    seen_ids = set()
    unique_papers = []
    for p in all_scored_papers:
        arxiv_id = p.get('arxiv_id') or p.get('arxivId')
        if arxiv_id:
            if arxiv_id not in seen_ids:
                seen_ids.add(arxiv_id)
                unique_papers.append(p)
        else:
            # 没有 arXiv ID 的，使用标题去重
            title = p.get('title', '')
            if title not in seen_ids:
                seen_ids.add(title)
                unique_papers.append(p)
    
    logger.info("Total unique papers after deduplication: %d", len(unique_papers))

    if len(unique_papers) == 0:
        logger.warning("No papers matched the criteria!")
        return 1

    # 取前 N 篇
    top_papers = unique_papers[:args.top_n]

    # 准备输出
    output = {
        'target_date': args.target_date or target_date.strftime('%Y-%m-%d'),
        'date_windows': {
            'recent_30d': {
                'start': window_30d_start.strftime('%Y-%m-%d'),
                'end': window_30d_end.strftime('%Y-%m-%d')
            },
            'past_year': {
                'start': window_1y_start.strftime('%Y-%m-%d'),
                'end': window_1y_end.strftime('%Y-%m-%d')
            }
        },
        'total_recent': len(recent_papers),
        'total_hot': len(hot_papers),
        'total_unique': len(unique_papers),
        'top_papers': top_papers
    }

    # 保存结果
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2, default=str)

    logger.info("Results saved to: %s", args.output)
    logger.info("Top %d papers:", len(top_papers))
    for i, p in enumerate(top_papers, 1):
        hot_marker = " [HOT]" if p.get('is_hot_paper') else ""
        logger.info("  %d. %s... (Score: %s)%s", i, p.get('title', 'N/A')[:60], p['scores']['recommendation'], hot_marker)

    # 同时输出到 stdout
    print(json.dumps(output, ensure_ascii=False, indent=2, default=str))

    return 0


if __name__ == '__main__':
    sys.exit(main())
