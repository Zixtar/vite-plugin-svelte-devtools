<script lang="ts">
  import { bridge } from '../bridge.svelte'

  const sorted = $derived(
    (void bridge.nodesVersion,
    Array.from(bridge.nodes.values())
      .filter((n) => n.renderCount > 0)
      .sort((a, b) => b.renderTime - a.renderTime)),
  )

  function fmt(ms: number) {
    return ms < 1 ? '<1ms' : ms.toFixed(1) + 'ms'
  }
</script>

<div class="section">
  <h3>Render Performance</h3>
  {#if sorted.length === 0}
    <p class="empty">No renders recorded yet.</p>
  {:else}
    <table>
      <thead>
        <tr>
          <th>Component</th>
          <th>Renders</th>
          <th>Total</th>
          <th>Avg</th>
          <th>Bar</th>
        </tr>
      </thead>
      <tbody>
        {#each sorted as node (node.id)}
          {@const avg = node.renderTime / node.renderCount}
          {@const pct = (node.renderTime / sorted[0].renderTime) * 100}
          <tr>
            <td class="perf-key" title={node.name}>{node.name}</td>
            <td class="num">{node.renderCount}</td>
            <td class="num">{fmt(node.renderTime)}</td>
            <td class="num">{fmt(avg)}</td>
            <td class="bar-cell">
              <div class="bar" class:slow={avg > 16} style="width: {pct}%" title="{node.name} — {fmt(node.renderTime)} total, {node.renderCount} renders, {fmt(avg)} avg"></div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>

<style>
  .section { padding: 6px 8px; }
  h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.5; margin: 0 0 4px; }
  .empty { opacity: 0.5; font-size: 12px; margin: 0; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; opacity: 0.5; padding: 2px 4px; }
  td { padding: 2px 4px; vertical-align: middle; }
  .perf-key { font-family: monospace; color: #a8dfff; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .num { font-family: monospace; color: rgba(255,255,255,0.6); white-space: nowrap; }
  .bar-cell { width: 60px; padding: 2px 4px; }
  .bar { height: 8px; background: #4a90d9; border-radius: 2px; min-width: 2px; cursor: default; }
  .bar.slow { background: #e05a3a; }
</style>
