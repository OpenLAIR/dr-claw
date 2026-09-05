import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ErrorBoundary from './ErrorBoundary';

type LazyLoadBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
  mode?: 'page' | 'panel' | 'modal';
  onClose?: () => void;
  fallback?: ReactNode;
};

export function LazyModalLoadingFallback({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-busy="true"
        aria-label={t('mainContent.loading')}
      >
        <div className="mx-auto h-7 w-7 animate-spin rounded-full border-[3px] border-muted border-t-primary" />
        <p className="mt-3 text-sm text-muted-foreground" role="status" aria-live="polite">
          {t('mainContent.loading')}
        </p>
        <button
          type="button"
          className="mt-5 rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
          onClick={onClose}
        >
          {t('lazyLoad.close')}
        </button>
      </div>
    </div>
  );
}

function LazyLoadError({ mode = 'panel', onClose }: Pick<LazyLoadBoundaryProps, 'mode' | 'onClose'>) {
  const { t } = useTranslation('common');
  const isPage = mode === 'page';
  const isModal = mode === 'modal';

  const content = (
    <div
      className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center shadow-lg"
      role="alert"
    >
      <h2 className="text-base font-semibold text-foreground">{t('lazyLoad.errorTitle')}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{t('lazyLoad.errorDescription')}</p>
      <div className="mt-5 flex justify-center gap-3">
        {onClose && (
          <button
            type="button"
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-muted"
            onClick={onClose}
          >
            {t('lazyLoad.close')}
          </button>
        )}
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground hover:opacity-90"
          onClick={() => window.location.reload()}
        >
          {t('lazyLoad.reload')}
        </button>
      </div>
    </div>
  );

  if (isModal) {
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">{content}</div>;
  }

  return (
    <div className={`${isPage ? 'min-h-screen' : 'h-full min-h-48'} flex items-center justify-center bg-background p-4`}>
      {content}
    </div>
  );
}

export default function LazyLoadBoundary({
  children,
  resetKey,
  mode = 'panel',
  onClose,
  fallback,
}: LazyLoadBoundaryProps) {
  return (
    <ErrorBoundary
      key={resetKey}
      resetKey={resetKey}
      fallback={fallback ?? <LazyLoadError mode={mode} onClose={onClose} />}
    >
      {children}
    </ErrorBoundary>
  );
}
