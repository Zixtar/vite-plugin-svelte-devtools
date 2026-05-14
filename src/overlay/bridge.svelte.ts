/**
 * Overlay bridge — subscribes to the runtime event channel and exposes
 * reactive $state stores for the UI components.
 *
 * Transport layer:
 *   - When running inside a @vitejs/devtools iframe (remote: true dock):
 *     uses connectRemoteDevTools() from @vitejs/devtools-kit/client.
 *     The connection descriptor is injected into the iframe URL by the host.
 *   - Standalone floating overlay (legacy mode): uses window CustomEvents.
 */

type NodeId = string

export interface ComponentNode {
  id: NodeId
  name: string
  parentId: NodeId | null
  childIds: NodeId[]
  props: Record<string, unknown>
  state: Record<string, unknown>
  stores: Record<string, unknown>
  context: Record<string, unknown>
  renderTime: number
  renderCount: number
  domSelector?: string
  writableKeys: string[]
  sourceFile?: string
}

export interface EventEntry {
  id: string
  componentId: NodeId
  componentName: string
  event: string
  detail: unknown
  timestamp: number
}

export interface PropChange {
  id: string
  timestamp: number
  componentId: NodeId
  componentName: string
  key: string
  kind: 'prop' | 'state'
  oldValue: unknown
  value: unknown
  destroyed?: true
}

type DevToolsMessage =
  | { type: 'dt:init'; nodes: ComponentNode[] }
  | { type: 'dt:batch'; added: ComponentNode[]; updated: ComponentNode[]; removed: NodeId[] }
  | { type: 'dt:node-added'; node: ComponentNode }
  | { type: 'dt:node-updated'; node: ComponentNode }
  | { type: 'dt:node-removed'; id: NodeId }
  | { type: 'dt:event'; entry: EventEntry }
  | { type: 'dt:picked'; id: NodeId; name: string }
  | { type: 'dt:pick-mode'; active: boolean }
  | { type: 'dt:stores-updated'; stores: Record<string, unknown>; writableStores?: string[] }
  | { type: 'dt:tracking'; enabled: boolean }
  | { type: 'dt:cmd:set-prop'; id: NodeId; key: string; value: unknown }
  | { type: 'dt:cmd:highlight'; id: NodeId | null }
  | { type: 'dt:cmd:pick-mode'; active: boolean }
  | { type: 'dt:cmd:set-store'; name: string; value: unknown }
  | { type: 'dt:cmd:set-tracking'; enabled: boolean }
  | { type: 'dt:cmd:scroll-to'; id: NodeId }

// ---------------------------------------------------------------------------
// Reactive state — one exported object, mutated in-place (never reassigned)
// ---------------------------------------------------------------------------

export const bridge = $state({
  nodes: new Map<NodeId, ComponentNode>(),
  // Incremented once per batched flush — components that need to react to
  // tree changes should read this instead of bridge.nodes directly.
  nodesVersion: 0,
  selectedId: null as NodeId | null,
  events: [] as EventEntry[],
  stores: {} as Record<string, unknown>,
  writableStores: [] as string[],
  activeTab: 'inspector' as 'inspector' | 'stores' | 'perf' | 'history',
  pickMode: false,
  // Whether the runtime is currently collecting and sending node data.
  // false = paused (zero overhead); true = active.
  // Seeded from localStorage so the preference survives page reloads.
  tracking: loadTracking(),
  // Tree search query (empty string = no filter)
  treeSearch: '',
  // Set of "componentId:propKey" strings the user has pinned
  pinnedProps: new Set<string>(),
  // Chronological log of changes to pinned props/state
  propHistory: [] as PropChange[],
  // Previous prop snapshots per node (for diffing)
  _prevProps: new Map<NodeId, Record<string, unknown>>(),
  // Previous state snapshots per node (for diffing)
  _prevState: new Map<NodeId, Record<string, unknown>>(),
})

export function selectedNode(): ComponentNode | null {
  // Read nodesVersion so this derived value re-runs on every batched flush
  // (bridge.nodes values are plain objects — their property mutations are not
  // individually tracked, only Map.set() calls are).
  void bridge.nodesVersion
  return bridge.selectedId ? bridge.nodes.get(bridge.selectedId) ?? null : null
}

