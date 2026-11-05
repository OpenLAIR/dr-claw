import { useTranslation } from 'react-i18next';
import ComposerSelect from './ComposerSelect';
import { getSupportedGeminiThinkingModes, type GeminiThinkingModeId } from '../../../../../shared/geminiThinkingSupport';

type GeminiThinkingSelectorProps = {
  model: string;
  selectedMode: GeminiThinkingModeId;
  onModeChange: (modeId: GeminiThinkingModeId) => void;
  onClose?: () => void;
  className?: string;
  compact?: boolean;
};

function getBudgetForMode(model: string, mode: GeminiThinkingModeId) {
  if (model === 'gemini-2.5-pro') {
    if (mode === 'light') return 1024;
    if (mode === 'balanced') return 8192;
    if (mode === 'deep') return 24576;
    if (mode === 'max') return 32768;
  }

  if (model === 'gemini-2.5-flash') {
    if (mode === 'light') return 1024;
    if (mode === 'balanced') return 8192;
    if (mode === 'deep') return 24576;
  }

  if (model === 'gemini-2.5-flash-lite') {
    if (mode === 'light') return 512;
    if (mode === 'balanced') return 8192;
    if (mode === 'deep') return 24576;
  }

  return null;
}

export default function GeminiThinkingSelector({ model, selectedMode, onModeChange, onClose, className }: GeminiThinkingSelectorProps) {
  const { t } = useTranslation('chat');
  const options = getSupportedGeminiThinkingModes(model).map(mode => {
    const budget = getBudgetForMode(model, mode);
    return { value: mode, label: t(`geminiThinking.modes.${mode}.name`),
      description: t(`geminiThinking.modes.${mode}.description`, budget ? { budget: budget.toLocaleString() } : {}),
    };
  });
  if (!options.length) return null;
  return <ComposerSelect label={t('geminiThinking.selector.title')} value={selectedMode} options={options}
    title={t('geminiThinking.buttonTitle', { mode: options.find(option => option.value === selectedMode)?.label || options[0].label })}
    onChange={value => onModeChange(value as GeminiThinkingModeId)} onClose={onClose} className={className} />;
}
