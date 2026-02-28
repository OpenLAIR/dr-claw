import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, Edit3, Layers, Loader2, RefreshCw, Save, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api } from '../utils/api';
type SkillNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillNode[];
};

type SkillTagType = 'domain' | 'stage' | 'meta';

type SkillTag = {
  label: string;
  type: SkillTagType;
};

type LocaleKey = 'zh' | 'en' | 'ko';

type LocalizedLabel = {
  zh: string;
  en: string;
  ko?: string;
};

type SkillTagMappingFile = {
  stageOverrides?: Record<string, LocalizedLabel>;
  domainOverrides?: Record<string, LocalizedLabel>;
  platformNativeSkills?: string[];
};

type SkillTagMapping = {
  stageOverrides: Record<string, LocalizedLabel>;
  domainOverrides: Record<string, LocalizedLabel>;
  platformNativeSkills: Set<string>;
};

type SkillSummary = {
  name: string;
  /** Relative path from skills root to the skill directory (e.g. "distributed-training/accelerate") */
  dirPath: string;
  summary: string;
  fullDescription: string;
  tags: SkillTag[];
};


// Skills are now loaded from the global /api/skills endpoint (no per-project scanning).

const STAGE_RULES: Array<{ test: RegExp; tag: LocalizedLabel }> = [
  { test: /(orchestrator|route|planning|planner)/i, tag: { zh: '阶段: 编排', en: 'Stage: Orchestration', ko: '단계: 오케스트레이션' } },
  { test: /(prepare|resource|bootstrap|setup|collect)/i, tag: { zh: '阶段: 资源准备', en: 'Stage: Resource Prep', ko: '단계: 리소스 준비' } },
  { test: /(idea|brainstorm|hypothesis)/i, tag: { zh: '阶段: Idea生成', en: 'Stage: Idea Generation', ko: '단계: 아이디어 생성' } },
  { test: /(idea eval|evaluation|quality gate|meta-review)/i, tag: { zh: '阶段: Idea评估', en: 'Stage: Idea Evaluation', ko: '단계: 아이디어 평가' } },
  { test: /(survey|reference|literature|search)/i, tag: { zh: '阶段: 调研', en: 'Stage: Survey', ko: '단계: 조사' } },
  { test: /(experiment|develop|training|implementation|run)/i, tag: { zh: '阶段: 实验开发', en: 'Stage: Experiment Dev', ko: '단계: 실험 개발' } },
  { test: /(analysis|evaluate|benchmark|metric)/i, tag: { zh: '阶段: 实验分析', en: 'Stage: Analysis', ko: '단계: 분석' } },
  { test: /(paper|write|publication|report)/i, tag: { zh: '阶段: 论文撰写', en: 'Stage: Paper Writing', ko: '단계: 논문 작성' } },
  { test: /(reviewer|peer review|manuscript review)/i, tag: { zh: '阶段: 论文评审', en: 'Stage: Paper Review', ko: '단계: 논문 심사' } },
  { test: /(overleaf|rclone|sync)/i, tag: { zh: '阶段: 发布同步', en: 'Stage: Publication Sync', ko: '단계: 배포 동기화' } },
];

const DOMAIN_RULES: Array<{ test: RegExp; tag: LocalizedLabel }> = [
  { test: /(medical|med|clinical|health|biomed)/i, tag: { zh: '领域: 医疗', en: 'Domain: Medical', ko: '영역: 의료' } },
  { test: /(vision|image|cv|segmentation|detection)/i, tag: { zh: '领域: 视觉', en: 'Domain: Vision', ko: '영역: 비전' } },
  { test: /(nlp|language|text|llm)/i, tag: { zh: '领域: NLP', en: 'Domain: NLP', ko: '영역: NLP' } },
  { test: /(dataset|benchmark|corpus|data discovery)/i, tag: { zh: '领域: 数据', en: 'Domain: Data', ko: '영역: 데이터' } },
  { test: /(mcp|orchestrator|workflow|tool[- ]?use|automation|multi-agent)/i, tag: { zh: '领域: Agent', en: 'Domain: Agent', ko: '영역: 에이전트' } },
];

const EMPTY_TAG_MAPPING: SkillTagMapping = {
  stageOverrides: {},
  domainOverrides: {},
  platformNativeSkills: new Set<string>(),
};

