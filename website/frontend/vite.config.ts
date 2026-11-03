/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // API_PROXY_TARGET has no VITE_ prefix, so it stays in this config and never reaches the browser.
  const env = loadEnv(mode, process.cwd(), '')
  const apiProxy = {
    // FastAPI (uvicorn) on loopback. When it isn't running the proxy answers 502,
    // which the API client reports as "Can't reach the EcoPantry server".
    '/api/v1': { target: env.API_PROXY_TARGET || 'http://127.0.0.1:8000' },
  }

  return {
    // DEV_HTTPS=true serves the dev server over HTTPS with a throwaway self-signed certificate.
    // Browsers only allow the camera (QR scanner) on HTTPS or localhost, so this is how to
    // try the scanner from a phone on the local network (`npm run dev -- --host`).
    plugins: [react(), tailwindcss(), ...(env.DEV_HTTPS === 'true' ? [basicSsl()] : [])],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: { proxy: apiProxy },
    preview: { proxy: apiProxy },
    test: {
      environment: 'jsdom',
      globals: false,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  }
})
