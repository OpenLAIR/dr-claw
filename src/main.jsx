import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'
import { setupServiceWorker } from './utils/serviceWorkerSetup.js'

// Register the offline service worker for web production builds only; see
// utils/serviceWorkerSetup.js for why development and the desktop app run
// without one.
setupServiceWorker({
  isProduction: import.meta.env.PROD,
  isElectron: Boolean(window.isElectron),
  serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
  cacheStorage: typeof caches !== 'undefined' ? caches : undefined,
  onLoad: (callback) => window.addEventListener('load', callback, { once: true }),
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