const UI_TEXT: Record<LocaleKey, Record<string, string>> = {
  zh: {
    loading: '加载技能中...',
    title: '技能面板',
    refresh: '刷新',
    noRoots: '当前项目中未找到技能目录。',
    notFoundRoots: '当前工作区未检测到可用技能。',
    noSkills: '暂未检测到技能。创建或关联技能后点击刷新。',
    searchPlaceholder: '搜索技能名、描述或标签...',
    clearSearch: '清除搜索',
    allTags: '全部标签',
    noFilterResult: '当前筛选条件下没有技能，尝试清空搜索词或切换标签。',
    clickForMore: '点击查看完整描述',
    detailTitle: '技能详情',
    fallbackDesc: 'Skill available, but description could not be extracted from SKILL.md.',
    fallbackNoSkillMd: 'No SKILL.md detected at the root. Contains {{count}} files (likely script- or workflow-based skill).',
    defaultDomain: '领域: 通用',
    sourcePlatform: '来源: 平台自研',
    headerCount: '{{shown}}/{{total}} skills',
    importLocal: '导入本地技能',
    importModalTitle: '从本地目录导入技能',
    scan: '扫描',
    scanning: '扫描中...',
    importSelected: '导入选中',
    importing: '导入中...',
    importSuccess: '成功导入 {{count}} 个技能',
    importSkipped: '已跳过 {{count}} 个已存在的技能',
    noSkillsFound: '未在该目录中发现技能。',
    alreadyImported: '已导入',
    pathLabel: '技能目录路径',
    editSkill: '编辑',
    deleteSkill: '删除',
    saveSkill: '保存',
    cancelEdit: '取消',
    confirmDeleteSkill: '确定要删除技能 "{{name}}" 吗？此操作不可撤销。',
    skillDeleted: '技能 "{{name}}" 已删除',
    skillSaved: '技能 "{{name}}" 已保存',
    saving: '保存中...',
    deleting: '删除中...',
  },
  en: {
    loading: 'Loading skills...',
    title: 'Skills Dashboard',
    refresh: 'Refresh',
    noRoots: 'No skill directories found in this project.',
    notFoundRoots: 'No skills are currently available in this workspace.',
    noSkills: 'No skills detected yet. Click Refresh after creating or linking skills.',
    searchPlaceholder: 'Search skills, descriptions, or tags...',
    clearSearch: 'Clear search',
    allTags: 'All Tags',
    noFilterResult: 'No skills match the current filters. Try clearing search or switching tags.',
    clickForMore: 'Click to view full description',
    detailTitle: 'Skill details',
    fallbackDesc: 'Skill available, but description could not be extracted from SKILL.md.',
    fallbackNoSkillMd: 'No SKILL.md detected at the root. Contains {{count}} files (likely script- or workflow-based skill).',
    defaultDomain: 'Domain: General',
    sourcePlatform: 'Source: VibeLab',
    headerCount: '{{shown}}/{{total}} skills',
    importLocal: 'Import Local Skills',
    importModalTitle: 'Import skills from local directory',
    scan: 'Scan',
    scanning: 'Scanning...',
    importSelected: 'Import Selected',
    importing: 'Importing...',
    importSuccess: 'Successfully imported {{count}} skills',
    importSkipped: 'Skipped {{count}} already-imported skills',
    noSkillsFound: 'No skills found in this directory.',
    alreadyImported: 'Already imported',
    pathLabel: 'Skills directory path',
    editSkill: 'Edit',
    deleteSkill: 'Delete',
    saveSkill: 'Save',
    cancelEdit: 'Cancel',
    confirmDeleteSkill: 'Delete skill "{{name}}"? This cannot be undone.',
    skillDeleted: '"{{name}}" deleted',
    skillSaved: '"{{name}}" saved',
    saving: 'Saving...',
    deleting: 'Deleting...',
  },
  ko: {
    loading: 'Loading skills...',
    title: 'Skills Dashboard',
    refresh: 'Refresh',
    noRoots: 'No skill directories found in this project.',
    notFoundRoots: 'No skills are currently available in this workspace.',
    noSkills: 'No skills detected yet. Click Refresh after creating or linking skills.',
    searchPlaceholder: 'Search skills, descriptions, or tags...',
    clearSearch: 'Clear search',
    allTags: 'All Tags',
    noFilterResult: 'No skills match the current filters. Try clearing search or switching tags.',
    clickForMore: 'Click to view full description',
    detailTitle: 'Skill details',
    fallbackDesc: 'Skill available, but description could not be extracted from SKILL.md.',
    fallbackNoSkillMd: 'No SKILL.md detected at the root. Contains {{count}} files (likely script- or workflow-based skill).',
    defaultDomain: 'Domain: General',
    sourcePlatform: 'Source: VibeLab',
    headerCount: '{{shown}}/{{total}} skills',
    importLocal: 'Import Local Skills',
    importModalTitle: 'Import skills from local directory',
    scan: 'Scan',
    scanning: 'Scanning...',
    importSelected: 'Import Selected',
    importing: 'Importing...',
    importSuccess: 'Successfully imported {{count}} skills',
    importSkipped: 'Skipped {{count}} already-imported skills',
    noSkillsFound: 'No skills found in this directory.',
    alreadyImported: 'Already imported',
    pathLabel: 'Skills directory path',
    editSkill: 'Edit',
    deleteSkill: 'Delete',
    saveSkill: 'Save',
    cancelEdit: 'Cancel',
    confirmDeleteSkill: 'Delete skill "{{name}}"? This cannot be undone.',
    skillDeleted: '"{{name}}" deleted',
    skillSaved: '"{{name}}" saved',
    saving: 'Saving...',
    deleting: 'Deleting...',
  },
};

