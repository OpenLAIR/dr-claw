import type { SessionProvider } from '../../../types/app';
import type { HarnessModelOption } from '../hooks/useHarnessModels';

type RescueHarnessModelArgs = {
  provider: SessionProvider;
  allowsCustom: boolean;
  currentModel: string;
  discoveredDefault: string;
  options: HarnessModelOption[];
};

export function shouldRescueHarnessModel({
  provider,
  allowsCustom,
  currentModel,
  discoveredDefault,
  options,
}: RescueHarnessModelArgs): boolean {
  if (!currentModel || !discoveredDefault || currentModel === discoveredDefault) return false;

  // Most free-form providers accept values absent from discovery. Pi is the
  // exception: its list is scoped to authenticated providers, so an absent
  // value cannot run until the user logs into that provider.
  if (allowsCustom && provider !== 'pi') return false;

  return !options.some((option) =>
    option.value === currentModel
    && !option.deprecated
    && (provider !== 'pi' || !option.builtIn),
  );
}
