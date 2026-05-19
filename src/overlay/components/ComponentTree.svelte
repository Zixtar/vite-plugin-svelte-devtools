<script lang="ts">
  import type { ComponentNode } from '../bridge.svelte'
  import { bridge, rootNodes, selectNode, highlightNode } from '../bridge.svelte'

  const ROW_H = 24   // px per row
  const OVERSCAN = 8 // extra rows above/below viewport

  // ── collapsed set ──────────────────────────────────────────────────────────
  let toggleTick = $state(0)
  const collapsed = new Set<string>()

  function toggle(e: MouseEvent, id: string) {
    e.stopPropagation()
    if (collapsed.has(id)) collapsed.delete(id)
    else collapsed.add(id)
    toggleTick++
  }

  // ── flat row list (iterative DFS, no recursion) ────────────────────────────
  interface Row { node: ComponentNode; depth: number; hasChildren: boolean; matchStr?: string }

  /** All rows regardless of search (full tree). */
  const allRows = $derived.by<Row[]>(() => {
    void bridge.nodesVersion  // subscribe to batch flushes
    void toggleTick           // subscribe to collapse toggles
    const rows: Row[] = []
    const stack: Array<{ id: string; depth: number }> = []
    const roots = rootNodes()
    for (let i = roots.length - 1; i >= 0; i--) stack.push({ id: roots[i].id, depth: 0 })
    while (stack.length > 0) {
      const { id, depth } = stack.pop()!
      const node = bridge.nodes.get(id)
      if (!node) continue
      const hasChildren = node.childIds.length > 0
      rows.push({ node, depth, hasChildren })
      if (hasChildren && !collapsed.has(id)) {
        for (let i = node.childIds.length - 1; i >= 0; i--)
          stack.push({ id: node.childIds[i], depth: depth + 1 })
      }
    }
    return rows
  })

  /**
   * When a search query is active:
   *  1. Collect the set of matching node IDs.
   *  2. Walk the *full* tree (ignoring collapsed state) so ancestor rows appear
   *     as non-collapsed context nodes that lead to matches.
   *  3. A row is included if it matches OR if any of its descendants match.
   */
  const visibleRows = $derived.by<Row[]>(() => {
    const q = bridge.treeSearch.trim().toLowerCase()
    if (!q) return allRows

    void bridge.nodesVersion

    // Build set of matching IDs and all their ancestors
    const matchIds = new Set<string>()
    const ancestorIds = new Set<string>()

    for (const node of bridge.nodes.values()) {
      if (node.name.toLowerCase().includes(q)) {
        matchIds.add(node.id)
        // Walk up the tree to mark ancestors
        let cur: ComponentNode | undefined = node
        while (cur && cur.parentId) {
          if (ancestorIds.has(cur.parentId)) break // already marked
          ancestorIds.add(cur.parentId)
          cur = bridge.nodes.get(cur.parentId)
        }
      }
    }

    if (matchIds.size === 0) return []

    // Full DFS ignoring collapsed — emit rows for matches + ancestors
    const rows: Row[] = []
    const stack: Array<{ id: string; depth: number }> = []
    const roots = rootNodes()
    for (let i = roots.length - 1; i >= 0; i--) stack.push({ id: roots[i].id, depth: 0 })
    while (stack.length > 0) {
      const { id, depth } = stack.pop()!
      const node = bridge.nodes.get(id)
      if (!node) continue
      const isMatch = matchIds.has(id)
      const isAncestor = ancestorIds.has(id)
      if (!isMatch && !isAncestor) continue
      const hasChildren = node.childIds.length > 0
      rows.push({ node, depth, hasChildren, matchStr: isMatch ? q : undefined })
      // Always expand ancestors to show their matching children
      if (hasChildren) {
        for (let i = node.childIds.length - 1; i >= 0; i--)
          stack.push({ id: node.childIds[i], depth: depth + 1 })
      }
    }
    return rows
  })

  // ── expand ancestors of selected node so it is always visible ────────────
  $effect(() => {
    const id = bridge.selectedId
    if (!id) return
    // Walk up the parent chain and remove any collapsed ancestor from the set
    let cur = bridge.nodes.get(id)
    let changed = false
    while (cur && cur.parentId) {
      if (collapsed.has(cur.parentId)) {
        collapsed.delete(cur.parentId)
        changed = true
      }
      cur = bridge.nodes.get(cur.parentId)
    }
    if (changed) {
      toggleTick++
    }
  })

  // ── scroll selected node into view ─────────────────────────────────────────
  $effect(() => {
    const id = bridge.selectedId
    if (!id || !viewportEl) return
    const idx = visibleRows.findIndex(r => r.node.id === id)
    if (idx === -1) return
    const rowTop = idx * ROW_H
    const rowBot = rowTop + ROW_H
    if (rowTop < scrollTop) {
      viewportEl.scrollTop = rowTop
    } else if (rowBot > scrollTop + viewportH) {
      viewportEl.scrollTop = rowBot - viewportH
    }
  })

  // ── virtual scroll ─────────────────────────────────────────────────────────
  let scrollTop = $state(0)
  let viewportH = $state(400)
  let viewportEl = $state<HTMLDivElement | undefined>(undefined)

  $effect(() => {
    if (!viewportEl) return
    const ro = new ResizeObserver(([e]) => { viewportH = e.contentRect.height })
    ro.observe(viewportEl)
    return () => ro.disconnect()
  })

  const slice = $derived.by(() => {
    const total = visibleRows.length
    const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
    const end   = Math.min(total, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
    return { start, end, totalH: total * ROW_H, rows: visibleRows.slice(start, end) }
  })

  // ── highlight match within a component name ─────────────────────────────────
  function highlightName(name: string, query: string | undefined): string {
    if (!query) return escHtml(name)
    const lo = name.toLowerCase()
    const idx = lo.indexOf(query.toLowerCase())
    if (idx === -1) return escHtml(name)
    return (
      escHtml(name.slice(0, idx)) +
      `<mark>${escHtml(name.slice(idx, idx + query.length))}</mark>` +
      escHtml(name.slice(idx + query.length))
    )
  }
  function escHtml(s: string) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
</script>

<!-- Search bar -->
<div class="search-bar">
  <input
    class="search-input"
    type="search"
    placeholder="Search components…"
    aria-label="Search components"
    bind:value={bridge.treeSearch}
  />
  {#if bridge.treeSearch}
    <button
      class="search-clear"
      onclick={() => { bridge.treeSearch = '' }}
      aria-label="Clear search"
    >✕</button>
  {/if}
</div>

<div
  class="tree-viewport"
  bind:this={viewportEl}
  onscroll={(e) => { scrollTop = (e.target as HTMLElement).scrollTop }}
  role="tree"
  aria-label="Component tree"
>
  {#if visibleRows.length === 0 && bridge.treeSearch}
    <p class="empty">No components match "<em>{bridge.treeSearch}</em>".</p>
  {:else if allRows.length === 0}
    <p class="empty">No components detected yet.</p>
  {:else}
    <div style="height:{slice.totalH}px; position:relative;">
      {#each slice.rows as { node, depth, hasChildren, matchStr }, i (node.id)}
        {@const top = (slice.start + i) * ROW_H}
        {@const isSelected = bridge.selectedId === node.id}
        {@const isCollapsed = !bridge.treeSearch && collapsed.has(node.id)}
        <div
          class="row"
          class:selected={isSelected}
          class:ancestor={!!bridge.treeSearch && !matchStr}
          style="top:{top}px; padding-left:{depth * 14 + 4}px"
          onclick={() => selectNode(node.id)}
          onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectNode(node.id)}
          onpointerenter={() => highlightNode(node.id)}
          onpointerleave={() => highlightNode(null)}
          role="treeitem"
          aria-selected={isSelected}
          tabindex="0"
        >
          {#if hasChildren}
            <button class="toggle" onclick={(e) => { if (!bridge.treeSearch) toggle(e, node.id) }}
              aria-label={isCollapsed ? 'Expand' : 'Collapse'}
            >{isCollapsed ? '▸' : '▾'}</button>
          {:else}
            <span class="toggle-spacer"></span>
          {/if}
          <!-- eslint-disable-next-line svelte/no-at-html-tags -->
          <span class="comp-name">&lt;{@html highlightName(node.name, matchStr)}&gt;</span>
          {#if node.renderCount > 0}
            <span class="render-badge">{node.renderCount}</span>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .search-bar {
    position: relative;
    padding: 4px 6px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .search-input {
    flex: 1;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: inherit;
    font-size: 11px;
    padding: 3px 6px;
    outline: none;
    min-width: 0;
  }
  .search-input:focus {
    border-color: rgba(99,179,237,0.5);
    background: rgba(255,255,255,0.09);
  }
  /* Remove default ✕ from Chrome search input */
  .search-input::-webkit-search-cancel-button { display: none; }
  .search-clear {
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.4); font-size: 10px; padding: 1px 3px;
    border-radius: 3px; flex-shrink: 0;
  }
  .search-clear:hover { color: rgba(255,255,255,0.8); background: rgba(255,255,255,0.08); }

  .tree-viewport {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    position: relative;
  }
  .row {
    position: absolute;
    left: 0; right: 0;
    height: 24px;
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    font-size: 12px;
    box-sizing: border-box;
  }
  .row:hover { background: rgba(255,255,255,0.06); }
  .row.selected { background: rgba(99,179,237,0.25); }
  .row.ancestor { opacity: 0.5; }
  .toggle {
    background: none; border: none; cursor: pointer;
    color: inherit; font-size: 10px; padding: 0;
    width: 14px; flex-shrink: 0;
  }
  .toggle-spacer { width: 14px; flex-shrink: 0; display: inline-block; }
  .comp-name { font-family: monospace; }
  .comp-name :global(mark) {
    background: rgba(255, 200, 50, 0.4);
    color: #ffe87a;
    border-radius: 2px;
    padding: 0 1px;
  }
  .render-badge {
    font-size: 10px;
    background: rgba(99,179,237,0.4);
    border-radius: 8px;
    padding: 0 4px;
    flex-shrink: 0;
  }
  .empty { padding: 8px; opacity: 0.6; font-size: 12px; }
</style>
