import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import {
  DEFAULT_BACKEND_PORT,
  DEFAULT_FRONTEND_PORT,
  getBackendPortSync,
  parsePortNumber,
  setRuntimePortSync
} from './server/utils/runtimePorts.js'

function buildProxyTarget(protocol, host, fallbackPort) {
  return `${protocol}://${host}:${getBackendPortSync(fallbackPort)}`
}

function configureDynamicProxy(proxy, protocol, host, fallbackPort, eventName = 'proxyReq') {
  const syncTarget = () => {
    proxy.options.target = buildProxyTarget(protocol, host, fallbackPort)
  }

  syncTarget()
  proxy.on(eventName, syncTarget)

  // Vite adds its own error handler *after* configure() returns,
  // so we must wait a tick to replace it with ours.
  process.nextTick(() => {
    proxy.removeAllListeners('error')
    proxy.on('error', (err, _req, res) => {
      if (err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') return
      console.error(`[vite] proxy error: ${err.message}`)
      if (res && !res.headersSent && typeof res.writeHead === 'function') {
        res.writeHead(502)
        res.end('Bad Gateway')
      }
    })
  })
}

function runtimePortSyncPlugin() {
  return {
    name: 'runtime-port-sync',
    configureServer(server) {
      const recordFrontendPort = () => {
        const address = server.httpServer?.address()
        if (address && typeof address === 'object' && address.port) {
          setRuntimePortSync('frontend', address.port)
        }
      }

      if (server.httpServer) {
        server.httpServer.once('listening', recordFrontendPort)
      }
    }
  }
}

// Vendor chunks pinned by package. Patterns require a path separator after the
// package name so `react` does not also capture react-i18next, react-markdown, etc.
const VENDOR_CHUNKS = [
  ['vendor-react', /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run[\\/]router)[\\/]/],
  [
    'vendor-codemirror',
    /[\\/]node_modules[\\/](@uiw[\\/](react-codemirror|codemirror-extensions-basic-setup)|@codemirror|@lezer|@marijn[\\/]find-cluster-break|style-mod|w3c-keyname|crelt)[\\/]/,
  ],
  ['vendor-xterm', /[\\/]node_modules[\\/]@xterm[\\/]/],
];

export default defineConfig(({ command, mode }) => {
  // Load env file based on `mode` in the current working directory.
  const env = loadEnv(mode, process.cwd(), '')

  const host = env.HOST || '0.0.0.0'
  // When binding to all interfaces (0.0.0.0), proxy should connect to localhost.
  // Otherwise, proxy to the specific host the backend is bound to.
  const proxyHost = host === '0.0.0.0' ? 'localhost' : host
  const backendPort = parsePortNumber(env.PORT, DEFAULT_BACKEND_PORT)
  const frontendPort = parsePortNumber(env.VITE_PORT, DEFAULT_FRONTEND_PORT)

  return {
    plugins: [react(), runtimePortSyncPlugin()],
    server: {
      host,
      port: frontendPort,
      strictPort: false,
      proxy: {
        '/api': {
          target: buildProxyTarget('http', proxyHost, backendPort),
          configure(proxy) {
            configureDynamicProxy(proxy, 'http', proxyHost, backendPort)
          }
        },
        '/ws': {
          target: buildProxyTarget('ws', proxyHost, backendPort),
          ws: true,
          configure(proxy) {
            configureDynamicProxy(proxy, 'ws', proxyHost, backendPort, 'proxyReqWs')
          }
        },
        '/shell': {
          target: buildProxyTarget('ws', proxyHost, backendPort),
          ws: true,
          configure(proxy) {
            configureDynamicProxy(proxy, 'ws', proxyHost, backendPort, 'proxyReqWs')
          }
        }
      }
    },
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          // Function form on purpose: the object form also captures each listed
          // package's transitive dependencies, which pulled react/jsx-runtime and
          // the @babel/runtime helpers into the CodeMirror chunk and made every
          // page load (including the login screen) download all of CodeMirror.
          manualChunks(id) {
            const match = VENDOR_CHUNKS.find(([, pattern]) => pattern.test(id));
            return match ? match[0] : undefined;
          }
        }
      }
    }
  }
})
