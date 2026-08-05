import express from 'express';

import {
  clearModelDiscoveryCache,
  getDiscoverableProviders,
  getModelsForProvider,
} from '../utils/harnessModelDiscovery.js';

const router = express.Router();

/**
 * GET /api/models/providers
 * Which providers this build can probe for a live model list.
 */
router.get('/providers', async (req, res) => {
  try {
    res.json({ providers: getDiscoverableProviders() });
  } catch (error) {
    console.error('[ERROR] Failed to list discoverable providers:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/models/:provider
 *
 * Resolves to the harness's own model list when it can be probed, otherwise to
 * the built-in list. `source` tells the client which it got, so the picker can
 * show that it is running on a fallback.
 *
 * Pass ?refresh=1 to bypass the discovery cache.
 */
router.get('/:provider', async (req, res) => {
  try {
    const { provider } = req.params;
    const force = req.query.refresh === '1' || req.query.refresh === 'true';

    const payload = await getModelsForProvider(provider, { force });
    res.json(payload);
  } catch (error) {
    console.error('[ERROR] Failed to resolve models:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/models/:provider/refresh
 * Drop the cached list and re-probe. Useful right after a CLI upgrade or login.
 */
router.post('/:provider/refresh', async (req, res) => {
  try {
    const { provider } = req.params;
    clearModelDiscoveryCache(provider);

    const payload = await getModelsForProvider(provider, { force: true });
    res.json(payload);
  } catch (error) {
    console.error('[ERROR] Failed to refresh models:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
