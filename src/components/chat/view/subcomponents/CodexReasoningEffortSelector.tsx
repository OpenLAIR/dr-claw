import { useState, useRef, useEffect } from 'react';
import { Brain, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { codexReasoningEfforts } from '../../constants/codexReasoningEfforts';
import type { CodexReasoningEffortId } from '../../constants/codexReasoningEfforts';
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

function CodexReasoningEffortSelector({
  model,
  supportedEfforts,
  selectedEffort,
  onEffortChange,
  onClose,
  className = '',
  compact,
}: CodexReasoningEffortSelectorProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const supportedEffortIds = getSupportedCodexReasoningEfforts(model, supportedEfforts);

  const translatedEfforts = codexReasoningEfforts
    .filter((effort) => supportedEffortIds.includes(effort.id))
    .map((effort) => ({
    ...effort,
    name: t(`codexReasoningEffort.levels.${effort.id}.name`),
    description: t(`codexReasoningEffort.levels.${effort.id}.description`),
    }));

  const currentEffort = translatedEfforts.find((effort) => effort.id === selectedEffort) || translatedEfforts[0];
  const IconComponent = currentEffort.icon || Brain;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`${compact ? 'w-7 h-7' : 'w-10 h-10 sm:w-10 sm:h-10'} rounded-full flex items-center justify-center transition-all duration-200 ${
          selectedEffort === 'default'
            ? 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600'
            : 'bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-900 dark:hover:bg-emerald-800'
        }`}
        title={t('codexReasoningEffort.buttonTitle', { level: currentEffort.name })}
      >
        <IconComponent className={`${compact ? 'w-3.5 h-3.5' : 'w-5 h-5'} ${currentEffort.color}`} />
      </button>

      {isOpen && (
        <div className={`absolute bottom-full right-0 mb-2 ${compact ? 'w-52' : 'w-72'} max-h-[min(420px,70vh)] bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 overflow-y-auto`}>
          <div className={`${compact ? 'px-2.5 py-2' : 'p-3'} border-b border-gray-200 dark:border-gray-700`}>
            <div className="flex items-center justify-between">
              <h3 className={`${compact ? 'text-xs' : 'text-sm'} font-semibold text-gray-900 dark:text-white`}>
                {t('codexReasoningEffort.selector.title')}
              </h3>
              <button
                onClick={() => {
                  setIsOpen(false);
                  onClose?.();
                }}
                className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
              >
                <X className={`${compact ? 'w-3 h-3' : 'w-4 h-4'} text-gray-500`} />
              </button>
            </div>
            {!compact && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                {t('codexReasoningEffort.selector.description')}
              </p>
            )}
          </div>

          <div className="py-0.5">
            {translatedEfforts.map((effort) => {
              const EffortIcon = effort.icon;
              const isSelected = effort.id === selectedEffort;

              return (
                <button
                  key={effort.id}
                  onClick={() => {
                    onEffortChange(effort.id);
                    setIsOpen(false);
                    onClose?.();
                  }}
                  className={`w-full ${compact ? 'px-2.5 py-1.5' : 'px-4 py-3'} text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                    isSelected ? 'bg-gray-50 dark:bg-gray-700' : ''
                  }`}
                >
                  <div className={`flex items-start ${compact ? 'gap-2' : 'gap-3'}`}>
                    <div className={`mt-0.5 ${effort.color}`}>
                      <EffortIcon className={`${compact ? 'w-3.5 h-3.5' : 'w-5 h-5'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`font-medium ${compact ? 'text-[11px]' : 'text-sm'} ${
                          isSelected ? 'text-gray-900 dark:text-white' : 'text-gray-700 dark:text-gray-300'
                        }`}>
                          {effort.name}
                        </span>
                        {isSelected && (
                          <span className={`${compact ? 'text-[9px] px-1.5 py-px' : 'text-xs px-2 py-0.5'} bg-emerald-100 dark:bg-emerald-900 text-emerald-700 dark:text-emerald-300 rounded`}>
                            {t('codexReasoningEffort.selector.active')}
                          </span>
                        )}
                      </div>
                      {!compact && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                          {effort.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {!compact && (
            <div className="p-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
              <p className="text-xs text-gray-600 dark:text-gray-400">
                <strong>Tip:</strong> {t('codexReasoningEffort.selector.tip')}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default CodexReasoningEffortSelector;
