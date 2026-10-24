import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { BRANDING } from './shared/branding'

/** Reuse the runtime branding config for the static HTML title in dev/build. */
function brandingHtmlPlugin(): Plugin {
  return {
    name: 'temponest-branding-html',
    transformIndexHtml(html) {
      return html.replaceAll('%APP_NAME%', BRANDING.name)
    }
  }
}

/**
 * Electron enforces a Content-Security-Policy for packaged builds. The dev
 * server needs a slightly looser policy for React Fast Refresh, so it is set
 * as a response header from the main process instead (see electron/main.ts).
 */
function productionCspPlugin(): Plugin {
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "media-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'none'"
  ].join('; ')

  return {
    name: 'temponest-production-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/main.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'electron/preload.ts') }
      }
    }
  },
  renderer: {
    root: '.',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'shared')
      }
    },
    plugins: [react(), tailwindcss(), brandingHtmlPlugin(), productionCspPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'index.html') }
      }
    }
  }
})
