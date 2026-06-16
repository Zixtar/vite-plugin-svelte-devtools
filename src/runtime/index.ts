/**
 * svelte-devtools runtime
 *
 * This module is injected into the user's app (browser) and:
 *  1. Exposes __sdt_instrument__ so transformed .svelte files can register.
 *  2. Hooks into Svelte 5's internal lifecycle via the component_root /
 *     effect APIs (where available) or falls back to wrapper tracking.
 *  3. Communicates with the overlay via a custom DOM event channel.
 *  4. Listens for commands from the overlay (prop edits, highlight requests).
 */

// ---------------------------------------------------------------------------
// Types (inlined so this file is self-contained when served as a virtual module)
// ---------------------------------------------------------------------------

type NodeId = string

interface ComponentNode {
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

interface EventEntry {
  id: string
  componentId: NodeId
  componentName: string
  event: string
  detail: unknown
  timestamp: number
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
  | { type: 'dt:cmd:inspect'; id: NodeId | null }
  | { type: 'dt:cmd:set-pinned-nodes'; nodeIds: NodeId[] }
  | { type: 'dt:inspected'; node: ComponentNode }

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let uidCounter = 0
const uid = () => String(++uidCounter)

const nodes = new Map<NodeId, ComponentNode>()
/** Map from component instance (object reference) to its NodeId */
const instanceMap = new WeakMap<object, NodeId>()
/** Map from NodeId to its root element reference (for picker reverse-lookup) */
const elementGetters = new Map<NodeId, Element | null>()
/** Map from NodeId to its context re-snapshot getter (captures raw context map at mount) */
const contextGetters = new Map<NodeId, () => Record<string, unknown>>()
/** Map from NodeId to its latest props getter (so we can re-snapshot on resume) */
const propsGetters = new Map<NodeId, () => Record<string, unknown>>()
/** Map from NodeId to its latest state getter (so we can re-snapshot on resume) */
const stateGetters = new Map<NodeId, () => Record<string, unknown>>()
/** Highlight overlay element */
let highlightEl: HTMLElement | null = null
/** NodeId currently being highlighted */
let highlightedId: NodeId | null = null
/** NodeId currently selected/inspected in the overlay */
let _inspectedId: NodeId | null = null
/** NodeIds that the user has pinned (always kept fresh) */
const _pinnedNodeIds = new Set<NodeId>()

// ---------------------------------------------------------------------------
// Event bus (runtime ↔ overlay share the same window)
// ---------------------------------------------------------------------------

const CHANNEL_OUT = 'sdt:runtime'
const CHANNEL_IN = 'sdt:overlay'

// ---------------------------------------------------------------------------
// Runtime-side batching — coalesces node add/update/remove events into a
// single flush per animation frame.  This is the primary fix for high-churn
// situations (virtual scrolling / datagrids) where hundreds of components
// mount/unmount per frame and would otherwise spam the RPC channel.
//
// Rules:
//  • node-added / node-updated  → deferred snapshot; getters stored so
//                                  safeClone runs ONCE at flush time, not on
//                                  every reactive update (key perf fix)
//  • node-removed               → recorded in _pendingRemovals; any pending
//                                  add/update for that id is dropped (node
//                                  appeared and disappeared within one frame)
//  • Other message types        → emitted immediately (low frequency)
// ---------------------------------------------------------------------------

type GetProps = () => Record<string, unknown>
type GetCtx   = () => Map<unknown, unknown> | object

type PendingOp = {
  op: 'add' | 'update'
  /** Accumulated render duration across all updates this frame */
  renderDuration: number
  /** Render count increments this frame */
  renderCount: number
  getProps: GetProps
  getState: GetProps
  // getContext re-clones from the live raw context map reference captured at
  // mount time.  getAllContexts() can only be called during component init, but
  // the raw Map reference stays valid and its values (e.g. $state objects) can
  // mutate, so we re-snapshot them at flush time on every update.
  getContext: () => Record<string, unknown>
}
const _pendingNodes = new Map<NodeId, PendingOp>()
const _pendingRemovals = new Set<NodeId>()
let _batchScheduled = false

// Maximum number of pending nodes/removals to process in a single frame.
// During a startup burst with hundreds or thousands of components, cloning
// every node's props/state/context synchronously would freeze the main thread.
// Chunking spreads the work across multiple rAF callbacks while keeping all
// background updates fully visible.
const BATCH_CHUNK_SIZE = 100

// ---------------------------------------------------------------------------
// Tracking toggle — when paused the runtime records nothing and emits nothing.
// Default: PAUSED (zero overhead until the user activates devtools).
// ---------------------------------------------------------------------------
let _paused = true

function scheduleBatch() {
  if (_batchScheduled) return
  _batchScheduled = true
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(flushBatch)
  } else {
    // No rAF (test/SSR env) — schedule as microtask; tests should call __sdt_flush__() explicitly.
    Promise.resolve().then(flushBatch)
  }
}

function flushBatch() {
  _batchScheduled = false
  if (_pendingNodes.size === 0 && _pendingRemovals.size === 0) return

  const added: ComponentNode[] = []
  const updated: ComponentNode[] = []
  const removed: NodeId[] = []
  let processed = 0

  // Process pending node add/updates in chunks so a startup burst with
  // thousands of components doesn't block the main thread.
  for (const [id, pending] of _pendingNodes) {
    if (_pendingRemovals.has(id)) {
      // born and died in same frame — skip entirely, but still clean up
      _pendingNodes.delete(id)
      continue
    }
    const node = nodes.get(id)
    if (!node) {
      _pendingNodes.delete(id)
      continue
    }
    // Snapshot once here — not on every reactive update.
    // Only pay the safeClone cost for the inspected node and pinned nodes;
    // every other node is sent as a lightweight skeleton so startup bursts
    // with thousands of components don't freeze the app.
    const shouldSnapshot = id === _inspectedId || _pinnedNodeIds.has(id)
    if (shouldSnapshot) {
      node.props = safeClone(pending.getProps())
      node.state = safeClone(pending.getState())
      node.context = pending.getContext()  // re-snapshot from live context map reference
    } else {
      // Keep skeleton buckets empty; the tree is still fully visible.
      node.props = {}
      node.state = {}
      node.context = {}
    }
    node.renderTime += pending.renderDuration
    node.renderCount += pending.renderCount
    if (pending.op === 'add') added.push(deepClone(node))
    else updated.push(deepClone(node))
    _pendingNodes.delete(id)
    processed++
    if (processed >= BATCH_CHUNK_SIZE) break
  }

  // Use any remaining chunk budget for removals.
  if (processed < BATCH_CHUNK_SIZE) {
    for (const id of _pendingRemovals) {
      removed.push(id)
      _pendingRemovals.delete(id)
      processed++
      if (processed >= BATCH_CHUNK_SIZE) break
    }
  }

  // Emit the partial batch for this chunk.
  if (added.length || updated.length || removed.length) {
    emitImmediate({ type: 'dt:batch', added, updated, removed })
  }

  // If more work remains, schedule the next chunk on the next frame.
  if (_pendingNodes.size > 0 || _pendingRemovals.size > 0) {
    scheduleBatch()
  }
}

function emitImmediate(msg: DevToolsMessage) {
  window.dispatchEvent(new CustomEvent(CHANNEL_OUT, { detail: msg }))
}

/**
 * Fully snapshots props/state/context for a single node.
 * Used when the overlay requests inspection or a node becomes pinned.
 */
function snapshotNodeDetails(id: NodeId): ComponentNode | null {
  const node = nodes.get(id)
  if (!node) return null
  const getProps = propsGetters.get(id) ?? (() => ({}))
  const getState = stateGetters.get(id) ?? (() => ({}))
  const getContext = contextGetters.get(id) ?? (() => ({}))
  node.props = safeClone(getProps())
  node.state = safeClone(getState())
  node.context = getContext()
  return node
}

/** Emits a `dt:inspected` message with a full snapshot of the requested node. */
function emitInspected(id: NodeId | null) {
  if (id == null) return
  const node = snapshotNodeDetails(id)
  if (!node) return
  emitImmediate({ type: 'dt:inspected', node: deepClone(node) })
}

function enqueueMount(
  id: NodeId,
  getProps: GetProps,
  getState: GetProps,
  getContext: () => Record<string, unknown>,
) {
  propsGetters.set(id, getProps)
  stateGetters.set(id, getState)
  if (_paused) return
  _pendingNodes.set(id, { op: 'add', renderDuration: 0, renderCount: 0, getProps, getState, getContext })
  scheduleBatch()
}

function enqueueUpdate(
  id: NodeId,
  renderDuration: number,
  getProps: GetProps,
  getState: GetProps,
  getContext: () => Record<string, unknown>,
) {
  propsGetters.set(id, getProps)
  stateGetters.set(id, getState)
  if (_paused) return
  const existing = _pendingNodes.get(id)
  if (existing) {
    existing.renderDuration += renderDuration
    existing.renderCount += 1
    existing.getProps = getProps
    existing.getState = getState
    existing.getContext = getContext
  } else {
    _pendingNodes.set(id, { op: 'update', renderDuration, renderCount: 1, getProps, getState, getContext })
  }
  scheduleBatch()
}

function enqueueRemoval(id: NodeId) {
  if (_paused) return
  _pendingRemovals.add(id)
  scheduleBatch()
}

function emit(msg: DevToolsMessage) {
  emitImmediate(msg)
}

window.addEventListener(CHANNEL_IN, (e: Event) => {
  const msg = (e as CustomEvent<DevToolsMessage>).detail
  handleCommand(msg)
})

// ---------------------------------------------------------------------------
// Public API exposed to instrumented components
// ---------------------------------------------------------------------------

/**
 * Called at the top of every transformed .svelte module.
 * Returns a hooks object that the module can optionally use to push
 * richer state snapshots.
 */
export function __sdt_instrument__(componentName: string, _getExtra: () => object) {
  // The actual per-instance hooks are created via __sdt_mount__ / __sdt_unmount__
  // which Svelte's lifecycle (onMount / onDestroy) will call.
  // We store the component name so it can be looked up by instance.
  ;(window as any).__sdt_names__ = (window as any).__sdt_names__ ?? {}
  ;(window as any).__sdt_names__[componentName] = true
}

/**
 * Snapshots the full context map available to this component (including inherited keys).
 * The __sdt__ key (our own internal parent-tracking key) is excluded.
 */
function snapshotOwnContext(
  ctxMap: Map<unknown, unknown> | object | undefined,
  _parentId: NodeId | null,
): Record<string, unknown> {
  if (!ctxMap || typeof (ctxMap as Map<unknown, unknown>).entries !== 'function') return {}
  const result: Record<string, unknown> = {}
  for (const [k, v] of ctxMap as Map<unknown, unknown>) {
    const key = String(k)
    if (key === '__sdt__') continue
    result[key] = (v !== null && typeof v === 'object') ? safeClone(v) : v
  }
  return result
}

/**
 * Called synchronously at component script evaluation time.
 * parentId comes from Svelte's getContext('__sdt__') injected by the preprocessor —
 * this correctly identifies the nearest ancestor regardless of sibling order.
 */
export function __sdt_mount__(
  instance: object,
  componentName: string,
  parentId: NodeId | null,
  getProps: () => Record<string, unknown>,
  getState: () => Record<string, unknown>,
  getContext: () => Map<unknown, unknown> | object = () => new Map(),
  writableKeys: string[] = [],
  sourceFile?: string,
) {
  const id = uid()
  instanceMap.set(instance, id)
  elementGetters.set(id, null)

  // Capture the raw context map NOW — getAllContexts() is only valid during
  // component initialisation. We keep a reference to the raw map so we can
  // re-snapshot its values (which may be reactive $state objects) on every
  // subsequent update without needing to call getAllContexts() again.
  const rawCtxMap = getContext()
  const makeGetContext = () => snapshotOwnContext(rawCtxMap, parentId)

  // Store so __sdt_update__ / snapshotNodeDetails can re-snapshot context
  // on demand. We deliberately do NOT call it here — snapshotOwnContext runs
  // safeClone on every object-shaped context value, and for a startup burst
  // with hundreds of components that is exactly the freeze we're avoiding.
  contextGetters.set(id, makeGetContext)

  // Create skeleton node — props/state/context are only filled when the node
  // is inspected or pinned.
  const node: ComponentNode = {
    id,
    name: componentName,
    parentId,
    childIds: [],
    props: {},
    state: {},
    stores: {},
    context: {},
    renderTime: 0,
    renderCount: 0,
    domSelector: undefined,
    writableKeys,
    sourceFile,
  }
  nodes.set(id, node)

  // Register as child of parent — parent's childIds updated in live nodes map.
  // The parent will send updated childIds via its own pending batch entry, or
  // the bridge reconstructs the tree from parentId on each added node.
  if (parentId) {
    const parent = nodes.get(parentId)
    if (parent && !parent.childIds.includes(id)) {
      parent.childIds.push(id)
    }
  }

  enqueueMount(id, getProps, getState, makeGetContext)
  return id
}

/**
 * Called from the use:__sdt_root__ action to register the DOM element for a component.
 * Stamps the element with data-sdt-id and caches the element reference directly
 * so subsequent lookups never need a document-wide querySelector.
 */
export function __sdt_update_el__(id: NodeId, rootEl: Element | null) {
  if (rootEl) {
    rootEl.setAttribute('data-sdt-id', id)
    elementGetters.set(id, rootEl)
    const node = nodes.get(id)
    if (node) node.domSelector = elementSelector(rootEl)
  }
}

/**
 * Called when a component updates (re-renders).
 * Store values are maintained separately by __sdt_subscribe_store__ subscriptions
 * and must not be overwritten here.
 */
export function __sdt_update__(
  id: NodeId,
  renderDuration: number,
  getProps: () => Record<string, unknown>,
  getState: () => Record<string, unknown>,
  _getContext: () => Map<unknown, unknown> | object = () => new Map(),
) {
  if (!nodes.has(id)) return
  // Reuse the getContext getter stored at mount time — it closes over the raw
  // context map captured during init (getAllContexts() can't be called here).
  const getContext = contextGetters.get(id) ?? (() => nodes.get(id)!.context)
  enqueueUpdate(id, renderDuration, getProps, getState, getContext)
}

/**
 * Called when a component is destroyed.
 */
export function __sdt_unmount__(id: NodeId) {
  const node = nodes.get(id)
  if (!node) return
  // Remove from parent's childIds
  if (node.parentId) {
    const parent = nodes.get(node.parentId)
    if (parent) parent.childIds = parent.childIds.filter((c) => c !== id)
  }
  // Recursively remove all descendants that are still in the map.
  // Svelte normally fires onDestroy on every child, but emit the removal
  // events here too so the bridge never has orphaned nodes.
  function removeSubtree(nodeId: NodeId) {
    const n = nodes.get(nodeId)
    if (!n) return
    for (const childId of n.childIds) removeSubtree(childId)
    const el = elementGetters.get(nodeId)
    if (el) {
      try { el.removeAttribute('data-sdt-id') } catch { /* ignore */ }
    }
    nodes.delete(nodeId)
    elementGetters.delete(nodeId)
    propSetters.delete(nodeId)
    contextGetters.delete(nodeId)
    propsGetters.delete(nodeId)
    stateGetters.delete(nodeId)
    // Cancel any pending add/update for this node — it's gone
    _pendingNodes.delete(nodeId)
    enqueueRemoval(nodeId)
  }
  // Remove children first (removeSubtree handles the node itself too,
  // but we've already removed it from the parent above so handle root separately)
  for (const childId of node.childIds) removeSubtree(childId)
  // Clean up the node itself
  const el = elementGetters.get(id)
  if (el) {
    try { el.removeAttribute('data-sdt-id') } catch { /* ignore */ }
  }
  nodes.delete(id)
  elementGetters.delete(id)
  propSetters.delete(id)
  contextGetters.delete(id)
  _pendingNodes.delete(id)
  if (highlightedId === id) {
    highlightedId = null
    clearHighlight()
  }
  enqueueRemoval(id)
}

/**
 * Emit a component event (dispatched DOM events / createEventDispatcher).
 */
export function __sdt_event__(
  id: NodeId,
  componentName: string,
  eventName: string,
  detail: unknown,
) {
  if (_paused) return
  const entry: EventEntry = {
    id: uid(),
    componentId: id,
    componentName,
    event: eventName,
    detail: safeClone(detail),
    timestamp: performance.now(),
  }
  emit({ type: 'dt:event', entry })
}

// ---------------------------------------------------------------------------
// Store subscription helper
// ---------------------------------------------------------------------------

const storeUnsubs = new Map<string, () => void>()
/** Global store registry: storeName → current value */
const storeRegistry = new Map<string, unknown>()
/** Store setters: storeName → store.set function (writable stores only) */
const storeSetters = new Map<string, (v: unknown) => void>()

export function __sdt_subscribe_store__(
  nodeId: NodeId,
  storeName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  store: { subscribe: (cb: (v: any) => void) => () => void; set?: (v: any) => void },
) {
  // One global subscription per store name — stores are singletons
  if (storeUnsubs.has(storeName)) return
  if (store.set) storeSetters.set(storeName, store.set)
  const unsub = store.subscribe((value) => {
    const cloned = safeCloneStoreValue(value)
    storeRegistry.set(storeName, cloned)
    emit({
      type: 'dt:stores-updated',
      stores: Object.fromEntries(storeRegistry),
      writableStores: Array.from(storeSetters.keys()),
    })
  })
  storeUnsubs.set(storeName, unsub)
}

// ---------------------------------------------------------------------------
// Overlay init: send current tree snapshot when the overlay is ready
// ---------------------------------------------------------------------------

window.addEventListener('sdt:overlay-ready', () => {
  // Tell the bridge what tracking state we're in right now
  emit({ type: 'dt:tracking', enabled: !_paused })
  // Tell the bridge the authoritative pick-mode state (may have been cancelled
  // by Esc while the panel was closed — bridge needs to sync on reconnect)
  emit({ type: 'dt:pick-mode', active: pickModeActive })
  // Flush any pending batch synchronously. With lazy inspection only the
  // inspected/pinned nodes carry full props/state; everything else is a skeleton.
  flushBatch()
  // Snapshot inspected/pinned nodes for the init payload.
  for (const id of nodes.keys()) {
    if (id === _inspectedId || _pinnedNodeIds.has(id)) snapshotNodeDetails(id)
  }
  emit({ type: 'dt:init', nodes: Array.from(nodes.values()).map(deepClone) })
  // If a node is already inspected, send its full snapshot immediately so the
  // inspector panel populates without requiring another selection.
  emitInspected(_inspectedId)
  if (storeRegistry.size > 0) {
    emit({
      type: 'dt:stores-updated',
      stores: Object.fromEntries(storeRegistry),
      writableStores: Array.from(storeSetters.keys()),
    })
  }
})

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

const propSetters = new Map<NodeId, (key: string, value: unknown) => void>()

export function __sdt_register_prop_setter__(
  id: NodeId,
  setter: (key: string, value: unknown) => void,
) {
  propSetters.set(id, setter)
}

function handleCommand(msg: DevToolsMessage) {
  switch (msg.type) {
    case 'dt:cmd:set-prop': {
      const setter = propSetters.get(msg.id)
      if (setter) setter(msg.key, msg.value)
      break
    }
    case 'dt:cmd:highlight': {
      clearHighlight()
      highlightedId = msg.id ?? null
      if (msg.id) {
        const el = elementGetters.get(msg.id)
        if (el) showHighlight(el as HTMLElement)
      }
      break
    }
    case 'dt:cmd:pick-mode': {
      if (msg.active) startPickMode()
      else stopPickMode()
      break
    }
    case 'dt:cmd:set-store': {
      const setter = storeSetters.get(msg.name)
      if (setter) setter(msg.value)
      break
    }
    case 'dt:cmd:scroll-to': {
      const el = elementGetters.get(msg.id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      break
    }
    case 'dt:cmd:inspect': {
      _inspectedId = msg.id
      emitInspected(_inspectedId)
      break
    }
    case 'dt:cmd:set-pinned-nodes': {
      _pinnedNodeIds.clear()
      for (const id of msg.nodeIds) _pinnedNodeIds.add(id)
      // Re-snapshot every pinned node immediately so panels populate without
      // waiting for the next flush.
      for (const id of _pinnedNodeIds) emitInspected(id)
      break
    }
    case 'dt:cmd:set-tracking': {
      const wasEnabled = !_paused
      _paused = !msg.enabled
      // Ack the new state back to the bridge
      emit({ type: 'dt:tracking', enabled: msg.enabled })
      // If just resumed, only the inspected and pinned nodes need full snapshots
      // for dt:init. Everything else can be sent as skeletons.
      if (!wasEnabled && msg.enabled) {
        for (const id of nodes.keys()) {
          if (id === _inspectedId || _pinnedNodeIds.has(id)) {
            snapshotNodeDetails(id)
          }
        }
        flushBatch()
        emit({ type: 'dt:init', nodes: Array.from(nodes.values()).map(deepClone) })
        // If there is an inspected node, send a dedicated dt:inspected so the
        // inspector panel populates immediately.
        emitInspected(_inspectedId)
      }
      // If just paused, discard any pending work
      if (wasEnabled && !msg.enabled) {
        _pendingNodes.clear()
        _pendingRemovals.clear()
        _batchScheduled = false
      }
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Component picker
// ---------------------------------------------------------------------------

let pickModeActive = false
let pickTooltipEl: HTMLElement | null = null

function findNodeByElement(target: Element): { id: NodeId; name: string } | null {
  // Collect all nodes whose root element contains the target, then pick the
  // deepest one (the node whose root is not contained by any other match's root).
  const matches: { id: NodeId; name: string; root: Element }[] = []
  for (const [id, root] of elementGetters) {
    if (root && (root === target || root.contains(target))) {
      const node = nodes.get(id)
      if (node) matches.push({ id, name: node.name, root })
    }
  }
  if (matches.length === 0) return null
  // The innermost node is the one whose root is contained by all other roots
  // (i.e. no other match's root is a descendant of it).
  const deepest = matches.reduce((best, cur) =>
    best.root.contains(cur.root) && best.root !== cur.root ? cur : best
  )
  return { id: deepest.id, name: deepest.name }
}

function startPickMode() {
  if (pickModeActive) return
  pickModeActive = true
  document.body.style.cursor = 'crosshair'

  if (!pickTooltipEl) {
    pickTooltipEl = document.createElement('div')
    pickTooltipEl.id = '__sdt_pick_tooltip__'
    Object.assign(pickTooltipEl.style, {
      position: 'fixed',
      zIndex: '2147483647',
      background: '#0f1923',
      color: '#ff9d6c',
      border: '1px solid rgba(255,255,255,0.2)',
      borderRadius: '4px',
      padding: '3px 8px',
      fontSize: '12px',
      fontFamily: 'monospace',
      pointerEvents: 'none',
      display: 'none',
    })
    document.body.appendChild(pickTooltipEl)
  }

  document.addEventListener('mousemove', onPickHover, true)
  document.addEventListener('click', onPickClick, true)
  document.addEventListener('keydown', onPickKey, true)
}

function stopPickMode() {
  if (!pickModeActive) return
  pickModeActive = false
  document.body.style.cursor = ''
  clearHighlight()
  if (pickTooltipEl) pickTooltipEl.style.display = 'none'
  document.removeEventListener('mousemove', onPickHover, true)
  document.removeEventListener('click', onPickClick, true)
  document.removeEventListener('keydown', onPickKey, true)
}

// Global Alt+C shortcut — always active, works regardless of focus
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.altKey && e.key === 'c') {
    e.preventDefault()
    if (pickModeActive) {
      stopPickMode()
      emit({ type: 'dt:pick-mode', active: false })
    } else {
      startPickMode()
      emit({ type: 'dt:pick-mode', active: true })
    }
  }
})

function onPickHover(e: Event) {
  const me = e as MouseEvent
  // Use elementsFromPoint to get all elements under cursor, pick the topmost
  // non-devtools one as the target for component matching
  const els = document.elementsFromPoint(me.clientX, me.clientY)
  const target = els.find(el =>
    el.id !== '__svelte_devtools__' &&
    el.id !== '__sdt_highlight__' &&
    el.id !== '__sdt_pick_tooltip__' &&
    el !== document.body &&
    el !== document.documentElement
  ) ?? (e.target as Element)

  const found = findNodeByElement(target)
  if (found) {
    const el = elementGetters.get(found.id) as HTMLElement | null
    if (el) showHighlight(el)
    if (pickTooltipEl) {
      const node = nodes.get(found.id)
      const filePart = node?.sourceFile
        ? ' — ' + node.sourceFile.replace(/.*[\\/]/, '')
        : ''
      pickTooltipEl.textContent = `<${found.name}>${filePart}`
      Object.assign(pickTooltipEl.style, {
        display: 'block',
        left: (me.clientX + 12) + 'px',
        top: (me.clientY + 12) + 'px',
      })
    }
  } else {
    clearHighlight()
    if (pickTooltipEl) pickTooltipEl.style.display = 'none'
  }
}

function onPickClick(e: Event) {
  e.preventDefault()
  e.stopPropagation()
  e.stopImmediatePropagation()
  const me = e as MouseEvent
  const els = document.elementsFromPoint(me.clientX, me.clientY)
  const target = els.find(el =>
    el.id !== '__svelte_devtools__' &&
    el.id !== '__sdt_highlight__' &&
    el.id !== '__sdt_pick_tooltip__' &&
    el !== document.body &&
    el !== document.documentElement
  ) ?? (e.target as Element)
  const found = findNodeByElement(target)
  if (found) emit({ type: 'dt:picked', id: found.id, name: found.name })
  stopPickMode()
  emit({ type: 'dt:pick-mode', active: false })
}

function onPickKey(e: Event) {
  if ((e as KeyboardEvent).key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    stopPickMode()
    emit({ type: 'dt:pick-mode', active: false })
  }
}

// ---------------------------------------------------------------------------
// DOM highlight
// ---------------------------------------------------------------------------

function showHighlight(el: HTMLElement) {
  if (!highlightEl) {
    highlightEl = document.createElement('div')
    highlightEl.id = '__sdt_highlight__'
    Object.assign(highlightEl.style, {
      position: 'fixed',
      zIndex: '2147483646',
      pointerEvents: 'none',
      borderRadius: '2px',
      transition: 'all 0.1s ease',
    })
    document.body.appendChild(highlightEl)
  }
  const rect = el.getBoundingClientRect()
  Object.assign(highlightEl.style, {
    outline: `3px solid #ff3e00`,
    backgroundColor: 'rgba(255,62,0,0.08)',
    top: rect.top + 'px',
    left: rect.left + 'px',
    width: rect.width + 'px',
    height: rect.height + 'px',
    display: 'block',
  })
}

function clearHighlight() {
  if (highlightEl) highlightEl.style.display = 'none'
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Sentinel stored in place of `undefined` so the value survives JSON serialization. */
export const SDT_UNDEFINED = '__sdt_undefined__'

const SAFE_CLONE_DEPTH = 5
const SAFE_CLONE_MAX_DEPTH_VALUE = '[max-depth]'

/**
 * Snapshot a props/state object for the devtools panel.
 *
 * We avoid JSON.parse/stringify on the hot path: it is slow, loses types like Map/Set,
 * and throws on circular references. A recursive walk with a depth cap handles the
 * common case (plain objects / arrays / primitives) much faster while still producing
 * a structured-clone-safe result.
 */
function safeClone(obj: unknown, depth = SAFE_CLONE_DEPTH): Record<string, unknown> {
  if (obj == null || typeof obj !== 'object') return {}
  if (depth <= 0) return { '': SAFE_CLONE_MAX_DEPTH_VALUE }
  // Fast path: empty props/state objects are extremely common; skip iteration.
  const keys = Object.keys(obj as object)
  if (keys.length === 0) return {}
  const out: Record<string, unknown> = {}
  for (const k of keys) {
    try {
      out[k] = cloneSnapshotValue((obj as Record<string, unknown>)[k], depth - 1)
    } catch {
      // Getter or enumerable access threw — omit rather than risk side-effects.
      out[k] = '[object]'
    }
  }
  return out
}

function cloneSnapshotValue(v: unknown, depth: number): unknown {
  if (v === undefined) return SDT_UNDEFINED
  // Skip functions and Svelte snippets entirely — calling String() on a snippet
  // throws snippet_without_render_tag, and functions are not useful to display.
  if (typeof v === 'function') return undefined
  if (v === null || typeof v !== 'object') return v
  if (depth <= 0) return SAFE_CLONE_MAX_DEPTH_VALUE
  if (Array.isArray(v)) return v.map((item) => cloneSnapshotValue(item, depth - 1))
  if (v instanceof Date) return v.toISOString()
  if (v instanceof Map) return safeClone(Object.fromEntries(v), depth - 1)
  if (v instanceof Set) return safeClone(Array.from(v), depth - 1)
  if (ArrayBuffer.isView(v) && !(v instanceof DataView)) {
    return Array.from(v as ArrayLike<unknown>).map((item) => cloneSnapshotValue(item, depth - 1))
  }
  return safeClone(v, depth - 1)
}

/** Clone a store value — preserves arrays (unlike safeClone which always returns a plain object). */
function safeCloneStoreValue(value: unknown): unknown {
  return cloneSnapshotValue(value, SAFE_CLONE_DEPTH)
}

function deepClone<T>(v: T): T {
  // Prefer native structuredClone: orders of magnitude faster than
  // JSON.parse/stringify for large objects and it preserves Maps/Sets/Dates.
  // Fall back to JSON round-trip in environments without it (older browsers,
  // or test environments where the global is missing).
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(v)
    } catch {
      // structuredClone throws on functions/DOM nodes; our nodes should be
      // safe, but fall back to JSON just in case.
    }
  }
  return JSON.parse(JSON.stringify(v)) as T
}

/**
 * Test helper — resets all internal runtime state so tests can start clean
 * without needing to re-import the module.
 */
export function __sdt_reset__() {
  uidCounter = 0
  nodes.clear()
  propSetters.clear()
  contextGetters.clear()
  propsGetters.clear()
  stateGetters.clear()
  for (const unsub of storeUnsubs.values()) unsub()
  storeUnsubs.clear()
  storeRegistry.clear()
  storeSetters.clear()
  clearHighlight()
  // Discard any pending batch from previous test
  _pendingNodes.clear()
  _pendingRemovals.clear()
  _batchScheduled = false
  _paused = true
  _inspectedId = null
  _pinnedNodeIds.clear()
}

/**
 * Test helper — flushes any pending batched node messages synchronously.
 * Call this after rt.__sdt_mount__ / __sdt_update__ / __sdt_unmount__ calls
 * in unit tests where requestAnimationFrame is not available.
 */
export function __sdt_flush__() {
  flushBatch()
}

function elementSelector(el: Element | null): string | undefined {
  if (!el) return undefined
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls = el.classList.length ? '.' + Array.from(el.classList).join('.') : ''
  return `${tag}${id}${cls}` || undefined
}
