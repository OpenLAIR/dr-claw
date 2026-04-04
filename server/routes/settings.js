import express from 'express';
import { apiKeysDb, appSettingsDb, credentialsDb } from '../database/db.js';
import {
  getOpenRouterBaseUrl,
  getOpenRouterProviderHeaders,
  isOfficialOpenRouterBaseUrl,
} from '../utils/openrouterConfig.js';

const router = express.Router();
const AUTO_RESEARCH_SENDER_EMAIL_KEY = 'auto_research_sender_email';
const AUTO_RESEARCH_RESEND_API_KEY = 'auto_research_resend_api_key';

// ===============================
// API Keys Management
// ===============================

// Get all API keys for the authenticated user
router.get('/api-keys', async (req, res) => {
  try {
    const apiKeys = apiKeysDb.getApiKeys(req.user.id);
    // Don't send the full API key in the list for security
    const sanitizedKeys = apiKeys.map(key => ({
      ...key,
      api_key: key.api_key.substring(0, 10) + '...'
    }));
    res.json({ apiKeys: sanitizedKeys });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    res.status(500).json({ error: 'Failed to fetch API keys' });
  }
});

// Create a new API key
router.post('/api-keys', async (req, res) => {
  try {
    const { keyName } = req.body;

    if (!keyName || !keyName.trim()) {
      return res.status(400).json({ error: 'Key name is required' });
    }

    const result = apiKeysDb.createApiKey(req.user.id, keyName.trim());
    res.json({
      success: true,
      apiKey: result
    });
  } catch (error) {
    console.error('Error creating API key:', error);
    res.status(500).json({ error: 'Failed to create API key' });
  }
});

