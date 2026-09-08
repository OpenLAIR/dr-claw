import { StrictMode, Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';

import LazyLoadBoundary from '../../src/components/LazyLoadBoundary';
import lazyWithRetry from '../../src/utils/lazyWithRetry';

const state = {
  attempts: { shared: 0, other: 0 },
  mode: 'failure',
  rejectPending: undefined as undefined | (() => void),
};
// Reuse the same error across loaders/attempts to exercise consumer isolation.
const failure = new Error('Fixture module failed');
const loaded = {
  default: function Loaded({ label }: { label: string }) {
    const [count, setCount] = useState(0);
    return <button onClick={() => setCount(count + 1)}>{label} loaded {count}</button>;
  },
};

function makeLazy(key: 'shared' | 'other') {
  return lazyWithRetry(async () => {
    state.attempts[key] += 1;
    if (state.mode === 'pending') {
      await new Promise((_, reject) => {
        state.rejectPending = () => reject(failure);
      });
    }
    if (state.mode === 'failure') throw failure;
    if (state.mode === 'chunk-failure') {
      throw new TypeError('Failed to fetch dynamically imported module');
    }
    return loaded;
  }, { retries: 2, delayMs: 10 });
}

const Shared = makeLazy('shared');
const Other = makeLazy('other');
Object.assign(window, { loadingFixture: state });

function Fixture() {
  const [visible, setVisible] = useState(true);
  const [resetKey, setResetKey] = useState(0);
  const [revision, setRevision] = useState(0);
  const params = new URLSearchParams(location.search);
  const multiple = params.has('multiple');
  const reverse = params.has('reverse');
  const contents = <Shared label="first" />;

  return <>
    <button onClick={() => setVisible(!visible)}>Toggle first</button>
    <button onClick={() => setResetKey(resetKey + 1)}>Change reset key</button>
    <button onClick={() => setRevision(revision + 1)}>Rerender {revision}</button>
    <section data-testid="first">
      {visible && (reverse
        ? <Suspense fallback={<p>Outer loading</p>}>
            <LazyLoadBoundary resetKey={String(resetKey)}>{contents}</LazyLoadBoundary>
          </Suspense>
        : <LazyLoadBoundary resetKey={String(resetKey)}>
            <Suspense fallback={<p>Inner loading</p>}>{contents}</Suspense>
          </LazyLoadBoundary>)}
    </section>
    {multiple && <>
      <section data-testid="second">
        <LazyLoadBoundary>
          <Suspense fallback={<p>Second loading</p>}><Shared label="second" /></Suspense>
        </LazyLoadBoundary>
      </section>
      <section data-testid="third">
        <LazyLoadBoundary>
          <Suspense fallback={<p>Third loading</p>}><Other label="third" /></Suspense>
        </LazyLoadBoundary>
      </section>
    </>}
  </>;
}

const i18n = i18next.createInstance();
await i18n.init({
  lng: 'en', fallbackLng: 'en',
  resources: { en: { common: {
    mainContent: { loading: 'Loading fixture' },
    lazyLoad: { errorTitle: 'Module unavailable', errorDescription: 'Reload to recover', reload: 'Reload page' },
  } } },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode><I18nextProvider i18n={i18n}><Fixture /></I18nextProvider></StrictMode>,
);
