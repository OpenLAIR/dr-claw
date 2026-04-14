import express from 'express';
import { runClaudeBtw } from '../claude-sdk.js';
import { runGeminiBtw } from '../gemini-api.js';
import { runCodexBtw } from '../openai-codex.js';
import { MAX_QUESTION_CHARS, MAX_TRANSCRIPT_CHARS } from '../utils/btw.js';
import { getGeminiApiKeyForUser, withGeminiApiKeyEnv } from '../utils/geminiApiKey.js';

const router = express.Router();

const SUPPORTED_PROVIDERS = new Set(['claude', 'gemini', 'codex']);

/**
 * POST /api/btw
 * Ephemeral side question (no tools, separate from main chat session).
 * Dispatches to the appropriate provider backend.
 */
router.post('/', async (req, res) => {
  try {
    const { question, transcript, projectPath, model, provider } = req.body || {};

    const effectiveProvider = typeof provider === 'string' ? provider.trim() : 'claude';
    if (!SUPPORTED_PROVIDERS.has(effectiveProvider)) {
      return res.status(400).json({
        error: `/btw is supported for ${[...SUPPORTED_PROVIDERS].join(', ')} providers. Got: ${effectiveProvider}`,
      });
    }

    const q = typeof question === 'string' ? question.trim() : '';
    if (!q) {
      return res.status(400).json({ error: 'question is required' });
    }
    if (q.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: `question exceeds ${MAX_QUESTION_CHARS} character limit` });
    }

    const raw = typeof transcript === 'string' ? transcript : '';
    const text = raw.length > MAX_TRANSCRIPT_CHARS ? raw.slice(raw.length - MAX_TRANSCRIPT_CHARS) : raw;
    const cwd = typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : undefined;
    const modelId = typeof model === 'string' && model.trim() ? model.trim() : undefined;

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableFinished) {
        ac.abort();
      }
    });

    const userId = req.user?.id;
    const geminiApiKey = getGeminiApiKeyForUser(userId);
    const sessionEnv = withGeminiApiKeyEnv(process.env, geminiApiKey);

    let result;

    if (effectiveProvider === 'claude') {
      result = await runClaudeBtw({
        question: q,
        transcript: text,
        cwd,
        model: modelId,
        signal: ac.signal,
      });
    } else if (effectiveProvider === 'gemini') {
      result = await runGeminiBtw({
        question: q,
        transcript: text,
        model: modelId,
        env: sessionEnv,
        userId,
        signal: ac.signal,
      });
    } else if (effectiveProvider === 'codex') {
      result = await runCodexBtw({
        question: q,
        transcript: text,
        model: modelId,
        env: sessionEnv,
        signal: ac.signal,
      });
    }

    if (!res.headersSent) {
      res.json({ answer: result?.answer || '' });
    }
  } catch (error) {
    if (!res.headersSent) {
      console.error('[ERROR] /api/btw:', error.message);
      res.status(500).json({ error: error.message || 'btw request failed' });
    }
  }
});

export default router;
