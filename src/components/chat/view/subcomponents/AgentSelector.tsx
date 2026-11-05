import ComposerSelect from './ComposerSelect';
import SessionProviderLogo from '../../../SessionProviderLogo';
import type { SessionProvider } from '../../../../types/app';
import type { ProviderAvailability } from '../../types/types';

export type ProviderDef = {
  id: SessionProvider;
  name: string;
  accent: string;
  ring: string;
  check: string;
};

interface AgentSelectorProps {
  providers: ProviderDef[];
  activeProvider: SessionProvider;
  providerAvailability: Record<SessionProvider, ProviderAvailability>;
  onSelect: (id: SessionProvider) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export default function AgentSelector({ providers, activeProvider, providerAvailability, onSelect, t }: AgentSelectorProps) {
  return <ComposerSelect label={t('sessionContext.stats.provider')} value={activeProvider}
    onChange={value => onSelect(value as SessionProvider)} options={providers.map(provider => ({
      value: provider.id, label: provider.name,
      disabled: providerAvailability[provider.id]?.cliAvailable === false,
      meta: providerAvailability[provider.id]?.cliAvailable === false ? t('modelSelector.unavailable') : undefined,
      icon: <SessionProviderLogo provider={provider.id} className="h-4 w-4" />,
    }))} />;
}
