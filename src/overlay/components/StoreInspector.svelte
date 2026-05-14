<script lang="ts">
  import { bridge, setStore } from '../bridge.svelte'

  const SDT_UNDEFINED = '__sdt_undefined__'

  const entries = $derived(Object.entries(bridge.stores))

  let editingKey = $state<string | null>(null)
  let editingValue = $state('')

  function isWritable(name: string): boolean {
    return bridge.writableStores.includes(name)
  }

  function displayVal(v: unknown): string {
    if (v === SDT_UNDEFINED) return 'undefined'
    return JSON.stringify(v)
  }

  function startEdit(name: string, current: unknown) {
    editingKey = name
    editingValue = current === SDT_UNDEFINED ? '' : JSON.stringify(current)
  }

  function commitEdit() {
    if (editingKey == null) return
    try {
      setStore(editingKey, JSON.parse(editingValue))
    } catch {
      setStore(editingKey, editingValue)
    }
    editingKey = null
  }
</script>

<div class="section">
  <h3>Global Stores</h3>
  {#if entries.length === 0}
    <p class="empty">
      No stores detected yet.<br>
      Stores appear once a component using them is mounted.
    </p>
  {:else}
    <table>
      <thead><tr><th>Store</th><th>Value</th></tr></thead>
      <tbody>
        {#each entries as [name, val] (name)}
          <tr>
            <td class="store-key">{name}</td>
            <td class="val">
              {#if isWritable(name)}
                {#if editingKey === name}
                  <input
                    class="edit"
                    bind:value={editingValue}
                    onblur={commitEdit}
                    onkeydown={(e) => e.key === 'Enter' && commitEdit()}
                    autofocus
                  />
                {:else}
                  <button class="val-btn" onclick={() => startEdit(name, val)}>
                    {displayVal(val)}
                  </button>
                {/if}
              {:else}
                <span class="val-ro" title="Read-only (readable/derived)">{displayVal(val)} <span class="lock">🔒</span></span>
              {/if}
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
  .empty { opacity: 0.5; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; opacity: 0.5; padding: 2px 4px; }
  td { padding: 2px 4px; vertical-align: middle; }
  .store-key { font-family: monospace; font-size: 12px; color: #7ecfff; white-space: nowrap; }
  .val { font-family: monospace; font-size: 12px; word-break: break-all; }
  .val-btn {
    background: none; border: none; cursor: pointer;
    font-family: monospace; font-size: 12px; color: inherit;
    padding: 0; text-align: left; width: 100%;
  }
  .val-btn:hover { color: #ff9d6c; }
  .val-ro { opacity: 0.75; }
  .lock { font-size: 10px; }
  .edit {
    font-family: monospace; font-size: 12px;
    background: #1a1a2e; border: 1px solid #4a90d9;
    color: #fff; padding: 1px 4px; width: 100%; border-radius: 2px;
  }
</style>
