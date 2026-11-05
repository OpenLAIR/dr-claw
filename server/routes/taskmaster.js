/**
 * TASKMASTER API ROUTES
 * ====================
 * 
 * This module provides API endpoints for TaskMaster integration including:
 * - .pipeline folder detection in project directories
 * - MCP server configuration detection
 * - TaskMaster state and metadata management
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { promises as fsPromises } from 'fs';
import { fileURLToPath } from 'url';
import { extractProjectDirectory } from '../projects.js';
import { detectTaskMasterMCPServer } from '../utils/mcp-detector.js';
import { broadcastTaskMasterProjectUpdate, broadcastTaskMasterTasksUpdate } from '../utils/taskmaster-websocket.js';

const router = express.Router();
const PIPELINE_DIR = '.pipeline';
const LEGACY_TASKMASTER_DIR = '.taskmaster';
const DEFAULT_TASKS_TAG = 'master';
const DEFAULT_RESEARCH_BRIEF_FILENAME = 'research_brief.json';
const DEFAULT_MAX_TASKS = 30;
const STAGE_ORDER = ['survey', 'ideation', 'experiment', 'publication', 'promotion'];
const STAGE_LABELS = {
    survey: 'Survey',
    ideation: 'Ideation',
    experiment: 'Experiment',
    publication: 'Publication',
    promotion: 'Promotion',
    presentation: 'Promotion',
};
const STAGE_PROMPT_HINTS = {
    survey: 'Establish the literature baseline, collect evidence, and map open gaps before committing to a direction.',
    ideation: 'Clarify thesis, scope boundaries, and evidence framing before execution.',
    experiment: 'Turn assumptions into an executable protocol with measurable validation criteria.',
    publication: 'Convert outcomes into a coherent manuscript narrative with concrete submission artifacts.',
    promotion: 'Transform research outcomes into homepage assets, visual slides, narration scripts, and demo videos.',
};
const DEFAULT_STAGE_SKILL_MAP = {
    survey: {
        base: ['inno-deep-research', 'academic-researcher', 'dataset-discovery'],
        byTaskType: {
            exploration: ['inno-deep-research', 'academic-researcher', 'dataset-discovery'],
            analysis: ['inno-deep-research', 'academic-researcher'],
        },
    },
    ideation: {
        base: ['inno-pipeline-planner', 'inno-idea-generation', 'inno-prepare-resources'],
        byTaskType: {
            analysis: ['inno-idea-generation', 'academic-researcher'],
            exploration: ['inno-idea-generation', 'inno-code-survey'],
        },
    },
    experiment: {
        base: ['inno-code-survey', 'inno-experiment-dev', 'inno-experiment-analysis'],
        byTaskType: {
            implementation: ['inno-experiment-dev'],
            analysis: ['inno-experiment-analysis'],
            exploration: ['inno-code-survey'],
        },
    },
    publication: {
        base: ['ml-paper-writing', 'inno-reference-audit', 'inno-rclone-to-overleaf'],
        byTaskType: {
            writing: ['ml-paper-writing'],
            analysis: ['inno-reference-audit'],
        },
    },
    promotion: {
        base: ['making-academic-presentations'],
        byTaskType: {
            scripting: ['making-academic-presentations'],
            rendering: ['making-academic-presentations'],
            narration: ['making-academic-presentations'],
            delivery: ['making-academic-presentations'],
        },
    },
};
const DEFAULT_BRIEF_SECTIONS = {
    survey: {
        literature_scope: '',
        key_references: [],
        synthesis_summary: '',
        open_gaps: [],
    },
    ideation: {
        research_goal: '',
        problem_framing: '',
        evidence_plan: '',
        success_criteria: [],
    },
    experiment: {
        hypothesis_or_validation_goal: '',
        dataset_or_data_source: '',
        method_or_protocol: '',
        evaluation_plan: '',
    },
    publication: {
        paper_outline: '',
        figures_tables_plan: '',
        artifact_plan: '',
        submission_checklist: [],
    },
    promotion: {
        slide_outline: '',
        deck_style: '',
        tts_config: '',
        video_assembly_plan: '',
        homepage_plan: '',
    },
};
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = path.resolve(__dirname, '..', '..', 'skills');
const STAGE_SKILL_MAP_PATH = path.join(SKILLS_DIR, 'stage-skill-map.json');
let cachedStageSkillMap = null;
let cachedStageSkillMapMtimeMs = null;
function normalizeStageSkillMap(rawMap = {}) {
    const normalized = {};
    STAGE_ORDER.forEach((stage) => {
        const source = rawMap?.[stage]
            || (stage === 'promotion' ? rawMap?.presentation : null)
            || {};
        normalized[stage] = {
            base: Array.isArray(source.base) ? source.base.map((item) => String(item || '').trim()).filter(Boolean) : [],
            byTaskType: source.byTaskType && typeof source.byTaskType === 'object'
                ? Object.fromEntries(
                    Object.entries(source.byTaskType).map(([taskType, skills]) => [
                        String(taskType || '').trim(),
                        Array.isArray(skills) ? skills.map((item) => String(item || '').trim()).filter(Boolean) : [],
                    ]),
                )
                : {},
        };
        if (normalized[stage].base.length === 0) {
            normalized[stage].base = DEFAULT_STAGE_SKILL_MAP[stage]?.base || [];
        }
    });
    return normalized;
}

function getStageSkillMap() {
    try {
        const stats = fs.statSync(STAGE_SKILL_MAP_PATH);
        if (
            cachedStageSkillMap &&
            typeof cachedStageSkillMapMtimeMs === 'number' &&
            cachedStageSkillMapMtimeMs === stats.mtimeMs
        ) {
            return cachedStageSkillMap;
        }

        const content = fs.readFileSync(STAGE_SKILL_MAP_PATH, 'utf8');
        const parsed = JSON.parse(content);
        cachedStageSkillMap = normalizeStageSkillMap(parsed);
        cachedStageSkillMapMtimeMs = stats.mtimeMs;
        return cachedStageSkillMap;
    } catch (error) {
        if (!cachedStageSkillMap) {
            cachedStageSkillMap = normalizeStageSkillMap(DEFAULT_STAGE_SKILL_MAP);
        }
        return cachedStageSkillMap;
    }
}

function buildDefaultBriefPipeline(stageSkillMap) {
    const map = stageSkillMap || getStageSkillMap();
    return {
        version: '1.1',
        mode: 'idea',
        stages: {
            survey: {
                required_elements: [
                    'sections.survey.literature_scope',
                    'sections.survey.synthesis_summary',
                ],
                optional_elements: [
                    'sections.survey.key_references',
                    'sections.survey.open_gaps',
                ],
                quality_gate: [
                    'The literature scope is explicit and bounded',
                    'The synthesis identifies concrete open gaps or unresolved tensions',
                ],
                task_blueprints: [
                    {
                        id: 'survey_collect_references',
                        title: 'Collect and triage the core literature set',
                        description: 'Assemble the most relevant references, group them by theme, and note inclusion boundaries.',
                        taskType: 'exploration',
                    },
                    {
                        id: 'survey_summarize_gaps',
                        title: 'Summarize trends, baselines, and open gaps',
                        description: 'Write a compact synthesis of what is known, what is contested, and where the project can contribute.',
                        taskType: 'analysis',
                    },
                ],
                recommended_skills: map.survey.base,
            },
            ideation: {
                required_elements: [
                    'sections.ideation.research_goal',
                    'sections.ideation.problem_framing',
                ],
                optional_elements: [
                    'sections.ideation.evidence_plan',
                    'sections.ideation.success_criteria',
                ],
                quality_gate: [
                    'At least one clear research direction is defined',
                    'Problem framing and expected value are specific',
                ],
                task_blueprints: [
                    {
                        id: 'ideation_generate_candidates',
                        title: 'Generate and compare candidate research directions',
                        description: 'Produce multiple candidate directions and compare novelty, feasibility, and expected impact.',
                        taskType: 'exploration',
                    },
                    {
                        id: 'ideation_select_direction',
                        title: 'Select one direction with explicit rationale',
                        description: 'Pick one direction and document tradeoffs and scope boundaries.',
                        taskType: 'analysis',
                    },
                ],
                recommended_skills: map.ideation.base,
            },
            experiment: {
                required_elements: [
                    'sections.experiment.hypothesis_or_validation_goal',
                    'sections.experiment.method_or_protocol',
                    'sections.experiment.evaluation_plan',
                ],
                optional_elements: [
                    'sections.experiment.dataset_or_data_source',
                ],
                quality_gate: [
                    'Validation goal can be measured objectively',
                    'Method and evaluation protocol are executable',
                ],
                task_blueprints: [
                    {
                        id: 'experiment_define_protocol',
                        title: 'Define executable experiment protocol',
                        description: 'Translate method and evaluation plan into executable steps and checkpoints.',
                        taskType: 'implementation',
                    },
                    {
                        id: 'experiment_run_analysis',
                        title: 'Run baseline analysis and record outcomes',
                        description: 'Execute baseline validation and summarize key findings and gaps.',
                        taskType: 'analysis',
                    },
                ],
                recommended_skills: map.experiment.base,
            },
            publication: {
                required_elements: [
                    'sections.publication.paper_outline',
                    'sections.publication.submission_checklist',
                ],
                optional_elements: [
                    'sections.publication.figures_tables_plan',
                    'sections.publication.artifact_plan',
                ],
                quality_gate: [
                    'Contribution narrative and structure are coherent',
                    'Submission checklist and artifacts are complete',
                ],
                task_blueprints: [
                    {
                        id: 'publication_outline_to_draft',
                        title: 'Expand outline into draft sections',
                        description: 'Convert paper outline into structured draft sections with claim-evidence alignment.',
                        taskType: 'writing',
                    },
                    {
                        id: 'publication_finalize_artifacts',
                        title: 'Finalize figures, tables, and artifacts',
                        description: 'Prepare final visuals and reproducibility artifacts required for submission.',
                        taskType: 'writing',
                    },
                ],
                recommended_skills: map.publication.base,
            },
            promotion: {
                required_elements: [
                    'sections.promotion.slide_outline',
                ],
                optional_elements: [
                    'sections.promotion.deck_style',
                    'sections.promotion.tts_config',
                    'sections.promotion.video_assembly_plan',
                    'sections.promotion.homepage_plan',
                ],
                quality_gate: [
                    'Slide outline and homepage plan cover key paper contributions',
                    'Deck style defined for visual consistency',
                ],
                task_blueprints: [
                    {
                        id: 'promotion_draft_outline',
                        title: 'Draft slide outline and narration scripts',
                        description: 'Create per-slide content plan with talking points based on paper contributions.',
                        taskType: 'scripting',
                    },
                    {
                        id: 'promotion_prepare_homepage',
                        title: 'Prepare research homepage content and assets',
                        description: 'Organize homepage sections, key visuals, and links for project promotion.',
                        taskType: 'delivery',
                    },
                    {
                        id: 'promotion_generate_slides',
                        title: 'Generate slide images from outline and paper figures',
                        description: 'Use nanobanana to render slide images, preferring /edit on existing HQ paper figures.',
                        taskType: 'rendering',
                    },
                    {
                        id: 'promotion_generate_narration',
                        title: 'Generate TTS audio for slide narration',
                        description: 'Generate one audio file per slide using edge-tts (default), Kokoro (offline), or ElevenLabs (premium).',
                        taskType: 'narration',
                    },
                ],
                recommended_skills: map.promotion?.base || map.presentation?.base || ['making-academic-presentations'],
            },
        },
    };
}
const TEMPLATES_DIR = path.resolve(__dirname, '..', 'taskmaster-templates');
const DEFAULT_PIPELINE_CONFIG = {
    version: '1.0',
    provider: 'dr-claw-web',
    initializedAt: new Date().toISOString(),
};
let cachedTemplates = null;

function getPipelinePaths(projectPath) {
    const pipelineRoot = path.join(projectPath, PIPELINE_DIR);
    return {
        root: pipelineRoot,
        tasksDir: path.join(pipelineRoot, 'tasks'),
        tasksFile: path.join(pipelineRoot, 'tasks', 'tasks.json'),
        docsDir: path.join(pipelineRoot, 'docs'),
        configFile: path.join(pipelineRoot, 'config.json'),
        legacyRoot: path.join(projectPath, LEGACY_TASKMASTER_DIR),
    };
}

async function pathExists(filePath) {
    try {
        await fsPromises.access(filePath);
        return true;
    } catch {
        return false;
    }
}

async function migrateLegacyTaskmasterIfNeeded(projectPath) {
    const paths = getPipelinePaths(projectPath);
    const hasPipeline = await pathExists(paths.root);
    const hasLegacy = await pathExists(paths.legacyRoot);
    if (hasPipeline || !hasLegacy) {
        return;
    }

    await fsPromises.cp(paths.legacyRoot, paths.root, { recursive: true, force: false });
}

async function ensurePipelineInitialized(projectPath) {
    const paths = getPipelinePaths(projectPath);
    await migrateLegacyTaskmasterIfNeeded(projectPath);
    await fsPromises.mkdir(paths.tasksDir, { recursive: true });
    await fsPromises.mkdir(paths.docsDir, { recursive: true });

    if (!(await pathExists(paths.configFile))) {
        await fsPromises.writeFile(paths.configFile, `${JSON.stringify(DEFAULT_PIPELINE_CONFIG, null, 2)}\n`, 'utf8');
    }

    if (!(await pathExists(paths.tasksFile))) {
        const initial = { [DEFAULT_TASKS_TAG]: { tasks: [] } };
        await fsPromises.writeFile(paths.tasksFile, `${JSON.stringify(initial, null, 2)}\n`, 'utf8');
    }

    return paths;
}

function extractTasksFromData(tasksData) {
    let currentTag = DEFAULT_TASKS_TAG;
    let tasks = [];

    if (Array.isArray(tasksData)) {
        tasks = tasksData;
    } else if (tasksData?.tasks) {
        tasks = tasksData.tasks;
    } else if (tasksData && typeof tasksData === 'object') {
        if (tasksData[currentTag]?.tasks) {
            tasks = tasksData[currentTag].tasks;
        } else if (tasksData.master?.tasks) {
            tasks = tasksData.master.tasks;
            currentTag = 'master';
        } else {
            const firstTag = Object.keys(tasksData).find((key) => Array.isArray(tasksData[key]?.tasks));
            if (firstTag) {
                currentTag = firstTag;
                tasks = tasksData[firstTag].tasks;
            }
        }
    }

    return { tasks: Array.isArray(tasks) ? tasks : [], currentTag };
}

function normalizeTask(task) {
    const now = new Date().toISOString();
    const stage = normalizeStageName(task.stage);
    return {
        id: task.id,
        title: task.title || 'Untitled Task',
        description: task.description || '',
        status: normalizeTaskStatus(task.status),
        priority: task.priority || 'medium',
        dependencies: Array.isArray(task.dependencies) ? task.dependencies : [],
        createdAt: task.createdAt || task.created || now,
        updatedAt: task.updatedAt || task.updated || now,
        details: task.details || '',
        testStrategy: task.testStrategy || task.test_strategy || '',
        subtasks: Array.isArray(task.subtasks) ? task.subtasks : [],
        stage: stage || undefined,
        taskType: task.taskType || 'implementation',
        inputsNeeded: Array.isArray(task.inputsNeeded) ? task.inputsNeeded.filter(Boolean) : [],
        suggestedSkills: Array.isArray(task.suggestedSkills) ? task.suggestedSkills.filter(Boolean) : [],
        sourceBlueprintId: task.sourceBlueprintId || '',
        nextActionPrompt: typeof task.nextActionPrompt === 'string' ? task.nextActionPrompt : '',
    };
}

function normalizeTaskStatus(status) {
    const raw = String(status || '').trim().toLowerCase();
    if (!raw) return 'pending';
    if (raw === 'completed' || raw === 'complete') return 'done';
    if (raw === 'in_progress' || raw === 'inprogress') return 'in-progress';
    if (raw === 'todo' || raw === 'open') return 'pending';
    return raw;
}

async function readTasksFile(tasksFilePath) {
    const content = await fsPromises.readFile(tasksFilePath, 'utf8');
    const parsed = JSON.parse(content);
    const { tasks, currentTag } = extractTasksFromData(parsed);
    return {
        raw: parsed,
        currentTag,
        tasks: tasks.map(normalizeTask),
    };
}

async function writeTasksFile(tasksFilePath, tasks, currentTag = DEFAULT_TASKS_TAG) {
    const payload = { [currentTag]: { tasks } };
    await fsPromises.writeFile(tasksFilePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function generateTaskId(tasks) {
    const numericIds = tasks
        .map((task) => Number(task.id))
        .filter((value) => Number.isFinite(value));
    if (numericIds.length === 0) {
        return 1;
    }
    return Math.max(...numericIds) + 1;
}

/**
 * Reassign all task IDs sequentially (1, 2, 3, ...) following global stage order.
 * Preserves array order within each stage group and remaps dependency references.
 */
