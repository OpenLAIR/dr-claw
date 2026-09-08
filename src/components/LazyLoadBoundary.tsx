import { Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import ErrorBoundary from './ErrorBoundary';
import { LazyRetryScopeContext } from '../utils/lazyWithRetry';

type LazyLoadBoundaryProps = {
  children: ReactNode;
  resetKey?: string;
  mode?: 'page' | 'panel' | 'modal';
  onClose?: () => void;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
};

const CHUNK_LOAD_ERROR_PATTERNS = [
  /failed to fetch dynamically imported module/i, // Chromium (Vite)
  /error loading dynamically imported module/i, // Firefox
  /importing a module script failed/i, // Safari
  /loading (?:css )?chunk [\w-]+ failed/i, // webpack-style bundlers
  /ChunkLoadError/i,
];

export function isChunkLoadError(error: unknown): boolean {
  if (!error) return false;
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return CHUNK_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

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

function LazyLoadingFallback({ mode, onClose }: Pick<LazyLoadBoundaryProps, 'mode' | 'onClose'>) {
  const { t } = useTranslation('common');
  if (mode === 'modal' && onClose) return <LazyModalLoadingFallback onClose={onClose} />;

  return (
    <div className={`${mode === 'page' ? 'min-h-screen' : 'h-full min-h-48'} flex items-center justify-center p-4`} role="status" aria-live="polite">
      {t('mainContent.loading')}
    </div>
  );
}

/**
 * Error boundary for `lazy()` subtrees.
 *
 * Only chunk-load failures get the "the app may have been updated, reload" copy.
 * Any other error is a runtime bug and falls through to ErrorBoundary's default
 * UI, which keeps the stack trace and an in-place "Try Again". An explicit
 * `fallback` is a graceful-degradation node and is used for either kind.
 *
 * `resetKey` starts a fresh load only when recovering from an error. Healthy
 * children keep their state when the key changes.
 *
 * The inner Suspense lets this scope commit even if callers only provide an
 * outer Suspense. Callers may still nest a Suspense for a specific loading UI,
 * or pass `loadingFallback` here.
 */
export default function LazyLoadBoundary({
  children,
  resetKey,
  mode = 'panel',
  onClose,
  fallback,
  loadingFallback,
}: LazyLoadBoundaryProps) {
  const [retryScope, setRetryScope] = useState<object>(() => ({}));

  return (
    <ErrorBoundary
      resetKey={resetKey}
      onReset={() => setRetryScope({})}
      showDetails
      fallbackRender={(error: unknown) => {
        if (fallback !== undefined) return fallback;
        if (isChunkLoadError(error)) return <LazyLoadError mode={mode} onClose={onClose} />;
        return null;
      }}
    >
      <LazyRetryScopeContext.Provider value={retryScope}>
        <Suspense fallback={loadingFallback !== undefined ? loadingFallback : <LazyLoadingFallback mode={mode} onClose={onClose} />}>
          {children}
        </Suspense>
      </LazyRetryScopeContext.Provider>
    </ErrorBoundary>
  );
}
