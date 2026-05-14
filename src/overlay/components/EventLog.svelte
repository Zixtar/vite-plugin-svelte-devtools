<script lang="ts">
  import { bridge, clearEvents } from '../bridge.svelte'

  function fmt(ts: number) {
    const d = new Date(ts)
    return d.toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      '.' + String(Math.round(ts % 1000)).padStart(3, '0')
  }
</script>

<div class="section">
  <div class="header">
    <h3>Event Log</h3>
    <button onclick={clearEvents}>Clear</button>
  </div>
  {#if bridge.events.length === 0}
    <p class="empty">No events captured yet.</p>
  {:else}
    <table>
      <thead>
        <tr><th>Time</th><th>Component</th><th>Event</th><th>Detail</th></tr>
      </thead>
      <tbody>
        {#each bridge.events as entry (entry.id)}
          <tr>
            <td class="time">{fmt(entry.timestamp)}</td>
            <td class="comp">{entry.componentName}</td>
            <td class="evt">{entry.event}</td>
            <td class="detail">{JSON.stringify(entry.detail)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  {/if}
</div>
