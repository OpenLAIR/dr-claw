import { useTranslation } from 'react-i18next';
import ComposerSelect from './ComposerSelect';
import { thinkingModes } from '../../constants/thinkingModes';

type ThinkingModeSelectorProps = {
  selectedMode: string;
  onModeChange: (modeId: string) => void;
  onClose?: () => void;
  className?: string;
  compact?: boolean;
};

export default function ThinkingModeSelector({ selectedMode, onModeChange, onClose, className }: ThinkingModeSelectorProps) {
  const { t } = useTranslation('chat');
  const modeKeys: Record<string, string> = { 'think-hard': 'thinkHard', 'think-harder': 'thinkHarder' };
  const options = thinkingModes.map(mode => ({
    value: mode.id, label: t(`thinkingMode.modes.${modeKeys[mode.id] || mode.id}.name`),
    description: t(`thinkingMode.modes.${modeKeys[mode.id] || mode.id}.description`),
  }));
  return <ComposerSelect label={t('thinkingMode.selector.title')} value={selectedMode} options={options}
    title={t('thinkingMode.buttonTitle', { mode: options.find(option => option.value === selectedMode)?.label || options[0].label })}
    onChange={onModeChange} onClose={onClose} className={className} />;
}
