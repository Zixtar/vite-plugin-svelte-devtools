<script lang="ts">
  import { selectedNode, setProp, togglePin, bridge } from '../bridge.svelte'

  const SDT_UNDEFINED = '__sdt_undefined__'

  type EditingKey = string | null
  let editingKey = $state<EditingKey>(null)
  let editingValue = $state('')
  let copiedKey = $state<string | null>(null)

  function displayVal(v: unknown): string {
    if (v === SDT_UNDEFINED) return 'undefined'
    return JSON.stringify(v)
  }

  function startEdit(key: string, current: unknown) {
    editingKey = key
    // Start with empty string for undefined so the user types a fresh value
    editingValue = current === SDT_UNDEFINED ? '' : JSON.stringify(current)
  }

  function commitEdit(id: string) {
    if (editingKey == null) return
    try {
      setProp(id, editingKey, JSON.parse(editingValue))
    } catch {
      setProp(id, editingKey, editingValue)
    }
    editingKey = null
  }

  function copyValue(key: string, val: unknown) {
    const text = val === SDT_UNDEFINED ? 'undefined' : JSON.stringify(val, null, 2)
    navigator.clipboard?.writeText(text).catch(_e => {})
    copiedKey = key
    setTimeout(() => { copiedKey = null }, 1200)
  }

  function isPinned(nodeId: string, key: string) {
    return bridge.pinnedProps.has(`${nodeId}:${key}`)
  }

  function isWritable(node: ReturnType<typeof selectedNode>, key: string): boolean {
    return (node?.writableKeys ?? []).includes(key)
  }
</script>

{#if selectedNode()}
  {@const node = selectedNode()!}
  <div class="section">
    <h3>Props</h3>
    {#if Object.keys(node.props).length === 0}
      <p class="empty">No props</p>
    {:else}
      <table>
        <thead><tr><th style="width:22px"></th><th>Key</th><th>Value</th><th style="width:22px"></th></tr></thead>
        <tbody>
          {#each Object.entries(node.props) as [key, val] (key)}
            <tr>
              <td class="pin-cell">
                <button
                  class="pin-btn"
                  class:pinned={isPinned(node.id, key)}
                  onclick={() => togglePin(node.id, key)}
                  title={isPinned(node.id, key) ? 'Unpin' : 'Pin prop'}
                >⬡</button>
              </td>
              <td class="key">{key}</td>
              <td class="val">
                {#if isWritable(node, key)}
                  {#if editingKey === key}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      class="edit"
                      bind:value={editingValue}
                      onblur={() => commitEdit(node.id)}
                      onkeydown={(e) => e.key === 'Enter' && commitEdit(node.id)}
                      autofocus
                    />
                  {:else}
                    <button
                      class="val-btn"
                      class:val-undef={val === SDT_UNDEFINED}
                      onclick={() => startEdit(key, val)}
                      title="Click to edit — value persists until parent re-renders"
                    >{displayVal(val)}</button>
                  {/if}
                {:else}
                  <span class="val-ro" title="Read-only">{displayVal(val)} <span class="lock">🔒</span></span>
                {/if}
              </td>
              <td class="copy-cell">
                <button
                  class="copy-btn"
                  class:copied={copiedKey === `p:${key}`}
                  onclick={() => copyValue(`p:${key}`, val)}
                  title="Copy value"
                  aria-label="Copy value"
                >{copiedKey === `p:${key}` ? '✓' : '⎘'}</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}

    <h3 style="margin-top:10px">State</h3>
    {#if Object.keys(node.state).length === 0}
      <p class="empty">No reactive state</p>
    {:else}
      <table>
        <thead><tr><th style="width:22px"></th><th>Key</th><th>Value</th><th style="width:22px"></th></tr></thead>
        <tbody>
          {#each Object.entries(node.state) as [key, val] (key)}
            <tr>
              <td class="pin-cell">
                <button
                  class="pin-btn"
                  class:pinned={isPinned(node.id, key)}
                  onclick={() => togglePin(node.id, key)}
                  title={isPinned(node.id, key) ? 'Unpin' : 'Pin state'}
                >⬡</button>
              </td>
              <td class="key">{key}</td>
              <td class="val">
                {#if isWritable(node, key)}
                  {#if editingKey === key}
                    <!-- svelte-ignore a11y_autofocus -->
                    <input
                      class="edit"
                      bind:value={editingValue}
                      onblur={() => commitEdit(node.id)}
                      onkeydown={(e) => e.key === 'Enter' && commitEdit(node.id)}
                      autofocus
                    />
                  {:else}
                    <button class="val-btn" onclick={() => startEdit(key, val)}>
                      {displayVal(val)}
                    </button>
                  {/if}
                {:else}
                  <span class="val-ro" title="$derived / const $state — read-only">
                    {displayVal(val)} <span class="lock">🔒</span>
                  </span>
                {/if}
              </td>
              <td class="copy-cell">
                <button
                  class="copy-btn"
                  class:copied={copiedKey === `s:${key}`}
                  onclick={() => copyValue(`s:${key}`, val)}
                  title="Copy value"
                  aria-label="Copy value"
                >{copiedKey === `s:${key}` ? '✓' : '⎘'}</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
{:else}
  <p class="empty" style="padding: 8px">Select a component to inspect.</p>
{/if}
