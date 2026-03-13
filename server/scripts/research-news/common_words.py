"""
通用词集合 —— 被 scan_existing_notes.py 和 link_keywords.py 共享。
这些词在自动提取关键词和自动链接时应被排除。
"""

COMMON_WORDS = {
    # 英语功能词
    'and', 'the', 'for', 'of', 'in', 'on', 'at', 'by', 'with', 'from',
    'to', 'as', 'or', 'but', 'not', 'a', 'an', 'is', 'are', 'was', 'were',
    'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
    'will', 'would', 'should', 'could', 'may', 'might', 'must',
    'can', 'need', 'use', 'using', 'via', 'through', 'over',
    'under', 'between', 'among', 'during', 'without', 'within',
    'this', 'that', 'these', 'those', 'it', 'its', 'they', 'their',
    'we', 'you', 'your', 'our', 'my', 'his', 'her',
    # 在论文标题/摘要中过于常见、缺乏区分度的ML术语
    'model', 'learning', 'training', 'data', 'system', 'method',
    'approach', 'framework', 'network', 'algorithm', 'task',
}
