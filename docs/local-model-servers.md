# Local OpenAI-compatible model servers

The Local GPU provider supports Ollama, vLLM, SGLang, and other servers exposing
`GET /v1/models` and streaming `POST /v1/chat/completions`.

1. Start your model server separately. For coding tools, enable the server's
   tool-call parser and choose a model that supports OpenAI function calling.
2. In **Settings → Local GPU**, enter its URL and click **Test Connection**, then
   **Save & Refresh**. Examples: `http://localhost:11434` (Ollama),
   `http://localhost:8000/v1` (vLLM), `http://localhost:30000/v1` (SGLang).
3. Select a discovered model and use the **Local GPU** chat provider.

Only HTTP(S) loopback addresses are accepted. Redirects are refused. To reach a
remote server, establish an SSH tunnel yourself and use its local endpoint.
A root URL probes Ollama first, then OpenAI `/v1/models`; an explicit `/v1` URL
uses OpenAI directly. Proxy path prefixes such as `/proxy/v1` are preserved.
Ollama's Pull Model controls are only shown when Ollama is detected; vLLM/SGLang
models must be loaded in those servers, not downloaded through Dr. Claw.

For an authenticated local endpoint, set `LOCAL_GPU_API_KEY` in the server's
`.env` and restart Dr. Claw. It is sent as a Bearer token for discovery and chat,
not stored in browser localStorage. `LOCAL_GPU_SERVER_URL` sets the default for
API/CLI callers and can also be saved through Settings. No GPU is required for
discovery; a local server may use CPU inference.
