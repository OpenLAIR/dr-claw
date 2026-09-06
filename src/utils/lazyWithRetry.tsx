import { lazy } from 'react';
import type { ComponentProps, ComponentType } from 'react';

type Loader<T extends ComponentType<any>> = () => Promise<{ default: T }>;

type LazyWithRetryOptions = {
  /** Extra attempts after the first failure before giving up. */
  retries?: number;
  /** Base delay between attempts; grows linearly with each retry. */
  delayMs?: number;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

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
 * This wrapper retries transient failures and, if the loader still fails,
 * discards the rejected lazy component so the next render (after an error
 * boundary reset or a close/reopen) starts a fresh load instead of rethrowing
 * the cached error.
 */
export default function lazyWithRetry<T extends ComponentType<any>>(
  loader: Loader<T>,
  { retries = 2, delayMs = 500 }: LazyWithRetryOptions = {},
): ComponentType<ComponentProps<T>> {
  let Lazy: ComponentType<any> = createLazy();

  function createLazy() {
    return lazy(() =>
      loadWithRetry(loader, retries, delayMs).catch((error) => {
        Lazy = createLazy();
        throw error;
      }),
    );
  }

  function LazyWithRetry(props: ComponentProps<T>) {
    const Component = Lazy;
    return <Component {...props} />;
  }

  return LazyWithRetry;
}
