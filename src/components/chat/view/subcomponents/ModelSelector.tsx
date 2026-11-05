import { useTranslation } from 'react-i18next';
import ComposerSelect from './ComposerSelect';

export interface ModelSelectorOption {
  value: string;
  label: string;
  description?: string;
  deprecated?: boolean;
}

interface ModelSelectorProps {
  value: string;
  options: ModelSelectorOption[];
  onChange: (v: string) => void;
}

export default function ModelSelector({ value, options, onChange }: ModelSelectorProps) {
  const { t } = useTranslation('chat');
  return <ComposerSelect label={t('modelSelector.label')} value={value} onChange={onChange}
    options={options.map(option => ({ ...option, meta: option.deprecated ? t('modelSelector.notInCliList') : undefined }))} />;
}