function reindexTasks(tasks) {
    const staged = {};
    STAGE_ORDER.forEach((s) => { staged[s] = []; });
    const unassigned = [];

    for (const task of tasks) {
        const s = normalizeStageName(task.stage);
        if (s && staged[s]) {
            staged[s].push(task);
        } else {
            unassigned.push(task);
        }
    }

    const ordered = [];
    STAGE_ORDER.forEach((s) => { ordered.push(...staged[s]); });
    ordered.push(...unassigned);

    const idMap = {};
    ordered.forEach((task, idx) => {
        idMap[String(task.id)] = idx + 1;
    });

    return ordered.map((task, idx) => ({
        ...task,
        id: idx + 1,
        dependencies: Array.isArray(task.dependencies)
            ? task.dependencies
                .map((dep) => idMap[String(dep)])
                .filter(Boolean)
            : [],
        updatedAt: new Date().toISOString(),
    }));
}

function splitPromptToTitle(prompt) {
    const cleaned = String(prompt || '').replace(/\s+/g, ' ').trim();
    if (!cleaned) {
        return 'Untitled Task';
    }
    return cleaned.length > 120 ? `${cleaned.slice(0, 117)}...` : cleaned;
}

function assignPath(target, dottedPath, value) {
    const keys = String(dottedPath || '').split('.').filter(Boolean);
    if (keys.length === 0) return;
    let cursor = target;
    for (let i = 0; i < keys.length - 1; i += 1) {
        const key = keys[i];
        if (!cursor[key] || typeof cursor[key] !== 'object' || Array.isArray(cursor[key])) {
            cursor[key] = {};
        }
        cursor = cursor[key];
    }
    cursor[keys[keys.length - 1]] = value;
}

