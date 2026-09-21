import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { buildDefines } from './scripts/build-env'

// Pure-browser dev server for UI previews: `pnpm dev:renderer`.
// Serves the renderer bundle without launching Electron or the core.
export default defineConfig({
  root: 'src/renderer',
  envDir: '../..',
  define: buildDefines,
  build: {
    rollupOptions: {
      input: {
        index: resolve('src/renderer/index.html'),
        floating: resolve('src/renderer/floating.html'),
        traymenu: resolve('src/renderer/traymenu.html')
      }
    }
  },
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src')
    }
  },
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173
  }
})