export function rootNodes(): ComponentNode[] {
  // Read nodesVersion to subscribe to batch flushes — bridge.nodes itself is
  // mutated in-place and does not change identity between flushes.
  void bridge.nodesVersion
  return Array.from(bridge.nodes.values()).filter(
    (n) => n.parentId === null || !bridge.nodes.has(n.parentId)
  )
}

// ---------------------------------------------------------------------------
// Listen to the runtime
// ---------------------------------------------------------------------------

const CHANNEL_IN = 'sdt:runtime'
const CHANNEL_OUT = 'sdt:overlay'

// sendCmd is replaced with an async-initialised function once the transport
// is known. Initially it queues commands until the transport is ready.
let _sendQueue: DevToolsMessage[] = []
let _sendFn: ((msg: DevToolsMessage) => void) | null = null

function send(msg: DevToolsMessage) {
  if (_sendFn) _sendFn(msg)
  else _sendQueue.push(msg)
}

function _flushQueue(fn: (msg: DevToolsMessage) => void) {
  _sendFn = fn
  _sendQueue.forEach(fn)
  _sendQueue = []
}

let historySeq = 0
let _highlightedId: NodeId | null = null

// ---------------------------------------------------------------------------
// Batched update flush — coalesces rapid node-added/updated/removed events
// into a single Map reassignment per animation frame to avoid O(n²) re-renders
// when a page with many components mounts all at once.
// ---------------------------------------------------------------------------
let _pendingFlush = false

function scheduleFlush() {
  if (_pendingFlush) return
  _pendingFlush = true
  const tick = () => {
    _pendingFlush = false
    bridge.nodesVersion++
  }
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(tick)
  } else {
    Promise.resolve().then(tick)
  }
}

function diffProps(node: ComponentNode) {
  const prevProps = bridge._prevProps.get(node.id) ?? {}
  const prevState = bridge._prevState.get(node.id) ?? {}
  const newEntries: PropChange[] = []

  for (const key of Object.keys(node.props)) {
    const pinKey = `${node.id}:${key}`
    if (!bridge.pinnedProps.has(pinKey)) continue
    const cur = JSON.stringify(node.props[key])
    const old = JSON.stringify(prevProps[key])
    if (cur !== old) {
      newEntries.push({
        id: String(++historySeq),
        timestamp: Date.now(),
        componentId: node.id,
        componentName: node.name,
        key,
        kind: 'prop',
        oldValue: prevProps[key],
        value: node.props[key],
      })
    }
  }

  for (const key of Object.keys(node.state)) {
    const pinKey = `${node.id}:${key}`
    if (!bridge.pinnedProps.has(pinKey)) continue
    const cur = JSON.stringify(node.state[key])
    const old = JSON.stringify(prevState[key])
    if (cur !== old) {
      newEntries.push({
        id: String(++historySeq),
        timestamp: Date.now(),
        componentId: node.id,
        componentName: node.name,
        key,
        kind: 'state',
        oldValue: prevState[key],
        value: node.state[key],
      })
    }
  }

  if (newEntries.length) {
    bridge.propHistory = [...newEntries, ...bridge.propHistory].slice(0, 500)
  }

  bridge._prevProps.set(node.id, { ...node.props })
  bridge._prevState.set(node.id, { ...node.state })
}

function onNodeRemoved(id: NodeId) {
  // For every pinned prop/state on this node, add a tombstone history entry
  // then remove the pin so counts stay accurate.
  const node = bridge.nodes.get(id)
  const tombstones: PropChange[] = []
  for (const pinKey of bridge.pinnedProps) {
    const [pinNodeId, ...rest] = pinKey.split(':')
    if (pinNodeId !== id) continue
    const key = rest.join(':')
    const kind: 'prop' | 'state' =
      node && key in node.state ? 'state' : 'prop'
    const lastValue = node
      ? (kind === 'state' ? node.state[key] : node.props[key])
      : undefined
    tombstones.push({
      id: String(++historySeq),
      timestamp: Date.now(),
      componentId: id,
      componentName: node?.name ?? id,
      key,
      kind,
      oldValue: lastValue,
      value: undefined,
      destroyed: true,
    })
  }
  if (tombstones.length) {
    bridge.propHistory = [...tombstones, ...bridge.propHistory].slice(0, 500)
    // Remove the pins for this node
    const next = new Set(bridge.pinnedProps)
    for (const t of tombstones) next.delete(`${id}:${t.key}`)
    bridge.pinnedProps = next
  }

  bridge.nodes.delete(id)
  bridge._prevProps.delete(id)
  bridge._prevState.delete(id)
  if (bridge.selectedId === id) bridge.selectedId = null
  if (_highlightedId === id) {
    _highlightedId = null
    send({ type: 'dt:cmd:highlight', id: null })
  }
}