function toTaskCandidate(raw) {
    const value = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!value) return null;
    return value.length > 180 ? `${value.slice(0, 177)}...` : value;
}

function isPlaceholderLikeValue(value = '') {
    const normalized = String(value).trim().toLowerCase();
    if (!normalized) return true;
    const blocked = new Set([
        'none', 'null', 'n/a', 'na', 'todo', 'tbd', 'unknown', 'not sure', '-',
        '[]', '{}', 'placeholder',
    ]);
    return blocked.has(normalized);
}

function buildFallbackTaskCandidates(briefData = {}) {
    const title = String(briefData?.meta?.title || '').trim();
    const target = title ? ` for "${title}"` : '';
    return [
        `Finalize Survey section${target}: define literature scope, summarize prior work, and record open gaps.`,
        `Finalize Ideation section${target}: clarify research goal, framing, and evidence plan.`,
        `Define Experiment section${target}: specify validation goal, protocol, and evaluation plan.`,
        `Prepare Publication section${target}: draft paper outline, figures/tables plan, and submission checklist.`,
        `Create Promotion section${target}: draft homepage plan, slide outline, deck style, TTS config, and video assembly plan.`,
    ];
}

function buildPipelineSkeletonCandidates(briefData = {}) {
    const title = String(briefData?.meta?.title || '').trim();
    const target = title ? ` (${title})` : '';
    return [
        `Survey: define literature scope and search boundary${target}.`,
        `Survey: synthesize key baselines, trends, and open gaps${target}.`,
        `Ideation: clarify problem framing and research goal${target}.`,
        `Ideation: collect key evidence and references${target}.`,
        `Ideation: define measurable success criteria${target}.`,
        `Experiment: define validation hypothesis and evaluation criteria${target}.`,
        `Experiment: prepare data source and method/protocol plan${target}.`,
        `Experiment: execute baseline validation and analyze results${target}.`,
        `Publication: draft paper outline and contribution boundaries${target}.`,
        `Publication: prepare figures/tables and artifact appendix${target}.`,
        `Publication: complete submission checklist and final review${target}.`,
        `Promotion: prepare project homepage structure and assets${target}.`,
        `Promotion: draft slide outline and narration scripts${target}.`,
        `Promotion: generate slide images from paper figures${target}.`,
        `Promotion: generate TTS audio and assemble demo video${target}.`,
    ];
}

function parseBriefJsonToTaskCandidates(briefData = {}) {
    const candidates = [];
    const sectionOrder = ['ideation', 'experiment', 'publication', 'promotion', 'presentation'];
    const sectionData = briefData?.sections && typeof briefData.sections === 'object'
        ? briefData.sections
        : {};

    sectionOrder.forEach((sectionName) => {
        const fields = sectionData[sectionName];
        if (!fields || typeof fields !== 'object') return;
        Object.values(fields).forEach((value) => {
            if (Array.isArray(value)) {
                value.forEach((item) => {
                    const normalized = toTaskCandidate(item);
                    if (normalized) candidates.push(normalized);
                });
                return;
            }
            const normalized = toTaskCandidate(value);
            if (normalized && !isPlaceholderLikeValue(normalized)) candidates.push(normalized);
        });
    });

    const dynamic = [...new Set(candidates)];
    const skeleton = buildPipelineSkeletonCandidates(briefData);
    const fallback = dynamic.length > 0 ? [] : buildFallbackTaskCandidates(briefData);
    return [...new Set([...skeleton, ...dynamic, ...fallback])];
}

function inferStageFromCandidate(text = '') {
    const value = String(text || '').toLowerCase();
    if (value.includes('ideation')) return 'ideation';
    if (value.includes('experiment') || value.includes('validation') || value.includes('baseline')) return 'experiment';
    if (value.includes('publication') || value.includes('paper') || value.includes('submission')) return 'publication';
    if (
        value.includes('promotion')
        || value.includes('presentation')
        || value.includes('slide')
        || value.includes('deck')
        || value.includes('demo video')
        || value.includes('homepage')
    ) return 'promotion';
    return null;
}

function normalizeStageName(stage) {
    const value = String(stage || '').trim().toLowerCase();
    if (value === 'presentation') return 'promotion';
    if (value === 'research') return 'survey';
    if (value === 'survey' || value === 'ideation' || value === 'experiment' || value === 'publication' || value === 'promotion') {
        return value;
    }
    return null;
}

function titleFromBlueprintId(sourceBlueprintId = '', stage = '') {
    const cleaned = String(sourceBlueprintId || '').replace(/[_-]+/g, ' ').trim();
    const title = cleaned
        ? cleaned.replace(/\b\w/g, (ch) => ch.toUpperCase())
        : `Execute ${STAGE_LABELS[stage] || 'Pipeline'} task`;
    return title.length > 120 ? `${title.slice(0, 117)}...` : title;
}

function getValueByPath(target, dottedPath) {
    if (!target || typeof target !== 'object') return undefined;
    const keys = String(dottedPath || '').split('.').filter(Boolean);
    if (keys.length === 0) return undefined;
    let cursor = target;
    for (const key of keys) {
        if (cursor === null || cursor === undefined || typeof cursor !== 'object') {
            return undefined;
        }
        cursor = cursor[key];
    }
    return cursor;
}

function hasMeaningfulValue(value) {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return !isPlaceholderLikeValue(value);
    if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
}

function computeMissingElements(briefData = {}, requiredElements = []) {
    if (!Array.isArray(requiredElements)) return [];
    return requiredElements
        .map((pathName) => String(pathName || '').trim())
        .filter(Boolean)
        .filter((pathName) => !hasMeaningfulValue(getValueByPath(briefData, pathName)));
}

function ensureArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    return [value];
}

function dedupeStringList(values = []) {
    return [...new Set(values.map((item) => String(item || '').trim()).filter(Boolean))];
}

