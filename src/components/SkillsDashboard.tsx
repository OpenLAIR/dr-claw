import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronRight,
  Compass,
  Download,
  Edit3,
  FolderTree,
  Layers,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  X,
  Copy,
  Package,
  Play,
  ChevronDown,
  ChevronUp,
  Settings,
  AlertCircle,
  Terminal,
  Server,
  Cpu,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import translations from 'i18next';
import { api } from '../utils/api';
import WorkbenchDialog from './ui/WorkbenchDialog';
import { useDeviceSettings } from '../hooks/useDeviceSettings';

type SkillNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: SkillNode[];
};

type SkillTagType = 'intent' | 'capability' | 'domain' | 'status' | 'source' | 'stage' | 'meta';

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
  dirPath: string;
  summary: string;
  fullDescription: string;
  tags: SkillTag[];
  hasSkillMd: boolean;
  taxonomy: SkillTaxonomyRecord | null;
};

type FacetOption = {
  key: string;
  label: string;
  count: number;
};

type SkillRelation = {
  dirPath: string;
  name: string;
  reason: string;
  score: number;
};

type SkillExplorerSeed = SkillSummary & {
  primaryIntentKey: string;
  primaryIntentLabel: string;
  intentLabels: string[];
  capabilityKeys: string[];
  capabilityLabels: string[];
  domainKeys: string[];
  domainLabels: string[];
  keywordLabels: string[];
  primaryDomainKey: string;
  primaryDomainLabel: string;
  sourceKey: string;
  sourceLabel: string;
  statusKey: string;
  statusLabel: string;
  owner?: string;
  legacyCollectionLabel: string;
  legacyGroupLabel: string;
  searchText: string;
  relatedSkillNames: string[];
};

type SkillExplorerItem = SkillExplorerSeed & {
  relatedSkills: SkillRelation[];
};

type SkillCatalogV2Record = {
  name: string;
  primaryIntent: string;
  intents: string[];
  capabilities: string[];
  domains: string[];
  keywords?: string[];
  source: string;
  status: string;
  summary: string;
  relatedSkills?: string[];
  owner?: string;
  legacy?: {
    dirPath?: string;
    skillFile?: string;
    topLevelGroup?: string;
    collection?: string;
    domain?: string;
  };
};

type SkillCatalogV2File = {
  skills?: SkillCatalogV2Record[];
};

type SkillTaxonomyFacet = {
  key: string;
  label: string;
};

type SkillTaxonomyRecord = {
  primaryIntent: SkillTaxonomyFacet;
  intents: SkillTaxonomyFacet[];
  capabilities: SkillTaxonomyFacet[];
  domains: SkillTaxonomyFacet[];
  keywords: string[];
  source: SkillTaxonomyFacet;
  status: SkillTaxonomyFacet;
  relatedSkillNames: string[];
  owner?: string;
  legacyCollectionLabel?: string;
  legacyGroupLabel?: string;
};

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

const INTENT_LABELS: Record<string, LocalizedLabel> = {
  research: { zh: '调研', en: 'Research', ko: '연구' },
  ideation: { zh: '想法生成', en: 'Ideation', ko: '아이디어 생성' },
  data: { zh: '数据处理', en: 'Data', ko: '데이터' },
  experiment: { zh: '实验开发', en: 'Experiment', ko: '실험' },
  training: { zh: '模型训练', en: 'Training', ko: '훈련' },
  evaluation: { zh: '评测分析', en: 'Evaluation', ko: '평가' },
  writing: { zh: '论文与汇报', en: 'Writing', ko: '논문 작성' },
  deployment: { zh: '部署集成', en: 'Deployment', ko: '배포' },
};

const CAPABILITY_LABELS: Record<string, LocalizedLabel> = {
  'search-retrieval': { zh: '检索搜索', en: 'Search & Retrieval', ko: '검색 및 검색 결과 수집' },
  'research-planning': { zh: '研究规划', en: 'Research Planning', ko: '연구 계획' },
  'agent-workflow': { zh: 'Agent 工作流', en: 'Agent Workflow', ko: '에이전트 워크플로' },
  'data-processing': { zh: '数据处理', en: 'Data Processing', ko: '데이터 처리' },
  'training-tuning': { zh: '训练与调优', en: 'Training & Tuning', ko: '훈련 및 튜닝' },
  'inference-serving': { zh: '推理与服务', en: 'Inference & Serving', ko: '추론 및 서비스' },
  'evaluation-benchmarking': { zh: '评测与基准', en: 'Evaluation & Benchmarking', ko: '평가 및 벤치마킹' },
  'prompt-structured-output': { zh: '提示与结构化输出', en: 'Prompt & Structured Output', ko: '프롬프트 및 구조화된 출력' },
  multimodal: { zh: '多模态', en: 'Multimodal', ko: '멀티모달' },
  interpretability: { zh: '可解释性', en: 'Interpretability', ko: '해석 가능성' },
  'safety-alignment': { zh: '安全与对齐', en: 'Safety & Alignment', ko: '안전 및 정렬' },
  'infrastructure-ops': { zh: '基础设施与运维', en: 'Infrastructure & Ops', ko: '인프라 및 운영' },
  'visualization-reporting': { zh: '可视化与汇报', en: 'Visualization & Reporting', ko: '시각화 및 보고' },
};

const TAXONOMY_DOMAIN_LABELS: Record<string, LocalizedLabel> = {
  general: { zh: '通用', en: 'General', ko: '일반' },
  'cs-ai': { zh: 'CS / AI', en: 'CS / AI', ko: 'CS / AI' },
  bioinformatics: { zh: '生物信息学', en: 'Bioinformatics', ko: '생물정보학' },
  medical: { zh: '医疗', en: 'Medical', ko: '의료' },
  vision: { zh: '视觉', en: 'Vision', ko: '비전' },
  nlp: { zh: 'NLP', en: 'NLP', ko: 'NLP' },
  'data-engineering': { zh: '数据工程', en: 'Data Engineering', ko: '데이터 엔지니어링' },
};

const STATUS_LABELS: Record<string, LocalizedLabel> = {
  candidate: { zh: '待校正', en: 'Candidate', ko: '검증 대기' },
  verified: { zh: '已校正', en: 'Verified', ko: '검증됨' },
  experimental: { zh: '实验中', en: 'Experimental', ko: '실험 중' },
  deprecated: { zh: '已废弃', en: 'Deprecated', ko: '사용 중단' },
};

const PATH_GROUP_LABELS: Record<string, string> = {
  agents: 'Agent Frameworks',
  'data-processing': 'Data Processing',
  'distributed-training': 'Distributed Training',
  'emerging-techniques': 'Emerging Techniques',
  evaluation: 'Evaluation',
  'fine-tuning': 'Fine-Tuning',
  'inference-serving': 'Inference Serving',
  infrastructure: 'Infrastructure',
  'mechanistic-interpretability': 'Mechanistic Interpretability',
  mlops: 'MLOps',
  'model-architecture': 'Model Architecture',
  multimodal: 'Multimodal',
  observability: 'Observability',
  optimization: 'Optimization',
  'post-training': 'Post-Training',
  'prompt-engineering': 'Prompt Engineering',
  rag: 'RAG',
  'research-ideation': 'Research Ideation',
  'safety-alignment': 'Safety & Alignment',
  tokenization: 'Tokenization',
};

const SLUG_WORD_LABELS: Record<string, string> = {
  ai: 'AI',
  cv: 'CV',
  fsdp: 'FSDP',
  llm: 'LLM',
  mlops: 'MLOps',
  nlp: 'NLP',
  rag: 'RAG',
  rl: 'RL',
};

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

type PackConfigOption = {
  key: string;
  label: string;
  install?: string;
  register: string;
  envVars: Array<{ name: string; example: string }>;
};

type PackGpuOption = {
  key: string;
  label: string;
  template: string;
  note?: string;
};

type PackConfig = {
  mcp: PackConfigOption[];
  gpu: PackGpuOption[];
  setupScript: string;
};

const COMMUNITY_PACK_CONFIGS: Record<string, PackConfig> = {
  ARIS: {
    mcp: [
      {
        key: 'codex',
        label: 'Codex (GPT-5.4)',
        install: 'npm install -g @openai/codex',
        register: 'claude mcp add codex -s user -- codex mcp-server',
        envVars: [{ name: 'OPENAI_API_KEY', example: 'sk-proj-...' }],
      },
      {
        key: 'llm-chat',
        label: 'Generic LLM',
        register: 'claude mcp add llm-chat -s user -- python3 skills/aris-infra/mcp-servers/llm-chat/server.py',
        envVars: [
          { name: 'LLM_API_KEY', example: 'your-api-key' },
          { name: 'LLM_BASE_URL', example: 'https://api.openai.com/v1' },
          { name: 'LLM_MODEL', example: 'gpt-4o' },
        ],
      },
      {
        key: 'gemini',
        label: 'Gemini',
        register: 'claude mcp add gemini-review -s user -- python3 skills/aris-infra/mcp-servers/gemini-review/server.py',
        envVars: [{ name: 'GEMINI_API_KEY', example: 'your-gemini-key' }],
      },
    ],
    gpu: [
      {
        key: 'local',
        label: 'Local GPU',
        template: '## Local Environment\n- gpu: local\n- Mac MPS / Linux CUDA',
      },
      {
        key: 'remote',
        label: 'Remote SSH',
        template: '## Remote Server\n- gpu: remote\n- SSH: `ssh my-gpu-server`\n- GPU: 4x A100 (80GB each)\n- Conda: `conda activate research`\n- Code dir: `/home/user/experiments/`\n- code_sync: rsync',
        note: 'Edit SSH alias, GPU count, conda env, and code dir to match your server.',
      },
      {
        key: 'vast',
        label: 'Vast.ai',
        template: '## Vast.ai\n- gpu: vast\n- auto_destroy: true\n- max_budget: 5.00',
        note: 'Run: pip install vastai && vastai set api-key YOUR_KEY',
      },
      {
        key: 'modal',
        label: 'Modal',
        template: '## Modal\n- gpu: modal\n- modal_timeout: 21600',
        note: 'Run: pip install modal && modal setup',
      },
    ],
    setupScript: 'bash skills/aris-infra/setup.sh',
  },
  Autoresearch: {
    mcp: [],
    gpu: [],
    setupScript: '',
  },
  DeepScientist: {
    mcp: [],
    gpu: [],
    setupScript: '',
  },
};

