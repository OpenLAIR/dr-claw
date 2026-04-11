import type { SessionProvider } from '../types/app';
import ClaudeLogo from './ClaudeLogo';
import CodexLogo from './CodexLogo';
import CursorLogo from './CursorLogo';
import GeminiLogo from './GeminiLogo';
import LocalGpuLogo from './LocalGpuLogo';
import NanoClaudeLogo from './NanoClaudeLogo';
import OpenRouterLogo from './OpenRouterLogo';

type SessionProviderLogoProps = {
  provider?: SessionProvider | string | null;
  className?: string;
};

export default function SessionProviderLogo({
  provider = 'claude',
  className = 'w-5 h-5',
}: SessionProviderLogoProps) {
  if (provider === 'cursor') {
    return <CursorLogo className={className} />;
  }

  if (provider === 'codex') {
    return <CodexLogo className={className} />;
  }

  if (provider === 'gemini') {
    return <GeminiLogo className={className} />;
  }

  if (provider === 'openrouter') {
    return <OpenRouterLogo className={className} />;
  }

  if (provider === 'local') {
    return <LocalGpuLogo className={className} />;
  }

  if (provider === 'nano') {
    return <NanoClaudeLogo className={className} />;
  }

  return <ClaudeLogo className={className} />;
}
