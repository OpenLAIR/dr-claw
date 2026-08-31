import { promises as fs } from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(repoRoot, 'skills');
const schemaPath = path.join(repoRoot, 'skills', 'skills-taxonomy-v2.schema.json');
const overridesPath = path.join(repoRoot, 'skills', 'skills-taxonomy-v2.overrides.json');
const outputPath = process.argv[2]
  ? path.resolve(process.cwd(), process.argv[2])
  : path.join(repoRoot, 'skills', 'skills-catalog-v2.json');

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'in',
  'of',
  'on',
  'the',
  'to',
  'with',
  'using',
  'use',
  'skill',
  'skills',
]);

const LEGACY_STAGE_RULES = [
  { test: /(orchestrator|route|planning|planner)/i, label: 'Stage: Orchestration' },
  { test: /(prepare|resource|bootstrap|setup|collect)/i, label: 'Stage: Resource Prep' },
  { test: /(idea|brainstorm|hypothesis)/i, label: 'Stage: Idea Generation' },
  { test: /(idea eval|evaluation|quality gate|meta-review)/i, label: 'Stage: Idea Evaluation' },
  { test: /(survey|reference|literature|search)/i, label: 'Stage: Survey' },
  { test: /(experiment|develop|training|implementation|run)/i, label: 'Stage: Experiment Dev' },
  { test: /(analysis|evaluate|benchmark|metric)/i, label: 'Stage: Analysis' },
  { test: /(paper|write|publication|report)/i, label: 'Stage: Paper Writing' },
  { test: /(reviewer|peer review|manuscript review)/i, label: 'Stage: Paper Review' },
  { test: /(overleaf|rclone|sync)/i, label: 'Stage: Publication Sync' },
];

const LEGACY_DOMAIN_RULES = [
  { test: /(medical|med|clinical|health|biomed)/i, label: 'Domain: Medical' },
  { test: /(vision|image|cv|segmentation|detection)/i, label: 'Domain: Vision' },
  { test: /(nlp|language|text|llm)/i, label: 'Domain: NLP' },
  { test: /(dataset|benchmark|corpus|data discovery)/i, label: 'Domain: Data' },
  { test: /(mcp|orchestrator|workflow|tool[- ]?use|automation|multi-agent)/i, label: 'Domain: Agent' },
];

