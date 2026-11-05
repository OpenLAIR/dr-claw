// Service worker setup for the web UI.
//
// - Web production builds register /sw.js (offline fallback for the HTML).
// - Development and the Electron desktop app run without one, and remove any
//   worker and UI caches left behind. The desktop app always loads from its
//   own local server, so the offline copy has no value there, while a worker
//   persists across installs on the same origin (http://127.0.0.1:3001): after
//   an upgrade the previous version's worker kept sitting between the new UI
//   and the server.

const UI_CACHE_PREFIX = 'dr-claw-ui-';

export async function removeServiceWorkers({ serviceWorker, cacheStorage } = {}) {
  if (serviceWorker?.getRegistrations) {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if (cacheStorage?.keys) {
    const names = await cacheStorage.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(UI_CACHE_PREFIX))
        .map((name) => cacheStorage.delete(name)),
    );
  }
}

/**
 * @param {object} options
 * @param {boolean} options.isProduction
 * @param {boolean} options.isElectron
 * @param {{ register: Function, getRegistrations: Function } | undefined} options.serviceWorker
 *   navigator.serviceWorker, when supported.
 * @param {{ keys: Function, delete: Function } | undefined} options.cacheStorage
 *   window.caches, when available.
 * @param {(callback: () => void) => void} options.onLoad Runs the callback after the page load event.
 * @returns {'register'|'remove'|'unsupported'}
 */
export function setupServiceWorker({ isProduction, isElectron, serviceWorker, cacheStorage, onLoad }) {
  if (!serviceWorker) {
    return 'unsupported';
  }

  if (isProduction && !isElectron) {
    onLoad(() => {
      serviceWorker.register('/sw.js').catch((err) => {
        console.warn('Failed to register service worker:', err);
      });
    });
    return 'register';
  }

  removeServiceWorkers({ serviceWorker, cacheStorage }).catch((err) => {
    console.warn('Failed to remove service workers:', err);
  });
  return 'remove';
}
