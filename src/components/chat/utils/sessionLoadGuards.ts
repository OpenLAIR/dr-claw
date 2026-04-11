import type { Provider } from '../types/types';
import { DEFAULT_PROVIDER, normalizeProvider } from '../../../utils/providerPolicy';

export function resolveSessionLoadProvider(provider: Provider | string | null | undefined): Provider {
  return normalizeProvider((provider || DEFAULT_PROVIDER) as Provider);
}

export function shouldApplySessionLoadResult(
  requestId: number,
  activeRequestId: number,
  cancelled: boolean,
): boolean {
  return !cancelled && requestId === activeRequestId;
}

