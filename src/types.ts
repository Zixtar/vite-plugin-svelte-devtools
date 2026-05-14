// ---------------------------------------------------------------------------
// Shared message / data types used by both the runtime and the overlay UI
// ---------------------------------------------------------------------------

export type NodeId = string

export interface ComponentNode {
  id: NodeId
  name: string
  parentId: NodeId | null
  childIds: NodeId[]
  props: Record<string, unknown>
  /** Snapshot of $state / $derived runes */
  state: Record<string, unknown>
  /** Registered stores {name → value} */
  stores: Record<string, unknown>
  /** Cumulative render time (ms) */
  renderTime: number
  /** Number of renders */
  renderCount: number
  /** DOM element selector hint */
  domSelector?: string
  /** Absolute path to the source .svelte file */
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

// ---------------------------------------------------------------------------
// Message protocol (runtime → overlay and overlay → runtime)
// ---------------------------------------------------------------------------

export type DevToolsMessage =
  | { type: 'dt:init'; nodes: ComponentNode[] }
  | { type: 'dt:node-added'; node: ComponentNode }
  | { type: 'dt:node-updated'; node: ComponentNode }
  | { type: 'dt:node-removed'; id: NodeId }
  | { type: 'dt:event'; entry: EventEntry }
  | { type: 'dt:picked'; id: NodeId; name: string }
  | { type: 'dt:pick-mode'; active: boolean }
  // Overlay → runtime commands
  | { type: 'dt:cmd:set-prop'; id: NodeId; key: string; value: unknown }
  | { type: 'dt:cmd:highlight'; id: NodeId | null }
  | { type: 'dt:cmd:pick-mode'; active: boolean }
