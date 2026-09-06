import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import 'katex/dist/katex.min.css'

// Initialize i18n
import './i18n/config.js'

// Keep development free of stale caches while retaining offline support in production.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(err => {
        console.warn('Failed to register service worker:', err);
      });
    }, { once: true });
  } else {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        void registration.unregister();
      });
    }).catch(err => {
      console.warn('Failed to unregister service workers:', err);
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