function resolveLocaleKey(language: string): LocaleKey {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('zh')) return 'zh';
  if (normalized.startsWith('ko')) return 'ko';
  return 'en';
}

function localize(label: LocalizedLabel, localeKey: LocaleKey): string {
  return label[localeKey] ?? label.en;
}

function getPrefix(type: 'domain' | 'stage', localeKey: LocaleKey): string {
  if (type === 'domain') {
    if (localeKey === 'zh') return '领域:';
    if (localeKey === 'ko') return '영역:';
    return 'Domain:';
  }
  if (localeKey === 'zh') return '阶段:';
  if (localeKey === 'ko') return '단계:';
  return 'Stage:';
}

function normalizeSkillKey(input: string): string {
  return compactText(input).toLowerCase();
}

function parseTagMappingFile(payload: unknown): SkillTagMapping {
  if (!payload || typeof payload !== 'object') {
    return EMPTY_TAG_MAPPING;
  }

  const parsed = payload as SkillTagMappingFile;
  const stageOverrides = Object.fromEntries(
    Object.entries(parsed.stageOverrides ?? {}).map(([key, value]) => [normalizeSkillKey(key), value])
  );
  const domainOverrides = Object.fromEntries(
    Object.entries(parsed.domainOverrides ?? {}).map(([key, value]) => [normalizeSkillKey(key), value])
  );
  const platformNativeSkills = new Set((parsed.platformNativeSkills ?? []).map((name) => normalizeSkillKey(name)));

  return {
    stageOverrides,
    domainOverrides,
    platformNativeSkills,
  };
}

function countFiles(node: SkillNode): number {
  if (node.type === 'file') {
    return 1;
  }
  return (node.children ?? []).reduce((acc, child) => acc + countFiles(child), 0);
}

function findDirectFilePathByName(node: SkillNode, fileName: string): string | null {
  if (node.type !== 'directory') {
    return null;
  }

  const directFile = (node.children ?? []).find(
    (child) => child.type === 'file' && child.name === fileName
  );

  return directFile?.path ?? null;
}

const NON_SKILL_DIRECTORY_NAMES = new Set([
  '__pycache__',
  'asset',
  'assets',
  'scripts',
  'script',
  'references',
  'reference',
  'prompts',
  'prompt',
  'resources',
  'resource',
  'examples',
  'example',
  'templates',
  'template',
  'tests',
  'test',
]);

function isLikelyNonSkillDirectory(node: SkillNode): boolean {
  return NON_SKILL_DIRECTORY_NAMES.has(node.name.toLowerCase());
}

function collectSkillDirectories(nodes: SkillNode[]): SkillNode[] {
  const results: SkillNode[] = [];
  const seenPaths = new Set<string>();

  const push = (node: SkillNode) => {
    if (node.type !== 'directory') return;
    if (isLikelyNonSkillDirectory(node)) return;
    if (seenPaths.has(node.path)) return;
    seenPaths.add(node.path);
    results.push(node);
  };

  const visit = (node: SkillNode, depthFromRoot: number): boolean => {
    if (node.type !== 'directory') {
      return false;
    }

    if (findDirectFilePathByName(node, 'SKILL.md')) {
      push(node);
      return true;
    }

    const childDirs = (node.children ?? []).filter((child) => child.type === 'directory');
    let foundDescendantSkill = false;

    for (const childDir of childDirs) {
      if (visit(childDir, depthFromRoot + 1)) {
        foundDescendantSkill = true;
      }
    }

    // Fallback only for top-level directories directly under the skills root.
    if (!foundDescendantSkill && depthFromRoot === 0 && childDirs.length === 0) {
      push(node);
      return true;
    }

    return foundDescendantSkill;
  };

  for (const node of nodes) {
    if (node.type === 'directory') {
      visit(node, 0);
    }
  }

  return results;
}

