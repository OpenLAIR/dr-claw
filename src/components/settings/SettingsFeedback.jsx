import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button';

export default function SettingsFeedback({ state, onRetry, saved = true, failureMessage }) {
  const { t } = useTranslation('settings');
  if (!state) return null;
  if (state.pending) return <p role="status" className="text-sm text-muted-foreground">{t('feedback.working')}</p>;
  if (state.error) return <div role="alert" className="space-y-2 rounded-md border border-destructive/30 p-3 text-sm">
    <p>{failureMessage || t('feedback.failed')}</p>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{t('feedback.details')}</summary><p className="mt-1 whitespace-pre-wrap break-words">{state.error}</p></details>
    {onRetry && <Button type="button" variant="outline" size="sm" className="min-h-11 md:min-h-8" onClick={onRetry}>{t('feedback.retry')}</Button>}
  </div>;
  if (saved && state.success) return <p role="status" className="text-sm text-muted-foreground">{t('feedback.saved')}</p>;
  return null;
}