const FACET_PREFIX_PATTERN = /^(Domain|Stage|Category|Source|领域|阶段|类别|来源|영역|단계|카테고리|출처):\s*/i;
const SOURCE_PLATFORM_PATTERN = /^(来源: 平台自研|Source: Dr\. Claw|출처: Dr\. Claw)$/i;

function normalizeSourceKey(value: string) {
  return value === 'vibelab' ? 'dr-claw' : value;
}


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

function compactText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
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

function localizeTaxonomyValue(
  type: 'intent' | 'capability' | 'domain' | 'status',
  key: string,
  localeKey: LocaleKey
): string {
  const source =
    type === 'intent'
      ? INTENT_LABELS
      : type === 'capability'
        ? CAPABILITY_LABELS
        : type === 'domain'
          ? TAXONOMY_DOMAIN_LABELS
          : STATUS_LABELS;

  const label = source[key];
  if (label) {
    return localize(label, localeKey);
  }

  return humanizeSlug(key);
}

function buildTaxonomyTags(taxonomy: SkillTaxonomyRecord, metaTags: string[]): SkillTag[] {
  const tags: SkillTag[] = [];
  const pushTag = (label: string, type: SkillTagType) => {
    if (!tags.some((tag) => tag.label === label && tag.type === type)) {
      tags.push({ label, type });
    }
  };

  pushTag(taxonomy.primaryIntent.label, 'intent');
  taxonomy.capabilities.forEach((facet) => pushTag(facet.label, 'capability'));
  taxonomy.domains.forEach((facet) => pushTag(facet.label, 'domain'));
  pushTag(taxonomy.status.label, 'status');
  pushTag(taxonomy.source.label, 'source');
  [...taxonomy.keywords, ...metaTags].slice(0, 4).forEach((label) => pushTag(label, 'meta'));

  return tags;
}

function parseSkillCatalogV2(payload: unknown, localeKey: LocaleKey, text: Record<string, string>): Map<string, SkillTaxonomyRecord> {
  const catalog = payload as SkillCatalogV2File;
  const records = Array.isArray(catalog?.skills) ? catalog.skills : [];
  const result = new Map<string, SkillTaxonomyRecord>();

  for (const record of records) {
    const taxonomy: SkillTaxonomyRecord = {
      primaryIntent: {
        key: record.primaryIntent,
        label: localizeTaxonomyValue('intent', record.primaryIntent, localeKey),
      },
      intents: (record.intents?.length ? record.intents : [record.primaryIntent]).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('intent', value, localeKey),
      })),
      capabilities: (record.capabilities ?? []).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('capability', value, localeKey),
      })),
      domains: (record.domains ?? []).map((value) => ({
        key: value,
        label: localizeTaxonomyValue('domain', value, localeKey),
      })),
      keywords: Array.isArray(record.keywords) ? record.keywords.map((value) => compactText(String(value))).filter(Boolean) : [],
      source: {
        key: normalizeSourceKey(record.source),
        label: (record.source === 'vibelab' || record.source === 'dr-claw') ? text.sourcePlatformShort : text.sourceImportedShort,
      },
      status: {
        key: record.status,
        label: localizeTaxonomyValue('status', record.status, localeKey),
      },
      relatedSkillNames: Array.isArray(record.relatedSkills) ? record.relatedSkills : [],
      owner: record.owner,
      legacyCollectionLabel: record.legacy?.collection,
      legacyGroupLabel: record.legacy?.topLevelGroup,
    };

    const legacyDirPath = compactText(record.legacy?.dirPath ?? '');
    if (legacyDirPath) {
      result.set(legacyDirPath, taxonomy);
    }

    result.set(record.name, taxonomy);
  }

  return result;
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

  return lines.join('\n').replace(/^[\-*+]\s+/gm, '').trim();
}

function inferTags(
  skillName: string,
  summary: string,
  explicitTags: SkillTag[],
  localeKey: LocaleKey,
  mapping: SkillTagMapping
): SkillTag[] {
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
    push(String(translations.t('common:skillsLibrary.defaultDomain', { lng: localeKey === 'zh' ? 'zh-CN' : localeKey })), 'domain');
  }

  if (nativeSkillSet.has(normalizedSkillName)) {
    push(String(translations.t('common:skillsLibrary.sourcePlatform', { lng: localeKey === 'zh' ? 'zh-CN' : localeKey })), 'meta');
  }

  return inferred;
}

function extractSkillMetadata(
  content: string,
  localeKey: LocaleKey
): { summary: string | null; fullDescription: string | null; tags: SkillTag[] } {
  const normalized = content.replace(/\r\n/g, '\n');
  const frontmatterMatch = normalized.match(/^---\n([\s\S]*?)\n---/);
  const frontmatterLines = frontmatterMatch ? frontmatterMatch[1].split('\n') : [];

  const fmDescription = parseDescriptionFromFrontmatter(frontmatterLines);
  const bodyDescription = extractBodyDescription(normalized);
  const fullDescription = fmDescription || bodyDescription || null;
  const summary = fullDescription ? clampText(fullDescription) : null;
  const tags = parseFrontmatterTags(frontmatterLines, localeKey);

  return { summary, fullDescription, tags };
}

function isSourcePlatformTag(label: string): boolean {
  return SOURCE_PLATFORM_PATTERN.test(label);
}

function stripFacetPrefix(label: string): string {
  return label.replace(FACET_PREFIX_PATTERN, '').trim();
}

