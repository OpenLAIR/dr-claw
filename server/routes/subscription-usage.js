import express from 'express';
import {
  checkClaudeCredentials,
  checkCodexCredentials,
  checkGeminiCredentials,
} from './cli-auth.js';
import {
  buildSubscriptionUsageSummary,
  probeClaudePlanUsage,
  readLatestCodexRateLimits,
} from '../utils/subscriptionUsage.js';

const router = express.Router();

// The Claude probe starts a CLI process (~2s), so share one result across
// dashboard loads for a short while and collapse concurrent requests.
const CACHE_TTL_MS = 60 * 1000;
let cached = null;
let inFlight = null;

async function checkClaudeAuth() {
  const result = await checkClaudeCredentials();
  if (result?.authenticated) return result;
  // Mirrors /api/cli/claude/status: an API key means Claude runs without a plan.
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    return { authenticated: true, email: null, method: 'custom_api' };
  }
  return result;
}

function computeSummary() {
  return buildSubscriptionUsageSummary({
    checkClaudeAuth,
    checkCodexAuth: checkCodexCredentials,
    checkGeminiAuth: checkGeminiCredentials,
    probeClaude: () => probeClaudePlanUsage(),
    readCodexSnapshot: () => readLatestCodexRateLimits(),
  });
}

router.get('/', async (req, res) => {
  try {
    const forceRefresh = req.query.refresh === '1';
    if (!forceRefresh && cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return res.json(cached.summary);
    }
    if (!inFlight) {
      inFlight = computeSummary()
        .then((summary) => {
          cached = { at: Date.now(), summary };
          return summary;
        })
        .finally(() => { inFlight = null; });
    }
    res.json(await inFlight);
  } catch (error) {
    console.error('Error building subscription usage summary:', error);
    res.status(500).json({ error: 'Failed to read subscription usage' });
  }
});

export default router;