// Delete an API key
router.delete('/api-keys/:keyId', async (req, res) => {
  try {
    const { keyId } = req.params;
    const success = apiKeysDb.deleteApiKey(req.user.id, parseInt(keyId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error deleting API key:', error);
    res.status(500).json({ error: 'Failed to delete API key' });
  }
});

// Toggle API key active status
router.patch('/api-keys/:keyId/toggle', async (req, res) => {
  try {
    const { keyId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = apiKeysDb.toggleApiKey(req.user.id, parseInt(keyId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'API key not found' });
    }
  } catch (error) {
    console.error('Error toggling API key:', error);
    res.status(500).json({ error: 'Failed to toggle API key' });
  }
});

// ===============================
// Generic Credentials Management
// ===============================

// Get all credentials for the authenticated user (optionally filtered by type)
router.get('/credentials', async (req, res) => {
  try {
    const { type } = req.query;
    const credentials = credentialsDb.getCredentials(req.user.id, type || null);
    // Don't send the actual credential values for security
    res.json({ credentials });
  } catch (error) {
    console.error('Error fetching credentials:', error);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

// Create a new credential
router.post('/credentials', async (req, res) => {
  try {
    const { credentialName, credentialType, credentialValue, description } = req.body;

    if (!credentialName || !credentialName.trim()) {
      return res.status(400).json({ error: 'Credential name is required' });
    }

    if (!credentialType || !credentialType.trim()) {
      return res.status(400).json({ error: 'Credential type is required' });
    }

    if (!credentialValue || !credentialValue.trim()) {
      return res.status(400).json({ error: 'Credential value is required' });
    }

    const result = credentialsDb.createCredential(
      req.user.id,
      credentialName.trim(),
      credentialType.trim(),
      credentialValue.trim(),
      description?.trim() || null
    );

    res.json({
      success: true,
      credential: result
    });
  } catch (error) {
    console.error('Error creating credential:', error);
    res.status(500).json({ error: 'Failed to create credential' });
  }
});

// Delete a credential
router.delete('/credentials/:credentialId', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const success = credentialsDb.deleteCredential(req.user.id, parseInt(credentialId));

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error deleting credential:', error);
    res.status(500).json({ error: 'Failed to delete credential' });
  }
});

// Toggle credential active status
router.patch('/credentials/:credentialId/toggle', async (req, res) => {
  try {
    const { credentialId } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be a boolean' });
    }

    const success = credentialsDb.toggleCredential(req.user.id, parseInt(credentialId), isActive);

    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Credential not found' });
    }
  } catch (error) {
    console.error('Error toggling credential:', error);
    res.status(500).json({ error: 'Failed to toggle credential' });
  }
});

router.get('/auto-research-email', async (req, res) => {
  try {
    res.json({
      senderEmail: appSettingsDb.get(AUTO_RESEARCH_SENDER_EMAIL_KEY),
    });
  } catch (error) {
    console.error('Error fetching Auto Research sender email:', error);
    res.status(500).json({ error: 'Failed to fetch Auto Research sender email' });
  }
});

router.put('/auto-research-email', async (req, res) => {
  try {
    const rawEmail = typeof req.body?.senderEmail === 'string' ? req.body.senderEmail.trim().toLowerCase() : '';
    if (!rawEmail) {
      return res.status(400).json({ error: 'Sender email is required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    appSettingsDb.set(AUTO_RESEARCH_SENDER_EMAIL_KEY, rawEmail);
    res.json({ success: true, senderEmail: rawEmail });
  } catch (error) {
    console.error('Error saving Auto Research sender email:', error);
    res.status(500).json({ error: 'Failed to save Auto Research sender email' });
  }
});

router.get('/auto-research-resend-key', async (req, res) => {
  try {
    const apiKey = appSettingsDb.get(AUTO_RESEARCH_RESEND_API_KEY);
    res.json({
      configured: Boolean(apiKey),
      maskedKey: apiKey ? `${apiKey.slice(0, 6)}...${apiKey.slice(-4)}` : null,
    });
  } catch (error) {
    console.error('Error fetching Auto Research Resend key:', error);
    res.status(500).json({ error: 'Failed to fetch Auto Research Resend key' });
  }
});

router.put('/auto-research-resend-key', async (req, res) => {
  try {
    const rawKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey.trim() : '';
    if (!rawKey) {
      return res.status(400).json({ error: 'Resend API key is required' });
    }

    appSettingsDb.set(AUTO_RESEARCH_RESEND_API_KEY, rawKey);
    res.json({
      success: true,
      configured: true,
      maskedKey: `${rawKey.slice(0, 6)}...${rawKey.slice(-4)}`,
    });
  } catch (error) {
    console.error('Error saving Auto Research Resend key:', error);
    res.status(500).json({ error: 'Failed to save Auto Research Resend key' });
  }
});

// ===============================
// OpenRouter Models (cached proxy)
// ===============================

let openrouterModelsCache = { data: null, fetchedAt: 0, baseUrl: null };
const OPENROUTER_CACHE_TTL = 1000 * 60 * 30; // 30 minutes

router.get('/openrouter-models', async (_req, res) => {
  try {
    const baseUrl = getOpenRouterBaseUrl(process.env);
    const now = Date.now();
    if (
      openrouterModelsCache.data &&
      openrouterModelsCache.baseUrl === baseUrl &&
      now - openrouterModelsCache.fetchedAt < OPENROUTER_CACHE_TTL
    ) {
      return res.json(openrouterModelsCache.data);
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    const isOfficial = isOfficialOpenRouterBaseUrl(baseUrl);
    const requestUrl = isOfficial
      ? `${baseUrl}/models?output_modalities=text&supported_parameters=tools`
      : `${baseUrl}/models`;
    const headers = {
      ...getOpenRouterProviderHeaders(baseUrl, 'Dr. Claw'),
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    };

    const response = await fetch(requestUrl, { headers });
    if (!response.ok) throw new Error(`OpenRouter API returned ${response.status}`);

    const json = await response.json();
    const rawModels = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    const models = rawModels
      .filter((m) => m?.id)
      .map((m) => ({
        value: m.id,
        label: m.name || m.id,
        contextLength: m.context_length || null,
        pricing: m.pricing || null,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));

    openrouterModelsCache = { data: { models }, fetchedAt: now, baseUrl };
    res.json({ models });
  } catch (error) {
    console.error('Error fetching OpenRouter models:', error);
    if (openrouterModelsCache.data) {
      return res.json(openrouterModelsCache.data);
    }
    res.status(502).json({ error: 'Failed to fetch OpenRouter models' });
  }
});

export default router;
