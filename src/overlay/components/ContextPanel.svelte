<script lang="ts">
  import { selectedNode, bridge } from '../bridge.svelte'

  const entries = $derived.by(() => {
    void bridge.nodesVersion
    const node = selectedNode()
    return node ? Object.entries(node.context ?? {}) : null
  })
</script>

<div class="section">
  <h3>Context</h3>
  {#if entries === null}
    <p class="empty">Select a component in the tree to inspect its context.</p>
  {:else if entries.length === 0}
    <p class="empty">
      <strong>{selectedNode()?.name}</strong> has no context available.<br>
      Context set by ancestor components via <code>setContext</code> appears here.
    </p>
  {:else}
    <p class="hint">Context available to <strong>{selectedNode()?.name}</strong>:</p>
    <table>
      <thead><tr><th>Key</th><th>Value</th></tr></thead>
      <tbody>
        {#each entries as [key, val] (key)}
          <tr>
            <td class="ctx-key">{key}</td>
            <td class="val">{JSON.stringify(val)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .hint { font-size: 11px; color: #aaa; margin: 0 0 6px; }
  .ctx-key { font-family: monospace; font-size: 12px; color: #c3a6ff; }
  .val { font-family: monospace; font-size: 12px; word-break: break-all; }
  code { background: #2a2a3a; padding: 1px 4px; border-radius: 3px; font-size: 11px; }
</style>
