<script lang="ts">
  import { bridge, unpinAll, unpinOne, highlightNode } from '../bridge.svelte'

  interface PinnedRow {
    nodeId: string
    componentName: string
    key: string
    kind: 'prop' | 'state'
    value: unknown
  }

  const pinnedRows = $derived.by<PinnedRow[]>(() => {
    void bridge.nodesVersion  // subscribe to node updates
    const rows: PinnedRow[] = []
    for (const [nodeId, node] of bridge.nodes) {
      for (const key of Object.keys(node.props)) {
        if (bridge.pinnedProps.has(`${nodeId}:${key}`)) {
          rows.push({ nodeId, componentName: node.name, key, kind: 'prop', value: node.props[key] })
        }
      }
      for (const key of Object.keys(node.state)) {
        if (bridge.pinnedProps.has(`${nodeId}:${key}`)) {
          rows.push({ nodeId, componentName: node.name, key, kind: 'state', value: node.state[key] })
        }
      }
    }
    return rows
  })
</script>

<div class="section">
  <div class="header">
    <h3>Pinned Variables</h3>
    {#if bridge.pinnedProps.size > 0}
      <button onclick={unpinAll}>Unpin all</button>
    {/if}
  </div>
  {#if bridge.pinnedProps.size === 0}
    <p class="empty">
      No pinned variables.<br>
      Use ⬡ in the State / Props tab to pin props or state.
    </p>
  {:else}
    {#if pinnedRows.length === 0}
      <p class="empty">Pinned variables not visible (components may be unmounted).</p>
    {:else}
      <table>
        <thead>
          <tr><th>Component</th><th>Key</th><th>Value</th><th></th></tr>
        </thead>
        <tbody>
          {#each pinnedRows as row (row.nodeId + ':' + row.key)}
            <tr
              onmouseenter={() => highlightNode(row.nodeId)}
              onmouseleave={() => highlightNode(null)}
            >
              <td class="comp">
                {row.componentName}
                <span class="kind-badge" class:state-badge={row.kind === 'state'}>{row.kind}</span>
              </td>
              <td class="key">{row.key}</td>
              <td class="val">{JSON.stringify(row.value)}</td>
              <td class="unpin-cell">
                <button
                  class="unpin-btn"
                  title="Unpin"
                  onclick={() => unpinOne(row.nodeId, row.key)}
                >⬡</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  {/if}
</div>

<style>
  .unpin-cell { width: 22px; text-align: center; padding: 0; }
  .unpin-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: #ff9d6c;
    font-size: 14px;
    padding: 0 2px;
    line-height: 1;
    transition: color 0.1s;
  }
  .unpin-btn:hover { color: #ffb890; }
  .key { font-family: monospace; font-size: 12px; }
  .val { font-family: monospace; font-size: 12px; word-break: break-all; max-width: 160px; }
  .kind-badge {
    display: inline-block;
    font-size: 9px;
    padding: 1px 4px;
    border-radius: 3px;
    background: rgba(255,157,108,0.2);
    color: #ff9d6c;
    margin-left: 4px;
    vertical-align: middle;
    text-transform: uppercase;
  }
  .kind-badge.state-badge {
    background: rgba(126,207,255,0.2);
    color: #7ecfff;
  }
</style>