function formatInputValue(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') {
        return value.trim();
    }
    if (Array.isArray(value)) {
        return value
            .map((item) => String(item ?? '').trim())
            .filter(Boolean)
            .join('\n');
    }
    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function toTitleCase(text = '') {
    return String(text || '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}

function formatFieldDisplayName(pathName = '') {
    const cleaned = String(pathName || '').trim();
    if (!cleaned) return 'Required Field';
    const parts = cleaned.split('.').filter(Boolean);
    const fieldKey = parts[parts.length - 1] || cleaned;
    const stageKey = parts[1] && STAGE_LABELS[parts[1]] ? STAGE_LABELS[parts[1]] : '';
    const fieldLabel = toTitleCase(fieldKey.replace(/[_-]+/g, ' '));
    return stageKey ? `${stageKey} ${fieldLabel}` : fieldLabel;
}

function resolveTaskSkills(stage, taskType, stageConfiguredSkills = [], blueprintSkills = []) {
    const stageMap = getStageSkillMap()[stage] || {};
    const fromStageBase = ensureArray(stageMap.base);
    const fromTaskType = ensureArray(stageMap.byTaskType?.[taskType]);
    return dedupeStringList([
        ...ensureArray(stageConfiguredSkills),
        ...fromStageBase,
        ...fromTaskType,
        ...ensureArray(blueprintSkills),
    ]);
}

function buildTaskNextActionPrompt(task = {}, stageConfig = {}, stage = '', briefData = {}) {
    const lines = [
        `Task: ${task.title || 'Untitled Task'}`,
        `Stage: ${STAGE_LABELS[stage] || stage || 'Unknown'}`,
    ];

    const requiredInputs = dedupeStringList(Array.isArray(task.inputsNeeded) ? task.inputsNeeded : []);
    const missingInputs = [];
    const providedInputs = [];
    requiredInputs.forEach((pathName) => {
        const value = getValueByPath(briefData, pathName);
        if (hasMeaningfulValue(value)) {
            providedInputs.push({ pathName, value: formatInputValue(value) });
        } else {
            missingInputs.push(pathName);
        }
    });

    if (missingInputs.length > 0) {
        lines.push(`Missing inputs: ${missingInputs.join(', ')}`);
    }
    if (providedInputs.length === 1) {
        lines.push(`User inputs: "${providedInputs[0].value}"`);
    } else if (providedInputs.length > 1) {
        lines.push('User inputs:');
        providedInputs.forEach((entry) => {
            lines.push(`- ${entry.pathName}: "${entry.value}"`);
        });
    }

    const suggestedSkills = Array.isArray(task.suggestedSkills) ? task.suggestedSkills : [];
    if (suggestedSkills.length > 0) {
        lines.push(`Suggested skills: ${suggestedSkills.join(', ')}`);
    }

    const qualityGate = Array.isArray(stageConfig.quality_gate) ? stageConfig.quality_gate : [];
    if (qualityGate.length > 0 && task.taskType === 'analysis') {
        lines.push(`Quality gate checklist: ${qualityGate.join(' | ')}`);
    }

    if (STAGE_PROMPT_HINTS[stage]) {
        lines.push(`Stage guidance: ${STAGE_PROMPT_HINTS[stage]}`);
    }

    if (providedInputs.length > 0) {
        lines.push('Please produce a concrete next step plan and execution output. If user inputs are provided, polish and make them concrete, then write updates back to .pipeline/docs/research_brief.json.');
    } else {
        lines.push('Please produce a concrete next step plan and execution output. If key inputs are missing, propose precise placeholders and write updates back to .pipeline/docs/research_brief.json.');
    }
    return lines.join('\n');
}

function instantiatePipelineTasksFromBrief(briefData = {}, numTasks = DEFAULT_MAX_TASKS) {
    const pipelineStages = briefData?.pipeline?.stages && typeof briefData.pipeline.stages === 'object'
        ? briefData.pipeline.stages
        : null;
    if (!pipelineStages) return null;

    const now = new Date().toISOString();
    const generated = [];
    const maxTasks = Number.isFinite(Number(numTasks)) && Number(numTasks) > 0 ? Number(numTasks) : DEFAULT_MAX_TASKS;

    // Respect pipeline.startStage — only generate tasks for stages >= startStage
    const startStage = normalizeStageName(briefData?.pipeline?.startStage) || 'survey';
    const startIdx = STAGE_ORDER.indexOf(startStage);
    const activeStages = startIdx > 0 ? STAGE_ORDER.slice(startIdx) : STAGE_ORDER;

    for (const stage of activeStages) {
        const stageConfig = pipelineStages?.[stage]
            || (stage === 'promotion' ? pipelineStages?.presentation : null);
        if (!stageConfig || typeof stageConfig !== 'object') continue;

        const stageSkills = resolveTaskSkills(stage, '', stageConfig.recommended_skills, []);
        const stageRequiredElements = dedupeStringList(ensureArray(stageConfig.required_elements));
        const missingElements = computeMissingElements(briefData, stageConfig.required_elements);
        const stageBlueprints = ensureArray(stageConfig.task_blueprints);

        stageBlueprints.forEach((blueprintNode, index) => {
            const blueprint = typeof blueprintNode === 'string'
                ? { id: blueprintNode }
                : (blueprintNode && typeof blueprintNode === 'object' ? blueprintNode : { id: `${stage}_task_${index + 1}` });
            const sourceBlueprintId = String(blueprint.id || `${stage}_task_${index + 1}`);
            const task = normalizeTask({
                id: generated.length + 1,
                title: blueprint.title || titleFromBlueprintId(sourceBlueprintId, stage),
                description: blueprint.description || `Execute ${STAGE_LABELS[stage] || stage} task from pipeline blueprint.`,
                status: 'pending',
                priority: blueprint.priority || 'medium',
                dependencies: Array.isArray(blueprint.dependencies) ? blueprint.dependencies : [],
                createdAt: now,
                updatedAt: now,
                stage,
                taskType: blueprint.taskType || 'implementation',
                inputsNeeded: dedupeStringList([
                    ...ensureArray(blueprint.inputsNeeded),
                    ...stageRequiredElements,
                ]),
                suggestedSkills: resolveTaskSkills(stage, blueprint.taskType || 'implementation', stageSkills, blueprint.recommended_skills),
                sourceBlueprintId,
                nextActionPrompt: blueprint.nextActionPrompt || '',
            });
            task.nextActionPrompt = task.nextActionPrompt || buildTaskNextActionPrompt(task, stageConfig, stage, briefData);
            generated.push(task);
        });

        stageRequiredElements.forEach((requiredPath) => {
            const value = getValueByPath(briefData, requiredPath);
            const hasValue = hasMeaningfulValue(value);
            const fieldDisplayName = formatFieldDisplayName(requiredPath);
            const task = normalizeTask({
                id: generated.length + 1,
                title: hasValue ? `Refine ${fieldDisplayName}` : `Define ${fieldDisplayName}`,
                description: hasValue
                    ? `The required field "${requiredPath}" exists but may still be vague. Refine it into concrete, testable language.`
                    : `The required field "${requiredPath}" is missing or unclear. Clarify it before stage completion.`,
                status: 'pending',
                priority: hasValue ? 'medium' : 'high',
                dependencies: [],
                createdAt: now,
                updatedAt: now,
                stage,
                taskType: hasValue ? 'analysis' : 'exploration',
                inputsNeeded: [requiredPath],
                suggestedSkills: resolveTaskSkills(stage, hasValue ? 'analysis' : 'exploration', stageSkills, []),
                sourceBlueprintId: hasValue ? `${stage}.refine.${requiredPath}` : `${stage}.missing.${requiredPath}`,
                nextActionPrompt: '',
            });
            task.nextActionPrompt = buildTaskNextActionPrompt(task, stageConfig, stage, briefData);
            generated.push(task);
        });

        const qualityGate = Array.isArray(stageConfig.quality_gate)
            ? stageConfig.quality_gate.map((item) => String(item || '').trim()).filter(Boolean)
            : [];
        if (qualityGate.length > 0) {
            const task = normalizeTask({
                id: generated.length + 1,
                title: `Review ${STAGE_LABELS[stage] || stage} quality gate before moving forward`,
                description: `Complete and verify ${STAGE_LABELS[stage] || stage} quality gate criteria.`,
                status: 'pending',
                priority: 'medium',
                dependencies: [],
                createdAt: now,
                updatedAt: now,
                stage,
                taskType: 'analysis',
                inputsNeeded: [],
                suggestedSkills: resolveTaskSkills(stage, 'analysis', stageSkills, []),
                sourceBlueprintId: `${stage}.quality_gate`,
                nextActionPrompt: '',
            });
            task.nextActionPrompt = buildTaskNextActionPrompt(task, stageConfig, stage, briefData);
            generated.push(task);
        }
    }

    const normalized = generated.slice(0, maxTasks).map((task, index) => normalizeTask({
        ...task,
        id: index + 1,
    }));

    return normalized.length > 0 ? normalized : null;
}

function computeNextGuidance(tasks = []) {
    const allTasks = Array.isArray(tasks) ? tasks : [];
    const doneIds = new Set(
        allTasks
            .filter((task) => String(task.status || '').toLowerCase() === 'done')
            .map((task) => String(task.id)),
    );

    const inProgress = allTasks.find((task) => String(task.status || '').toLowerCase() === 'in-progress') || null;
    if (inProgress) {
        return {
            nextTask: inProgress,
            whyNext: 'This task is already in progress and should be finished first.',
            requiredInputs: Array.isArray(inProgress.inputsNeeded) ? inProgress.inputsNeeded : [],
            suggestedSkills: Array.isArray(inProgress.suggestedSkills) ? inProgress.suggestedSkills : [],
            nextActionPrompt: inProgress.nextActionPrompt || '',
        };
    }

    const pendingTasks = allTasks.filter((task) => String(task.status || '').toLowerCase() === 'pending');
    if (pendingTasks.length === 0) {
        return {
            nextTask: null,
            whyNext: 'No pending or in-progress tasks available.',
            requiredInputs: [],
            suggestedSkills: [],
            nextActionPrompt: '',
        };
    }

    const readyTask = pendingTasks.find((task) => {
        const deps = Array.isArray(task.dependencies) ? task.dependencies.map((dep) => String(dep)) : [];
        return deps.every((dep) => doneIds.has(dep));
    }) || pendingTasks[0];

    const blockedDependencies = Array.isArray(readyTask.dependencies)
        ? readyTask.dependencies.filter((dep) => !doneIds.has(String(dep)))
        : [];
    const whyNext = blockedDependencies.length === 0
        ? 'This is the first actionable pending task based on dependency order.'
        : `This pending task is recommended, but it still references unresolved dependencies: ${blockedDependencies.join(', ')}`;

    return {
        nextTask: readyTask,
        whyNext,
        requiredInputs: Array.isArray(readyTask.inputsNeeded) ? readyTask.inputsNeeded : [],
        suggestedSkills: Array.isArray(readyTask.suggestedSkills) ? readyTask.suggestedSkills : [],
        nextActionPrompt: readyTask.nextActionPrompt || '',
    };
}

function computeTaskmasterStatus(taskMasterResult, mcpResult) {
    let status = 'not-configured';
    if (taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles) {
        if (mcpResult.hasMCPServer && mcpResult.isConfigured) {
            status = 'fully-configured';
        } else {
            status = 'taskmaster-only';
        }
    } else if (mcpResult.hasMCPServer && mcpResult.isConfigured) {
        status = 'mcp-only';
    }
    return status;
}

function buildTaskmasterSummaryPayload({
    projectName,
    projectPath,
    status,
    tasks = [],
    nextTask = null,
    guidance = null,
    updatedAt = new Date().toISOString(),
}) {
    const tasksByStatus = tasks.reduce((acc, task) => {
        const taskStatus = normalizeTaskStatus(task.status);
        acc[taskStatus] = (acc[taskStatus] || 0) + 1;
        return acc;
    }, {
        pending: 0,
        'in-progress': 0,
        done: 0,
        review: 0,
        deferred: 0,
        cancelled: 0,
        blocked: 0,
    });

    const total = tasks.length;
    const completed = tasksByStatus.done || 0;

    return {
        project: projectName,
        status,
        project_path: projectPath,
        counts: {
            total,
            completed,
            in_progress: tasksByStatus['in-progress'] || 0,
            pending: tasksByStatus.pending || 0,
            blocked: tasksByStatus.blocked || 0,
            review: tasksByStatus.review || 0,
            deferred: tasksByStatus.deferred || 0,
            cancelled: tasksByStatus.cancelled || 0,
            completion_rate: total > 0 ? Math.round((completed / total) * 1000) / 10 : 0,
        },
        next_task: nextTask,
        guidance,
        updated_at: updatedAt,
    };
}

function dedupeGeneratedTasks(existingTasks = [], generatedTasks = []) {
    const signature = (task) => `${String(task.title || '').trim().toLowerCase()}|${String(task.description || '').trim().toLowerCase()}`;
    const existingSignatures = new Set(existingTasks.map(signature));
    return generatedTasks.filter((task) => {
        const key = signature(task);
        if (existingSignatures.has(key)) return false;
        existingSignatures.add(key);
        return true;
    });
}

/**
 * Check if TaskMaster CLI is installed globally
 * @returns {Promise<Object>} Installation status result
 */
async function checkTaskMasterInstallation() {
    return {
        isInstalled: true,
        installPath: PIPELINE_DIR,
        version: 'web-native',
        reason: null,
    };
}

/**
 * Detect .pipeline folder presence in a given project directory
 * @param {string} projectPath - Absolute path to project directory
 * @returns {Promise<Object>} Detection result with status and metadata
 */
async function detectTaskMasterFolder(projectPath) {
    try {
        await migrateLegacyTaskmasterIfNeeded(projectPath);
        const taskMasterPath = getPipelinePaths(projectPath).root;
        
        // Check if .pipeline directory exists
        try {
            const stats = await fsPromises.stat(taskMasterPath);
            if (!stats.isDirectory()) {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline exists but is not a directory'
                };
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                return {
                    hasTaskmaster: false,
                    reason: '.pipeline directory not found'
                };
            }
            throw error;
        }

        // Check for key TaskMaster files
        const keyFiles = [
            'tasks/tasks.json',
            'docs/research_brief.json',
            'config.json'
        ];
        
        const fileStatus = {};
        let hasEssentialFiles = true;

        for (const file of keyFiles) {
            const filePath = path.join(taskMasterPath, file);
            try {
                await fsPromises.access(filePath, fs.constants.R_OK);
                fileStatus[file] = true;
            } catch (error) {
                fileStatus[file] = false;
                if (file === 'tasks/tasks.json') {
                    hasEssentialFiles = false;
                }
            }
        }

        // Parse tasks.json if it exists for metadata
        let taskMetadata = null;
        if (fileStatus['tasks/tasks.json']) {
            try {
                const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
                const tasksContent = await fsPromises.readFile(tasksPath, 'utf8');
                const tasksData = JSON.parse(tasksContent);
                const { tasks } = extractTasksFromData(tasksData);

                // Calculate task statistics
                const stats = tasks.reduce((acc, task) => {
                    const taskStatus = normalizeTaskStatus(task.status);
                    acc.total++;
                    acc[taskStatus] = (acc[taskStatus] || 0) + 1;
                    
                    // Count subtasks
                    if (task.subtasks) {
                        task.subtasks.forEach(subtask => {
                            const subtaskStatus = normalizeTaskStatus(subtask.status);
                            acc.subtotalTasks++;
                            acc.subtasks = acc.subtasks || {};
                            acc.subtasks[subtaskStatus] = (acc.subtasks[subtaskStatus] || 0) + 1;
                        });
                    }
                    
                    return acc;
                }, { 
                    total: 0, 
                    subtotalTasks: 0,
                    pending: 0, 
                    'in-progress': 0, 
                    done: 0, 
                    review: 0,
                    deferred: 0,
                    cancelled: 0,
                    subtasks: {}
                });

                taskMetadata = {
                    taskCount: stats.total,
                    subtaskCount: stats.subtotalTasks,
                    completed: stats.done || 0,
                    pending: stats.pending || 0,
                    inProgress: stats['in-progress'] || 0,
                    review: stats.review || 0,
                    completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
                    lastModified: (await fsPromises.stat(tasksPath)).mtime.toISOString()
                };
            } catch (parseError) {
                console.warn('Failed to parse tasks.json:', parseError.message);
                taskMetadata = { error: 'Failed to parse tasks.json' };
            }
        }

        const hasResearchBrief = fileStatus['docs/research_brief.json'] === true;

        return {
            hasTaskmaster: true,
            hasEssentialFiles,
            hasResearchBrief,
            files: fileStatus,
            metadata: taskMetadata,
            path: taskMasterPath
        };

    } catch (error) {
        console.error('Error detecting TaskMaster folder:', error);
        return {
            hasTaskmaster: false,
            reason: `Error checking directory: ${error.message}`
        };
    }
}

// MCP detection is now handled by the centralized utility

// API Routes

/**
 * GET /api/taskmaster/installation-status
 * Check if TaskMaster CLI is installed on the system
 */
router.get('/installation-status', async (req, res) => {
    try {
        const installationStatus = await checkTaskMasterInstallation();
        
        // Also check for MCP server configuration
        const mcpStatus = await detectTaskMasterMCPServer();
        
        res.json({
            success: true,
            installation: installationStatus,
            mcpServer: mcpStatus,
            isReady: installationStatus.isInstalled && mcpStatus.hasMCPServer
        });
    } catch (error) {
        console.error('Error checking TaskMaster installation:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check TaskMaster installation status',
            installation: {
                isInstalled: false,
                reason: `Server error: ${error.message}`
            },
            mcpServer: {
                hasMCPServer: false,
                reason: `Server error: ${error.message}`
            },
            isReady: false
        });
    }
});