function handleMsg(msg: DevToolsMessage) {
  switch (msg.type) {
    case 'dt:init':
      bridge.nodes = new Map(msg.nodes.map((n) => [n.id, n]))
      // Seed prev-snapshots so diffProps has a correct baseline on the first
      // update after an init (otherwise oldValue would always be undefined).
      for (const n of msg.nodes) {
        bridge._prevProps.set(n.id, { ...n.props })
        bridge._prevState.set(n.id, { ...n.state })
      }
      bridge.nodesVersion++
      break
    case 'dt:batch': {
      for (const node of msg.added) {
        bridge.nodes.set(node.id, node)
        // Seed prev-snapshots so the first update for this node has a correct
        // baseline (otherwise oldValue would be undefined in prop history).
        bridge._prevProps.set(node.id, { ...node.props })
        bridge._prevState.set(node.id, { ...node.state })
        // Update parent's childIds in bridge — parent may have been added in a
        // previous frame and its stored childIds won't include this new child
        if (node.parentId) {
          const parent = bridge.nodes.get(node.parentId)
          if (parent && !parent.childIds.includes(node.id)) {
            parent.childIds = [...parent.childIds, node.id]
          }
        }
      }
      for (const node of msg.updated) {
        diffProps(node)
        bridge.nodes.set(node.id, node)
      }
      for (const id of msg.removed) {
        const removed = bridge.nodes.get(id)
        if (removed?.parentId) {
          const parent = bridge.nodes.get(removed.parentId)
          if (parent) parent.childIds = parent.childIds.filter((c) => c !== id)
        }
        onNodeRemoved(id)
      }
      if (msg.added.length || msg.updated.length || msg.removed.length) scheduleFlush()
      break
    }
    case 'dt:node-added':
      bridge.nodes.set(msg.node.id, msg.node)
      scheduleFlush()
      break
    case 'dt:node-updated':
      diffProps(msg.node)
      bridge.nodes.set(msg.node.id, msg.node)
      scheduleFlush()
      break
    case 'dt:node-removed':
      onNodeRemoved(msg.id)
      scheduleFlush()
      break
    case 'dt:event':
      bridge.events = [msg.entry, ...bridge.events].slice(0, 200)
      break
    case 'dt:pick-mode':
      bridge.pickMode = msg.active
      break
    case 'dt:stores-updated':
      bridge.stores = msg.stores
      if (msg.writableStores) bridge.writableStores = msg.writableStores
      break
    case 'dt:tracking':
      bridge.tracking = msg.enabled
      break
    case 'dt:picked':
      bridge.selectedId = msg.id
      bridge.pickMode = false
      bridge.activeTab = 'inspector'
      break
  }
}

