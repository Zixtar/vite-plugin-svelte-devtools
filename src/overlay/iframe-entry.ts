/**
 * iframe-entry.ts — entry point for the overlay SPA served inside the
 * Vite DevTools iframe panel.
 *
 * Unlike main.ts (which wraps in Shadow DOM and injects into the user's page),
 * this mounts DevTools directly into document.body since the iframe provides
 * its own isolated document.
 */
import { mount } from 'svelte'
import DevTools from './DevTools.svelte'
// Side-effect: starts the bridge (will auto-detect RPC or window events)
import './bridge.svelte'
import { bridge, togglePickMode } from './bridge.svelte'

// Alt+C toggles pick mode; Esc cancels it (same effect as Alt+C when active).
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.altKey && e.key === 'c') {
    e.preventDefault()
    togglePickMode()
  } else if (e.key === 'Escape' && bridge.pickMode) {
    togglePickMode()
  }
})

// Reset pick mode when the iframe tab is hidden (panel closed/switched away).
document.addEventListener('visibilitychange', () => {
  if (document.hidden && bridge.pickMode) {
    togglePickMode()
  }
})

function bootstrap() {
  const root = document.createElement('div')
  root.id = 'svelte-devtools-root'
  document.body.appendChild(root)
  mount(DevTools, { target: root, props: { alwaysOpen: true } })
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap)
} else {
  bootstrap()
}