const PATH_GROUP_LABELS = {
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

const WORD_LABELS = {
  ai: 'AI',
  cv: 'CV',
  fsdp: 'FSDP',
  llm: 'LLM',
  mlops: 'MLOps',
  nlp: 'NLP',
  rag: 'RAG',
  rl: 'RL',
};

const FACET_PREFIX_PATTERN = /^(Domain|Stage|Category|Source):\s*/i;

const PRIMARY_INTENT_BY_GROUP = {
  agents: 'deployment',
  'data-processing': 'data',
  'distributed-training': 'training',
  'emerging-techniques': 'experiment',
  evaluation: 'evaluation',
  'fine-tuning': 'training',
  'inference-serving': 'deployment',
  infrastructure: 'deployment',
  'mechanistic-interpretability': 'evaluation',
  mlops: 'evaluation',
  'model-architecture': 'experiment',
  multimodal: 'experiment',
  observability: 'evaluation',
  optimization: 'deployment',
  'post-training': 'training',
  'prompt-engineering': 'deployment',
  rag: 'deployment',
  'research-ideation': 'ideation',
  'safety-alignment': 'evaluation',
  tokenization: 'data',
};

const INTENTS_BY_GROUP = {
  agents: ['deployment'],
  'data-processing': ['data', 'experiment'],
  'distributed-training': ['training', 'experiment'],
  'emerging-techniques': ['experiment', 'training'],
  evaluation: ['evaluation', 'experiment'],
  'fine-tuning': ['training', 'experiment'],
  'inference-serving': ['deployment', 'evaluation'],
  infrastructure: ['deployment'],
  'mechanistic-interpretability': ['evaluation', 'experiment'],
  mlops: ['evaluation', 'experiment'],
  'model-architecture': ['experiment', 'training'],
  multimodal: ['experiment', 'deployment'],
  observability: ['evaluation', 'deployment'],
  optimization: ['deployment', 'training'],
  'post-training': ['training', 'evaluation'],
  'prompt-engineering': ['deployment'],
  rag: ['deployment', 'research'],
  'research-ideation': ['ideation', 'research'],
  'safety-alignment': ['evaluation', 'deployment'],
  tokenization: ['data', 'training'],
};

const COLLECTION_PRIMARY_INTENT = {
  Survey: 'research',
  'Resource Prep': 'data',
  Analysis: 'evaluation',
  'Experiment Dev': 'experiment',
  'Idea Generation': 'ideation',
  'Idea Evaluation': 'ideation',
  'Paper Review': 'evaluation',
  'Paper Writing': 'writing',
  'Publication Sync': 'writing',
  Promotion: 'writing',
  Orchestration: 'research',
  'Data & Applications': 'deployment',
  'Training & Tuning': 'training',
  'Inference & Optimization': 'deployment',
  'Evaluation & Safety': 'evaluation',
  Evaluation: 'evaluation',
  'Fine-Tuning': 'training',
  'Inference Serving': 'deployment',
  Infrastructure: 'deployment',
  'Infra & Ops': 'evaluation',
  'Mechanistic Interpretability': 'evaluation',
  'Model & Research': 'experiment',
  'Model Architecture': 'experiment',
  Multimodal: 'experiment',
  Observability: 'evaluation',
  Optimization: 'deployment',
  'Post-Training': 'training',
  RAG: 'deployment',
  Standalone: 'research',
  'Agent Frameworks': 'deployment',
  'Distributed Training': 'training',
  'Bioinformatics Init Analysis': 'data',
};

const COLLECTION_INTENTS = {
  Survey: ['research'],
  'Resource Prep': ['data', 'research'],
  Analysis: ['evaluation', 'experiment'],
  'Experiment Dev': ['experiment'],
  'Idea Generation': ['ideation', 'research'],
  'Idea Evaluation': ['ideation', 'evaluation'],
  'Paper Review': ['evaluation', 'writing'],
  'Paper Writing': ['writing', 'research'],
  'Publication Sync': ['writing', 'deployment'],
  Promotion: ['writing'],
  Orchestration: ['research', 'experiment'],
  'Evaluation & Safety': ['evaluation', 'deployment'],
};

const CAPABILITIES_BY_GROUP = {
  agents: ['agent-workflow'],
  'data-processing': ['data-processing'],
  'distributed-training': ['training-tuning', 'infrastructure-ops'],
  'emerging-techniques': ['training-tuning'],
  evaluation: ['evaluation-benchmarking'],
  'fine-tuning': ['training-tuning'],
  'inference-serving': ['inference-serving'],
  infrastructure: ['infrastructure-ops'],
  'mechanistic-interpretability': ['interpretability'],
  mlops: ['evaluation-benchmarking', 'infrastructure-ops'],
  'model-architecture': ['training-tuning'],
  multimodal: ['multimodal'],
  observability: ['evaluation-benchmarking', 'infrastructure-ops'],
  optimization: ['inference-serving'],
  'post-training': ['training-tuning'],
  'prompt-engineering': ['prompt-structured-output'],
  rag: ['search-retrieval'],
  'research-ideation': ['research-planning'],
  'safety-alignment': ['safety-alignment', 'evaluation-benchmarking'],
  tokenization: ['data-processing'],
};

const DOMAINS_BY_LEGACY_DOMAIN = {
  cs: ['cs-ai'],
  nlp: ['cs-ai', 'nlp'],
  vision: ['cs-ai', 'vision'],
  medical: ['medical'],
  'q-bio': ['bioinformatics'],
  data: ['data-engineering'],
  agent: ['general'],
  general: ['general'],
};

const TECHNICAL_GROUPS = new Set(Object.keys(PRIMARY_INTENT_BY_GROUP).filter((key) => key !== 'research-ideation'));

function compactText(input) {
  return String(input ?? '').replace(/\s+/g, ' ').trim();
}

function clampText(input, maxLength = 240) {
  const text = compactText(input);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function normalizeKey(input) {
  return compactText(input).toLowerCase();
}

function humanizeSlug(value) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => WORD_LABELS[part.toLowerCase()] ?? `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function stripFacetPrefix(label) {
  return label.replace(FACET_PREFIX_PATTERN, '').trim();
}

function normalizeList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => compactText(item)).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => compactText(item))
      .filter(Boolean);
  }
  return [];
}

function uniq(items) {
  return [...new Set(items.filter(Boolean))];
}

function extractBodyDescription(body) {
  const lines = body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => Boolean(line) && !line.startsWith('#'));

  return lines.join('\n').replace(/^[\-*+]\s+/gm, '').trim();
}

function tokenize(input) {
  return compactText(input)
    .toLowerCase()
    .split(/[^a-z0-9+]+/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 1 && !STOPWORDS.has(item));
}

function pushAll(target, items) {
  for (const item of items) {
    if (item && !target.includes(item)) {
      target.push(item);
    }
  }
}

async function collectSkillFiles(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const nextPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSkillFiles(nextPath));
      continue;
    }
    if (entry.isFile() && entry.name === 'SKILL.md') {
      files.push(nextPath);
    }
  }

  return files;
}

function buildLegacyTags(skillName, summary, frontmatter, mapping) {
  const stageTags = normalizeList(frontmatter.stage).map((value) => `Stage: ${value}`);
  const domainTags = normalizeList(frontmatter.domain).map((value) => `Domain: ${value}`);
  const metaTags = normalizeList(frontmatter.tags);
  const normalizedSkillName = normalizeKey(skillName);
  const signal = `${skillName} ${summary}`;
  const isPlatformNative = mapping.platformNativeSkills.has(normalizedSkillName);

  if (stageTags.length === 0) {
    const stageOverride = mapping.stageOverrides[normalizedSkillName]?.en;
    if (stageOverride) {
      stageTags.push(stageOverride);
    } else if (isPlatformNative) {
      const inferredStage = LEGACY_STAGE_RULES.find((rule) => rule.test.test(signal));
      if (inferredStage) {
        stageTags.push(inferredStage.label);
      }
    }
  }

  if (domainTags.length === 0) {
    const domainOverride = mapping.domainOverrides[normalizedSkillName]?.en;
    if (domainOverride) {
      domainTags.push(domainOverride);
    } else {
      const inferredDomains = LEGACY_DOMAIN_RULES
        .filter((rule) => rule.test.test(signal))
        .map((rule) => rule.label);
      domainTags.push(...inferredDomains);
    }
  }

  if (domainTags.length === 0) {
    domainTags.push('Domain: General');
  }

  if (isPlatformNative) {
    metaTags.push('Source: Dr. Claw');
  }

  return {
    stageTags: uniq(stageTags),
    domainTags: uniq(domainTags),
    metaTags: uniq(metaTags),
    isPlatformNative,
  };
}

function getTopLevelGroup(dirPath) {
  const segments = dirPath.split('/').filter(Boolean);
  if (segments.length <= 1) {
    return { key: 'standalone', label: 'Standalone' };
  }

  const key = segments[0];
  return {
    key,
    label: PATH_GROUP_LABELS[key] ?? humanizeSlug(key),
  };
}

function inferPrimaryIntent(skill, override) {
  if (override.primaryIntent) {
    return override.primaryIntent;
  }

  const groupIntent = PRIMARY_INTENT_BY_GROUP[skill.topLevelGroup.key];
  if (groupIntent) {
    return groupIntent;
  }

  return COLLECTION_PRIMARY_INTENT[skill.collection.label] ?? 'research';
}

function inferIntents(skill, primaryIntent, override) {
  if (override.intents?.length) {
    return uniq([primaryIntent, ...override.intents]).slice(0, 3);
  }

  const intents = [];
  pushAll(intents, INTENTS_BY_GROUP[skill.topLevelGroup.key] ?? []);
  pushAll(intents, COLLECTION_INTENTS[skill.collection.label] ?? []);
  pushAll(intents, [primaryIntent]);
  return intents.slice(0, 3);
}

function inferCapabilities(skill, override) {
  if (override.capabilities?.length) {
    return uniq(override.capabilities).slice(0, 3);
  }

  const capabilities = [];
  const text = normalizeKey([
    skill.name,
    skill.dirPath,
    skill.collection.label,
    skill.topLevelGroup.label,
    skill.summary,
    ...(skill.tags?.meta ?? []),
  ].join(' '));

  pushAll(capabilities, CAPABILITIES_BY_GROUP[skill.topLevelGroup.key] ?? []);

  if (/\b(orchestrator|planner|planning|brainstorm|idea|grants|prepare|roadmap)\b/.test(text)) {
    pushAll(capabilities, ['research-planning']);
  }
  if (/\b(agent|workflow|langchain|llamaindex|crewai|autogpt)\b/.test(text)) {
    pushAll(capabilities, ['agent-workflow']);
  }
  if (/\b(search|survey|retrieval|vector|citation|reference|biorxiv|literature)\b/.test(text) || /\bdataset discovery\b/.test(text)) {
    pushAll(capabilities, ['search-retrieval']);
  }
  if (/\b(data|dataset|tokenizer|tokenization|curator|ray-data|corpus|sentencepiece)\b/.test(text)) {
    pushAll(capabilities, ['data-processing']);
  }
  if (/\b(training|train|tuning|fine-tuning|finetuning|distillation|pruning|megatron|deepspeed|fsdp|lora|peft|unsloth|moe)\b/.test(text) || /\brl\b/.test(text)) {
    pushAll(capabilities, ['training-tuning']);
  }
  if (/\b(inference|serving|quantization|quantizing|gguf|gptq|hqq|awq|vllm|sglang|llama-cpp|tensorrt|flash-attention)\b/.test(text) || /\bspeculative decoding\b/.test(text)) {
    pushAll(capabilities, ['inference-serving']);
  }
  if (/\b(evaluate|evaluation|benchmark|metric|observability|review|audit|langsmith|phoenix|tensorboard|mlflow|wandb)\b/.test(text) || /\bweights and biases\b/.test(text)) {
    pushAll(capabilities, ['evaluation-benchmarking']);
  }
  if (/\b(vision|image|audio|speech|clip|llava|whisper|blip)\b/.test(text) || /\bstable diffusion\b/.test(text) || /\bsegment anything\b/.test(text)) {
    pushAll(capabilities, ['multimodal']);
  }
  if (/\b(interpretability|intervention|sae|nnsight|pyvene)\b/.test(text) || /\bsparse autoencoder\b/.test(text) || /\btransformer lens\b/.test(text)) {
    pushAll(capabilities, ['interpretability']);
  }
  if (/\b(safety|guardrails|guard|constitutional)\b/.test(text)) {
    pushAll(capabilities, ['safety-alignment']);
  }
  if (/\b(infra|ops|cloud|serverless|gpu|modal|skypilot|rclone|overleaf|deployment)\b/.test(text) || /\blambda labs\b/.test(text)) {
    pushAll(capabilities, ['infrastructure-ops']);
  }
  if (/\b(writing|presentation|figure|report|humanizer|slides|grant|manuscript)\b/.test(text)) {
    pushAll(capabilities, ['visualization-reporting']);
  }

  if (capabilities.length === 0) {
    capabilities.push('research-planning');
  }

  return capabilities.slice(0, 3);
}

function inferDomains(skill, override) {
  if (override.domains?.length) {
    return uniq(override.domains).slice(0, 3);
  }

  const domains = [];
  const legacyDomain = normalizeKey(skill.domain.label);
  const text = normalizeKey([
    skill.name,
    skill.dirPath,
    skill.collection.label,
    skill.topLevelGroup.label,
    skill.summary,
    ...(skill.tags?.meta ?? []),
  ].join(' '));

  pushAll(domains, DOMAINS_BY_LEGACY_DOMAIN[legacyDomain] ?? []);

  if (/\b(bioinformatics|genomics|biomedical|biorxiv|protein|cell|gene)\b/.test(text) || /\bsequenc/.test(text)) {
    pushAll(domains, ['bioinformatics']);
  }
  if (/\b(medical|clinical|patient|health)\b/.test(text)) {
    pushAll(domains, ['medical']);
  }
  if (/\b(vision|image|clip|llava|blip|whisper|audio|speech)\b/.test(text) || /\bstable diffusion\b/.test(text) || /\bsegment anything\b/.test(text)) {
    pushAll(domains, ['cs-ai']);
    if (/\b(vision|image|clip|llava|blip)\b/.test(text) || /\bstable diffusion\b/.test(text) || /\bsegment anything\b/.test(text)) {
      pushAll(domains, ['vision']);
    }
  }
  if (/\b(language|text|tokenizer|tokenization|nlp|llm|prompt)\b/.test(text)) {
    pushAll(domains, ['cs-ai']);
    if (/\b(language|text|tokenizer|tokenization|nlp|prompt)\b/.test(text)) {
      pushAll(domains, ['nlp']);
    }
  }
  if (/\b(dataset|curator|ray-data|qdrant|faiss|pinecone|chroma)\b/.test(text) || /\bdata processing\b/.test(text) || /\bvector database\b/.test(text)) {
    pushAll(domains, ['data-engineering']);
  }

  if (domains.length === 0) {
    if (TECHNICAL_GROUPS.has(skill.topLevelGroup.key) || skill.source === 'Imported') {
      domains.push('cs-ai');
    } else {
      domains.push('general');
    }
  }

  return domains.slice(0, 3);
}

function inferSource(skill) {
  const explicitSource = normalizeKey(skill.frontmatter?.source);
  if (explicitSource === 'vibelab' || explicitSource === 'dr-claw' || explicitSource === 'dr. claw') {
    return 'dr-claw';
  }

  const normalizedSource = normalizeKey(skill.source);
  return normalizedSource === 'vibelab' || normalizedSource === 'dr-claw' || normalizedSource === 'dr. claw'
    ? 'dr-claw'
    : 'imported';
}

function inferStatus(skill, source) {
  if (source === 'vibelab' || source === 'dr-claw') {
    return 'verified';
  }

  if (skill.topLevelGroup.key === 'standalone') {
    return 'verified';
  }

  return 'candidate';
}

function inferKeywords(skill, mapped) {
  const keywords = [];
  const explicitTags = Array.isArray(skill.frontmatter?.tags) ? skill.frontmatter.tags : [];
  const labels = [
    ...explicitTags,
    ...(skill.tags?.meta ?? []),
    skill.name,
    path.basename(skill.dirPath),
    skill.collection.label,
    skill.topLevelGroup.label,
    ...mapped.capabilities,
    ...mapped.domains,
  ];

  for (const label of labels) {
    const value = compactText(label).toLowerCase();
    if (!value || value === 'standalone' || value === 'general' || value.startsWith('source:')) {
      continue;
    }
    keywords.push(value);
  }

  for (const token of tokenize(`${skill.name} ${skill.summary}`)) {
    keywords.push(token);
  }

  return uniq(keywords).slice(0, 12);
}

function validateSkill(skill, schema) {
  const required = schema.required ?? [];
  const properties = schema.properties ?? {};
  const intentEnum = schema.$defs.intent.enum;
  const capabilityEnum = schema.$defs.capability.enum;
  const domainEnum = schema.$defs.domain.enum;

  for (const field of required) {
    if (!(field in skill)) {
      throw new Error(`Missing required field "${field}" for ${skill.name}`);
    }
  }

  if (!intentEnum.includes(skill.primaryIntent)) {
    throw new Error(`Invalid primaryIntent "${skill.primaryIntent}" for ${skill.name}`);
  }

  for (const intent of skill.intents) {
    if (!intentEnum.includes(intent)) {
      throw new Error(`Invalid intent "${intent}" for ${skill.name}`);
    }
  }

  for (const capability of skill.capabilities) {
    if (!capabilityEnum.includes(capability)) {
      throw new Error(`Invalid capability "${capability}" for ${skill.name}`);
    }
  }

  for (const domain of skill.domains) {
    if (!domainEnum.includes(domain)) {
      throw new Error(`Invalid domain "${domain}" for ${skill.name}`);
    }
  }

  if (!properties.source.enum.includes(skill.source)) {
    throw new Error(`Invalid source "${skill.source}" for ${skill.name}`);
  }

  if (!properties.status.enum.includes(skill.status)) {
    throw new Error(`Invalid status "${skill.status}" for ${skill.name}`);
  }

  if (!skill.intents.includes(skill.primaryIntent)) {
    throw new Error(`primaryIntent must be included in intents for ${skill.name}`);
  }

  if (uniq(skill.intents).length !== skill.intents.length) {
    throw new Error(`Duplicate intents for ${skill.name}`);
  }

  if (uniq(skill.capabilities).length !== skill.capabilities.length) {
    throw new Error(`Duplicate capabilities for ${skill.name}`);
  }

  if (uniq(skill.domains).length !== skill.domains.length) {
    throw new Error(`Duplicate domains for ${skill.name}`);
  }
}

function buildRelatedSkills(skills) {
  const overlapScore = (left, right) => {
    const shared = (a, b) => a.filter((item) => b.includes(item)).length;
    let score = 0;
    if (left.primaryIntent === right.primaryIntent) score += 4;
    score += shared(left.intents, right.intents) * 2;
    score += shared(left.capabilities, right.capabilities) * 3;
    score += shared(left.domains, right.domains) * 2;
    score += shared(left.keywords.slice(0, 6), right.keywords.slice(0, 6));
    return score;
  };

  for (const skill of skills) {
    skill.relatedSkills = skills
      .filter((candidate) => candidate.name !== skill.name)
      .map((candidate) => ({ name: candidate.name, score: overlapScore(skill, candidate) }))
      .filter((candidate) => candidate.score > 0)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
      .slice(0, 4)
      .map((candidate) => candidate.name);
  }
}

async function main() {
  const schema = JSON.parse(await fs.readFile(schemaPath, 'utf8'));
  const overrides = JSON.parse(await fs.readFile(overridesPath, 'utf8'));
  const mapping = JSON.parse(await fs.readFile(path.join(skillsRoot, 'skill-tag-mapping.json'), 'utf8'));
  mapping.platformNativeSkills = new Set((mapping.platformNativeSkills ?? []).map((name) => normalizeKey(name)));
  const skillFiles = (await collectSkillFiles(skillsRoot)).sort();

  const rawSkills = [];

  for (const skillFile of skillFiles) {
    const raw = await fs.readFile(skillFile, 'utf8');
    const { data, content } = matter(raw);
    const dirPath = path.relative(skillsRoot, path.dirname(skillFile)).split(path.sep).join('/');
    const name = data.name || path.basename(path.dirname(skillFile));
    const fullDescription = compactText(data.description || extractBodyDescription(content));
    const summary = clampText(fullDescription);
    const { stageTags, domainTags, metaTags, isPlatformNative } = buildLegacyTags(name, summary, data, mapping);
    const topLevelGroup = getTopLevelGroup(dirPath);
    const collectionLabel = stripFacetPrefix(stageTags[0] || topLevelGroup.label);
    const domainLabel = stripFacetPrefix(domainTags[0] || 'Domain: General');

    rawSkills.push({
      name,
      dirPath,
      skillFile: path.relative(repoRoot, skillFile).split(path.sep).join('/'),
      hasSkillMd: true,
      topLevelGroup,
      collection: {
        key: stageTags[0] ? `stage:${normalizeKey(collectionLabel)}` : `group:${topLevelGroup.key}`,
        label: collectionLabel,
      },
      domain: {
        key: `domain:${normalizeKey(domainLabel)}`,
        label: domainLabel,
      },
      source: isPlatformNative ? 'dr-claw' : 'imported',
      summary,
      fullDescription,
      tags: {
        stage: stageTags,
        domain: domainTags,
        meta: metaTags,
      },
      frontmatter: data,
    });
  }

  const mappedSkills = rawSkills.map((skill) => {
    const override = overrides[skill.name] ?? {};
    const primaryIntent = inferPrimaryIntent(skill, override);
    const source = inferSource(skill);
    const mapped = {
      name: skill.name,
      primaryIntent,
      intents: inferIntents(skill, primaryIntent, override),
      capabilities: inferCapabilities(skill, override),
      domains: inferDomains(skill, override),
      keywords: [],
      source,
      status: override.status ?? inferStatus(skill, source),
      summary: compactText(skill.summary || skill.fullDescription),
      legacy: {
        dirPath: skill.dirPath,
        skillFile: skill.skillFile,
        topLevelGroup: skill.topLevelGroup.label,
        collection: skill.collection.label,
        domain: skill.domain.label,
      },
    };

    mapped.keywords = inferKeywords(skill, mapped);

    const owner = compactText(skill.frontmatter?.metadata?.author || skill.frontmatter?.author);
    if (owner) {
      mapped.owner = owner;
    }

    validateSkill(mapped, schema);
    return mapped;
  });

  buildRelatedSkills(mappedSkills);

  for (const skill of mappedSkills) {
    validateSkill(skill, schema);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    schema: 'skills-taxonomy-v2',
    totalSkills: mappedSkills.length,
    skills: mappedSkills,
  };

  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${mappedSkills.length} mapped skills to ${path.relative(repoRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
