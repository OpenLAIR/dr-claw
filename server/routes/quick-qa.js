/**
 * Quick Q&A Route
 *
 * Provides lightweight endpoints for inline Q&A in markdown preview mode:
 * - Fast mode: quick haiku answer via SSE streaming
 * - Think mode: detailed sonnet analysis via SSE streaming
 * - Deep Research mode: comprehensive opus report via SSE streaming
 */

import { Router } from 'express';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Active query abort controllers
const activeQueries = new Map();

const FAST_SYSTEM_PROMPT = `You are a helpful assistant providing quick, concise answers about text selected from markdown documents. Keep responses brief and direct. Use markdown formatting in your response when appropriate.`;

const THINK_SYSTEM_PROMPT = `You are a deep-thinking assistant. Provide a detailed, well-reasoned analysis with thorough explanations. Break down concepts, explore implications, and provide comprehensive insights. Use markdown formatting with clear structure (headings, lists, etc.).`;

// Load the inno-deep-research skill as the Deep Research system prompt
let RESEARCH_SYSTEM_PROMPT;
try {
  const skillPath = join(__dirname, '../../skills/inno-deep-research/SKILL.md');
  const raw = readFileSync(skillPath, 'utf8');
  // Strip YAML frontmatter (between --- markers) and use the rest as the prompt
  const stripped = raw.replace(/^---[\s\S]*?---\s*/, '').trim();
  RESEARCH_SYSTEM_PROMPT = stripped;
  console.log('[QuickQA] Loaded inno-deep-research skill for Deep Research mode');
} catch (err) {
  console.warn('[QuickQA] Could not load inno-deep-research skill, using fallback:', err.message);
  RESEARCH_SYSTEM_PROMPT = `You are a comprehensive research assistant. Provide a thorough research report that includes: overview and background, key concepts, current state of knowledge, different perspectives, related work, and conclusions. Use markdown formatting with clear structure, headings, and well-organized sections.`;
}

const MODE_CONFIG = {
  fast: { model: 'haiku', systemPrompt: FAST_SYSTEM_PROMPT },
  think: { model: 'sonnet', systemPrompt: THINK_SYSTEM_PROMPT },
  research: { model: 'sonnet', systemPrompt: RESEARCH_SYSTEM_PROMPT },
};

function buildPrompt(selectedText, question, mode) {
  if (mode === 'think') {
    return question
      ? `Please think deeply and provide a detailed, well-reasoned analysis of the following text, focusing on this question: ${question}\n\nSelected text:\n"""\n${selectedText}\n"""`
      : `Please think deeply and provide a detailed, well-reasoned analysis of the following text. Break down the concepts, explore implications, and provide thorough explanations.\n\nSelected text:\n"""\n${selectedText}\n"""`;
  }
  if (mode === 'research') {
    return question
      ? `Please conduct a comprehensive deep research on the following topic/text, focusing on: ${question}\n\nProvide a thorough research report with: 1) Overview and background 2) Key concepts 3) Current state of knowledge 4) Different perspectives 5) Related work 6) Conclusions.\n\nSelected text:\n"""\n${selectedText}\n"""`
      : `Please conduct a comprehensive deep research on the following topic/text. Provide a thorough research report with: 1) Overview and background 2) Key concepts 3) Current state of knowledge 4) Different perspectives 5) Related work 6) Conclusions.\n\nSelected text:\n"""\n${selectedText}\n"""`;
  }
  // fast
  return question
    ? `The user has selected the following text from a markdown document and has a question about it.\n\nSelected text:\n"""\n${selectedText}\n"""\n\nUser's question: ${question}\n\nPlease provide a concise, direct answer. Keep it brief and focused.`
    : `The user has selected the following text from a markdown document and wants a quick explanation.\n\nSelected text:\n"""\n${selectedText}\n"""\n\nPlease provide a concise explanation of this text. Keep it brief and focused.`;
}

/**
 * Shared SSE query handler for all modes (fast, think, research).
 */
async function handleQueryRequest(req, res) {
  const { selectedText, question, projectPath, mode = 'fast' } = req.body;

  if (!selectedText || selectedText.length < 2) {
    return res.status(400).json({ error: 'Selected text must be at least 2 characters' });
  }

  const config = MODE_CONFIG[mode] || MODE_CONFIG.fast;
  const queryId = `quick-qa-${mode}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // Set up SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Query-Id', queryId);
  res.flushHeaders();

  const abortController = new AbortController();
  activeQueries.set(queryId, abortController);

  // Clean up on client disconnect
  res.on('close', () => {
    if (!res.writableFinished) {
      abortController.abort();
      activeQueries.delete(queryId);
    }
  });

  const prompt = buildPrompt(selectedText, question, mode);

  const prevStreamTimeout = process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
  process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000';

  try {
    const conversation = query({
      prompt,
      options: {
        cwd: projectPath || process.cwd(),
        model: config.model,
        systemPrompt: config.systemPrompt,
        tools: [],
        allowedTools: [],
        settingSources: [],
        permissionMode: 'default',
      },
    });

    let hasStreamedContent = false;
    let fullContent = '';

    for await (const message of conversation) {
      if (abortController.signal.aborted) break;

      if (message.type === 'assistant' && message.message?.content) {
        for (const block of message.message.content) {
          if (block.type === 'text' && block.text) {
            hasStreamedContent = true;
            fullContent += block.text;
            res.write(`data: ${JSON.stringify({ type: 'text', content: block.text })}\n\n`);
          }
        }
      }

      if (message.type === 'result') {
        if (message.subtype === 'success' && message.result && !hasStreamedContent) {
          fullContent = message.result;
          res.write(`data: ${JSON.stringify({ type: 'text', content: message.result })}\n\n`);
        } else if (message.subtype !== 'success') {
          const errMsg = Array.isArray(message.errors) ? message.errors.join('\n') : 'Query failed';
          res.write(`data: ${JSON.stringify({ type: 'error', message: errMsg })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({ type: 'done', fullContent })}\n\n`);
  } catch (error) {
    if (error.name !== 'AbortError') {
      console.error(`[QuickQA/${mode}] Error:`, error.message);
      res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    }
  } finally {
    activeQueries.delete(queryId);
    if (prevStreamTimeout !== undefined) {
      process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = prevStreamTimeout;
    } else {
      delete process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT;
    }
    res.end();
  }
}

/**
 * POST /api/quick-qa
 * Unified endpoint for all modes. Pass { mode: 'fast' | 'think' | 'research' } in body.
 */
router.post('/', handleQueryRequest);

/**
 * POST /api/quick-qa/abort
 * Aborts an active query.
 */
router.post('/abort', (req, res) => {
  const { queryId } = req.body;
  const controller = activeQueries.get(queryId);
  if (controller) {
    controller.abort();
    activeQueries.delete(queryId);
    return res.json({ success: true });
  }
  res.json({ success: false, message: 'Query not found' });
});

export default router;