function humanizeSlug(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => SLUG_WORD_LABELS[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function getTopLevelGroup(dirPath: string, standaloneLabel: string): { key: string; label: string } {
  const segments = dirPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return { key: 'standalone', label: standaloneLabel };
  }

  const key = segments[0];
  return {
    key,
    label: PATH_GROUP_LABELS[key] ?? humanizeSlug(key),
  };
}

function buildFacetOptions(
  items: SkillExplorerItem[],
  pickFacet: (item: SkillExplorerItem) => { key: string; label: string }
): FacetOption[] {
  const counts = new Map<string, FacetOption>();

  for (const item of items) {
    const facet = pickFacet(item);
    const current = counts.get(facet.key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(facet.key, { ...facet, count: 1 });
    }
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function buildMultiFacetOptions(
  items: SkillExplorerItem[],
  pickFacets: (item: SkillExplorerItem) => Array<{ key: string; label: string }>
): FacetOption[] {
  const counts = new Map<string, FacetOption>();

  for (const item of items) {
    for (const facet of pickFacets(item)) {
      const current = counts.get(facet.key);
      if (current) {
        current.count += 1;
      } else {
        counts.set(facet.key, { ...facet, count: 1 });
      }
    }
  }

  return Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function tagStyleClass(_type: SkillTagType, _label?: string): string {
  return 'border-border bg-muted text-muted-foreground';
}

function getTagPriority(tag: SkillTag): number {
  if (isSourcePlatformTag(tag.label)) return 0;
  if (tag.type === 'intent') return 1;
  if (tag.type === 'capability') return 2;
  if (tag.type === 'domain') return 3;
  if (tag.type === 'status' || tag.type === 'source') return 4;
  if (tag.type === 'stage') return 5;
  return 6;
}

function sortSkillTags(tags: SkillTag[]): SkillTag[] {
  return [...tags].sort((a, b) => {
    const priorityDiff = getTagPriority(a) - getTagPriority(b);
    if (priorityDiff !== 0) return priorityDiff;
    return a.label.localeCompare(b.label);
  });
}

function scoreSkillMatch(skill: SkillExplorerItem, query: string): number {
  const terms = compactText(query).toLowerCase().split(' ').filter(Boolean);
  if (terms.length === 0) {
    return 0;
  }

  let score = 0;
  const name = skill.name.toLowerCase();
  const path = skill.dirPath.toLowerCase();
  const primaryIntent = skill.primaryIntentLabel.toLowerCase();
  const capabilities = skill.capabilityLabels.join(' ').toLowerCase();
  const domain = skill.primaryDomainLabel.toLowerCase();
  const status = skill.statusLabel.toLowerCase();
  const summary = skill.summary.toLowerCase();

  for (const term of terms) {
    if (name === term) score += 140;
    if (name.startsWith(term)) score += 80;
    if (name.includes(term)) score += 55;
    if (path.includes(term)) score += 35;
    if (primaryIntent.includes(term)) score += 28;
    if (capabilities.includes(term)) score += 24;
    if (domain.includes(term)) score += 18;
    if (status.includes(term)) score += 12;
    if (summary.includes(term)) score += 12;
    if (skill.tags.some((tag) => tag.label.toLowerCase().includes(term))) score += 10;
  }

  if (terms.every((term) => skill.searchText.includes(term))) {
    score += 25;
  }

  return score;
}

function sortSkillsForBrowse(items: SkillExplorerItem[]): SkillExplorerItem[] {
  return [...items].sort((a, b) =>
    a.primaryIntentLabel.localeCompare(b.primaryIntentLabel)
    || a.statusLabel.localeCompare(b.statusLabel)
    || a.name.localeCompare(b.name)
  );
}

function buildExplorerSkills(
  skills: SkillSummary[],
  options: {
    standaloneLabel: string;
    defaultDomainLabel: string;
    sourcePlatformShort: string;
    sourceImportedShort: string;
    localeKey: LocaleKey;
  }
): SkillExplorerItem[] {
  const seeds: SkillExplorerSeed[] = skills.map((skill) => {
    const fallbackTags = sortSkillTags(skill.tags);
    const topLevelGroup = getTopLevelGroup(skill.dirPath, options.standaloneLabel);
    const primaryStageTag = fallbackTags.find((tag) => tag.type === 'stage');
    const primaryDomainTag = fallbackTags.find((tag) => tag.type === 'domain');
    const collectionLabel = stripFacetPrefix(primaryStageTag?.label ?? topLevelGroup.label);
    const primaryDomainLabel = stripFacetPrefix(primaryDomainTag?.label ?? options.defaultDomainLabel);
    const taxonomy = skill.taxonomy;
    const fallbackSourceKey = fallbackTags.some((tag) => isSourcePlatformTag(tag.label)) ? 'dr-claw' : 'imported';
    const fallbackDomainKey = primaryDomainTag ? `domain:${normalizeSkillKey(primaryDomainLabel)}` : 'domain:general';
    const fallbackCapabilities = topLevelGroup.key === 'standalone'
      ? []
      : [{ key: `legacy:${topLevelGroup.key}`, label: topLevelGroup.label }];
    const intentLabel = taxonomy?.primaryIntent.label ?? collectionLabel;
    const sourceLabel = taxonomy?.source.label ?? (fallbackSourceKey === 'dr-claw' ? options.sourcePlatformShort : options.sourceImportedShort);
    const statusKey = taxonomy?.status.key ?? (fallbackSourceKey === 'dr-claw' ? 'verified' : 'candidate');
    const statusLabel = taxonomy?.status.label ?? (STATUS_LABELS[statusKey] ? localize(STATUS_LABELS[statusKey], options.localeKey) : humanizeSlug(statusKey));
    const domains = taxonomy?.domains ?? [{ key: fallbackDomainKey, label: primaryDomainLabel }];
    const capabilities = taxonomy?.capabilities ?? fallbackCapabilities;
    const tags = taxonomy
      ? sortSkillTags(buildTaxonomyTags(taxonomy, fallbackTags.filter((tag) => tag.type === 'meta').map((tag) => tag.label)))
      : fallbackTags;

    return {
      ...skill,
      tags,
      primaryIntentKey: taxonomy?.primaryIntent.key ?? `legacy:${normalizeSkillKey(collectionLabel)}`,
      primaryIntentLabel: intentLabel,
      intentLabels: (taxonomy?.intents ?? [{ key: `legacy:${normalizeSkillKey(collectionLabel)}`, label: collectionLabel }]).map((facet) => facet.label),
      capabilityKeys: capabilities.map((facet) => facet.key),
      capabilityLabels: capabilities.map((facet) => facet.label),
      domainKeys: domains.map((facet) => facet.key),
      domainLabels: domains.map((facet) => facet.label),
      keywordLabels: taxonomy?.keywords ?? fallbackTags.filter((tag) => tag.type === 'meta').map((tag) => tag.label),
      primaryDomainKey: domains[0]?.key ?? fallbackDomainKey,
      primaryDomainLabel: domains[0]?.label ?? primaryDomainLabel,
      sourceKey: taxonomy?.source.key ?? fallbackSourceKey,
      sourceLabel,
      statusKey,
      statusLabel,
      owner: taxonomy?.owner,
      legacyCollectionLabel: taxonomy?.legacyCollectionLabel ?? collectionLabel,
      legacyGroupLabel: taxonomy?.legacyGroupLabel ?? topLevelGroup.label,
      relatedSkillNames: taxonomy?.relatedSkillNames ?? [],
      searchText: compactText([
        skill.name,
        skill.dirPath,
        skill.summary,
        intentLabel,
        capabilities.map((facet) => facet.label).join(' '),
        domains.map((facet) => facet.label).join(' '),
        sourceLabel,
        statusLabel,
        ...tags.map((tag) => tag.label),
      ].join(' ')).toLowerCase(),
    };
  });

  const seedByName = new Map(seeds.map((skill) => [skill.name, skill]));

  return seeds.map((skill) => {
    const inferReason = (other: SkillExplorerSeed): string => {
      const sharedCapability = skill.capabilityLabels.find((label) => other.capabilityLabels.includes(label));
      if (sharedCapability) return sharedCapability;
      const sharedDomain = skill.domainLabels.find((label) => other.domainLabels.includes(label));
      if (sharedDomain) return sharedDomain;
      const sharedIntent = skill.intentLabels.find((label) => other.intentLabels.includes(label));
      if (sharedIntent) return sharedIntent;
      if (skill.sourceKey === other.sourceKey) return skill.sourceLabel;
      return other.primaryIntentLabel;
    };

    const explicitRelated = skill.relatedSkillNames
      .map((name, index) => {
        const other = seedByName.get(name);
        if (!other || other.dirPath === skill.dirPath) {
          return null;
        }

        return {
          dirPath: other.dirPath,
          name: other.name,
          reason: inferReason(other),
          score: 100 - index,
        };
      })
      .filter((relation): relation is SkillRelation => relation !== null);

    const heuristicRelated = seeds
      .filter((other) => other.dirPath !== skill.dirPath)
      .map((other) => {
        let score = 0;
        let reason = '';

        if (skill.primaryIntentKey === other.primaryIntentKey) {
          score += 6;
          reason = skill.primaryIntentLabel;
        }

        const sharedCapabilities = skill.capabilityLabels.filter((label) => other.capabilityLabels.includes(label));
        if (sharedCapabilities.length > 0) {
          score += 4;
          if (!reason) {
            reason = sharedCapabilities[0];
          }
        }

        const sharedDomains = skill.domainLabels.filter((label) => other.domainLabels.includes(label));
        if (sharedDomains.length > 0) {
          score += 3;
          if (!reason) {
            reason = sharedDomains[0];
          }
        }

        const sharedMetaTags = skill.tags.filter(
          (tag) => tag.type === 'meta' && other.tags.some((otherTag) => otherTag.label === tag.label)
        );
        if (sharedMetaTags.length > 0) {
          score += Math.min(sharedMetaTags.length, 2);
          if (!reason) {
            reason = sharedMetaTags[0].label;
          }
        }

        if (score === 0 && skill.sourceKey === other.sourceKey) {
          score = 1;
          reason = skill.sourceLabel;
        }

        if (score === 0) {
          return null;
        }

        return {
          dirPath: other.dirPath,
          name: other.name,
          reason,
          score,
        };
      })
      .filter((relation): relation is SkillRelation => relation !== null)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, 6);

    const relatedSkills = explicitRelated.length > 0
      ? explicitRelated
      : heuristicRelated;

    return {
      ...skill,
      relatedSkills,
    };
  });
}

function facetButtonClass(active: boolean): string {
  return `flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition ${
    active
      ? 'border-foreground/30 bg-muted text-foreground'
      : 'border-border/70 bg-background text-foreground hover:bg-muted/60'
  }`;
}

function DetailChipSection({
  title,
  values,
  type = 'meta',
}: {
  title: string;
  values: string[];
  type?: SkillTagType;
}) {
  if (values.length === 0) {
    return null;
  }

  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {values.map((value) => (
          <span
            key={`${title}-${value}`}
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tagStyleClass(type, value)}`}
          >
            {value}
          </span>
        ))}
      </div>
    </div>
  );
}

function buildSkillCardTagSummary(skill: SkillExplorerItem): { tags: Array<{ label: string; type: SkillTagType }>; hiddenCount: number } {
  const tags: Array<{ label: string; type: SkillTagType }> = [
    { label: skill.primaryIntentLabel, type: 'intent' },
    ...skill.capabilityLabels.slice(0, 2).map((label) => ({ label, type: 'capability' as SkillTagType })),
    ...skill.domainLabels.slice(0, 1).map((label) => ({ label, type: 'domain' as SkillTagType })),
    { label: skill.statusLabel, type: 'status' },
  ];

  const hiddenCount = Math.max(skill.intentLabels.length - 1, 0)
    + Math.max(skill.capabilityLabels.length - 2, 0)
    + Math.max(skill.domainLabels.length - 1, 0);

  return { tags, hiddenCount };
}

type SkillsDashboardProps = {
  onSendToChat?: (command: string) => void;
};

export default function SkillsDashboard({ onSendToChat }: SkillsDashboardProps = {}) {
  const { i18n, t } = useTranslation();
  const { isMobile: isCompact } = useDeviceSettings({ mobileBreakpoint: 1279, trackPWA: false });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const localeKey = useMemo(() => resolveLocaleKey(i18n.language || 'en'), [i18n.language]);
  const text = useMemo(() => t('common:skillsLibrary', { returnObjects: true }) as Record<string, string>, [t, i18n.language]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [hasSkillRoots, setHasSkillRoots] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeIntent, setActiveIntent] = useState('all');
  const [activeCapability, setActiveCapability] = useState('all');
  const [activeDomain, setActiveDomain] = useState('all');
  const [activeSource, setActiveSource] = useState<'all' | 'dr-claw' | 'imported'>('all');
  const [activeStatus, setActiveStatus] = useState('all');
  const [viewMode, setViewMode] = useState<'platform' | 'community'>('platform');
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [configExpanded, setConfigExpanded] = useState<Set<string>>(new Set());
  const [selectedMcp, setSelectedMcp] = useState<Record<string, string>>({});
  const [selectedGpu, setSelectedGpu] = useState<Record<string, string>>({});
  const [apiKeyInputs, setApiKeyInputs] = useState<Record<string, string>>({});
  const [apiKeyVisible, setApiKeyVisible] = useState<Record<string, boolean>>({});
  const [configuring, setConfiguring] = useState(false);
  const [configResult, setConfigResult] = useState<{ success: boolean; message: string } | null>(null);
  const [computeNodes, setComputeNodes] = useState<Array<{ id: string; name: string; host: string; user: string; port: number; workDir: string; type: string }>>([]);
  const [detectingGpu, setDetectingGpu] = useState(false);
  const [detectedGpuTemplate, setDetectedGpuTemplate] = useState<Record<string, string>>({});
  const [detectedGpuInfo, setDetectedGpuInfo] = useState<Record<string, string>>({});
  const [focusedSkill, setFocusedSkill] = useState<SkillExplorerItem | null>(null);
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

      let taxonomyMap = new Map<string, SkillTaxonomyRecord>();
      let catalogRecordMap = new Map<string, SkillCatalogV2Record>();
      try {
        const catalogResponse = await api.readGlobalSkillFile('skills-catalog-v2.json');
        if (catalogResponse.ok) {
          const catalogPayload = await catalogResponse.json();
          const catalogContent = catalogPayload?.content ?? '';
          const catalog = JSON.parse(catalogContent || '{}') as SkillCatalogV2File;
          taxonomyMap = parseSkillCatalogV2(catalog, localeKey, text);
          for (const record of catalog.skills ?? []) {
            if (record.legacy?.dirPath) {
              catalogRecordMap.set(record.legacy.dirPath, record);
            }
            catalogRecordMap.set(record.name, record);
          }
        }
      } catch {
        taxonomyMap = new Map<string, SkillTaxonomyRecord>();
        catalogRecordMap = new Map<string, SkillCatalogV2Record>();
      }

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
      const skillsRoot = treeNodes.length > 0 && treeNodes[0].path
        ? treeNodes[0].path.replace(/[/\\][^/\\]+$/, '')
        : '';
      const normalizedSkillsRoot = skillsRoot.replace(/\\/g, '/');

      const extractedSkills = await Promise.all(
        skillDirs.map(async (node) => {
          const hasSkillMd = Boolean(findDirectFilePathByName(node, 'SKILL.md'));
          const skillName = node.name;
          const normalizedNodePath = node.path.replace(/\\/g, '/');

          let dirPath = skillName;
          if (normalizedSkillsRoot && normalizedNodePath.startsWith(`${normalizedSkillsRoot}/`)) {
            dirPath = normalizedNodePath.slice(normalizedSkillsRoot.length + 1);
          }

          let summary = '';
          let fullDescription = '';
          let tags: SkillTag[] = [];
          let taxonomy: SkillTaxonomyRecord | null = null;

          taxonomy = taxonomyMap.get(dirPath) ?? taxonomyMap.get(skillName) ?? null;

          if (hasSkillMd) {
            try {
              const fileResponse = await api.readGlobalSkillFile(`${dirPath}/SKILL.md`);
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
            const catalogRecord = catalogRecordMap.get(dirPath) ?? catalogRecordMap.get(skillName);
            if (catalogRecord?.summary) {
              summary = catalogRecord.summary;
              fullDescription = catalogRecord.summary;
            }
          }

          if (!summary) {
            const fileCount = countFiles(node);
            summary = hasSkillMd
              ? text.fallbackDesc
              : text.fallbackNoSkillMd.replace('{{count}}', String(fileCount));
          }

          if (!fullDescription) {
            fullDescription = summary;
          }

          if (taxonomy) {
            tags = buildTaxonomyTags(taxonomy, tags.filter((tag) => tag.type === 'meta').map((tag) => tag.label));
          } else {
            tags = inferTags(skillName, summary, tags, localeKey, tagMapping);
          }

          return {
            name: skillName,
            dirPath,
            summary,
            fullDescription,
            tags,
            hasSkillMd,
            taxonomy,
          };
        })
      );

      setHasSkillRoots(skillDirs.length > 0);
      setSkills(extractedSkills.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load skills';
      setError(message);
      setHasSkillRoots(false);
      setSkills([]);
    } finally {
      setLoading(false);
    }
  }, [localeKey, text, text.fallbackDesc, text.fallbackNoSkillMd]);

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

      const nextSelected = new Set<string>();
      for (const skill of data.skills || []) {
        if (!skill.alreadyImported) {
          nextSelected.add(skill.name);
        }
      }
      setSelectedSkills(nextSelected);
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
      const messages: string[] = [];
      if (data.imported?.length > 0) {
        messages.push(text.importSuccess.replace('{{count}}', String(data.imported.length)));
      }
      if (data.skipped?.length > 0) {
        messages.push(text.importSkipped.replace('{{count}}', String(data.skipped.length)));
      }
      if (data.errors?.length > 0) {
        messages.push(`Errors: ${data.errors.join(', ')}`);
      }

      setImportMessage({
        type: data.errors?.length ? 'error' : 'success',
        text: messages.join('. '),
      });

      if (data.imported?.length > 0) {
        const rescan = await api.scanLocalSkills(importPath);
        if (rescan.ok) {
          const rescanData = await rescan.json();
          setScannedSkills(rescanData.skills || []);
          setSelectedSkills(new Set());
        }
        await loadSkills();
      }
    } catch (err) {
      setImportMessage({ type: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setImportLoading(false);
    }
  }, [importPath, loadSkills, selectedSkills, text.importSkipped, text.importSuccess]);

  const openImportModal = useCallback(() => {
    setShowImportModal(true);
    setScannedSkills([]);
    setSelectedSkills(new Set());
    setImportMessage(null);
    setHasScanned(false);
  }, []);

  const handleStartEdit = useCallback(async () => {
    if (!focusedSkill || !focusedSkill.hasSkillMd) return;

    setEditLoading(true);
    setModalMessage(null);
    try {
      const response = await api.readGlobalSkillFile(`${focusedSkill.dirPath}/SKILL.md`);
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
    if (!focusedSkill || !focusedSkill.hasSkillMd) return;

    setEditLoading(true);
    setModalMessage(null);
    try {
      const response = await api.saveGlobalSkillFile(`${focusedSkill.dirPath}/SKILL.md`, editContent);
      if (response.ok) {
        setModalMessage({ type: 'success', text: text.skillSaved.replace('{{name}}', focusedSkill.name) });
        setIsEditing(false);
        await loadSkills();
      } else {
        const err = await response.json();
        setModalMessage({ type: 'error', text: err.error || 'Save failed' });
      }
    } catch (err) {
      setModalMessage({ type: 'error', text: err instanceof Error ? err.message : 'Save failed' });
    } finally {
      setEditLoading(false);
    }
  }, [editContent, focusedSkill, loadSkills, text.skillSaved]);

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
        setIsEditing(false);
        setEditContent('');
        setModalMessage({ type: 'success', text: text.skillDeleted.replace('{{name}}', focusedSkill.name) });
        await loadSkills();
      } else {
        const err = await response.json();
        setModalMessage({ type: 'error', text: err.error || 'Delete failed' });
      }
    } catch (err) {
      setModalMessage({ type: 'error', text: err instanceof Error ? err.message : 'Delete failed' });
    } finally {
      setDeleteLoading(false);
    }
  }, [focusedSkill, loadSkills, text.confirmDeleteSkill, text.skillDeleted]);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    setActiveIntent('all');
    setActiveCapability('all');
    setActiveDomain('all');
    setActiveStatus('all');
  }, [localeKey]);

  const explorerSkills = useMemo(
    () => buildExplorerSkills(skills, {
      standaloneLabel: text.standaloneGroup,
      defaultDomainLabel: text.defaultDomain,
      sourcePlatformShort: text.sourcePlatformShort,
      sourceImportedShort: text.sourceImportedShort,
      localeKey,
    }),
    [skills, localeKey, text.defaultDomain, text.sourceImportedShort, text.sourcePlatformShort, text.standaloneGroup]
  );

  const skillLookup = useMemo(
    () => new Map(explorerSkills.map((skill) => [skill.dirPath, skill])),
    [explorerSkills]
  );

  const allCollectionOptions = useMemo(
    () => buildFacetOptions(explorerSkills, (skill) => ({ key: skill.primaryIntentKey, label: skill.primaryIntentLabel })),
    [explorerSkills]
  );
  const allGroupOptions = useMemo(
    () => buildMultiFacetOptions(explorerSkills, (skill) => skill.capabilityKeys.map((key, index) => ({ key, label: skill.capabilityLabels[index] }))),
    [explorerSkills]
  );
  const allDomainOptions = useMemo(
    () => buildMultiFacetOptions(explorerSkills, (skill) => skill.domainKeys.map((key, index) => ({ key, label: skill.domainLabels[index] }))),
    [explorerSkills]
  );
  const allStatusOptions = useMemo(
    () => buildFacetOptions(explorerSkills, (skill) => ({ key: skill.statusKey, label: skill.statusLabel })),
    [explorerSkills]
  );

  const collectionLookup = useMemo(
    () => new Map(allCollectionOptions.map((option) => [option.key, option.label])),
    [allCollectionOptions]
  );
  const groupLookup = useMemo(
    () => new Map(allGroupOptions.map((option) => [option.key, option.label])),
    [allGroupOptions]
  );
  const domainLookup = useMemo(
    () => new Map(allDomainOptions.map((option) => [option.key, option.label])),
    [allDomainOptions]
  );
  const statusLookup = useMemo(
    () => new Map(allStatusOptions.map((option) => [option.key, option.label])),
    [allStatusOptions]
  );

  const searchFilteredSkills = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) {
      return sortSkillsForBrowse(explorerSkills);
    }

    return explorerSkills
      .map((skill) => ({ skill, score: scoreSkillMatch(skill, query) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
      .map((entry) => entry.skill);
  }, [explorerSkills, searchQuery]);

  const collectionOptions = useMemo(
    () => buildFacetOptions(searchFilteredSkills, (skill) => ({ key: skill.primaryIntentKey, label: skill.primaryIntentLabel })),
    [searchFilteredSkills]
  );
  const groupOptions = useMemo(
    () => buildMultiFacetOptions(searchFilteredSkills, (skill) => skill.capabilityKeys.map((key, index) => ({ key, label: skill.capabilityLabels[index] }))),
    [searchFilteredSkills]
  );
  const domainOptions = useMemo(
    () => buildMultiFacetOptions(searchFilteredSkills, (skill) => skill.domainKeys.map((key, index) => ({ key, label: skill.domainLabels[index] }))),
    [searchFilteredSkills]
  );
  const statusOptions = useMemo(
    () => buildFacetOptions(searchFilteredSkills, (skill) => ({ key: skill.statusKey, label: skill.statusLabel })),
    [searchFilteredSkills]
  );

  const filteredSkills = useMemo(() => {
    return searchFilteredSkills.filter((skill) => {
      if (activeSource !== 'all' && skill.sourceKey !== activeSource) return false;
      if (activeIntent !== 'all' && skill.primaryIntentKey !== activeIntent) return false;
      if (activeCapability !== 'all' && !skill.capabilityKeys.includes(activeCapability)) return false;
      if (activeDomain !== 'all' && !skill.domainKeys.includes(activeDomain)) return false;
      if (activeStatus !== 'all' && skill.statusKey !== activeStatus) return false;
      return true;
    });
  }, [activeCapability, activeDomain, activeIntent, activeSource, activeStatus, searchFilteredSkills]);

  const verifiedCount = useMemo(
    () => explorerSkills.filter((skill) => skill.statusKey === 'verified').length,
    [explorerSkills]
  );

  type CommunityPack = {
    name: string;
    skills: SkillExplorerSeed[];
    verified: SkillExplorerSeed[];
    workflows: SkillExplorerSeed[];
    setupSkill: SkillExplorerSeed | undefined;
    owner: string;
  };

  const communityPacks = useMemo<CommunityPack[]>(() => {
    const imported = explorerSkills.filter((s) => s.sourceKey === 'imported');
    const groups: Record<string, SkillExplorerSeed[]> = {};
    for (const s of imported) {
      const group = s.legacyGroupLabel || 'Standalone';
      (groups[group] ??= []).push(s);
    }
    return Object.entries(groups)
      .filter(([name]) => name !== 'Standalone')
      .map(([name, skills]) => ({
        name,
        skills,
        verified: skills.filter((s) => s.statusKey === 'verified'),
        workflows: skills.filter((s) => s.taxonomy?.capabilities.some((c) => c.key === 'agent-workflow')),
        setupSkill: skills.find((s) => s.name.endsWith('-infra') || s.name.endsWith('-setup')),
        owner: skills[0]?.owner || '',
      }))
      .sort((a, b) => b.skills.length - a.skills.length);
  }, [explorerSkills]);

  const copyToClipboard = useCallback((command: string) => {
    navigator.clipboard.writeText(command).then(() => {
      setCopiedCommand(command);
      setTimeout(() => setCopiedCommand(null), 2000);
    });
  }, []);

  const togglePackExpanded = useCallback((packName: string) => {
    setExpandedPacks((prev) => {
      const next = new Set(prev);
      if (next.has(packName)) next.delete(packName);
      else next.add(packName);
      return next;
    });
  }, []);

  const handleConfigure = useCallback(async (packName: string) => {
    const cfg = COMMUNITY_PACK_CONFIGS[packName];
    if (!cfg) return;

    const mcpKey = selectedMcp[packName] || cfg.mcp[0].key;
    const gpuKey = selectedGpu[packName] || cfg.gpu[0].key;
    const gpuOpt = cfg.gpu.find((g) => g.key === gpuKey) || cfg.gpu[0];

    // Use detected GPU template if compute-node selected
    const gpuTemplate = gpuKey === 'compute-node' && detectedGpuTemplate[packName]
      ? detectedGpuTemplate[packName]
      : gpuOpt?.template || '';

    // Collect API keys from inputs
    const mcpOpt = cfg.mcp.find((m) => m.key === mcpKey) || cfg.mcp[0];
    const apiKeys: Record<string, string> = {};
    for (const ev of mcpOpt.envVars) {
      const val = apiKeyInputs[ev.name];
      if (val) apiKeys[ev.name] = val;
    }

    setConfiguring(true);
    setConfigResult(null);

    try {
      // Use current working directory as project path
      const projectPath = window.location.pathname === '/' ? process.env.REACT_APP_PROJECT_PATH || '.' : '.';
      const resp = await (await import('../utils/api')).api.communityTools.configure(
        projectPath,
        mcpKey,
        apiKeys,
        gpuTemplate
      );
      const data = await resp.json();
      if (data.success) {
        const okSteps = (data.steps || []).filter((s: { status: string }) => s.status === 'ok').length;
        setConfigResult({ success: true, message: `Done! ${okSteps} step(s) configured.` });
      } else {
        const errMsgs = (data.errors || []).map((e: { error: string }) => e.error).join('; ');
        setConfigResult({ success: false, message: errMsgs || 'Configuration failed' });
      }
    } catch (err) {
      setConfigResult({ success: false, message: String(err) });
    } finally {
      setConfiguring(false);
    }
  }, [selectedMcp, selectedGpu, apiKeyInputs]);

  const loadComputeNodes = useCallback(async () => {
    try {
      const resp = await (await import('../utils/api')).api.communityTools.getComputeNodes();
      const data = await resp.json();
      setComputeNodes(data.nodes || []);
    } catch {
      // no compute nodes available
    }
  }, []);

  const handleDetectGpu = useCallback(async (nodeId: string, packName: string) => {
    setDetectingGpu(true);
    try {
      const resp = await (await import('../utils/api')).api.communityTools.detectGpu(nodeId);
      const data = await resp.json();
      if (data.success) {
        setDetectedGpuTemplate((prev) => ({ ...prev, [packName]: data.template }));
        setDetectedGpuInfo((prev) => ({ ...prev, [packName]: `${data.nodeName}: ${data.gpuLine}` }));
        setSelectedGpu((prev) => ({ ...prev, [packName]: 'compute-node' }));
      }
    } catch {
      // detection failed
    } finally {
      setDetectingGpu(false);
    }
  }, []);

  const hasActiveFilters = Boolean(searchQuery.trim())
    || activeSource !== 'all'
    || activeIntent !== 'all'
    || activeCapability !== 'all'
    || activeDomain !== 'all'
    || activeStatus !== 'all';

  const activeFilterLabels = useMemo(() => {
    const labels: string[] = [];

    if (activeSource === 'dr-claw') {
      labels.push(`${text.sourceField}: ${text.sourcePlatformShort}`);
    }
    if (activeSource === 'imported') {
      labels.push(`${text.sourceField}: ${text.sourceImportedShort}`);
    }
    if (activeIntent !== 'all') {
      labels.push(`${text.primaryIntentField}: ${collectionLookup.get(activeIntent) ?? activeIntent}`);
    }
    if (activeCapability !== 'all') {
      labels.push(`${text.capabilitiesField}: ${groupLookup.get(activeCapability) ?? activeCapability}`);
    }
    if (activeDomain !== 'all') {
      labels.push(`${text.domainField}: ${domainLookup.get(activeDomain) ?? activeDomain}`);
    }
    if (activeStatus !== 'all') {
      labels.push(`${text.statusField}: ${statusLookup.get(activeStatus) ?? activeStatus}`);
    }

    return labels;
  }, [
    activeCapability,
    activeDomain,
    activeIntent,
    activeSource,
    activeStatus,
    domainLookup,
    groupLookup,
    collectionLookup,
    statusLookup,
    text.capabilitiesField,
    text.domainField,
    text.primaryIntentField,
    text.statusField,
    text.sourceField,
    text.sourceImportedShort,
    text.sourcePlatformShort,
  ]);

  const headerSummary = useMemo(() => {
    if (!hasSkillRoots) return text.noRoots;
    return text.headerCount
      .replace('{{shown}}', String(filteredSkills.length))
      .replace('{{total}}', String(skills.length));
  }, [filteredSkills.length, hasSkillRoots, skills.length, text.headerCount, text.noRoots]);

  useEffect(() => {
    setFocusedSkill((current) => {
      if (explorerSkills.length === 0) {
        return null;
      }

      const refreshedCurrent = current ? skillLookup.get(current.dirPath) ?? null : null;
      if (refreshedCurrent) {
        if (isEditing) {
          return refreshedCurrent;
        }
        if (filteredSkills.some((skill) => skill.dirPath === refreshedCurrent.dirPath)) {
          return refreshedCurrent;
        }
        return filteredSkills[0] ?? refreshedCurrent;
      }

      return filteredSkills[0] ?? explorerSkills[0] ?? null;
    });
  }, [explorerSkills, filteredSkills, isEditing, skillLookup]);

  const handleSelectSkill = useCallback((skill: SkillExplorerItem) => {
    if (isEditing && focusedSkill?.dirPath === skill.dirPath) {
      setMobileDetailOpen(true);
      return;
    }
    if (isEditing && focusedSkill && focusedSkill.dirPath !== skill.dirPath) {
      if (!confirm(text.discardChanges)) {
        return;
      }
    }
    setFocusedSkill(skill);
    setMobileDetailOpen(true);
    setIsEditing(false);
    setEditContent('');
    setModalMessage(null);
  }, [focusedSkill, isEditing, text.discardChanges]);

  const clearAllFilters = useCallback(() => {
    setSearchQuery('');
    setActiveSource('all');
    setActiveIntent('all');
    setActiveCapability('all');
    setActiveDomain('all');
    setActiveStatus('all');
  }, []);

  const detailPanel = <>
              <div className="overflow-hidden rounded-lg border border-border/80 bg-card/95 ">
                {!focusedSkill && (
                  <div className="p-6 text-sm text-muted-foreground">{text.emptySelection}</div>
                )}

                {focusedSkill && (
                  <>
                    <div className="border-b border-border/60 p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-muted-foreground">{text.detailTitle}</p>
                          <h3 className="mt-2 break-all text-xl font-semibold text-foreground">{focusedSkill.name}</h3>
                          <p className="mt-2 text-sm leading-6 text-muted-foreground">{focusedSkill.summary}</p>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tagStyleClass('intent', focusedSkill.primaryIntentLabel)}`}>
                              {focusedSkill.primaryIntentLabel}
                            </span>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tagStyleClass('status', focusedSkill.statusLabel)}`}>
                              {focusedSkill.statusLabel}
                            </span>
                            <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tagStyleClass('source', focusedSkill.sourceLabel)}`}>
                              {focusedSkill.sourceLabel}
                            </span>
                          </div>
                        </div>
                        <div className="flex flex-wrap justify-end gap-2">
                          {!isEditing && (
                            <>
                              <button
                                type="button"
                                onClick={handleStartEdit}
                                disabled={editLoading || !focusedSkill.hasSkillMd}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
                                title={focusedSkill.hasSkillMd ? text.editSkill : text.noSkillFile}
                              >
                                {editLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Edit3 className="h-3.5 w-3.5" />}
                                {text.editSkill}
                              </button>
                              <button
                                type="button"
                                onClick={handleDeleteSkill}
                                disabled={deleteLoading}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/30 disabled:opacity-50"
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
                                className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50"
                              >
                                {editLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                                {editLoading ? text.saving : text.saveSkill}
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                              >
                                {text.cancelEdit}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-5 p-5">
                      {modalMessage && (
                        <div className={`rounded-md border px-3 py-2 text-sm ${modalMessage.type === 'success' ? 'border-green-300/60 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'border-red-300/60 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
                          {modalMessage.text}
                        </div>
                      )}

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="border-b border-border pb-3">
                          <p className="text-sm text-muted-foreground">{text.primaryIntentField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.primaryIntentLabel}</p>
                        </div>
                        <div className="border-b border-border pb-3">
                          <p className="text-sm text-muted-foreground">{text.intentsField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.intentLabels.join(', ')}</p>
                        </div>
                        <div className="border-b border-border pb-3">
                          <p className="text-sm text-muted-foreground">{text.statusField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.statusLabel}</p>
                        </div>
                        <div className="border-b border-border pb-3">
                          <p className="text-sm text-muted-foreground">{text.domainField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.domainLabels.join(', ')}</p>
                        </div>
                        <div className="border-b border-border pb-3">
                          <p className="text-sm text-muted-foreground">{text.sourceField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.sourceLabel}</p>
                        </div>
                        <div className="border-b border-border pb-3 sm:col-span-2">
                          <p className="text-sm text-muted-foreground">{text.capabilitiesField}</p>
                          <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.capabilityLabels.join(', ') || '—'}</p>
                        </div>
                        {focusedSkill.owner && (
                          <div className="border-b border-border pb-3 sm:col-span-2">
                            <p className="text-sm text-muted-foreground">{text.ownerField}</p>
                            <p className="mt-1 text-sm font-medium text-foreground">{focusedSkill.owner}</p>
                          </div>
                        )}
                      </div>

                      <div className="border-b border-border pb-3">
                        <p className="text-sm text-muted-foreground">{text.pathField}</p>
                        <p className="mt-1 break-all text-sm font-medium text-foreground">{`skills/${focusedSkill.dirPath}`}</p>
                      </div>

                      <div className="border-b border-border pb-3">
                        <p className="text-sm text-muted-foreground">{text.legacyField}</p>
                        <p className="mt-1 text-sm font-medium text-foreground">
                          {`${focusedSkill.legacyCollectionLabel} / ${focusedSkill.legacyGroupLabel}`}
                        </p>
                      </div>

                      {!focusedSkill.hasSkillMd && !isEditing && (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                          {text.noSkillFile}
                        </div>
                      )}

                      {isEditing ? (
                        <textarea
                          aria-label={`${text.editSkill} ${focusedSkill.name}`}
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="min-h-[360px] w-full resize-y rounded-lg border border-border/70 bg-background p-4 font-mono text-sm leading-6 text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                          spellCheck={false}
                        />
                      ) : (
                        <>
                          <div className="grid gap-5">
                            <DetailChipSection
                              title={text.intentsField}
                              values={focusedSkill.intentLabels}
                              type="intent"
                            />
                            <DetailChipSection
                              title={text.capabilitiesField}
                              values={focusedSkill.capabilityLabels}
                              type="capability"
                            />
                            <DetailChipSection
                              title={text.domainField}
                              values={focusedSkill.domainLabels}
                              type="domain"
                            />
                            <DetailChipSection
                              title={text.keywordsField}
                              values={focusedSkill.keywordLabels}
                              type="meta"
                            />
                            {!focusedSkill.taxonomy && focusedSkill.tags.length > 0 && (
                              <div>
                                <h4 className="text-sm font-semibold text-foreground">{text.rawTagsField}</h4>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {focusedSkill.tags.map((tag) => (
                                    <span
                                      key={`${focusedSkill.dirPath}-detail-${tag.label}`}
                                      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tagStyleClass(tag.type, tag.label)}`}
                                    >
                                      {tag.label}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>

                          <div>
                            <h4 className="text-sm font-semibold text-foreground">{text.overview}</h4>
                            <div className="mt-2 max-h-[38vh] overflow-auto rounded-lg border border-border/70 bg-muted/30 p-4">
                              <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{focusedSkill.fullDescription}</p>
                            </div>
                          </div>

                          {focusedSkill.relatedSkills.length > 0 && (
                            <div>
                              <h4 className="text-sm font-semibold text-foreground">{text.relatedSkills}</h4>
                              <div className="mt-2 space-y-2">
                                {focusedSkill.relatedSkills.map((relation) => {
                                  const relatedSkill = skillLookup.get(relation.dirPath);
                                  if (!relatedSkill) return null;

                                  return (
                                    <button
                                      key={relation.dirPath}
                                      type="button"
                                      onClick={() => handleSelectSkill(relatedSkill)}
                                      className="flex w-full items-start justify-between gap-3 rounded-lg border border-border/70 bg-background px-3 py-3 text-left transition hover:bg-muted/60"
                                    >
                                      <div className="min-w-0">
                                        <p className="break-all text-sm font-medium text-foreground">{relatedSkill.name}</p>
                                        <p className="mt-1 text-xs text-muted-foreground">{relation.reason}</p>
                                      </div>
                                      <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            </>;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {text.loading}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-background">
      <div className="workbench-page">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0"><h1 className="text-2xl font-semibold tracking-tight">{text.title}</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{t('common:workbench.skillsDescription')}</p><p className="mt-3 text-sm tabular-nums text-muted-foreground">{headerSummary}</p></div>
          <div className="flex flex-wrap gap-2"><button
                onClick={openImportModal}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/85 px-4 py-2 text-sm font-medium text-foreground  transition-colors hover:bg-muted"
              >
                <Download className="h-4 w-4" />
                {text.importLocal}
              </button><button
                onClick={loadSkills}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-background/85 px-4 py-2 text-sm font-medium text-foreground  transition-colors hover:bg-muted"
              >
                <RefreshCw className="h-4 w-4" />
                {text.refresh}
              </button></div>
        </header>

        {/* ── Tab Bar: Platform vs Community ── */}
        <div className="mb-5 flex items-center gap-1 rounded-lg border border-border/80 bg-card/95 p-1.5  w-fit">
          <button
            type="button"
            onClick={() => setViewMode('platform')}
            className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
              viewMode === 'platform'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            {text.tabPlatform}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('community')}
            className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition-colors ${
              viewMode === 'community'
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:bg-muted/60'
            }`}
          >
            <Package className="h-4 w-4" />
            {text.tabCommunity}
            {communityPacks.length > 0 && (
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                viewMode === 'community'
                  ? 'bg-amber-200/70 text-amber-800 dark:bg-amber-800/50 dark:text-amber-100'
                  : 'bg-muted text-muted-foreground'
              }`}>
                {communityPacks.length}
              </span>
            )}
          </button>
        </div>

        {/* ── Community Tools View ── */}
        {viewMode === 'community' && (
          <div className="space-y-6">
            {communityPacks.length === 0 ? (
              <div className="rounded-lg border border-border/80 bg-card/95 p-8 text-center text-sm text-muted-foreground">
                <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
                {text.noCommunityPacks}
              </div>
            ) : (
              communityPacks.map((pack) => (
                <div key={pack.name} className="rounded-lg border border-amber-200/60 bg-muted     dark:border-amber-800/30 ">
                  {/* Pack Header */}
                  <div className="p-6 pb-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                            <Package className="h-5 w-5" />
                          </div>
                          <div>
                            <h2 className="text-xl font-semibold text-foreground">{pack.name}</h2>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {text.packAuthor}: {pack.owner || 'Community'} · {text.packVerified.replace('{{count}}', String(pack.verified.length))} · {pack.skills.length} skills
                            </p>
                          </div>
                        </div>
                      </div>
                      {pack.setupSkill && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(`/${pack.setupSkill!.name}`)}
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-amber-300/60 bg-amber-100/80 px-4 py-2 text-sm font-medium text-amber-800  transition-colors hover:bg-amber-200/80 dark:border-amber-700/40 dark:bg-amber-900/30 dark:text-amber-200 dark:hover:bg-amber-800/40"
                        >
                          <Settings className="h-4 w-4" />
                          {copiedCommand === `/${pack.setupSkill.name}` ? text.copied : text.packSetup}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Configuration Section */}
                  {COMMUNITY_PACK_CONFIGS[pack.name] && (
                    <div className="border-t border-amber-200/40 dark:border-amber-800/20">
                      <button
                        type="button"
                        onClick={() => { loadComputeNodes(); setConfigExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(pack.name)) next.delete(pack.name);
                          else next.add(pack.name);
                          return next;
                        }); }}
                        className="flex w-full items-center justify-between px-6 py-3 transition-colors hover:bg-amber-50/40 dark:hover:bg-amber-950/10"
                      >
                        <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                          <AlertCircle className="h-4 w-4 text-sky-500" />
                          {text.packConfig}
                        </span>
                        {configExpanded.has(pack.name) ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>

                      {configExpanded.has(pack.name) && (() => {
                        const cfg = COMMUNITY_PACK_CONFIGS[pack.name];
                        const mcpKey = selectedMcp[pack.name] || cfg.mcp[0].key;
                        const gpuKey = selectedGpu[pack.name] || cfg.gpu[0].key;
                        const mcpOpt = cfg.mcp.find((m) => m.key === mcpKey) || cfg.mcp[0];
                        const gpuOpt = cfg.gpu.find((g) => g.key === gpuKey) || cfg.gpu[0];

                        return (
                          <div className="space-y-5 px-6 pb-5">
                            {/* MCP Reviewer */}
                            <div>
                              <h4 className="mb-1 text-sm font-semibold text-foreground">{text.configMcp}</h4>
                              <p className="mb-3 text-xs text-muted-foreground">{text.configMcpDesc}</p>
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {cfg.mcp.map((opt) => (
                                  <button
                                    key={opt.key}
                                    type="button"
                                    onClick={() => setSelectedMcp((prev) => ({ ...prev, [pack.name]: opt.key }))}
                                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                      mcpKey === opt.key
                                        ? 'border-sky-400 bg-sky-100 text-sky-700  dark:border-sky-600 dark:bg-sky-900/40 dark:text-sky-200'
                                        : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/60'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                              <div className="space-y-2 rounded-lg border border-sky-200/50 bg-sky-50/30 p-3 dark:border-sky-800/30 dark:bg-sky-950/10">
                                {mcpOpt.install && (
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className="mb-0.5 text-xs font-medium text-muted-foreground">{text.configInstall}</p>
                                      <code className="block truncate rounded bg-slate-100 px-2 py-1 text-xs text-foreground dark:bg-slate-800">{mcpOpt.install}</code>
                                    </div>
                                    <button type="button" onClick={() => copyToClipboard(mcpOpt.install!)} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/30">
                                      {copiedCommand === mcpOpt.install ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                                    </button>
                                  </div>
                                )}
                                {mcpOpt.register && (
                                <div className="flex items-center justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="mb-0.5 text-xs font-medium text-muted-foreground">{text.configRegister}</p>
                                    <code className="block truncate rounded bg-slate-100 px-2 py-1 text-xs text-foreground dark:bg-slate-800">{mcpOpt.register}</code>
                                  </div>
                                  <button type="button" onClick={() => copyToClipboard(mcpOpt.register)} className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/30">
                                    {copiedCommand === mcpOpt.register ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                                  </button>
                                </div>
                                )}
                                {mcpOpt.envVars.map((ev) => (
                                  <div key={ev.name}>
                                    <p className="mb-1 text-xs font-medium text-muted-foreground">{ev.name}</p>
                                    <div className="relative">
                                      <input
                                        type={apiKeyVisible[ev.name] ? 'text' : 'password'}
                                        placeholder={ev.example}
                                        value={apiKeyInputs[ev.name] || ''}
                                        onChange={(e) => setApiKeyInputs((prev) => ({ ...prev, [ev.name]: e.target.value }))}
                                        className="w-full rounded-lg border border-border bg-background px-3 py-1.5 pr-9 text-xs font-mono text-foreground outline-none transition focus:border-sky-400 focus:ring-1 focus:ring-sky-300/50 dark:focus:border-sky-600"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => setApiKeyVisible((prev) => ({ ...prev, [ev.name]: !prev[ev.name] }))}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                                      >
                                        {apiKeyVisible[ev.name] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>

                            {/* GPU Environment */}
                            <div>
                              <h4 className="mb-1 text-sm font-semibold text-foreground">{text.configGpu}</h4>
                              <p className="mb-3 text-xs text-muted-foreground">{text.configGpuDesc}</p>
                              <div className="mb-3 flex flex-wrap gap-1.5">
                                {/* Existing compute nodes button */}
                                {computeNodes.length > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setSelectedGpu((prev) => ({ ...prev, [pack.name]: 'compute-node' }))}
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                      gpuKey === 'compute-node'
                                        ? 'border-green-400 bg-green-100 text-green-700  dark:border-green-600 dark:bg-green-900/40 dark:text-green-200'
                                        : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/60'
                                    }`}
                                  >
                                    <Server className="h-3 w-3" />
                                    {text.existingServer}
                                  </button>
                                )}
                                {cfg.gpu.map((opt) => (
                                  <button
                                    key={opt.key}
                                    type="button"
                                    onClick={() => setSelectedGpu((prev) => ({ ...prev, [pack.name]: opt.key }))}
                                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                                      gpuKey === opt.key
                                        ? 'border-sky-400 bg-sky-100 text-sky-700  dark:border-sky-600 dark:bg-sky-900/40 dark:text-sky-200'
                                        : 'border-border/60 bg-background text-muted-foreground hover:bg-muted/60'
                                    }`}
                                  >
                                    <Cpu className="h-3 w-3" />
                                    {opt.label}
                                  </button>
                                ))}
                              </div>

                              {/* Compute node selector */}
                              {gpuKey === 'compute-node' && computeNodes.length > 0 && (
                                <div className="mb-3 rounded-lg border border-green-200/50 bg-green-50/30 p-3 dark:border-green-800/30 dark:bg-green-950/10">
                                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                                    {text.selectServer}
                                  </p>
                                  <div className="space-y-1.5">
                                    {computeNodes.map((node) => (
                                      <button
                                        key={node.id}
                                        type="button"
                                        disabled={detectingGpu}
                                        onClick={() => handleDetectGpu(node.id, pack.name)}
                                        className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-left transition-colors hover:border-green-300/60 hover:bg-green-50/40 active:scale-[0.99] disabled:opacity-50 dark:hover:border-green-700/40"
                                      >
                                        <div className="flex items-center gap-2">
                                          <Server className="h-3.5 w-3.5 text-green-600" />
                                          <span className="text-xs font-medium text-foreground">{node.name}</span>
                                          <span className="text-xs text-muted-foreground">{node.user}@{node.host}</span>
                                        </div>
                                        <span className="text-xs text-muted-foreground group-hover:text-green-600">
                                          {detectingGpu ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (text.detectGpu)}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                  {detectedGpuInfo[pack.name] && (
                                    <p className="mt-2 text-xs font-medium text-green-700 dark:text-green-300">
                                      <Check className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />{detectedGpuInfo[pack.name]}
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Template display */}
                              <div className="rounded-lg border border-sky-200/50 bg-sky-50/30 p-3 dark:border-sky-800/30 dark:bg-sky-950/10">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="mb-1 text-xs font-medium text-muted-foreground">{text.configClaudeMd}</p>
                                    <pre className="whitespace-pre-wrap rounded bg-slate-100 px-2 py-1.5 text-xs text-foreground dark:bg-slate-800">
                                      {gpuKey === 'compute-node' && detectedGpuTemplate[pack.name]
                                        ? detectedGpuTemplate[pack.name]
                                        : gpuOpt.template}
                                    </pre>
                                    {gpuKey !== 'compute-node' && gpuOpt.note && <p className="mt-1.5 text-xs text-muted-foreground">{gpuOpt.note}</p>}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => copyToClipboard(
                                      gpuKey === 'compute-node' && detectedGpuTemplate[pack.name]
                                        ? detectedGpuTemplate[pack.name]
                                        : gpuOpt.template
                                    )}
                                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-900/30"
                                  >
                                    {copiedCommand === (gpuKey === 'compute-node' && detectedGpuTemplate[pack.name] ? detectedGpuTemplate[pack.name] : gpuOpt.template)
                                      ? <Check className="h-3.5 w-3.5 text-green-600" />
                                      : <Copy className="h-3.5 w-3.5" />}
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Setup Script */}
                            <div>
                              <h4 className="mb-2 text-sm font-semibold text-foreground">{text.configSetupScript}</h4>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(cfg.setupScript)}
                                className="group flex w-full items-center justify-between gap-2 rounded-lg border border-border/60 bg-background/80 px-4 py-2.5 text-left transition-colors hover:border-sky-300/80 hover:bg-sky-50/40 active:scale-[0.99] dark:hover:border-sky-700/50 dark:hover:bg-sky-950/20"
                              >
                                <div className="flex items-center gap-2">
                                  <Terminal className="h-4 w-4 text-sky-500" />
                                  <code className="text-sm font-mono text-foreground">{cfg.setupScript}</code>
                                </div>
                                <span className="shrink-0 text-muted-foreground transition-colors group-hover:text-sky-600">
                                  {copiedCommand === cfg.setupScript ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                                </span>
                              </button>
                            </div>

                            {/* Auto Configure Button */}
                            <div className="mt-1 rounded-lg border border-sky-300/50 bg-sky-50/50 p-4 dark:border-sky-800/30 dark:bg-sky-950/20">
                              <button
                                type="button"
                                disabled={configuring}
                                onClick={() => handleConfigure(pack.name)}
                                className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white  transition-colors hover:bg-sky-700 active:scale-[0.98] disabled:opacity-60 dark:bg-sky-500 dark:hover:bg-sky-600"
                              >
                                {configuring ? (
                                  <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    {text.configApplying}
                                  </>
                                ) : (
                                  <>
                                    <Settings className="h-4 w-4" />
                                    {text.configApply}
                                  </>
                                )}
                              </button>
                              {configResult && (
                                <p className={`mt-2 text-center text-xs font-medium ${configResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                  {configResult.success ? text.configSuccess : configResult.message}
                                </p>
                              )}
                              <p className="mt-2 text-center text-xs text-muted-foreground">
                                {text.configureHint}
                              </p>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  )}

                  {/* Workflow Skills */}
                  {pack.workflows.length > 0 && (
                    <div className="border-t border-amber-200/40 px-6 py-4 dark:border-amber-800/20">
                      <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Play className="h-4 w-4 text-muted-foreground" />
                        {text.packWorkflows}
                      </h3>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {pack.workflows.map((skill) => (
                          <div
                            key={skill.name}
                            className="group flex flex-col items-start gap-1.5 rounded-lg border border-border/60 bg-background/80 px-4 py-3 transition-colors hover:border-amber-300/80 hover:bg-amber-50/60  dark:hover:border-amber-700/50 dark:hover:bg-amber-950/20"
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <p className="truncate text-sm font-semibold text-foreground">{skill.name}</p>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(`/${skill.name}`); }}
                                className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-colors hover:text-amber-600 group-hover:opacity-100"
                                title={text.copyCommandTitle}
                              >
                                {copiedCommand === `/${skill.name}` ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                              </button>
                            </div>
                            <p className="line-clamp-2 text-xs text-muted-foreground">{skill.summary.slice(0, 80)}</p>
                            <div className="mt-1 flex w-full items-center gap-2">
                              <button
                                type="button"
                                onClick={() => onSendToChat ? onSendToChat(`/${skill.name}`) : copyToClipboard(`/${skill.name}`)}
                                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white  transition-colors hover:bg-amber-700 active:scale-[0.97] dark:bg-amber-500 dark:hover:bg-amber-600"
                              >
                                <Play className="h-3 w-3" />
                                {text.useInChat}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* All Skills (expandable) */}
                  <div className="border-t border-amber-200/40 dark:border-amber-800/20">
                    <button
                      type="button"
                      onClick={() => togglePackExpanded(pack.name)}
                      className="flex w-full items-center justify-between px-6 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span>{text.packAllSkills.replace('{{count}}', String(pack.skills.length))}</span>
                      {expandedPacks.has(pack.name) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>

                    {expandedPacks.has(pack.name) && (
                      <div className="px-6 pb-4">
                        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                          {pack.skills
                            .filter((s) => !pack.workflows.includes(s) && s !== pack.setupSkill)
                            .map((skill) => (
                              <button
                                key={skill.name}
                                type="button"
                                onClick={() => copyToClipboard(`/${skill.name}`)}
                                className="group flex items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/60 px-3 py-2 text-left transition-colors hover:border-amber-200/60 hover:bg-amber-50/30 active:scale-[0.98] dark:hover:border-amber-800/40 dark:hover:bg-amber-950/10"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium text-foreground">{skill.name}</p>
                                  <p className="truncate text-xs text-muted-foreground">{skill.primaryIntentLabel}</p>
                                </div>
                                <span className="shrink-0 text-muted-foreground transition-colors group-hover:text-amber-600">
                                  {copiedCommand === `/${skill.name}` ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                                </span>
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Platform Skills View (existing) ── */}
        {viewMode === 'platform' && error && (
          <div className="mb-4 rounded-md border border-red-300/60 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </div>
        )}

        {viewMode === 'platform' && !hasSkillRoots && !error && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {text.notFoundRoots}
          </div>
        )}

        {viewMode === 'platform' && hasSkillRoots && skills.length === 0 && !error && (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
            {text.noSkills}
          </div>
        )}

        {viewMode === 'platform' && skills.length > 0 && (
          <div className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_420px]">
            <aside className="space-y-4 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto xl:pr-1">
              <div className="border-t border-border py-4">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label={text.searchPlaceholder}
                    placeholder={text.searchPlaceholder}
                    className="w-full rounded-lg border border-border bg-background pl-9 pr-9 py-2.5 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted"
                      aria-label={text.clearSearch}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    {text.clearFilters}
                  </button>
                )}
              </div>

              {isCompact && <button type="button" className="w-full rounded-md border border-border px-3 py-2 text-left text-sm" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(value => !value)}>{t('common:workbench.filters')}</button>}
              <div className={isCompact && !filtersOpen ? 'hidden' : 'space-y-4'}>
              <div className="border-t border-border py-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  {text.quickViews}
                </div>
                <div className="space-y-2">
                  {[
                    {
                      key: 'all',
                      label: text.allSkills,
                      count: searchFilteredSkills.length,
                      active: activeSource === 'all' && activeIntent === 'all' && activeCapability === 'all' && activeDomain === 'all' && activeStatus === 'all',
                      onClick: () => {
                        setActiveSource('all');
                        setActiveIntent('all');
                        setActiveCapability('all');
                        setActiveDomain('all');
                        setActiveStatus('all');
                      },
                    },
                    {
                      key: 'verified',
                      label: text.verifiedSkills,
                      count: searchFilteredSkills.filter((skill) => skill.statusKey === 'verified').length,
                      active: activeStatus === 'verified' && activeSource === 'all' && activeIntent === 'all' && activeCapability === 'all' && activeDomain === 'all',
                      onClick: () => {
                        setActiveSource('all');
                        setActiveIntent('all');
                        setActiveCapability('all');
                        setActiveDomain('all');
                        setActiveStatus('verified');
                      },
                    },
                    {
                      key: 'community',
                      label: text.communitySkills,
                      count: searchFilteredSkills.filter((skill) => skill.sourceKey === 'imported').length,
                      active: activeSource === 'imported' && activeIntent === 'all' && activeCapability === 'all' && activeDomain === 'all' && activeStatus === 'all',
                      onClick: () => {
                        setActiveSource('imported');
                        setActiveIntent('all');
                        setActiveCapability('all');
                        setActiveDomain('all');
                        setActiveStatus('all');
                      },
                    },
                    {
                      key: 'native',
                      label: text.nativeSkills,
                      count: searchFilteredSkills.filter((skill) => skill.sourceKey === 'dr-claw' || skill.sourceKey === 'vibelab').length,
                      active: activeSource === 'dr-claw' && activeIntent === 'all' && activeCapability === 'all' && activeDomain === 'all' && activeStatus === 'all',
                      onClick: () => {
                        setActiveSource('dr-claw');
                        setActiveIntent('all');
                        setActiveCapability('all');
                        setActiveDomain('all');
                        setActiveStatus('all');
                      },
                    },
                  ].map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={item.onClick}
                      className={facetButtonClass(item.active)}
                    >
                      <span>{item.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{item.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-border py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  {text.intents}
                </div>
                <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setActiveIntent('all')}
                    className={facetButtonClass(activeIntent === 'all')}
                  >
                    <span>{text.allIntents}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{searchFilteredSkills.length}</span>
                  </button>
                  {collectionOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setActiveIntent(option.key)}
                      className={facetButtonClass(activeIntent === option.key)}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="border-t border-border py-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <FolderTree className="h-4 w-4 text-muted-foreground" />
                  {text.capabilities}
                </div>
                <div className="max-h-[320px] space-y-2 overflow-auto pr-1">
                  <button
                    type="button"
                    onClick={() => setActiveCapability('all')}
                    className={facetButtonClass(activeCapability === 'all')}
                  >
                    <span>{text.allCapabilities}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{searchFilteredSkills.length}</span>
                  </button>
                  {groupOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setActiveCapability(option.key)}
                      className={facetButtonClass(activeCapability === option.key)}
                    >
                      <span className="min-w-0 truncate">{option.label}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
                    </button>
                  ))}
                </div>
              </div>

              {domainOptions.length > 1 && (
                <div className="border-t border-border py-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Compass className="h-4 w-4 text-muted-foreground" />
                    {text.domains}
                  </div>
                  <div className="max-h-[260px] space-y-2 overflow-auto pr-1">
                    <button
                      type="button"
                      onClick={() => setActiveDomain('all')}
                      className={facetButtonClass(activeDomain === 'all')}
                    >
                      <span>{text.allDomains}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{searchFilteredSkills.length}</span>
                    </button>
                    {domainOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setActiveDomain(option.key)}
                        className={facetButtonClass(activeDomain === option.key)}
                      >
                        <span className="min-w-0 truncate">{option.label}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {statusOptions.length > 1 && (
                <div className="border-t border-border py-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Check className="h-4 w-4 text-muted-foreground" />
                    {text.statuses}
                  </div>
                  <div className="max-h-[220px] space-y-2 overflow-auto pr-1">
                    <button
                      type="button"
                      onClick={() => setActiveStatus('all')}
                      className={facetButtonClass(activeStatus === 'all')}
                    >
                      <span>{text.allStatuses}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{searchFilteredSkills.length}</span>
                    </button>
                    {statusOptions.map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setActiveStatus(option.key)}
                        className={facetButtonClass(activeStatus === option.key)}
                      >
                        <span className="min-w-0 truncate">{option.label}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{option.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              </div>
            </aside>

            <section className="min-w-0 space-y-4">
              <div className="border-t border-border py-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{text.results}</p>
                    <h3 className="mt-1 text-xl font-semibold tabular-nums text-foreground">{headerSummary}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {text.resultsSummary.replace('{{shown}}', String(filteredSkills.length))}
                    </p>
                  </div>

                  {activeFilterLabels.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {activeFilterLabels.map((label) => (
                        <span
                          key={label}
                          className="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 dark:border-sky-900/80 dark:bg-sky-950/50 dark:text-sky-200"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {filteredSkills.length === 0 && (
                <div className="rounded-lg border border-border bg-card p-6 text-sm text-muted-foreground ">
                  {text.noFilterResult}
                </div>
              )}

              {filteredSkills.length > 0 && (
                <div className="overflow-hidden rounded-lg border border-border/80 bg-card/95 ">
                  <div className="divide-y divide-border/60">
                    {filteredSkills.map((skill) => {
                      const isFocused = focusedSkill?.dirPath === skill.dirPath;
                      const { tags: cardTags, hiddenCount } = buildSkillCardTagSummary(skill);
                      return (
                        <button
                          key={skill.dirPath}
                          type="button"
                          onClick={() => handleSelectSkill(skill)}
                          className={`flex w-full items-start justify-between gap-4 px-4 py-4 text-left transition ${
                            isFocused
                              ? 'bg-muted'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-900/40'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h4 className="break-all text-sm font-semibold text-foreground">{skill.name}</h4>
                              {cardTags.map((tag) => (
                                <span
                                  key={`${skill.dirPath}-${tag.type}-${tag.label}`}
                                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tagStyleClass(tag.type, tag.label)}`}
                                >
                                  {tag.label}
                                </span>
                              ))}
                              {hiddenCount > 0 && (
                                <span className="inline-flex items-center rounded-full border border-border/70 bg-muted/40 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                  +{hiddenCount}
                                </span>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{`skills/${skill.dirPath}`}</p>
                            <p
                              className="mt-3 text-sm leading-6 text-muted-foreground"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 3,
                                WebkitBoxOrient: 'vertical',
                                overflow: 'hidden',
                              }}
                            >
                              {skill.summary}
                            </p>
                          </div>
                          <ChevronRight className={`mt-1 h-4 w-4 shrink-0 ${isFocused ? 'text-sky-600 dark:text-sky-300' : 'text-muted-foreground'}`} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>

            {!isCompact && <aside className="min-w-0 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)] xl:self-start xl:overflow-y-auto">{detailPanel}</aside>}
            {isCompact && mobileDetailOpen && focusedSkill && <WorkbenchDialog title={focusedSkill.name} size="wide" onClose={() => setMobileDetailOpen(false)}>{detailPanel}</WorkbenchDialog>}
          </div>
        )}
      </div>

      {showImportModal && (
        <WorkbenchDialog title={text.importModalTitle} onClose={() => setShowImportModal(false)}>
            <div className="mb-4">
              <label htmlFor="skill-import-path" className="mb-1.5 block text-sm font-medium text-foreground">{text.pathLabel}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  id="skill-import-path"
                  value={importPath}
                  onChange={(e) => setImportPath(e.target.value)}
                  className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:ring-2 focus:ring-sky-300/70 dark:focus:ring-sky-700/70"
                  placeholder="~/.claude/skills"
                />
                <button
                  onClick={handleScanLocal}
                  disabled={scanLoading || !importPath.trim()}
                  className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {scanLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  {scanLoading ? text.scanning : text.scan}
                </button>
              </div>
            </div>

            {importMessage && (
              <div role={importMessage.type === 'error' ? 'alert' : 'status'} className={`mb-4 rounded-md border px-3 py-2 text-sm ${importMessage.type === 'success' ? 'border-green-300/60 bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' : 'border-red-300/60 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300'}`}>
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
                    className={`flex items-center gap-3 border-b border-border/50 px-3 py-2.5 last:border-b-0 transition-colors ${skill.alreadyImported ? 'opacity-60' : 'cursor-pointer hover:bg-muted/50'}`}
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
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-foreground">{skill.name}</span>
                      <div className="mt-0.5 flex items-center gap-2">
                        {skill.hasSkillMd && (
                          <span className="text-xs text-muted-foreground">SKILL.md</span>
                        )}
                        {skill.alreadyImported && (
                          <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                            <Check className="h-3 w-3" />
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
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {importLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {importLoading ? text.importing : `${text.importSelected} (${selectedSkills.size})`}
                </button>
              </div>
            )}
        </WorkbenchDialog>
      )}
    </div>
  );
}
