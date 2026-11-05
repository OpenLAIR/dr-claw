import { useTranslation } from 'react-i18next';
import type { ResearchStatus } from '../utils/useResearchStatus';

export default function ResearchStatusLabel({ running, needsAttention, status, onRetry }: {
  running: boolean; needsAttention: boolean; status?: ResearchStatus; onRetry: () => void;
}) {
  const { t } = useTranslation('common');
  const key = needsAttention ? 'needsAttention' : running ? 'running'
    : !status ? 'checkingStatus' : status.state === 'error' ? 'statusUnavailable' : 'ready';
  return <span className="text-xs">
    <span className={needsAttention ? 'text-red-700 dark:text-red-300' : running ? 'text-blue-700 dark:text-blue-300' : 'text-muted-foreground'}>{t(`workbench.${key}`)}</span>
    {status?.state === 'error' && <button onClick={onRetry} className="ml-2 rounded underline focus-visible:outline focus-visible:outline-2" aria-label={t('workbench.retryStatus')}>{t('buttons.retry')}</button>}
  </span>;
}