/**
 * GET /api/taskmaster/detect/:projectName
 * Detect TaskMaster configuration for a specific project
 */
router.get('/detect/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Use the existing extractProjectDirectory function to get actual project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            console.error('Error extracting project directory:', error);
            return res.status(404).json({
                error: 'Project path not found',
                projectName,
                message: error.message
            });
        }
        
        // Verify the project path exists
        try {
            await fsPromises.access(projectPath, fs.constants.R_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'Project path not accessible',
                projectPath,
                projectName,
                message: error.message
            });
        }

        // Run detection in parallel
        const [taskMasterResult, mcpResult] = await Promise.all([
            detectTaskMasterFolder(projectPath),
            detectTaskMasterMCPServer()
        ]);

        const status = computeTaskmasterStatus(taskMasterResult, mcpResult);

        const responseData = {
            projectName,
            projectPath,
            status,
            taskmaster: taskMasterResult,
            mcp: mcpResult,
            timestamp: new Date().toISOString()
        };

        res.json(responseData);

    } catch (error) {
        console.error('TaskMaster detection error:', error);
        res.status(500).json({
            error: 'Failed to detect TaskMaster configuration',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/detect-all
 * Detect TaskMaster configuration for all known projects
 * This endpoint works with the existing projects system
 */
router.get('/detect-all', async (req, res) => {
    try {
        // Import getProjects from the projects module
        const { getProjects } = await import('../projects.js');
        const projects = await getProjects();

        // Run detection for all projects in parallel
        const detectionPromises = projects.map(async (project) => {
            try {
                // Use the project's fullPath if available, otherwise extract the directory
                let projectPath;
                if (project.fullPath) {
                    projectPath = project.fullPath;
                } else {
                    try {
                        projectPath = await extractProjectDirectory(project.name);
                    } catch (error) {
                        throw new Error(`Failed to extract project directory: ${error.message}`);
                    }
                }
                
                const [taskMasterResult, mcpResult] = await Promise.all([
                    detectTaskMasterFolder(projectPath),
                    detectTaskMasterMCPServer()
                ]);

                const status = computeTaskmasterStatus(taskMasterResult, mcpResult);

                return {
                    projectName: project.name,
                    displayName: project.displayName,
                    projectPath,
                    status,
                    taskmaster: taskMasterResult,
                    mcp: mcpResult
                };
            } catch (error) {
                return {
                    projectName: project.name,
                    displayName: project.displayName,
                    status: 'error',
                    error: error.message
                };
            }
        });

        const results = await Promise.all(detectionPromises);

        res.json({
            projects: results,
            summary: {
                total: results.length,
                fullyConfigured: results.filter(p => p.status === 'fully-configured').length,
                taskmasterOnly: results.filter(p => p.status === 'taskmaster-only').length,
                mcpOnly: results.filter(p => p.status === 'mcp-only').length,
                notConfigured: results.filter(p => p.status === 'not-configured').length,
                errors: results.filter(p => p.status === 'error').length
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Bulk TaskMaster detection error:', error);
        res.status(500).json({
            error: 'Failed to detect TaskMaster configuration for projects',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/initialize/:projectName
 * Initialize TaskMaster in a project (placeholder for future CLI integration)
 */
router.post('/initialize/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        res.json({
            projectName,
            projectPath,
            pipelinePath: paths.root,
            message: 'Pipeline initialized successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('TaskMaster initialization error:', error);
        res.status(500).json({
            error: 'Failed to initialize TaskMaster',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/next/:projectName
 * Get the next recommended task from local pipeline tasks
 */
router.get('/next/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks } = await readTasksFile(paths.tasksFile);
        const nextTask = tasks.find((task) => task.status === 'in-progress')
            || tasks.find((task) => task.status === 'pending')
            || null;

        res.json({
            projectName,
            projectPath,
            nextTask,
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('TaskMaster next task error:', error);
        res.status(500).json({
            error: 'Failed to get next task',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/next-guidance/:projectName
 * Get next actionable task with guidance metadata for Chat handoff
 */
router.get('/next-guidance/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`,
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks } = await readTasksFile(paths.tasksFile);
        const guidance = computeNextGuidance(tasks);

        res.json({
            projectName,
            projectPath,
            nextTask: guidance.nextTask,
            guidance: {
                whyNext: guidance.whyNext,
                requiredInputs: guidance.requiredInputs,
                suggestedSkills: guidance.suggestedSkills,
                nextActionPrompt: guidance.nextActionPrompt,
            },
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('TaskMaster next-guidance error:', error);
        res.status(500).json({
            error: 'Failed to get next guidance',
            message: error.message,
        });
    }
});

/**
 * GET /api/taskmaster/summary/:projectName
 * Build a compact TaskMaster summary for CLI / OpenClaw reporting
 */
router.get('/summary/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`,
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const [taskMasterResult, mcpResult, tasksResult] = await Promise.all([
            detectTaskMasterFolder(projectPath),
            detectTaskMasterMCPServer(),
            readTasksFile(paths.tasksFile),
        ]);

        const tasks = tasksResult.tasks || [];
        const guidanceResult = computeNextGuidance(tasks);
        const status = computeTaskmasterStatus(taskMasterResult, mcpResult);

        res.json(buildTaskmasterSummaryPayload({
            projectName,
            projectPath,
            status,
            tasks,
            nextTask: guidanceResult.nextTask,
            guidance: {
                whyNext: guidanceResult.whyNext,
                requiredInputs: guidanceResult.requiredInputs,
                suggestedSkills: guidanceResult.suggestedSkills,
                nextActionPrompt: guidanceResult.nextActionPrompt,
            },
            updatedAt: new Date().toISOString(),
        }));
    } catch (error) {
        console.error('TaskMaster summary error:', error);
        res.status(500).json({
            error: 'Failed to build TaskMaster summary',
            message: error.message,
        });
    }
});

/**
 * GET /api/taskmaster/tasks/:projectName
 * Load actual tasks from .pipeline/tasks/tasks.json
 */
router.get('/tasks/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const tasksFilePath = paths.tasksFile;

        // Check if tasks file exists
        try {
            await fsPromises.access(tasksFilePath);
        } catch (error) {
            return res.json({
                projectName,
                tasks: [],
                message: 'No tasks.json file found'
            });
        }

        // Read and parse tasks file
        try {
            const { tasks: transformedTasks, currentTag } = await readTasksFile(tasksFilePath);

            res.json({
                projectName,
                projectPath,
                tasks: transformedTasks,
                currentTag,
                totalTasks: transformedTasks.length,
                tasksByStatus: {
                    pending: transformedTasks.filter(t => t.status === 'pending').length,
                    'in-progress': transformedTasks.filter(t => t.status === 'in-progress').length,
                    done: transformedTasks.filter(t => t.status === 'done').length,
                    review: transformedTasks.filter(t => t.status === 'review').length,
                    deferred: transformedTasks.filter(t => t.status === 'deferred').length,
                    cancelled: transformedTasks.filter(t => t.status === 'cancelled').length
                },
                timestamp: new Date().toISOString()
            });

        } catch (parseError) {
            console.error('Failed to parse tasks.json:', parseError);
            return res.status(500).json({
                error: 'Failed to parse tasks file',
                message: parseError.message
            });
        }

    } catch (error) {
        console.error('TaskMaster tasks loading error:', error);
        res.status(500).json({
            error: 'Failed to load TaskMaster tasks',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/artifacts/:projectName
 * Summarize recent project artifacts for mobile/reporting workflows.
 */
router.get('/artifacts/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const artifacts = await summarizeProjectArtifacts(projectPath);
        const latest = artifacts.length > 0 ? artifacts[0] : null;

        res.json({
            projectName,
            projectPath,
            artifacts,
            latestArtifact: latest,
            totalArtifacts: artifacts.length,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('TaskMaster artifact summary error:', error);
        res.status(500).json({
            error: 'Failed to summarize project artifacts',
            message: error.message,
        });
    }
});

/**
 * GET /api/taskmaster/prd/:projectName
 * List all PRD files in the project's .pipeline/docs directory
 */
router.get('/prd/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const docsPath = paths.docsDir;
        
        // Check if docs directory exists
        try {
            await fsPromises.access(docsPath, fs.constants.R_OK);
        } catch (error) {
            return res.json({
                projectName,
                prdFiles: [],
                message: 'No .pipeline/docs directory found'
            });
        }

        // Read directory and filter for PRD files
        try {
            const files = await fsPromises.readdir(docsPath);
            const prdFiles = [];

            for (const file of files) {
                const filePath = path.join(docsPath, file);
                const stats = await fsPromises.stat(filePath);
                
                if (stats.isFile() && (file.endsWith('.txt') || file.endsWith('.md') || file.endsWith('.json'))) {
                    prdFiles.push({
                        name: file,
                        path: path.relative(projectPath, filePath),
                        size: stats.size,
                        modified: stats.mtime.toISOString(),
                        created: stats.birthtime.toISOString()
                    });
                }
            }

            res.json({
                projectName,
                projectPath,
                prdFiles: prdFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified)),
                timestamp: new Date().toISOString()
            });

        } catch (readError) {
            console.error('Error reading docs directory:', readError);
            return res.status(500).json({
                error: 'Failed to read PRD files',
                message: readError.message
            });
        }

    } catch (error) {
        console.error('PRD list error:', error);
        res.status(500).json({
            error: 'Failed to list PRD files',
            message: error.message
        });
    }
});

/**
 * Validate a PRD/brief file name. Only a flat file name with an allowed extension is
 * permitted — no path separators or traversal sequences — so the value is always safe
 * to join onto the project's docs directory.
 */
const PRD_FILENAME_PATTERN = /^[\w\-. ]+\.(txt|md|json)$/;
function isValidPrdFileName(fileName) {
    return typeof fileName === 'string'
        && PRD_FILENAME_PATTERN.test(fileName)
        && !fileName.includes('/')
        && !fileName.includes('\\')
        && !fileName.includes('..');
}

/**
 * POST /api/taskmaster/prd/:projectName
 * Create or update a PRD file in the project's .pipeline/docs directory
 */
router.post('/prd/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { fileName, content } = req.body;

        if (!fileName || !content) {
            return res.status(400).json({
                error: 'Missing required fields',
                message: 'fileName and content are required'
            });
        }

        // Validate filename
        if (!isValidPrdFileName(fileName)) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'Filename must end with .txt, .md, or .json and contain only alphanumeric characters, spaces, dots, and dashes'
            });
        }

        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const docsPath = paths.docsDir;
        const filePath = path.join(docsPath, fileName);

        // Ensure docs directory exists
        try {
            await fsPromises.mkdir(docsPath, { recursive: true });
        } catch (error) {
            console.error('Failed to create docs directory:', error);
            return res.status(500).json({
                error: 'Failed to create directory',
                message: error.message
            });
        }

        // Write the PRD file
        try {
            await fsPromises.writeFile(filePath, content, 'utf8');
            
            // Get file stats
            const stats = await fsPromises.stat(filePath);

            res.json({
                projectName,
                projectPath,
                fileName,
                filePath: path.relative(projectPath, filePath),
                size: stats.size,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                message: 'PRD file saved successfully',
                timestamp: new Date().toISOString()
            });

        } catch (writeError) {
            console.error('Failed to write PRD file:', writeError);
            return res.status(500).json({
                error: 'Failed to write PRD file',
                message: writeError.message
            });
        }

    } catch (error) {
        console.error('PRD create/update error:', error);
        res.status(500).json({
            error: 'Failed to create/update PRD file',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/prd/:projectName/:fileName
 * Get content of a specific PRD file
 */
router.get('/prd/:projectName/:fileName', async (req, res) => {
    try {
        const { projectName, fileName } = req.params;

        // Validate filename to prevent path traversal (e.g. ../../etc/passwd)
        if (!isValidPrdFileName(fileName)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const filePath = path.join(paths.docsDir, fileName);
        
        // Check if file exists
        try {
            await fsPromises.access(filePath, fs.constants.R_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'PRD file not found',
                message: `File "${fileName}" does not exist`
            });
        }

        // Read file content
        try {
            const content = await fsPromises.readFile(filePath, 'utf8');
            const stats = await fsPromises.stat(filePath);

            res.json({
                projectName,
                projectPath,
                fileName,
                filePath: path.relative(projectPath, filePath),
                content,
                size: stats.size,
                created: stats.birthtime.toISOString(),
                modified: stats.mtime.toISOString(),
                timestamp: new Date().toISOString()
            });

        } catch (readError) {
            console.error('Failed to read PRD file:', readError);
            return res.status(500).json({
                error: 'Failed to read PRD file',
                message: readError.message
            });
        }

    } catch (error) {
        console.error('PRD read error:', error);
        res.status(500).json({
            error: 'Failed to read PRD file',
            message: error.message
        });
    }
});

/**
 * DELETE /api/taskmaster/prd/:projectName/:fileName
 * Delete a specific PRD file
 */
router.delete('/prd/:projectName/:fileName', async (req, res) => {
    try {
        const { projectName, fileName } = req.params;

        // Validate filename to prevent path traversal — this endpoint unlinks the file.
        if (!isValidPrdFileName(fileName)) {
            return res.status(400).json({ error: 'Invalid filename' });
        }

        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const filePath = path.join(paths.docsDir, fileName);
        
        // Check if file exists
        try {
            await fsPromises.access(filePath, fs.constants.F_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'PRD file not found',
                message: `File "${fileName}" does not exist`
            });
        }

        // Delete the file
        try {
            await fsPromises.unlink(filePath);

            res.json({
                projectName,
                projectPath,
                fileName,
                message: 'PRD file deleted successfully',
                timestamp: new Date().toISOString()
            });

        } catch (deleteError) {
            console.error('Failed to delete PRD file:', deleteError);
            return res.status(500).json({
                error: 'Failed to delete PRD file',
                message: deleteError.message
            });
        }

    } catch (error) {
        console.error('PRD delete error:', error);
        res.status(500).json({
            error: 'Failed to delete PRD file',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/init/:projectName
 * Initialize TaskMaster in a project
 */
router.post('/init/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        if (req.app.locals.wss) {
            broadcastTaskMasterProjectUpdate(
                req.app.locals.wss,
                projectName,
                { hasTaskmaster: true, status: 'initialized', path: paths.root }
            );
        }

        res.json({
            projectName,
            projectPath,
            pipelinePath: paths.root,
            message: 'Pipeline initialized successfully',
            timestamp: new Date().toISOString(),
        });

    } catch (error) {
        console.error('TaskMaster init error:', error);
        res.status(500).json({
            error: 'Failed to initialize TaskMaster',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/add-task/:projectName
 * Add a new task to the project
 */
router.post('/add-task/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { prompt, title, description, priority = 'high', dependencies, stage, insertAfterId } = req.body;

        if (!prompt && (!title || !description)) {
            return res.status(400).json({
                error: 'Missing required parameters',
                message: 'Either "prompt" or both "title" and "description" are required'
            });
        }
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks, currentTag } = await readTasksFile(paths.tasksFile);
        const taskId = generateTaskId(tasks);
        const now = new Date().toISOString();

        const dependencyList = Array.isArray(dependencies)
            ? dependencies
            : typeof dependencies === 'string' && dependencies.trim().length > 0
                ? dependencies.split(',').map((item) => item.trim()).filter(Boolean)
                : [];

        const newTask = normalizeTask({
            id: taskId,
            title: title || splitPromptToTitle(prompt),
            description: description || (prompt ? String(prompt).trim() : ''),
            priority,
            status: 'pending',
            dependencies: dependencyList,
            ...(stage ? { stage } : {}),
            createdAt: now,
            updatedAt: now,
        });

        // Determine insertion position
        let nextTasks;
        if (insertAfterId !== undefined) {
            if (insertAfterId === null || insertAfterId === 0) {
                // Insert at beginning of the target stage
                const targetStage = normalizeStageName(stage);
                const firstInStageIdx = tasks.findIndex(
                    (t) => normalizeStageName(t.stage) === targetStage
                );
                if (firstInStageIdx === -1) {
                    nextTasks = [...tasks, newTask];
                } else {
                    nextTasks = [...tasks.slice(0, firstInStageIdx), newTask, ...tasks.slice(firstInStageIdx)];
                }
            } else {
                // Insert after the specified task
                const afterIdx = tasks.findIndex((t) => String(t.id) === String(insertAfterId));
                if (afterIdx === -1) {
                    nextTasks = [...tasks, newTask];
                } else {
                    nextTasks = [...tasks.slice(0, afterIdx + 1), newTask, ...tasks.slice(afterIdx + 1)];
                }
            }
        } else {
            nextTasks = [...tasks, newTask];
        }

        // Reindex all tasks so IDs are sequential
        const reindexed = reindexTasks(nextTasks);
        await writeTasksFile(paths.tasksFile, reindexed, currentTag);

        // Find the inserted task by its createdAt timestamp
        const insertedTask = reindexed.find((t) => t.createdAt === now && t.title === newTask.title);

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            message: 'Task added successfully',
            task: insertedTask || newTask,
            timestamp: now,
        });

    } catch (error) {
        console.error('Add task error:', error);
        res.status(500).json({
            error: 'Failed to add task',
            message: error.message
        });
    }
});

/**
 * DELETE /api/taskmaster/delete-task/:projectName/:taskId
 * Permanently remove a task from the project
 */
router.delete('/delete-task/:projectName/:taskId', async (req, res) => {
    try {
        const { projectName, taskId } = req.params;

        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks, currentTag } = await readTasksFile(paths.tasksFile);

        const targetId = String(taskId);
        const taskIndex = tasks.findIndex((t) => String(t.id) === targetId);
        if (taskIndex === -1) {
            return res.status(404).json({
                error: 'Task not found',
                message: `Task with ID "${taskId}" does not exist`
            });
        }

        const deletedTask = tasks[taskIndex];
        const nextTasks = tasks.filter((_, i) => i !== taskIndex);

        // Remove deleted task ID from dependency arrays, then reindex
        nextTasks.forEach((t) => {
            if (Array.isArray(t.dependencies)) {
                t.dependencies = t.dependencies.filter(
                    (dep) => String(dep) !== targetId
                );
            }
        });

        const reindexed = reindexTasks(nextTasks);
        await writeTasksFile(paths.tasksFile, reindexed, currentTag);

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            message: 'Task deleted successfully',
            deletedTask,
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        console.error('Delete task error:', error);
        res.status(500).json({
            error: 'Failed to delete task',
            message: error.message
        });
    }
});

/**
 * PUT /api/taskmaster/update-task/:projectName/:taskId
 * Update a specific task using TaskMaster CLI
 */
router.put('/update-task/:projectName/:taskId', async (req, res) => {
    try {
        const { projectName, taskId } = req.params;
        const { title, description, status, priority, details, testStrategy, dependencies } = req.body;
        
        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const { tasks, currentTag } = await readTasksFile(paths.tasksFile);
        const now = new Date().toISOString();
        const targetId = String(taskId);
        const taskIndex = tasks.findIndex((task) => String(task.id) === targetId);

        if (taskIndex === -1) {
            return res.status(404).json({
                error: 'Task not found',
                message: `Task "${taskId}" does not exist`,
            });
        }

        const existingTask = tasks[taskIndex];
        const updatedTask = {
            ...existingTask,
            ...(title !== undefined ? { title } : {}),
            ...(description !== undefined ? { description } : {}),
            ...(status !== undefined ? { status } : {}),
            ...(priority !== undefined ? { priority } : {}),
            ...(details !== undefined ? { details } : {}),
            ...(testStrategy !== undefined ? { testStrategy } : {}),
            ...(dependencies !== undefined ? { dependencies: Array.isArray(dependencies) ? dependencies : [] } : {}),
            updatedAt: now,
        };

        const nextTasks = [...tasks];
        nextTasks[taskIndex] = normalizeTask(updatedTask);
        await writeTasksFile(paths.tasksFile, nextTasks, currentTag);

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            taskId,
            message: 'Task updated successfully',
            task: nextTasks[taskIndex],
            timestamp: now,
        });

    } catch (error) {
        console.error('Update task error:', error);
        res.status(500).json({
            error: 'Failed to update task',
            message: error.message
        });
    }
});

/**
 * POST /api/taskmaster/parse-prd/:projectName
 * Parse a Research Brief JSON file to generate tasks
 */
router.post('/parse-prd/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { fileName = DEFAULT_RESEARCH_BRIEF_FILENAME, numTasks, append = false } = req.body;

        // Validate filename before it is joined onto the docs directory to prevent
        // path traversal (e.g. ../../../some.json).
        if (!isValidPrdFileName(fileName) || !fileName.endsWith('.json')) {
            return res.status(400).json({
                error: 'Invalid brief format',
                message: 'Research Brief must be a .json file name without path separators',
            });
        }

        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const paths = await ensurePipelineInitialized(projectPath);
        const briefPath = path.join(paths.docsDir, fileName);

        // Check if brief JSON file exists
        try {
            await fsPromises.access(briefPath, fs.constants.F_OK);
        } catch (error) {
            return res.status(404).json({
                error: 'Research Brief file not found',
                message: `File "${fileName}" does not exist in ${PIPELINE_DIR}/docs/`
            });
        }

        let briefData;
        try {
            const briefContent = await fsPromises.readFile(briefPath, 'utf8');
            briefData = JSON.parse(briefContent);
        } catch (parseError) {
            return res.status(400).json({
                error: 'Invalid Research Brief JSON',
                message: parseError.message,
            });
        }

        const maxTasks = Number.isFinite(Number(numTasks)) && Number(numTasks) > 0 ? Number(numTasks) : DEFAULT_MAX_TASKS;

        const { tasks: existingTasks, currentTag } = await readTasksFile(paths.tasksFile);
        const now = new Date().toISOString();

        const pipelineGenerated = instantiatePipelineTasksFromBrief(briefData, maxTasks);
        let generatedTasks = [];

        if (pipelineGenerated && pipelineGenerated.length > 0) {
            let nextId = generateTaskId(existingTasks);
            generatedTasks = pipelineGenerated.map((task) => normalizeTask({
                ...task,
                id: nextId++,
                createdAt: task.createdAt || now,
                updatedAt: now,
            }));
        } else {
            const candidates = parseBriefJsonToTaskCandidates(briefData);
            let nextId = generateTaskId(existingTasks);
            generatedTasks = candidates.slice(0, maxTasks).map((candidate) => normalizeTask({
                id: nextId++,
                title: splitPromptToTitle(candidate),
                description: candidate,
                status: 'pending',
                priority: 'medium',
                dependencies: [],
                createdAt: now,
                updatedAt: now,
                stage: inferStageFromCandidate(candidate),
                taskType: 'exploration',
                suggestedSkills: ensureArray(getStageSkillMap()[inferStageFromCandidate(candidate)]?.base),
                sourceBlueprintId: `legacy.candidate.${nextId - 1}`,
                nextActionPrompt: [
                    `Task: ${splitPromptToTitle(candidate)}`,
                    `Description: ${candidate}`,
                    'Please turn this into a concrete actionable plan and provide first-step outputs.',
                ].join('\n'),
            }));
        }

        const nextTasks = append
            ? [...existingTasks, ...dedupeGeneratedTasks(existingTasks, generatedTasks)]
            : generatedTasks;
        await writeTasksFile(paths.tasksFile, nextTasks, currentTag);

        if (req.app.locals.wss) {
            broadcastTaskMasterTasksUpdate(req.app.locals.wss, projectName);
        }

        res.json({
            projectName,
            projectPath,
            briefFile: fileName,
            generationMode: pipelineGenerated ? 'pipeline-blueprint' : 'legacy-fallback',
            message: pipelineGenerated
                ? 'Research Brief pipeline instantiated successfully'
                : 'Research Brief parsed and tasks generated successfully',
            generatedCount: generatedTasks.length,
            totalTasks: nextTasks.length,
            timestamp: now,
        });

    } catch (error) {
        console.error('Parse PRD error:', error);
        res.status(500).json({
            error: 'Failed to parse Research Brief',
            message: error.message
        });
    }
});

/**
 * GET /api/taskmaster/prd-templates
 * Get available PRD templates
 */
router.get('/prd-templates', async (req, res) => {
    try {
        const templates = await getAvailableTemplates();
        res.json({
            templates,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('PRD templates error:', error);
        res.status(500).json({
            error: 'Failed to get PRD templates',
            message: error.message
        });
    }
});

function normalizeLoadedTemplate(template = {}) {
    return {
        ...template,
        category: template.category || template.domain || 'general',
        format: template.format || 'research-brief-json',
        fileName: template.fileName || DEFAULT_RESEARCH_BRIEF_FILENAME,
        metaFields: Array.isArray(template.metaFields) ? template.metaFields : [],
        sectionFields: template.sectionFields && typeof template.sectionFields === 'object' ? template.sectionFields : {},
    };
}

function cloneJsonCompatible(value) {
    return JSON.parse(JSON.stringify(value));
}

async function summarizeProjectArtifacts(projectPath, limit = 12) {
    const candidates = [
        '.pipeline/docs',
        '.pipeline/tasks',
        'results',
        'reports',
        'artifacts',
        'output',
        'outputs',
        'analysis',
        'figures',
        'plots',
        'tables',
        'paper',
        'drafts',
    ];

    const artifactFiles = [];
    for (const relativeDir of candidates) {
        const targetDir = path.join(projectPath, relativeDir);
        try {
            const entries = await fsPromises.readdir(targetDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isFile()) {
                    continue;
                }
                const fullPath = path.join(targetDir, entry.name);
                const stats = await fsPromises.stat(fullPath);
                artifactFiles.push({
                    name: entry.name,
                    relativePath: path.relative(projectPath, fullPath),
                    category: relativeDir,
                    size: stats.size,
                    modified: stats.mtime.toISOString(),
                });
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                console.warn('[TaskMaster] Artifact scan skipped for', targetDir, error.message);
            }
        }
    }

    artifactFiles.sort((a, b) => new Date(b.modified) - new Date(a.modified));
    return artifactFiles.slice(0, limit);
}

function buildBriefFromTemplate(template, nowDate) {
    const stageSkillMap = getStageSkillMap();
    return {
        schemaVersion: '1.1',
        templateId: template.id,
        meta: {
            title: '',
            lead_author: '',
            target_venue: '',
            date: nowDate,
        },
        sections: cloneJsonCompatible(DEFAULT_BRIEF_SECTIONS),
        pipeline: cloneJsonCompatible(
            template?.pipeline && typeof template.pipeline === 'object'
                ? template.pipeline
                : buildDefaultBriefPipeline(stageSkillMap),
        ),
    };
}

/**
 * POST /api/taskmaster/apply-template/:projectName
 * Apply a structured template to create/update a Research Brief JSON file
 */
router.post('/apply-template/:projectName', async (req, res) => {
    try {
        const { projectName } = req.params;
        const { templateId, fileName = DEFAULT_RESEARCH_BRIEF_FILENAME, customizations = {} } = req.body;

        if (!templateId) {
            return res.status(400).json({
                error: 'Missing required parameter',
                message: 'templateId is required'
            });
        }

        // Get project path
        let projectPath;
        try {
            projectPath = await extractProjectDirectory(projectName);
        } catch (error) {
            return res.status(404).json({
                error: 'Project not found',
                message: `Project "${projectName}" does not exist`
            });
        }

        const templates = await getAvailableTemplates();
        const template = templates.find(t => t.id === templateId);

        if (!template) {
            return res.status(404).json({
                error: 'Template not found',
                message: `Template "${templateId}" does not exist`
            });
        }

        if (!fileName.endsWith('.json')) {
            return res.status(400).json({
                error: 'Invalid filename',
                message: 'Research Brief must be saved as .json',
            });
        }

        const now = new Date().toISOString().split('T')[0];
        const brief = buildBriefFromTemplate(template, now);

        const allFields = [
            ...(Array.isArray(template.metaFields) ? template.metaFields : []),
            ...Object.values(template.sectionFields || {}).flat(),
        ];

        allFields.forEach((field) => {
            const submitted = customizations?.[field.path];
            if (submitted === undefined || submitted === null) return;
            const rawValue = typeof submitted === 'string' ? submitted.trim() : submitted;
            if (rawValue === '') return;

            if (field.type === 'array') {
                const values = Array.isArray(rawValue)
                    ? rawValue.map((item) => String(item).trim()).filter(Boolean)
                    : String(rawValue).split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
                assignPath(brief, field.path, values);
                return;
            }

            assignPath(brief, field.path, String(rawValue));
        });

        const paths = await ensurePipelineInitialized(projectPath);
        const docsDir = paths.docsDir;
        try {
            await fsPromises.mkdir(docsDir, { recursive: true });
        } catch (error) {
            console.error('Failed to create docs directory:', error);
        }

        const filePath = path.join(docsDir, fileName);

        // Write the template content to the file
        try {
            await fsPromises.writeFile(filePath, `${JSON.stringify(brief, null, 2)}\n`, 'utf8');

            res.json({
                projectName,
                projectPath,
                templateId,
                templateName: template.name,
                fileName,
                filePath: path.relative(projectPath, filePath),
                message: 'Research Brief template applied successfully',
                timestamp: new Date().toISOString()
            });

        } catch (writeError) {
            console.error('Failed to write PRD template:', writeError);
            return res.status(500).json({
                error: 'Failed to write Research Brief',
                message: writeError.message
            });
        }

    } catch (error) {
        console.error('Apply template error:', error);
        res.status(500).json({
            error: 'Failed to apply Research Brief template',
            message: error.message
        });
    }
});

// Helper function to get available templates
async function getAvailableTemplates() {
    if (cachedTemplates) {
        return cachedTemplates;
    }

    let files = [];
    try {
        files = await fsPromises.readdir(TEMPLATES_DIR);
    } catch (error) {
        throw new Error(`Failed to read templates directory: ${error.message}`);
    }

    const jsonFiles = files.filter((name) => name.endsWith('.json'));
    if (jsonFiles.length === 0) {
        throw new Error(`No template JSON files found in ${TEMPLATES_DIR}`);
    }

    const loaded = [];
    for (const fileName of jsonFiles) {
        const filePath = path.join(TEMPLATES_DIR, fileName);
        const content = await fsPromises.readFile(filePath, 'utf8');
        const parsed = JSON.parse(content);
        if (!parsed?.id || !parsed?.name) {
            throw new Error(`Template "${fileName}" missing required fields: id/name`);
        }
        loaded.push(normalizeLoadedTemplate(parsed));
    }

    cachedTemplates = loaded.sort((a, b) => a.name.localeCompare(b.name));
    return cachedTemplates;
}

export default router;
