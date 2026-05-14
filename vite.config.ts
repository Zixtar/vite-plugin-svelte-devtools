import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolve } from 'path'

// Controlled by BUILD_TARGET env var:
//   BUILD_TARGET=lib  → library build (Vite plugin + injected overlay bundle)
//   BUILD_TARGET=spa  → iframe SPA build → dist/client/
//   (default)         → library build

const target = process.env.BUILD_TARGET ?? 'lib'

const spaConfig = defineConfig({
  plugins: [svelte()],
  root: resolve(__dirname, 'src/overlay'),
  // Assets are served at /.svelte-devtools/ — use that as base so the
  // built index.html references /assets/... as /.svelte-devtools/assets/...
  base: '/.svelte-devtools/',
  resolve: {
    alias: {
      // devframe/client transitively imports node:crypto (via ohash) even
      // though it never runs the node code path in a browser.  Alias it to a
      // tiny Web Crypto shim so the bundle doesn't blow up at runtime.
      'node:crypto': resolve(__dirname, 'src/overlay/shims/node-crypto.ts'),
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist/client'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/overlay/index.html'),
    },
  },
})

const libConfig = defineConfig({
  plugins: [svelte()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      input: {
        'plugin/index': resolve(__dirname, 'src/plugin/index.ts'),
        'overlay/overlay': resolve(__dirname, 'src/overlay/main.ts'),
      },
      output: [
        {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
        {
          format: 'cjs',
          entryFileNames: (chunkInfo) =>
            chunkInfo.name.startsWith('plugin') ? '[name].cjs' : '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].cjs',
        },
      ],
      external: ['vite', 'fs', 'path', 'url', 'module', 'node:fs', 'node:path', 'node:url'],
    },
  },
})

export default target === 'spa' ? spaConfig : libConfig