// Try to connect via Vite DevTools RPC (iframe remote mode).
// connectRemoteDevTools() reads the connection descriptor injected into the
// iframe URL by the @vitejs/devtools host (requires remote: true on the dock).
// Falls back to window events when no descriptor is present (standalone overlay).
async function initTransport() {
  try {
    const { connectRemoteDevTools } = await import('@vitejs/devtools-kit/client')
    const rpc = await connectRemoteDevTools()

    // Wait for the auth handshake to complete before making any RPC calls.
    // In @vitejs/devtools-kit 0.1.22+ the WS connection requires a trust
    // round-trip (vite:anonymous:auth) before the server accepts our calls.
    await rpc.ensureTrusted()

    // RPC mode: receive runtime events forwarded from the user app via server
    rpc.client.register({
      name: 'svelte-devtools:event',
      type: 'event',
      handler: (msg: unknown) => {
        handleMsg(msg as DevToolsMessage)
      },
    })

    // RPC mode: send commands to user app via server relay
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rpcCall = (rpc.call as any).bind(rpc)
    _flushQueue((msg) => {
      rpcCall('svelte-devtools:forward-cmd', msg).catch(() => {})
    })

    // Sync the persisted tracking preference to the runtime.
    send({ type: 'dt:cmd:set-tracking', enabled: bridge.tracking })

    // Reset pick mode — the panel may have been closed while pick was active.
    // The runtime will echo back the authoritative state via dt:pick-mode.
    bridge.pickMode = false

    // Signal the user app that the iframe is ready and listening.
    // The server relays this as an HMR 'sdt:ready' event → triggers dt:init snapshot.
    // Pass null instead of undefined to avoid wire serialization errors (#325).
    rpcCall('svelte-devtools:iframe-ready', null).catch(() => {})
  } catch (_e) {
    // Standalone mode: use window CustomEvents
    window.addEventListener(CHANNEL_IN, (e: Event) => {
      const msg = (e as CustomEvent<DevToolsMessage>).detail
      handleMsg(msg)
    })

    _flushQueue((msg) => {
      window.dispatchEvent(new CustomEvent(CHANNEL_OUT, { detail: msg }))
    })

    // Sync the persisted tracking preference to the runtime.
    send({ type: 'dt:cmd:set-tracking', enabled: bridge.tracking })

    // Reset pick mode on reconnect — runtime will echo authoritative state.
    bridge.pickMode = false

    // Tell the runtime we're ready
    window.dispatchEvent(new CustomEvent('sdt:overlay-ready'))
  }
}

initTransport()

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export function selectNode(id: NodeId | null) {
  bridge.selectedId = id
  // Highlighting is driven by hover only — don't send a highlight on select.
}

export function highlightNode(id: NodeId | null) {
  _highlightedId = id
  send({ type: 'dt:cmd:highlight', id })
}

export function setProp(id: NodeId, key: string, value: unknown) {
  const node = bridge.nodes.get(id)
  if (!node) return
  // Optimistically update whichever bucket the key lives in so the panel
  // reflects the new value immediately (before the component re-renders and
  // sends a dt:node-updated with the authoritative snapshot).
  if (key in node.props) {
    node.props[key] = value
  } else if (key in node.state) {
    node.state[key] = value
  }
  // Re-set the node in the Map so Svelte's proxy tracks the change,
  // then schedule a flush so selectedNode() subscribers re-run.
  bridge.nodes.set(id, node)
  scheduleFlush()
  send({ type: 'dt:cmd:set-prop', id, key, value })
}

export function clearEvents() {
  bridge.events = []
}

export function togglePickMode() {
  bridge.pickMode = !bridge.pickMode
  send({ type: 'dt:cmd:pick-mode', active: bridge.pickMode })
}

export function togglePin(nodeId: NodeId, key: string) {
  const pinKey = `${nodeId}:${key}`
  const next = new Set(bridge.pinnedProps)
  if (next.has(pinKey)) next.delete(pinKey)
  else next.add(pinKey)
  bridge.pinnedProps = next
}

export function clearHistory() {
  bridge.propHistory = []
}

export function unpinAll() {
  bridge.pinnedProps = new Set()
}

export function unpinOne(nodeId: NodeId, key: string) {
  const next = new Set(bridge.pinnedProps)
  next.delete(`${nodeId}:${key}`)
  bridge.pinnedProps = next
}

export function openInEditor(file: string) {
  fetch(`/__open-in-editor?file=${encodeURIComponent(file)}`).catch(() => {})
}

export function scrollToComponent(id: NodeId) {
  send({ type: 'dt:cmd:scroll-to', id })
}

export function setStore(name: string, value: unknown) {
  send({ type: 'dt:cmd:set-store', name, value })
}

const TRACKING_KEY = 'svelte-devtools:tracking'

function loadTracking(): boolean {
  try {
    return localStorage.getItem(TRACKING_KEY) !== 'false'
  } catch (_e) {
    return true
  }
}

function saveTracking(enabled: boolean) {
  try { localStorage.setItem(TRACKING_KEY, String(enabled)) } catch (_e) { /* ignore */ }
}

export function setTracking(enabled: boolean) {
  saveTracking(enabled)
  // Optimistically update so the button flips instantly
  bridge.tracking = enabled
  send({ type: 'dt:cmd:set-tracking', enabled })
}
