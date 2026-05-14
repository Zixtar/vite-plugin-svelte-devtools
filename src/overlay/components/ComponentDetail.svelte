<script lang="ts">
  import { selectedNode, setProp, togglePin, bridge, openInEditor, scrollToComponent } from '../bridge.svelte'
  import ContextPanel from './ContextPanel.svelte'

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

  function copyValue(scopedKey: string, val: unknown) {
    const text = val === SDT_UNDEFINED ? 'undefined' : JSON.stringify(val, null, 2)
    navigator.clipboard?.writeText(text).catch(_e => {})
    copiedKey = scopedKey
    setTimeout(() => { copiedKey = null }, 1200)
  }

  function isPinned(nodeId: string, key: string) {
    return bridge.pinnedProps.has(`${nodeId}:${key}`)
  }

  function isWritable(node: ReturnType<typeof selectedNode>, key: string): boolean {
    return (node?.writableKeys ?? []).includes(key)
  }

  function shortFile(path: string): string {
    return path.replace(/.*[\\/]/, '')
  }
</script>

{#if selectedNode()}
  {@const node = selectedNode()!}

  <!-- ── Component header ─────────────────────────────── -->
  <div class="comp-header">
    <span class="comp-title">&lt;{node.name}&gt;</span>
    {#if node.sourceFile}
      <button
        class="open-file-btn"
        onclick={() => openInEditor(node.sourceFile!)}
        title={node.sourceFile}
      >{shortFile(node.sourceFile)}</button>
    {/if}
    <button
      class="scroll-btn"
      onclick={() => scrollToComponent(node.id)}
      title="Scroll to component in page"
      aria-label="Scroll to component"
    >⌖</button>
  </div>

  <!-- ── Props ─────────────────────────────────────────── -->
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
                      title="Click to edit"
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
  </div>

  <!-- ── State ─────────────────────────────────────────── -->
  <div class="section">
    <h3>State</h3>
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

  <!-- ── Context ────────────────────────────────────────── -->
  <ContextPanel />

{:else}
  <p class="empty" style="padding: 8px">Select a component to inspect.</p>
{/if}

<style>
  .comp-header {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 8px 4px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .comp-title {
    font-family: monospace;
    font-size: 13px;
    color: #ff9d6c;
    font-weight: 600;
  }
  .open-file-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-family: monospace;
    font-size: 11px;
    color: #7ecfff;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    opacity: 0.8;
  }
  .open-file-btn:hover { opacity: 1; color: #a8dfff; }

  .scroll-btn {
    background: none; border: none; cursor: pointer;
    font-size: 13px; color: rgba(255,255,255,0.35); padding: 0;
    line-height: 1; margin-left: auto;
  }
  .scroll-btn:hover { color: #7ecfff; }

  .section { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,0.06); }
  h3 { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.5; margin: 0 0 4px; }
  .empty { opacity: 0.5; font-size: 12px; margin: 0; padding: 2px 0; }

  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th { text-align: left; font-size: 10px; opacity: 0.5; padding: 2px 4px; }
  td { padding: 2px 4px; vertical-align: middle; }

  .pin-cell { width: 22px; }
  .pin-btn {
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.3); font-size: 12px; padding: 0;
  }
  .pin-btn:hover, .pin-btn.pinned { color: #ff9d6c; }

  .key { font-family: monospace; color: #a8dfff; white-space: nowrap; }

  .val { font-family: monospace; word-break: break-all; }
  .val-btn {
    background: none; border: none; cursor: pointer;
    font-family: monospace; font-size: 12px; color: inherit;
    padding: 0; text-align: left; width: 100%;
  }
  .val-btn:hover { color: #ff9d6c; }
  .val-btn.val-undef { opacity: 0.5; }
  .val-ro { opacity: 0.75; }
  .lock { font-size: 10px; }
  .edit {
    font-family: monospace; font-size: 12px;
    background: #1a1a2e; border: 1px solid #4a90d9;
    color: #fff; padding: 1px 4px; width: 100%; border-radius: 2px;
  }

  .copy-cell { width: 22px; }
  .copy-btn {
    background: none; border: none; cursor: pointer;
    color: rgba(255,255,255,0.3); font-size: 12px; padding: 0;
    line-height: 1;
  }
  .copy-btn:hover { color: #7ecfff; }
  .copy-btn.copied { color: #7ecfff; }
</style>
