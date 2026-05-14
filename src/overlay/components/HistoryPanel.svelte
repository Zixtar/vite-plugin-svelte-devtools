<script lang="ts">
  import { bridge, clearHistory, selectNode, highlightNode } from '../bridge.svelte'
  import PinnedPanel from './PinnedPanel.svelte'

  let subTab = $state<'pinned' | 'history'>('pinned')

  function fmt(ts: number) {
    const d = new Date(ts)
    return d.toLocaleTimeString('en', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
      '.' + String(Math.round(ts % 1000)).padStart(3, '0')
  }

  function jumpToTree(componentId: string) {
    selectNode(componentId)
    bridge.activeTab = 'inspector'
  }
</script>

<div class="history-root">
  <nav class="sub-tabs">
    <button
      class:active={subTab === 'pinned'}
      onclick={() => (subTab = 'pinned')}
    >
      Pinned{bridge.pinnedProps.size ? ` (${bridge.pinnedProps.size})` : ''}
    </button>
    <button
      class:active={subTab === 'history'}
      onclick={() => (subTab = 'history')}
    >
      History{bridge.propHistory.length ? ` (${bridge.propHistory.length})` : ''}
    </button>
  </nav>

  {#if subTab === 'pinned'}
    <PinnedPanel />
  {:else}
    <div class="section">
      <div class="header">
        <h3>Change History</h3>
        <button onclick={clearHistory}>Clear</button>
      </div>
      {#if bridge.propHistory.length === 0}
        <p class="empty">
          No changes recorded.<br>
          Pin props or state via ⬡ in State/Props tab to track them.
        </p>
      {:else}
        <table>
          <thead>
            <tr><th>Time</th><th>Component</th><th>Key</th><th>Old</th><th>New</th><th></th></tr>
          </thead>
          <tbody>
            {#each bridge.propHistory as entry (entry.id)}
              <tr
                class:destroyed={entry.destroyed}
                onmouseenter={() => !entry.destroyed && highlightNode(entry.componentId)}
                onmouseleave={() => highlightNode(null)}
              >
                <td class="time">{fmt(entry.timestamp)}</td>
                <td class="comp">
                  {entry.componentName}
                  {#if entry.destroyed}
                    <span class="kind-badge destroyed-badge">destroyed</span>
                  {:else}
                    <span class="kind-badge" class:state-badge={entry.kind === 'state'}>{entry.kind}</span>
                  {/if}
                </td>
                <td class="evt">{entry.key}</td>
                <td class="old-val">{entry.oldValue === undefined ? '—' : JSON.stringify(entry.oldValue)}</td>
                <td class="detail">{entry.destroyed ? '—' : JSON.stringify(entry.value)}</td>
                <td class="jump">
                  {#if !entry.destroyed}
                    <button
                      class="jump-btn"
                      title="Select in tree"
                      onclick={() => jumpToTree(entry.componentId)}
                    >⌖</button>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
    </div>
  {/if}
</div>

<style>
  .history-root { display: flex; flex-direction: column; height: 100%; }

  .sub-tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid #1e2d3d;
    padding: 0 8px;
    flex-shrink: 0;
  }
  .sub-tabs button {
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: #666;
    font-size: 11px;
    padding: 4px 10px;
    cursor: pointer;
    margin-bottom: -1px;
  }
  .sub-tabs button.active {
    color: #ff9d6c;
    border-bottom-color: #ff9d6c;
  }
  .sub-tabs button:hover:not(.active) { color: #aaa; }

  .jump-btn {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--accent, #ff9d6c);
    font-size: 14px;
    padding: 0 2px;
    line-height: 1;
    opacity: 0.6;
  }
  .jump-btn:hover { opacity: 1; }
  .jump { width: 20px; text-align: center; }
  .old-val { color: #888; word-break: break-all; max-width: 120px; text-decoration: line-through; }
  tr.destroyed td { opacity: 0.5; }
  tr.destroyed .comp { text-decoration: line-through; }
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
  .kind-badge.destroyed-badge {
    background: rgba(255, 80, 80, 0.15);
    color: #ff6060;
  }
</style>