function compactText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function clampText(input: string, maxLength = 240): string {
  const text = compactText(input);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function parseYamlInlineArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }

  return trimmed
    .slice(1, -1)
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseFrontmatterTags(lines: string[], localeKey: LocaleKey): SkillTag[] {
  const tags: SkillTag[] = [];
  const pushTag = (label: string, type: SkillTagType = 'meta') => {
    const normalized = compactText(label);
    if (normalized) {
      tags.push({ label: normalized, type });
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const keyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1].toLowerCase();
    const rawValue = keyMatch[2].trim();

    if (key === 'tags') {
      if (!rawValue) {
        for (let j = i + 1; j < lines.length; j += 1) {
          const listMatch = lines[j].match(/^\s*[-*]\s*(.+)$/);
          if (!listMatch) break;
          pushTag(listMatch[1], 'meta');
          i = j;
        }
      } else {
        const inlineArray = parseYamlInlineArray(rawValue);
        if (inlineArray.length > 0) {
          inlineArray.forEach((tag) => pushTag(tag, 'meta'));
        } else {
          rawValue.split(',').forEach((tag) => pushTag(tag, 'meta'));
        }
      }
    }

    if (key === 'domain') {
      rawValue.split(',').forEach((tag) => pushTag(`${getPrefix('domain', localeKey)} ${tag.trim()}`, 'domain'));
    }

    if (key === 'stage') {
      rawValue.split(',').forEach((tag) => pushTag(`${getPrefix('stage', localeKey)} ${tag.trim()}`, 'stage'));
    }
  }

  return tags;
}

function parseDescriptionFromFrontmatter(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const keyMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const rawValue = keyMatch[2].trim();
    if (key !== 'description') continue;

    if (/^(>|>-|\||\|-)$/.test(rawValue)) {
      const blockLines: string[] = [];
      for (let j = i + 1; j < lines.length; j += 1) {
        const candidate = lines[j];
        if (/^[A-Za-z0-9_-]+\s*:/.test(candidate)) {
          break;
        }
        const cleaned = candidate.replace(/^\s+/, '');
        if (cleaned) blockLines.push(cleaned);
      }
      const blockSummary = compactText(blockLines.join(' '));
      if (blockSummary) {
        return blockSummary;
      }
    } else if (rawValue) {
      const inlineSummary = compactText(rawValue.replace(/^['"]|['"]$/g, ''));
      if (inlineSummary) {
        return inlineSummary;
      }
    }

    break;
  }

  return null;
}

function extractBodyDescription(content: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, '');
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !line.startsWith('#'));

  const normalized = lines.join('\n').replace(/^[\-*+]\s+/gm, '').trim();
  return normalized;
}

function inferTags(skillName: string, summary: string, explicitTags: SkillTag[], localeKey: LocaleKey, mapping: SkillTagMapping): SkillTag[] {
  const inferred: SkillTag[] = [...explicitTags];
  const push = (label: string, type: SkillTagType) => {
    if (!inferred.some((tag) => tag.label === label)) {
      inferred.push({ label, type });
    }
  };

  const signal = `${skillName} ${summary}`;
  const normalizedSkillName = normalizeSkillKey(skillName);
  const hasStage = inferred.some((tag) => tag.type === 'stage');
  const hasDomain = inferred.some((tag) => tag.type === 'domain');
  const nativeSkillSet = mapping.platformNativeSkills;

  if (!hasStage) {
    const stageOverride = mapping.stageOverrides[normalizedSkillName];
    if (stageOverride) {
      push(localize(stageOverride, localeKey), 'stage');
    } else if (nativeSkillSet.has(normalizedSkillName)) {
      for (const rule of STAGE_RULES) {
        if (rule.test.test(signal)) {
          push(localize(rule.tag, localeKey), 'stage');
          break;
        }
      }
    }
  }

  if (!hasDomain) {
    const domainOverride = mapping.domainOverrides[normalizedSkillName];
    if (domainOverride) {
      push(localize(domainOverride, localeKey), 'domain');
    } else {
      for (const rule of DOMAIN_RULES) {
        if (rule.test.test(signal)) {
          push(localize(rule.tag, localeKey), 'domain');
        }
      }
    }
  }

  if (!inferred.some((tag) => tag.type === 'domain')) {
    push(UI_TEXT[localeKey].defaultDomain, 'domain');
  }

  if (nativeSkillSet.has(normalizedSkillName)) {
    push(UI_TEXT[localeKey].sourcePlatform, 'meta');
  }

  return inferred;
}

function extractSkillMetadata(content: string, localeKey: LocaleKey): { summary: string | null; fullDescription: string | null; tags: SkillTag[] } {
  const normalized = content.replace(/\r\n/g, '\n');
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  const frontmatterLines = frontmatterMatch ? frontmatterMatch[1].split('\n') : [];

  const fmDescription = parseDescriptionFromFrontmatter(frontmatterLines);
  const bodyDescription = extractBodyDescription(normalized);
  const fullDescription = fmDescription || bodyDescription || null;
  const summary = fullDescription ? clampText(fullDescription) : null;
  const tags: SkillTag[] = [];

  return { summary, fullDescription, tags };
}

