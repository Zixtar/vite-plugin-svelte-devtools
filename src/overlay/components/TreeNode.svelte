<script lang="ts">
  import type { ComponentNode } from '../bridge.svelte'
  import { bridge, selectNode } from '../bridge.svelte'
  import TreeNode from './TreeNode.svelte'

  interface Props {
    node: ComponentNode
    depth?: number
    nodes: Map<string, ComponentNode>
  }
  let { node, depth = 0, nodes }: Props = $props()

  let expanded = $state(true)

  function toggle(e: MouseEvent) {
    e.stopPropagation()
    expanded = !expanded
  }

  // Children are derived from the stable `nodes` Map passed as prop.
  // The Map identity never changes between flushes — only its contents do —
  // so this derived only re-runs when `node.childIds` changes (i.e. when
  // this specific node's data is updated), not on every global tree change.
  const children = $derived(
    node.childIds.map((id) => nodes.get(id)).filter(Boolean) as ComponentNode[],
  )
  const isSelected = $derived(bridge.selectedId === node.id)
</script>

<div class="node">
  <div
    class="node-row"
    class:selected={isSelected}
    style="padding-left: {depth * 14}px"
    onclick={() => selectNode(node.id)}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && selectNode(node.id)}
    role="treeitem"
    aria-selected={isSelected}
    tabindex="0"
  >
    {#if children.length > 0}
      <button class="toggle" onclick={toggle} aria-label={expanded ? 'Collapse' : 'Expand'}>
        {expanded ? '▾' : '▸'}
      </button>
    {:else}
      <span class="toggle-spacer"></span>
    {/if}
    <span class="comp-name">&lt;{node.name}&gt;</span>
    {#if node.renderCount > 0}
      <span class="render-badge">{node.renderCount}</span>
    {/if}
  </div>

  {#if expanded && children.length > 0}
    <div role="group">
      {#each children as child (child.id)}
        <TreeNode node={child} depth={depth + 1} {nodes} />
      {/each}
    </div>
  {/if}
</div>
