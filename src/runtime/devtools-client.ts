/**
 * devtools-client.ts
 *
 * Injected into the user's app page (browser) when @vitejs/devtools is active.
 *
 * Transport: Vite HMR WebSocket (import.meta.hot)
 *   - Runtime events  →  hot.send('sdt:event', msg)   →  Vite server
 *   - Commands        ←  hot.on('sdt:cmd', handler)   ←  Vite server
 *   - Ready signal    ←  hot.on('sdt:ready', handler) ←  Vite server (relayed from iframe)
 *
 * The Vite plugin handles these on the server side and relays them to/from
 * the iframe via the @vitejs/devtools RPC channel.
 */

const CHANNEL_OUT = 'sdt:runtime' // runtime dispatches here
const CHANNEL_IN  = 'sdt:overlay' // runtime listens here

if (import.meta.hot) {
  const hot = import.meta.hot

  // 1. Forward every runtime event to the Vite server over HMR WebSocket
  window.addEventListener(CHANNEL_OUT, (e: Event) => {
    const msg = (e as CustomEvent).detail
    hot.send('sdt:event', msg)
  })

  // 2. Receive commands from the server (relayed from the iframe)
  hot.on('sdt:cmd', (msg: unknown) => {
    window.dispatchEvent(new CustomEvent(CHANNEL_IN, { detail: msg }))
  })

  // 3. When the iframe signals it is ready and listening, trigger the
  //    runtime to send the full dt:init snapshot
  hot.on('sdt:ready', () => {
    window.dispatchEvent(new CustomEvent('sdt:overlay-ready'))
  })
}
