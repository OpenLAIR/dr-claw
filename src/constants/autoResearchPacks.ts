export type LocaleKey = 'zh' | 'en' | 'ko';

export type PackConfigOption = {
  key: string;
  label: string;
  install?: string;
  register?: string;
  envVars: Array<{ name: string; example: string }>;
};

export type PackGpuOption = {
  key: string;
  label: string;
  template: string;
  note?: string;
};

export type PackWorkflow = {
  name: string;
  command: string;
  description: Record<LocaleKey, string>;
};

export type PackDef = {
  name: string;
  description: Record<LocaleKey, string>;
  skills: string[];
  workflows: PackWorkflow[];
  mcp: PackConfigOption[];
  gpu: PackGpuOption[];
  setupScript: string;
  repoUrl?: string;
  configLabel?: Record<LocaleKey, { title: string; desc: string }>;
};

export const AUTO_RESEARCH_PACKS: PackDef[] = [
  {
    name: 'Dr. Claw',
    description: {
      zh: '自研全流程研究工具包，覆盖完整研究生命周期的 16 个技能：从课题规划、文献调研、实验开发到论文撰写与投稿。',
      en: '16 in-house skills covering the full research lifecycle: from project planning, literature survey, experiment development to paper writing and submission.',
      ko: '16 in-house skills covering the full research lifecycle: planning, survey, experiments, paper writing.',
    },
    skills: [
      'inno-pipeline-planner',
      'inno-prepare-resources',
      'inno-idea-generation',
      'inno-idea-eval',
      'inno-deep-research',
      'inno-code-survey',
      'inno-experiment-dev',
      'inno-experiment-analysis',
      'inno-paper-writing',
      'inno-paper-reviewer',
      'inno-humanizer',
      'inno-reference-audit',
      'inno-figure-gen',
      'inno-rclone-to-overleaf',
      'inno-rebuttal',
      'inno-grant-proposal',
    ],
    workflows: [
      { name: 'Pipeline Planner', command: '/inno-pipeline-planner', description: { zh: '交互式项目定义 → research_brief.json + tasks.json', en: 'Interactive project definition → research_brief.json + tasks.json', ko: 'Interactive project definition → research_brief.json + tasks.json' } },
      { name: 'Deep Research', command: '/inno-deep-research', description: { zh: '综合多源文献调研', en: 'Comprehensive multi-source literature survey', ko: 'Comprehensive multi-source literature survey' } },
      { name: 'Idea Generation', command: '/inno-idea-generation', description: { zh: 'SCAMPER/SWOT 结构化头脑风暴', en: 'Structured brainstorming with SCAMPER/SWOT frameworks', ko: 'Structured brainstorming with SCAMPER/SWOT' } },
      { name: 'Experiment Dev', command: '/inno-experiment-dev', description: { zh: '实现 + Judge 反馈循环', en: 'Implementation + judge feedback loop', ko: 'Implementation + judge feedback loop' } },
      { name: 'Paper Writing', command: '/inno-paper-writing', description: { zh: 'IEEE/ACM 学术论文撰写', en: 'IEEE/ACM academic paper writing', ko: 'IEEE/ACM academic paper writing' } },
      { name: 'Paper Review', command: '/inno-paper-reviewer', description: { zh: '清单式论文审阅', en: 'Checklist-based paper review', ko: 'Checklist-based paper review' } },
      { name: 'Rebuttal', command: '/inno-rebuttal', description: { zh: '学术反驳信撰写', en: 'Academic rebuttal drafting', ko: 'Academic rebuttal drafting' } },
      { name: 'Figure Gen', command: '/inno-figure-gen', description: { zh: 'Gemini 图像生成/编辑', en: 'Gemini image generation/editing', ko: 'Gemini image generation/editing' } },
    ],
    mcp: [
      { key: 'gemini-figure', label: 'Gemini (Figure Gen)', envVars: [{ name: 'GEMINI_API_KEY', example: 'your-gemini-api-key' }] },
    ],
    configLabel: {
      zh: { title: '① 环境变量', desc: '配置图片生成所需的 API Key' },
      en: { title: '① Environment', desc: 'API key required for image generation' },
      ko: { title: '① Environment', desc: 'API key for image generation' },
    },
    gpu: [],
    setupScript: '',
  },
  {
    name: 'ARIS',
    repoUrl: 'https://github.com/wanshuiyin/Auto-claude-code-research-in-sleep',
    description: {
      zh: '跨模型对抗审稿的端到端自动研究流水线。Claude 执行，GPT/Gemini 审稿，避免自我审查盲区。',
      en: 'End-to-end autonomous research pipeline with cross-model adversarial review. Claude executes, GPT/Gemini reviews.',
      ko: 'Cross-model adversarial review pipeline. Claude executes, GPT/Gemini reviews.',
    },
    skills: ['aris-research-pipeline', 'aris-idea-discovery', 'aris-experiment-bridge', 'aris-auto-review-loop', 'aris-paper-writing', 'aris-rebuttal', 'aris-meta-optimize', 'aris-meta-apply'],
    workflows: [
      { name: 'Full Pipeline', command: '/aris-research-pipeline', description: { zh: 'Idea → 实验 → 审稿 → 论文', en: 'Idea → Experiment → Review → Paper', ko: 'Idea → Experiment → Review → Paper' } },
      { name: 'Idea Discovery', command: '/aris-idea-discovery', description: { zh: '文献调研 + 想法生成 + 新颖性验证', en: 'Literature + Idea gen + Novelty check', ko: 'Literature + Idea gen + Novelty check' } },
      { name: 'Auto Review', command: '/aris-auto-review-loop', description: { zh: '跨模型多轮对抗审稿', en: 'Cross-model multi-round review', ko: 'Cross-model multi-round review' } },
      { name: 'Paper Writing', command: '/aris-paper-writing', description: { zh: '提纲 → 图表 → LaTeX → 编译', en: 'Outline → Figures → LaTeX → Compile', ko: 'Outline → Figures → LaTeX → Compile' } },
      { name: 'Experiment', command: '/aris-experiment-bridge', description: { zh: '实现实验 + 部署到 GPU', en: 'Implement + Deploy to GPU', ko: 'Implement + Deploy to GPU' } },
      { name: 'Rebuttal', command: '/aris-rebuttal', description: { zh: '解析审稿意见 + 起草反驳信', en: 'Parse reviews + Draft rebuttal', ko: 'Parse reviews + Draft rebuttal' } },
      { name: 'Meta Optimize', command: '/aris-meta-optimize', description: { zh: 'Workflow M：分析使用日志 → 建议优化（需单独人工应用）', en: 'Workflow M: usage logs → improvement proposals (separate human-gated apply)', ko: 'Workflow M: 사용 로그 분석 → 개선 제안 (별도 사용자 승인 적용)' } },
    ],
    mcp: [
      { key: 'codex', label: 'Codex (capability-gated)', install: 'npm install -g @openai/codex', register: 'claude mcp add codex -s user -- python3 "$(pwd)/skills/aris-infra/mcp-servers/codex-exec/server.py"', envVars: [{ name: 'OPENAI_API_KEY', example: 'sk-proj-...' }] },
      { key: 'llm-chat', label: 'Generic LLM', register: 'claude mcp add llm-chat -s user -- python3 skills/aris-infra/mcp-servers/llm-chat/server.py', envVars: [{ name: 'LLM_API_KEY', example: 'your-api-key' }, { name: 'LLM_BASE_URL', example: 'https://api.openai.com/v1' }, { name: 'LLM_MODEL', example: 'gpt-4o' }] },
      { key: 'gemini', label: 'Gemini', register: 'claude mcp add gemini-review -s user -- python3 skills/aris-infra/mcp-servers/gemini-review/server.py', envVars: [{ name: 'GEMINI_API_KEY', example: 'your-gemini-key' }] },
    ],
    gpu: [
      { key: 'local', label: 'Local GPU', template: '## Local Environment\n- gpu: local\n- Mac MPS / Linux CUDA' },
      { key: 'remote', label: 'Remote SSH', template: '## Remote Server\n- gpu: remote\n- SSH: `ssh my-gpu-server`\n- GPU: 4x A100 (80GB each)\n- Conda: `conda activate research`\n- Code dir: `/home/user/experiments/`\n- code_sync: rsync', note: 'Edit SSH, GPU, conda, code dir to match your server.' },
      { key: 'vast', label: 'Vast.ai', template: '## Vast.ai\n- gpu: vast\n- auto_destroy: true\n- max_budget: 5.00', note: 'Run: pip install vastai && vastai set api-key YOUR_KEY' },
      { key: 'modal', label: 'Modal', template: '## Modal\n- gpu: modal\n- modal_timeout: 21600', note: 'Run: pip install modal && modal setup' },
    ],
    setupScript: 'bash skills/aris-infra/setup.sh',
  },
  {
    name: 'Autoresearch',
    repoUrl: 'https://github.com/uditgoenka/autoresearch',
    description: {
      zh: '基于 Karpathy 原则的自治迭代引擎。9 个子命令。零依赖。',
      en: 'Autonomous goal-directed iteration engine. 9 subcommands. Zero dependencies.',
      ko: 'Autonomous goal-directed iteration engine. 9 subcommands. Zero dependencies.',
    },
    skills: ['autoresearch'],
    workflows: [
      { name: 'Auto Loop', command: '/autoresearch', description: { zh: '修改 → 验证 → 保留/丢弃', en: 'Modify → Verify → Keep/Discard', ko: 'Modify → Verify → Keep/Discard' } },
      { name: 'Plan', command: '/autoresearch:plan', description: { zh: '目标 → 指标 → 配置向导', en: 'Goal → Metric → Config wizard', ko: 'Goal → Metric → Config wizard' } },
      { name: 'Debug', command: '/autoresearch:debug', description: { zh: '自动 Bug 猎手', en: 'Bug hunter', ko: 'Bug hunter' } },
      { name: 'Fix', command: '/autoresearch:fix', description: { zh: '自动修复', en: 'Error crusher', ko: 'Error crusher' } },
      { name: 'Security', command: '/autoresearch:security', description: { zh: 'STRIDE + OWASP', en: 'STRIDE + OWASP', ko: 'STRIDE + OWASP' } },
      { name: 'Ship', command: '/autoresearch:ship', description: { zh: '发布工作流', en: 'Shipping workflow', ko: 'Shipping workflow' } },
    ],
    mcp: [],
    gpu: [],
    setupScript: '',
  },
  {
    name: 'DeepScientist',
    repoUrl: 'https://github.com/ResearAI/DeepScientist',
    description: {
      zh: 'ICLR 2026 发布的自主研究操作系统。13 个阶段技能覆盖完整研究生命周期，含 50+ 参考模板。每个研究项目是一个 Git 仓库。',
      en: 'Autonomous research OS from ICLR 2026. 13 stage skills covering the full research lifecycle with 50+ reference templates. Each project is a Git repo.',
      ko: 'Autonomous research OS. 13 stage skills, 50+ reference templates.',
    },
    skills: ['ds-full-pipeline', 'ds-scout', 'ds-baseline', 'ds-idea', 'ds-experiment', 'ds-analysis-campaign', 'ds-optimize', 'ds-write', 'ds-review', 'ds-rebuttal', 'ds-figure-polish', 'ds-finalize', 'ds-decision', 'ds-intake-audit'],
    workflows: [
      { name: 'Full Pipeline', command: '/ds-full-pipeline', description: { zh: '调研 → Baseline → Idea → 实验 → 分析 → 论文', en: 'Scout → Baseline → Idea → Experiment → Analysis → Paper', ko: 'Scout → Baseline → Idea → Experiment → Paper' } },
      { name: 'Scout', command: '/ds-scout', description: { zh: '文献调研 + 问题定义 + Baseline 发现', en: 'Literature + problem framing + baseline discovery', ko: 'Literature + problem framing' } },
      { name: 'Idea', command: '/ds-idea', description: { zh: '假设生成 + 方向选择', en: 'Hypothesis generation + direction selection', ko: 'Hypothesis generation' } },
      { name: 'Experiment', command: '/ds-experiment', description: { zh: '主实验实现 + 运行', en: 'Main experiment implementation + run', ko: 'Main experiment' } },
      { name: 'Write', command: '/ds-write', description: { zh: '论文撰写（含 LaTeX 模板）', en: 'Paper writing with LaTeX templates', ko: 'Paper writing' } },
      { name: 'Review', command: '/ds-review', description: { zh: '模拟同行评审', en: 'Simulated peer review', ko: 'Peer review' } },
    ],
    mcp: [],
    gpu: [],
    setupScript: '',
  },
];
