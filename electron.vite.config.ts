import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // node-llama-cpp is ESM-only; the main process must build as ESM so it
    // can `import` it directly instead of the bundler trying to require()
    // it (which throws ERR_REQUIRE_ESM).
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'es' }
      }
    }
  },
  preload: {
    // Electron preload scripts ignore package.json's "type": "module" and
    // specifically require the .mjs extension to be loaded as ESM.
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: { format: 'es', entryFileNames: '[name].mjs' }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
