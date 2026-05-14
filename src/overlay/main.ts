import { mount } from 'svelte'
import DevTools from './DevTools.svelte'
// Side-effect: start the bridge (subscribes to runtime events)
import './bridge.svelte'
import { bridge, togglePickMode } from './bridge.svelte'
// Single source of truth for all overlay styles — also used by index.html via <link>
import CSS from './devtools.css?raw'

// Global shortcuts — registered on the main document so they work regardless
// of which element has focus (shadow DOM doesn't receive events from outside).
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.altKey && e.key === 'c') {
    e.preventDefault()
    togglePickMode()
  } else if (e.key === 'Escape' && bridge.pickMode) {
    togglePickMode()
  }
})

// Shadow-DOM path overrides: panel is a fixed floating window; badge is visible.
// (none needed — devtools.css already contains the full panel definition)

function bootstrap() {
  // The host covers the full viewport as a fixed, pointer-events-none layer.
  const host = document.createElement('div')
  host.id = '__svelte_devtools__'
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0',
    width: '0',
    height: '0',
    pointerEvents: 'none',
    zIndex: '2147483647',
    overflow: 'visible',
  })
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })

  // Inject all styles directly into the shadow root so they apply
  // (Svelte's <style> blocks go to document.head, not the shadow root)
  const styleEl = document.createElement('style')
  styleEl.textContent = CSS
  shadow.appendChild(styleEl)

  const root = document.createElement('div')
  shadow.appendChild(root)

  mount(DevTools, { target: root })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}