function tagStyleClass(type: SkillTagType, label?: string): string {
  if (label && /^(来源: 平台自研|Source: VibeLab)$/i.test(label)) {
    return 'border-amber-300/80 bg-amber-50 text-amber-800 shadow-sm dark:border-amber-500/60 dark:bg-amber-900/30 dark:text-amber-200';
  }
  if (type === 'stage') {
    if (label && /^(Category:|类别:|카테고리:)/.test(label)) {
      return 'border-violet-300/60 bg-violet-50 text-violet-700 dark:border-violet-600/60 dark:bg-violet-950/40 dark:text-violet-200';
    }
    return 'border-cyan-300/60 bg-cyan-50 text-cyan-700 dark:border-cyan-600/60 dark:bg-cyan-950/40 dark:text-cyan-200';
  }
  if (type === 'domain') {
    return 'border-emerald-300/60 bg-emerald-50 text-emerald-700 dark:border-emerald-600/60 dark:bg-emerald-950/40 dark:text-emerald-200';
  }
  return 'border-slate-300/60 bg-slate-50 text-slate-700 dark:border-slate-600/60 dark:bg-slate-900/60 dark:text-slate-200';
}

function getTagPriority(tag: SkillTag): number {
  if (/^(来源: 平台自研|Source: VibeLab)$/i.test(tag.label)) return 0;
  if (tag.type === 'stage') return 1;
  if (tag.type === 'domain') return 2;
  return 3;
}

function sortSkillTags(tags: SkillTag[]): SkillTag[] {
  return [...tags].sort((a, b) => {
    const priorityDiff = getTagPriority(a) - getTagPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.label.localeCompare(b.label);
  });
}

interface SkillsDashboardProps {
  selectedProject?: { name: string; displayName: string } | null;
}

