/** Loopback-only endpoints for Ollama and OpenAI-compatible local servers. */
export const DEFAULT_LOCAL_SERVER_URL = 'http://localhost:11434';

export function normalizeLocalServerUrl(input = DEFAULT_LOCAL_SERVER_URL) {
  let raw = String(input || DEFAULT_LOCAL_SERVER_URL).trim();
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) raw = `http://${raw}`;
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid local model server URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Local model URL must use http or https');
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Local model URL must not include credentials, query parameters, or fragments');
  }
  const host = url.hostname.toLowerCase();
  const loopback = ['localhost', '[::1]'].includes(host) || /^127(?:\.\d{1,3}){3}$/.test(host);
  if (!loopback) throw new Error('Local model URL must use a loopback host (localhost, 127.0.0.1, or ::1)');
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function localApiBaseUrl(input) {
  const base = normalizeLocalServerUrl(input);
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

function requestOptions(apiKey) {
  return {
    redirect: 'error', // A loopback endpoint must not redirect to external/internal hosts.
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    signal: AbortSignal.timeout(5000),
  };
}

export async function checkLocalModelServer(input, apiKey = process.env.LOCAL_GPU_API_KEY) {
  try {
    const base = normalizeLocalServerUrl(input);
    // Preserve Ollama metadata for existing installations. An explicit /v1 URL
    // selects the OpenAI protocol without probing Ollama's management API.
    if (new URL(base).pathname === '/') {
      try {
        const response = await fetch(`${base}/api/tags`, requestOptions(apiKey));
        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.models)) {
            return {
              running: true, provider: 'ollama', apiBaseUrl: localApiBaseUrl(base),
              models: data.models.filter(m => typeof m.name === 'string').map(m => {
                const match = m.details?.parameter_size?.match(/([\d.]+)([BM])/i);
                return {
                  name: m.name, displayName: m.name.split(':')[0],
                  size: m.details?.parameter_size || null,
                  sizeB: match ? Number(match[1]) / (match[2].toUpperCase() === 'M' ? 1000 : 1) : null,
                  family: m.details?.family || null, quantization: m.details?.quantization_level || null,
                  modifiedAt: m.modified_at,
                };
              }),
            };
          }
        }
      } catch { /* Not Ollama; try the standard OpenAI model endpoint. */ }
    }
    const apiBaseUrl = localApiBaseUrl(base);
    const response = await fetch(`${apiBaseUrl}/models`, requestOptions(apiKey));
    if (!response.ok) throw new Error(`Model discovery returned HTTP ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.data)) throw new Error('Invalid OpenAI-compatible model list: expected data[]');
    return {
      running: true, provider: 'openai-compatible', apiBaseUrl,
      models: data.data.filter(m => typeof m.id === 'string' && m.id).map(m => ({
        name: m.id, displayName: m.id, size: null, sizeB: null, family: null, quantization: null,
      })),
    };
  } catch (error) {
    return { running: false, error: error.message, models: [] };
  }
}

export function requestLocalChat(baseUrl, body, signal, apiKey = process.env.LOCAL_GPU_API_KEY) {
  return fetch(`${localApiBaseUrl(baseUrl)}/chat/completions`, {
    method: 'POST', redirect: 'error',
    headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify(body), signal,
  });
}
