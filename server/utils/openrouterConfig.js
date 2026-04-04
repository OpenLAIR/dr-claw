const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_REFERER = 'https://github.com/OpenLAIR/dr-claw';

export { DEFAULT_OPENROUTER_BASE_URL };

export function normalizeOpenRouterBaseUrl(baseUrl = DEFAULT_OPENROUTER_BASE_URL) {
  const candidate = String(baseUrl || '').trim() || DEFAULT_OPENROUTER_BASE_URL;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('OpenRouter base URL must be a valid http:// or https:// URL.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('OpenRouter base URL must start with http:// or https://');
  }

  return parsed.toString().replace(/\/$/, '');
}

export function getOpenRouterBaseUrl(env = process.env) {
  try {
    return normalizeOpenRouterBaseUrl(env?.OPENROUTER_BASE_URL);
  } catch {
    return DEFAULT_OPENROUTER_BASE_URL;
  }
}

export function isOfficialOpenRouterBaseUrl(baseUrl) {
  try {
    const { hostname } = new URL(normalizeOpenRouterBaseUrl(baseUrl));
    return hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai');
  } catch {
    return false;
  }
}

export function getOpenRouterProviderHeaders(baseUrl, title = 'Dr. Claw') {
  if (!isOfficialOpenRouterBaseUrl(baseUrl)) {
    return {};
  }

  return {
    'HTTP-Referer': OPENROUTER_REFERER,
    'X-Title': title,
  };
}
