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
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-codemirror': [
              '@uiw/react-codemirror',
              '@codemirror/lang-css',
              '@codemirror/lang-html',
              '@codemirror/lang-javascript',
              '@codemirror/lang-json',
              '@codemirror/lang-markdown',
              '@codemirror/lang-python',
              '@codemirror/theme-one-dark'
            ],
            'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-clipboard', '@xterm/addon-webgl']
          }
        }
      }
    }
  }
})
