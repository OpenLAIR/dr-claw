import type { SessionProvider } from "../types/app";

export { type SessionProvider };

export const ALL_PROVIDERS: SessionProvider[] = [
  "claude",
  "cursor",
  "codex",
  "gemini",
  "openrouter",
  "local",
  "nano",
];

export const ALLOWED_PROVIDERS: SessionProvider[] = [...ALL_PROVIDERS];

export const DEFAULT_PROVIDER: SessionProvider = "claude";

export function isProviderAllowed(provider?: string | null): provider is SessionProvider {
  if (!provider) {
    return false;
  }
  return ALLOWED_PROVIDERS.includes(provider as SessionProvider);
}

export function normalizeProvider(
  provider?: string | null,
  fallback: SessionProvider = DEFAULT_PROVIDER,
): SessionProvider {
  const normalized = String(provider || "").trim().toLowerCase();
  if (isProviderAllowed(normalized)) {
    return normalized;
  }
  return isProviderAllowed(fallback) ? fallback : DEFAULT_PROVIDER;
}
