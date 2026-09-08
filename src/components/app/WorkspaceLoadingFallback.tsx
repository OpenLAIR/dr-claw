import { useTranslation } from 'react-i18next';

export default function WorkspaceLoadingFallback() {
  const { t } = useTranslation('common');

  return (
    <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted border-t-primary" />
        <span className="text-sm">{t('mainContent.loading')}</span>
      </div>
    </div>
  );
}