export default function SkillsDashboard({ selectedProject }: SkillsDashboardProps) {
  const { i18n } = useTranslation();
  const localeKey = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const text = UI_TEXT[localeKey];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [hasSkillRoots, setHasSkillRoots] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTag, setActiveTag] = useState<string>('all');
  const [focusedSkill, setFocusedSkill] = useState<SkillSummary | null>(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPath, setImportPath] = useState('~/.claude/skills');
  const [scanLoading, setScanLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [scannedSkills, setScannedSkills] = useState<Array<{ name: string; hasSkillMd: boolean; alreadyImported: boolean }>>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [importMessage, setImportMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [modalMessage, setModalMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Load tag mapping from global skills directory
      let tagMapping = EMPTY_TAG_MAPPING;
      try {
        const mappingResponse = await api.readGlobalSkillFile('skill-tag-mapping.json');
        if (mappingResponse.ok) {
          const mappingPayload = await mappingResponse.json();
          const mappingContent = mappingPayload?.content ?? '';
          tagMapping = parseTagMappingFile(JSON.parse(mappingContent));
        }
      } catch {
        tagMapping = EMPTY_TAG_MAPPING;
      }

      // Load skills tree from global endpoint
      const treeResponse = await api.getGlobalSkills();
      if (!treeResponse.ok) {
        if (treeResponse.status === 404) {
          setHasSkillRoots(false);
          setSkills([]);
          return;
        }
        throw new Error(`Failed to load global skills (${treeResponse.status})`);
      }
      const responseContentType = treeResponse.headers.get('content-type') || '';
      if (!responseContentType.includes('application/json')) {
        throw new Error('Skills API returned non-JSON response. Please restart the backend and try again.');
      }

      const treeNodes = (await treeResponse.json()) as SkillNode[];
      const skillDirs = collectSkillDirectories(treeNodes);

      // Infer skills root from top-level node paths (strip the node name to get the parent)
      const skillsRoot = treeNodes.length > 0 && treeNodes[0].path
        ? treeNodes[0].path.replace(/[/\\][^/\\]+$/, '')
        : '';

      const extractedSkills = await Promise.all(
        skillDirs.map(async (node) => {
          const skillName = node.name;
          const skillMdPath = findDirectFilePathByName(node, 'SKILL.md');

          // Compute relative path from skills root (e.g. "distributed-training/accelerate")
          let dirPath = skillName;
          if (skillsRoot && node.path && node.path.startsWith(skillsRoot + '/')) {
            dirPath = node.path.slice(skillsRoot.length + 1);
          }

          let summary = '';
          let fullDescription = '';
          let tags: SkillTag[] = [];

          if (skillMdPath) {
            try {
              const fileResponse = await api.readGlobalSkillFile(skillMdPath);
              if (fileResponse.ok) {
                const payload = await fileResponse.json();
                const parsed = extractSkillMetadata(payload.content || '', localeKey);
                summary = parsed.summary || '';
                fullDescription = parsed.fullDescription || '';
                tags = parsed.tags;
              }
            } catch {
              // Fallback summary below.
            }
          }

          if (!summary) {
            const fileCount = countFiles(node);
            summary = skillMdPath
              ? text.fallbackDesc
              : text.fallbackNoSkillMd.replace('{{count}}', String(fileCount));
          }

          if (!fullDescription) {
            fullDescription = summary;
          }

          const normalizedTags = inferTags(skillName, summary, tags, localeKey, tagMapping);

          return {
            name: skillName,
            dirPath,
            summary,
            fullDescription,
            tags: normalizedTags,
          };
        })
      );

      const normalizedSkills = extractedSkills.sort((a, b) => a.name.localeCompare(b.name));

      setHasSkillRoots(skillDirs.length > 0);
      setSkills(normalizedSkills);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load skills';
      setError(message);
      setHasSkillRoots(false);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [localeKey, text.fallbackDesc, text.fallbackNoSkillMd]);

  const handleScanLocal = useCallback(async () => {
    setScanLoading(true);
    setImportMessage(null);
    setScannedSkills([]);
    setSelectedSkills(new Set());
    setHasScanned(false);
    try {
      const response = await api.scanLocalSkills(importPath);
      if (!response.ok) {
        const err = await response.json();
        setImportMessage({ type: 'error', text: err.error || 'Scan failed' });
        return;
      }
      const data = await response.json();
      setScannedSkills(data.skills || []);
      setHasScanned(true);
      // Pre-select skills that are not already imported
      const newSelected = new Set<string>();
      for (const skill of data.skills || []) {
        if (!skill.alreadyImported) {
          newSelected.add(skill.name);
        }
      }
      setSelectedSkills(newSelected);
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : 'Scan failed' });
    } finally {
      setScanLoading(false);
    }
  }, [importPath]);

  const handleImportSelected = useCallback(async () => {
    if (selectedSkills.size === 0) return;
    setImportLoading(true);
    setImportMessage(null);
    try {
      const response = await api.importLocalSkills(importPath, Array.from(selectedSkills));
      if (!response.ok) {
        const err = await response.json();
        setImportMessage({ type: 'error', text: err.error || 'Import failed' });
        return;
      }
      const data = await response.json();
      const msgs: string[] = [];
      if (data.imported?.length > 0) {
        msgs.push(text.importSuccess.replace('{{count}}', String(data.imported.length)));
      }
      if (data.skipped?.length > 0) {
        msgs.push(text.importSkipped.replace('{{count}}', String(data.skipped.length)));
      }
      if (data.errors?.length > 0) {
        msgs.push(`Errors: ${data.errors.join(', ')}`);
      }
      setImportMessage({ type: data.errors?.length ? 'error' : 'success', text: msgs.join('. ') });
      // Re-scan to update status
      if (data.imported?.length > 0) {
        const rescan = await api.scanLocalSkills(importPath);
        if (rescan.ok) {
          const rescanData = await rescan.json();
          setScannedSkills(rescanData.skills || []);
          setSelectedSkills(new Set());
        }
        // Refresh main skill list
        loadSkills();
      }
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setImportLoading(false);
    }
  }, [importPath, selectedSkills, text.importSuccess, text.importSkipped, loadSkills]);

  const openImportModal = useCallback(() => {
    setShowImportModal(true);
    setScannedSkills([]);
    setSelectedSkills(new Set());
    setImportMessage(null);
    setHasScanned(false);
  }, []);

  const handleStartEdit = useCallback(async () => {
    if (!focusedSkill) return;
    setEditLoading(true);
    setModalMessage(null);
    try {
      const skillMdPath = `${focusedSkill.dirPath}/SKILL.md`;
      const response = await api.readGlobalSkillFile(skillMdPath);
      if (response.ok) {
        const payload = await response.json();
        setEditContent(payload.content || '');
        setIsEditing(true);
      } else {
        const errBody = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        setModalMessage({ type: 'error', text: errBody.error || `Could not load SKILL.md (${response.status})` });
      }
    } catch (err) {
      setModalMessage({ type: 'error', text: err instanceof Error ? err.message : 'Load failed' });
    } finally {
      setEditLoading(false);
    }
  }, [focusedSkill]);

  const handleSaveEdit = useCallback(async () => {
    if (!focusedSkill) return;
    setEditLoading(true);
    setModalMessage(null);
    try {
      const skillMdPath = `${focusedSkill.dirPath}/SKILL.md`;
      const response = await api.saveGlobalSkillFile(skillMdPath, editContent);
      if (response.ok) {
        setModalMessage({ type: 'success', text: text.skillSaved.replace('{{name}}', focusedSkill.name) });
        setIsEditing(false);
        loadSkills();
      } else {
        const err = await response.json();
        setModalMessage({ type: 'error', text: err.error || 'Save failed' });
      }
    } catch (err) {
      setModalMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setEditLoading(false);
    }
  }, [focusedSkill, editContent, text.skillSaved, loadSkills]);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setEditContent('');
    setModalMessage(null);
  }, []);

  const handleDeleteSkill = useCallback(async () => {
    if (!focusedSkill) return;
    if (!confirm(text.confirmDeleteSkill.replace('{{name}}', focusedSkill.name))) return;
    setDeleteLoading(true);
    setModalMessage(null);
    try {
      const response = await api.deleteGlobalSkill(focusedSkill.dirPath);
      if (response.ok) {
        setFocusedSkill(null);
        setIsEditing(false);
        loadSkills();
      } else {
        const err = await response.json();
        setModalMessage({ type: 'error', text: err.error || 'Delete failed' });
      }
    } catch (err) {
      setModalMessage({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setDeleteLoading(false);
    }
  }, [focusedSkill, text.confirmDeleteSkill, loadSkills]);

  const handleCloseModal = useCallback(() => {
    setFocusedSkill(null);
    setIsEditing(false);
    setEditContent('');
    setModalMessage(null);
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    setActiveTag('all');
  }, [localeKey]);

  const searchFilteredSkills = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter((skill) =>
      skill.name.toLowerCase().includes(q)
      || skill.summary.toLowerCase().includes(q)
      || skill.tags.some((tag) => tag.label.toLowerCase().includes(q))
    );
  }, [skills, searchQuery]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const skill of searchFilteredSkills) {
      for (const tag of skill.tags) {
        counts.set(tag.label, (counts.get(tag.label) ?? 0) + 1);
      }
    }

    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }));
  }, [searchFilteredSkills]);

  const filteredSkills = useMemo(() => {
    if (activeTag === 'all') return searchFilteredSkills;
    return searchFilteredSkills.filter((skill) =>
      skill.tags.some((tag) => tag.label === activeTag)
    );
  }, [searchFilteredSkills, activeTag]);

  const headerSummary = useMemo(() => {
    if (!hasSkillRoots) return text.noRoots;
    return text.headerCount
      .replace('{{shown}}', String(filteredSkills.length))
      .replace('{{total}}', String(skills.length));
  }, [filteredSkills.length, skills.length, hasSkillRoots, text.headerCount, text.noRoots]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        {text.loading}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="max-w-6xl mx-auto p-4 sm:p-6">
        <div className="relative mb-5 overflow-hidden rounded-2xl border border-border/80 bg-gradient-to-r from-slate-50 via-white to-sky-50 p-4 shadow-sm dark:from-slate-950 dark:via-slate-900 dark:to-sky-950/40">
          <div className="absolute -right-10 -top-10 h-28 w-28 rounded-full bg-sky-200/40 blur-2xl dark:bg-sky-500/20" />
          <div className="relative flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-foreground flex items-center gap-2">
                <Layers className="w-4 h-4" />
                {text.title}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{headerSummary}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={openImportModal}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/80 text-sm text-foreground hover:bg-muted transition-colors"
              >
                <Download className="w-4 h-4" />
                {text.importLocal}
              </button>
              <button
                onClick={loadSkills}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-background/80 text-sm text-foreground hover:bg-muted transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                {text.refresh}
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-red-300/60 bg-red-50 dark:bg-red-900/20 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {!hasSkillRoots && !error && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {text.notFoundRoots}
          </div>
        )}

        {hasSkillRoots && skills.length === 0 && !error && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {text.noSkills}
          </div>
        )}

        {skills.length > 0 && (
          <>
            <div className="mb-4 rounded-xl border border-border/80 bg-card/90 p-3 sm:p-4 shadow-sm">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={text.searchPlaceholder}
                  className="w-full rounded-lg border border-border bg-background pl-9 pr-8 py-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-muted"
                    aria-label={text.clearSearch}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setActiveTag('all')}
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${activeTag === 'all' ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-200' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                >
                  {text.allTags}
                </button>
                {allTags.map((tag) => (
                  <button
                    key={tag.label}
                    onClick={() => setActiveTag(tag.label)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${activeTag === tag.label ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-200' : 'border-border bg-background text-muted-foreground hover:bg-muted'}`}
                  >
                    {tag.label} · {tag.count}
                  </button>
                ))}
              </div>
            </div>

            {filteredSkills.length === 0 && (
              <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                {text.noFilterResult}
              </div>
            )}

            {filteredSkills.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredSkills.map((skill) => (
                  <button
                    key={skill.name}
                    onClick={() => setFocusedSkill(skill)}
                    className="text-left rounded-xl border border-border/80 bg-gradient-to-b from-card to-slate-50/70 p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md dark:from-slate-900 dark:to-slate-950"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-foreground break-all">{skill.name}</h3>
                      <Sparkles className="h-4 w-4 text-sky-500/90" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {sortSkillTags(skill.tags).slice(0, 4).map((tag) => (
                        <span
                          key={`${skill.name}-${tag.label}`}
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${tagStyleClass(tag.type, tag.label)}`}
                        >
                          {tag.label}
                        </span>
                      ))}
                    </div>
                    <p
                      className="mt-3 text-sm text-muted-foreground leading-relaxed"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {skill.summary}
                    </p>
                    <p className="mt-3 text-xs font-medium text-sky-600 dark:text-sky-300">{text.clickForMore}</p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {focusedSkill && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={handleCloseModal}
        >
          <div
            className="w-full max-w-3xl rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground break-all">{focusedSkill.name}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{text.detailTitle}</p>
              </div>
              <div className="flex items-center gap-1.5">
                {!isEditing && (
                  <>
                    <button
                      type="button"
                      onClick={handleStartEdit}
                      disabled={editLoading}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                      title={text.editSkill}
                    >
                      {editLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Edit3 className="h-3.5 w-3.5" />}
                      {text.editSkill}
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteSkill}
                      disabled={deleteLoading}
                      className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-2.5 py-1.5 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30 transition-colors disabled:opacity-50"
                      title={text.deleteSkill}
                    >
                      {deleteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      {text.deleteSkill}
                    </button>
                  </>
                )}
                {isEditing && (
                  <>
                    <button
                      type="button"
                      onClick={handleSaveEdit}
                      disabled={editLoading}
                      className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-2.5 py-1.5 text-xs text-white hover:bg-sky-700 transition-colors disabled:opacity-50"
                    >
                      {editLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {editLoading ? text.saving : text.saveSkill}
                    </button>
                    <button
                      type="button"
                      onClick={handleCancelEdit}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-foreground hover:bg-muted transition-colors"
                    >
                      {text.cancelEdit}
                    </button>
                  </>
                )}
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            {modalMessage && (
              <div className={`mb-3 rounded-md border px-3 py-2 text-sm ${modalMessage.type === 'success' ? 'border-green-300/60 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'border-red-300/60 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                {modalMessage.text}
              </div>
            )}

            <div className="mb-3 flex flex-wrap gap-1.5">
              {sortSkillTags(focusedSkill.tags).map((tag) => (
                <span key={`${focusedSkill.name}-modal-${tag.label}`} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] ${tagStyleClass(tag.type, tag.label)}`}>
                  {tag.label}
                </span>
              ))}
            </div>

            {isEditing ? (
              <textarea
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full max-h-[60vh] min-h-[300px] overflow-auto rounded-lg border border-border/70 bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70 resize-y"
                spellCheck={false}
              />
            ) : (
              <div className="max-h-[60vh] overflow-auto rounded-lg border border-border/70 bg-muted/30 p-4">
                <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{focusedSkill.fullDescription}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {showImportModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
          onClick={() => setShowImportModal(false)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">{text.importModalTitle}</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-foreground mb-1.5">{text.pathLabel}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                  placeholder="~/.claude/skills"
                />
                <button
                  onClick={handleScanLocal}
                  disabled={scanLoading || !importPath.trim()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-background text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {scanLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  {scanLoading ? text.scanning : text.scan}
                </button>
              </div>
            </div>

            {importMessage && (
              <div className={`mb-4 rounded-md border px-3 py-2 text-sm ${importMessage.type === 'success' ? 'border-green-300/60 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'border-red-300/60 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                {importMessage.text}
              </div>
            )}

            {hasScanned && scannedSkills.length === 0 && (
              <div className="mb-4 rounded-md border border-border bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
                {text.noSkillsFound}
              </div>
            )}

            {scannedSkills.length > 0 && (
              <div className="mb-4 max-h-[40vh] overflow-auto rounded-lg border border-border/70">
                {scannedSkills.map((skill) => (
                  <label
                    key={skill.name}
                    className={`flex items-center gap-3 px-3 py-2.5 border-b border-border/50 last:border-b-0 transition-colors ${skill.alreadyImported ? 'opacity-60' : 'hover:bg-muted/50 cursor-pointer'}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedSkills.has(skill.name)}
                      disabled={skill.alreadyImported}
                      onChange={(e) => {
                        const next = new Set(selectedSkills);
                        if (e.target.checked) {
                          next.add(skill.name);
                        } else {
                          next.delete(skill.name);
                        }
                        setSelectedSkills(next);
                      }}
                      className="rounded border-border"
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-foreground">{skill.name}</span>
                      <div className="flex items-center gap-2 mt-0.5">
                        {skill.hasSkillMd && (
                          <span className="text-[11px] text-muted-foreground">SKILL.md</span>
                        )}
                        {skill.alreadyImported && (
                          <span className="inline-flex items-center gap-1 text-[11px] text-green-600 dark:text-green-400">
                            <Check className="w-3 h-3" />
                            {text.alreadyImported}
                          </span>
                        )}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            )}

            {scannedSkills.length > 0 && (
              <div className="flex justify-end">
                <button
                  onClick={handleImportSelected}
                  disabled={importLoading || selectedSkills.size === 0}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-sky-600 text-sm font-medium text-white hover:bg-sky-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                  {importLoading ? text.importing : `${text.importSelected} (${selectedSkills.size})`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
