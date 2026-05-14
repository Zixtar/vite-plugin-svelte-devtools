/// <reference types="@vitejs/devtools-kit" />
import type { Plugin } from 'vite'
import { resolve, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { devToolsPreprocessor } from './preprocessor.ts'
import { defineRpcFunction } from '@vitejs/devtools-kit'
import launchEditor from 'launch-editor'


// ---------------------------------------------------------------------------
// Testable open-in-editor middleware handler
// ---------------------------------------------------------------------------

/** Pure handler exported so unit tests can inject a mock launchEditor. */
export function openInEditorHandler(
  req: { url?: string },
  res: { statusCode: number; end: (body: string) => void },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  _launch: (...args: any[]) => void = launchEditor,
) {
  const url = new URL(req.url ?? '', 'http://localhost')
  const file = url.searchParams.get('file') ?? ''
  if (!file) { res.statusCode = 400; res.end('missing file'); return }
  _launch(file + ':1:1', undefined, (fileName: string, errorMsg: string) => {
    console.warn(`[svelte-devtools] Could not open ${fileName} in editor: ${errorMsg}`)
  })
  res.statusCode = 200
  res.end('ok')
}

const __dirname = dirname(fileURLToPath(import.meta.url))

// Absolute path to the self-contained runtime source file.
const RUNTIME_SRC = resolve(__dirname, '../runtime/index.ts')
const OVERLAY_MAIN_SRC = resolve(__dirname, '../overlay/main.ts')

// The overlay SPA built output (used when serving inside Vite DevTools iframe)
const OVERLAY_DIST = resolve(__dirname, '../../dist/client')

const VIRTUAL_RUNTIME = 'virtual:svelte-devtools/runtime'
const RESOLVED_VIRTUAL = '\0virtual:svelte-devtools/runtime'

// The client-side script that wires the runtime event bus to Vite DevTools RPC
const DEVTOOLS_CLIENT_SRC = resolve(__dirname, '../runtime/devtools-client.ts')
const VIRTUAL_DEVTOOLS_CLIENT = 'virtual:svelte-devtools/devtools-client'
const RESOLVED_DEVTOOLS_CLIENT = '\0virtual:svelte-devtools/devtools-client'

const NOOP_RUNTIME = [
  '__sdt_mount__', '__sdt_unmount__', '__sdt_update__', '__sdt_update_el__',
  '__sdt_event__', '__sdt_subscribe_store__',
  '__sdt_register_prop_setter__', '__sdt_instrument__', '__sdt_reset__', '__sdt_flush__',
].map((fn) => `export function ${fn}(){return ''}`).join('\n')

// ---------------------------------------------------------------------------
// Vite DevTools RPC type augmentation
// ---------------------------------------------------------------------------
declare module '@vitejs/devtools-kit' {
  interface DevToolsRpcServerFunctions {
    /** iframe → server: forward a command to the user app via HMR WS */
    'svelte-devtools:forward-cmd': (msg: unknown) => Promise<void>
    /** iframe → server: iframe is ready, relay sdt:ready to user app */
    'svelte-devtools:iframe-ready': (arg: null | undefined) => Promise<void>
  }
  interface DevToolsRpcClientFunctions {
    /** server → iframe: deliver a runtime event */
    'svelte-devtools:event': (msg: unknown) => void
  }
}

export interface SvelteDevToolsOptions {
  /** Only activate during `vite dev` (default: true). */
  devOnly?: boolean
}

/**
 * Usage in vite.config.ts:
 *
 *   import { svelte } from '@sveltejs/vite-plugin-svelte'
 *   import { svelteDevTools } from 'vite-plugin-svelte-devtools'
 *
 *   const devtools = svelteDevTools()
 *
 *   export default defineConfig({
 *     devtools: true,
 *     plugins: [
 *       svelte({ preprocess: devtools.preprocess }),
 *       devtools.plugin,
 *     ],
 *   })
 */
export function svelteDevTools(options: SvelteDevToolsOptions = {}) {
  const { devOnly = true } = options
  let isEnabled = false
  let hasViteDevTools = false

  const plugin: Plugin = {
    name: 'vite-plugin-svelte-devtools',
    enforce: 'pre',

    configureServer(server) {
      server.middlewares.use('/__open-in-editor', (req, res) => openInEditorHandler(req, res))
    },

    configResolved(config) {
      isEnabled = devOnly ? config.command === 'serve' : true
      // Detect if @vitejs/devtools is active by checking for its plugin in the pipeline
      hasViteDevTools = config.plugins.some((p) => p.name?.startsWith('vite:devtools:'))
      const pkgDir = resolve(__dirname, '../..')
      if (!config.server.fs.allow.includes(pkgDir)) {
        ;(config.server.fs.allow as string[]).push(pkgDir)
      }
    },

    resolveId(id) {
      if (id === VIRTUAL_RUNTIME) {
        if (!isEnabled) return '\0svelte-devtools-noop'
        return RESOLVED_VIRTUAL
      }
      if (id === VIRTUAL_DEVTOOLS_CLIENT) return RESOLVED_DEVTOOLS_CLIENT
    },

    load(id) {
      if (id === '\0svelte-devtools-noop') return NOOP_RUNTIME
      if (id === RESOLVED_VIRTUAL) {
        const parts = [`export * from ${JSON.stringify(RUNTIME_SRC)}`]
        if (hasViteDevTools) {
          // Wire runtime events → Vite DevTools RPC instead of injecting the overlay
          parts.push(`import ${JSON.stringify(DEVTOOLS_CLIENT_SRC)}`)
        } else {
          // Inject the floating overlay panel (legacy mode)
          parts.push(`import ${JSON.stringify(OVERLAY_MAIN_SRC)}`)
        }
        return parts.join('\n')
      }
      if (id === RESOLVED_DEVTOOLS_CLIENT) {
        return `export * from ${JSON.stringify(DEVTOOLS_CLIENT_SRC)}`
      }
    },

    transformIndexHtml(html) {
      if (!isEnabled) return html
      return {
        html,
        tags: [
          {
            tag: 'script',
            attrs: { type: 'module', src: `/@id/__x00__${VIRTUAL_RUNTIME}` },
            injectTo: 'body',
          },
        ],
      }
    },

    // ---------------------------------------------------------------------------
    // @vitejs/devtools integration
    // ---------------------------------------------------------------------------
    devtools: {
      setup(ctx) {
        // Serve the overlay SPA as a static asset at /.svelte-devtools/
        ctx.views.hostStatic('/.svelte-devtools/', OVERLAY_DIST)

        // Register the iframe dock entry with remote: true so the host injects
        // a WS connection descriptor into the iframe URL, enabling
        // connectRemoteDevTools() to work inside the iframe.
        ctx.docks.register({
          id: 'svelte-devtools',
          title: 'Svelte',
          icon: 'data:image/svg+xml,%3Csvg viewBox%3D%220 0 98.1 118%22 xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Cpath d%3D%22M91.8 15.6C80.9-.1 59.2-4.7 43.6 5.2L16.1 22.8C8.6 27.5 3.4 35.2 2.1 43.9c-1.1 7.3.8 14.7 5.1 20.6-3.1 4.7-4.8 10.2-4.6 15.9.3 10.3 6.3 19.5 15.6 24.7l27.5 17.6c15.6 9.9 37.3 5.3 48.2-10.4 3-4.4 5-9.5 5.8-14.8.7-4.8.3-9.7-1.2-14.3 3.1-4.7 4.8-10.2 4.6-15.9-.3-10.4-6.3-19.6-15.5-24.7z%22 fill%3D%22%23ff3e00%22%2F%3E%3Cpath d%3D%22M40.9 103.9c-8.9 2.3-18.2-1.2-23.4-8.7-3.2-4.4-4.4-9.9-3.5-15.3.2-.9.4-1.7.6-2.6l.5-1.6 1.4 1c3.3 2.4 6.9 4.2 10.8 5.4l1 .3-.1 1c-.1 1.4.3 2.9 1.1 4.1 1.6 2.3 4.4 3.4 7.1 2.7.6-.2 1.2-.4 1.7-.8L65.5 72c1.4-.9 2.3-2.2 2.6-3.8.3-1.6-.1-3.3-1.1-4.6-1.6-2.3-4.4-3.3-7.1-2.6-.6.2-1.2.4-1.7.8l-10.5 6.7c-1.7 1.1-3.6 1.9-5.6 2.4-8.9 2.3-18.2-1.2-23.4-8.7-3.2-4.4-4.4-9.9-3.5-15.3.8-5.4 4-10.2 8.7-13.2l27.5-17.5c1.7-1.1 3.6-1.9 5.6-2.5 8.9-2.3 18.2 1.2 23.4 8.7 3.2 4.4 4.4 9.9 3.5 15.3-.2.9-.4 1.7-.7 2.6l-.5 1.6-1.4-1c-3.3-2.4-6.9-4.2-10.8-5.4l-1-.3.1-1c.1-1.4-.3-2.9-1.1-4.1-1.6-2.3-4.4-3.4-7.1-2.7-.6.2-1.2.4-1.7.8L32.4 46.1c-1.4.9-2.3 2.2-2.6 3.8s.1 3.3 1.1 4.6c1.6 2.3 4.4 3.3 7.1 2.6.6-.2 1.2-.4 1.7-.8l10.5-6.7c1.7-1.1 3.6-1.9 5.6-2.5 8.9-2.3 18.2 1.2 23.4 8.7 3.2 4.4 4.4 9.9 3.5 15.3-.8 5.4-4 10.2-8.7 13.2l-27.5 17.5c-1.7 1.1-3.5 2-5.6 2.5z%22 fill%3D%22%23fff%22%2F%3E%3C%2Fsvg%3E',
          type: 'iframe',
          url: '/.svelte-devtools/',
          remote: true,
        })

        // RPC: iframe → server → user app (commands: prop edits, highlight, pick)
        ctx.rpc.register(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          defineRpcFunction({
            name: 'svelte-devtools:forward-cmd',
            type: 'action',
            setup: () => ({
              handler: async (msg: unknown) => {
                // Relay command to user app via HMR WebSocket
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(ctx as any).viteServer?.ws.send({ type: 'custom', event: 'sdt:cmd', data: msg })
              },
            }),
          }) as any,
        )

        // RPC: iframe → server: iframe is ready, tell user app to send dt:init
        ctx.rpc.register(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          defineRpcFunction({
            name: 'svelte-devtools:iframe-ready',
            type: 'action',
            setup: () => ({
              handler: async () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ;(ctx as any).viteServer?.ws.send({ type: 'custom', event: 'sdt:ready', data: {} })
              },
            }),
          }) as any,
        )

        // HMR: user app → server → iframe (runtime events via import.meta.hot.send)
        ctx.viteServer?.ws.on('sdt:event', (msg: unknown, client) => {
          // Broadcast the event to all RPC clients (the iframe)
          ctx.rpc.broadcast({ method: 'svelte-devtools:event', args: [msg] })
        })
      },
    },
  }

  const preprocess = buildPreprocessArray()
  return { plugin, preprocess }
}

export function buildPreprocessArray() {
  return [
    {
      name: 'svelte-devtools',
      script({
        content,
        filename,
        attributes,
      }: {
        content: string
        filename?: string
        attributes: Record<string, string | boolean>
      }) {
        if (!filename) return { code: content }
        const name = basename(filename, '.svelte')
        const pp = devToolsPreprocessor(name)
        return pp.script!({ content, filename, attributes, markup: '' })
      },
      markup({ content, filename }: { content: string; filename?: string }) {
        if (!filename) return { code: content }
        const name = basename(filename, '.svelte')
        const pp = devToolsPreprocessor(name)
        return pp.markup!({ content, filename })
      },
    },
  ]
}

