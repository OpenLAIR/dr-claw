import { useTranslation } from 'react-i18next';
import ComposerSelect from './ComposerSelect';
import { codexReasoningEfforts, type CodexReasoningEffortId } from '../../constants/codexReasoningEfforts';
import { getSupportedCodexReasoningEfforts } from '../../constants/codexReasoningSupport';

type CodexReasoningEffortSelectorProps = {
  model: string;
  /** Efforts the Codex CLI reported for `model`; null when discovery is unavailable. */
  supportedEfforts?: readonly string[] | null;
  selectedEffort: CodexReasoningEffortId;
  onEffortChange: (effortId: CodexReasoningEffortId) => void;
  onClose?: () => void;
  className?: string;
  compact?: boolean;
};

export default function CodexReasoningEffortSelector({ model, supportedEfforts, selectedEffort, onEffortChange, onClose, className }: CodexReasoningEffortSelectorProps) {
  const { t } = useTranslation('chat');
  const supported = getSupportedCodexReasoningEfforts(model, supportedEfforts);
  const options = codexReasoningEfforts.filter(effort => supported.includes(effort.id)).map(effort => ({
    value: effort.id, label: t(`codexReasoningEffort.levels.${effort.id}.name`),
    description: t(`codexReasoningEffort.levels.${effort.id}.description`),
  }));
  if (!options.length) return null;
  return <ComposerSelect label={t('codexReasoningEffort.selector.title')} value={selectedEffort} options={options}
    title={t('codexReasoningEffort.buttonTitle', { level: options.find(option => option.value === selectedEffort)?.label || options[0].label })}
    onChange={value => onEffortChange(value as CodexReasoningEffortId)} onClose={onClose} className={className} />;
}
