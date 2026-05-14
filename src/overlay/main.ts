/**
 * Overlay entry point — bootstraps the runtime listener and mounts the
 * DevTools panel as a Shadow DOM host so it can't be affected by the
 * host app's styles.
 */
import { mount } from 'svelte'
import DevTools from './DevTools.svelte'
// Side-effect: start the bridge (subscribes to runtime events)
import './bridge.svelte'
import { bridge, togglePickMode } from './bridge.svelte'

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

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

.panel {
  position: fixed;
  left: 16px;
  top: 16px;
  z-index: 2147483647;
  width: 420px;
  height: 560px;
  background: #0f1923;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.6);
  display: flex;
  flex-direction: column;
  font-family: 'Consolas', 'Fira Code', monospace;
  font-size: 13px;
  color: #d0d0d0;
  overflow: hidden;
  resize: both;
  pointer-events: auto;
}
.panel.paused {
  outline: 3px solid #c9a227;
}
.panel.pick-active {
  outline: 3px solid #ff3e00;
}

.titlebar {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  gap: 6px;
  background: #152030;
  cursor: grab;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  user-select: none;
  flex-shrink: 0;
}
.titlebar:active { cursor: grabbing; }

.logo {
  font-size: 13px;
  font-weight: 700;
  color: #ff3e00;
  flex: 1;
}

.close {
  background: none;
  border: none;
  color: #666;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 2px 4px;
}
.close:hover { color: #fff; }

.tabs {
  display: flex;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  background: #0f1923;
  overflow-x: auto;
  flex-shrink: 0;
}
.tabs button {
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  color: #666;
  font-size: 11px;
  padding: 6px 12px;
  cursor: pointer;
  white-space: nowrap;
  font-family: inherit;
}
.tabs button:hover { color: #ccc; }
.tabs button.active {
  color: #ff9d6c;
  border-bottom-color: #ff3e00;
}
.tabs button.settings-tab {
  margin-left: auto;
}

.content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.badge {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 2147483647;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #ff3e00;
  border: none;
  color: #fff;
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
}
.badge:hover { background: #e83000; }

/* Sub-component shared styles */
.section { padding: 8px; overflow-y: auto; flex: 1; }
h3 { font-size: 11px; text-transform: uppercase; color: #888; margin: 0 0 4px; }
.empty { color: #555; font-size: 12px; padding: 4px 0; }
table { width: 100%; border-collapse: collapse; font-size: 12px; }
th { text-align: left; color: #666; font-weight: 500; padding: 2px 6px; font-size: 11px; }
td { padding: 3px 6px; border-bottom: 1px solid rgba(255,255,255,0.05); }

/* Tree */
.tree { overflow-y: auto; flex: 1; padding: 6px 0; }
.node { user-select: none; }
.node-row {
  display: flex; align-items: center; gap: 4px;
  padding: 2px 6px; border-radius: 4px; cursor: pointer; font-size: 12px;
}
.node-row:hover { background: rgba(255,255,255,0.07); }
.node-row.selected { background: rgba(255,62,0,0.25); }
.toggle { background: none; border: none; color: #aaa; cursor: pointer; padding: 0; font-size: 10px; width: 14px; }
.toggle-spacer { width: 14px; display: inline-block; }
.comp-name { color: #ff9d6c; font-weight: 600; }
.render-badge { font-size: 10px; background: rgba(255,255,255,0.1); border-radius: 10px; padding: 0 5px; color: #aaa; margin-left: auto; }

/* State panel */
.key { color: #7ecfff; width: 40%; }
.val { color: #c8e6c9; word-break: break-all; }
.val-btn { background: none; border: none; color: inherit; cursor: pointer; text-align: left; width: 100%; padding: 0; font-size: 12px; }
.val-btn:hover { text-decoration: underline; }
input.edit {
  background: #1e2a35; border: 1px solid #ff3e00; color: #c8e6c9;
  font-size: 12px; width: 100%; padding: 1px 4px; border-radius: 3px;
}

/* Store inspector */
.store-key { color: #ce93d8; width: 40%; }

/* Perf */
.perf-key { color: #ff9d6c; }
.num { color: #aaa; text-align: right; }
.bar-cell { width: 80px; }
.bar { height: 8px; border-radius: 4px; background: #4caf50; min-width: 2px; }
.bar.slow { background: #f44336; }

/* Event log */
.header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.header button {
  font-size: 11px; padding: 2px 8px; background: rgba(255,255,255,0.08);
  border: 1px solid rgba(255,255,255,0.15); border-radius: 4px; color: #aaa; cursor: pointer;
}
.header button:hover { background: rgba(255,255,255,0.14); }
.time { color: #666; white-space: nowrap; }
.comp { color: #ff9d6c; }
.evt { color: #7ecfff; }
.detail { color: #c8e6c9; word-break: break-all; max-width: 180px; }

/* Pin button */
.pin-cell { width: 22px; text-align: center; padding: 0; }
.pin-btn { background: none; border: none; cursor: pointer; color: #999; font-size: 14px; padding: 0 2px; line-height: 1; transition: color 0.1s; }
.pin-btn.pinned { color: #ff9d6c; }
.pin-btn:hover { color: #aaa; }
.jump-btn { background: none; border: none; cursor: pointer; color: #ff9d6c; font-size: 14px; padding: 0 2px; line-height: 1; opacity: 0.6; }
.jump-btn:hover { opacity: 1; }
.jump { width: 20px; text-align: center; }

/* Pick button */
.pick-btn { background: none; border: none; color: #666; cursor: pointer; font-size: 16px; line-height: 1; padding: 2px 4px; }
.pick-btn:hover { color: #fff; }
.pick-btn.active { color: #ff3e00; }
`

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
