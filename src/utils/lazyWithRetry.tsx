import { createContext, lazy, useContext } from 'react';
import type { ComponentProps, ComponentType } from 'react';

type Loader<T extends ComponentType<any>> = () => Promise<{ default: T }>;

type LazyWithRetryOptions = {
  /** Extra attempts after the first failure before giving up. */
  retries?: number;
  /** Base delay between attempts; grows linearly with each retry. */
  delayMs?: number;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// LazyLoadBoundary owns a stable scope until an explicit retry or remount.
// Outside a boundary, keep React.lazy's normal (including rejected) cache.
export const LazyRetryScopeContext = createContext<object>({});

export async function loadWithRetry<T extends ComponentType<any>>(
  loader: Loader<T>,
  retries: number,
  delayMs: number,
): Promise<{ default: T }> {
  let attempt = 0;
  for (;;) {
    try {
      return await loader();
    } catch (error) {
      if (attempt >= retries) throw error;
      attempt += 1;
      await wait(delayMs * attempt);
    }
  }
}

/**
 * `React.lazy` caches a rejected import for the lifetime of the component, so a
 * single transient chunk-load failure leaves the component permanently broken
 * until a full page reload, even after an error boundary resets.
 *
 * Keep the lazy identity stable while React delivers a rejected load to the
 * error boundary. Replacing it in the rejection handler would make Suspense
 * start another load forever instead of showing the error UI.
 *
 * LazyLoadBoundary supplies a new scope on retry/reset or remount. Each scope
 * gets its own lazy instance, so retries and late failures cannot affect other
 * boundaries. Browsers may still cache a failed import URL; those failures
 * require the boundary's full-page reload action to recover.
 */
export default function lazyWithRetry<T extends ComponentType<any>>(
  loader: Loader<T>,
  { retries = 2, delayMs = 500 }: LazyWithRetryOptions = {},
): ComponentType<ComponentProps<T>> {
  const components = new WeakMap<object, ComponentType<any>>();

  function LazyWithRetry(props: ComponentProps<T>) {
    const scope = useContext(LazyRetryScopeContext);
    let Component = components.get(scope);
    if (!Component) {
      Component = lazy(() => loadWithRetry(loader, retries, delayMs));
      components.set(scope, Component);
    }
    return <Component {...props} />;
  }

  return LazyWithRetry;
}
