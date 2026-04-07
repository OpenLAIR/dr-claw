import express from 'express';
import { runClaudeBtw } from '../claude-sdk.js';

const router = express.Router();

/**
 * POST /api/claude/btw
 * Ephemeral side question (no tools, separate from main chat session).
 */
router.post('/btw', async (req, res) => {
  try {
    const { question, transcript, projectPath, model } = req.body || {};
    const q = typeof question === 'string' ? question.trim() : '';
    if (!q) {
      return res.status(400).json({ error: 'question is required' });
    }

    const text = typeof transcript === 'string' ? transcript : '';
    const cwd = typeof projectPath === 'string' && projectPath.trim() ? projectPath.trim() : undefined;
    const modelId = typeof model === 'string' && model.trim() ? model.trim() : undefined;

    const { answer } = await runClaudeBtw({
      question: q,
      transcript: text,
      cwd,
      model: modelId,
    });

    res.json({ answer });
  } catch (error) {
    console.error('[ERROR] /api/claude/btw:', error.message);
    res.status(500).json({ error: error.message || 'btw request failed' });
  }
});

export default router;
