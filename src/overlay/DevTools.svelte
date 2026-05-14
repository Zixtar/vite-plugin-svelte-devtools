<script lang="ts">
  import { bridge, togglePickMode, setTracking, settings } from './bridge.svelte'
  import InspectorPane from './components/InspectorPane.svelte'
  import StoreInspector from './components/StoreInspector.svelte'
  import PerfPanel from './components/PerfPanel.svelte'
  import HistoryPanel from './components/HistoryPanel.svelte'
  import SettingsPanel from './components/SettingsPanel.svelte'

  type Tab = typeof bridge.activeTab

  const TABS: { id: Tab; label: string }[] = [
    { id: 'inspector', label: 'Inspector' },
    { id: 'stores', label: 'Stores' },
    { id: 'perf', label: 'Perf' },
    { id: 'history', label: 'History' },
    { id: 'settings', label: 'Settings' },
  ]

  interface Props { alwaysOpen?: boolean }
  let { alwaysOpen = false }: Props = $props()

  // Start closed in standalone mode; always open in iframe mode
  // $state initialised from prop — alwaysOpen never changes after mount, so snapshot is correct
  // svelte-ignore state_referenced_locally
  let open = $state(alwaysOpen)

  // Panel position (px from top-left of viewport)
  let panelX = $state(16)
  let panelY = $state(16)

  function startDrag(e: PointerEvent) {
    if (e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const startX = e.clientX - panelX
    const startY = e.clientY - panelY
    function onMove(ev: PointerEvent) {
      panelX = ev.clientX - startX
      panelY = ev.clientY - startY
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
</script>

{#if open}
<div
  class="panel"
  class:pick-active={bridge.pickMode}
  class:paused={!bridge.tracking}
  role="complementary"
  aria-label="Svelte DevTools"
  style="font-size: {settings.fontSize}px; left: {panelX}px; top: {panelY}px;"
>
  <div class="titlebar" role="toolbar" tabindex="0" onpointerdown={startDrag}>
    <div class="titlebar-left">
      <button
        class="tb-btn"
        class:tb-btn--paused={!bridge.tracking}
        onclick={() => setTracking(!bridge.tracking)}
        title={bridge.tracking ? 'Pause tracking' : 'Resume tracking'}
        aria-label={bridge.tracking ? 'Pause tracking' : 'Resume tracking'}
        aria-pressed={bridge.tracking}
      >
        {#if bridge.tracking}
          <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
            <rect x="0" y="0" width="3.5" height="13" rx="1"/>
            <rect x="7.5" y="0" width="3.5" height="13" rx="1"/>
          </svg>
        {:else}
          <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
            <polygon points="0,0 11,6.5 0,13"/>
          </svg>
        {/if}
      </button>

      <button
        class="tb-btn"
        class:tb-btn--active={bridge.pickMode}
        onclick={togglePickMode}
        title="Pick component (Alt+C)"
        aria-label="Pick component"
        aria-pressed={bridge.pickMode}
      >
        <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true">
          <circle cx="6.5" cy="6.5" r="4"/>
          <line x1="6.5" y1="0"   x2="6.5" y2="3"/>
          <line x1="6.5" y1="10"  x2="6.5" y2="13"/>
          <line x1="0"   y1="6.5" x2="3"   y2="6.5"/>
          <line x1="10"  y1="6.5" x2="13"  y2="6.5"/>
        </svg>
      </button>

      <div class="tb-divider"></div>
    </div>

    <span class="logo">⬡ Svelte DevTools</span>

    <button
      class="tb-btn tb-btn--close"
      onclick={() => (open = false)}
      title="Close DevTools"
      aria-label="Close DevTools"
      style={alwaysOpen ? 'display:none' : ''}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
        <line x1="1" y1="1" x2="9" y2="9"/>
        <line x1="9" y1="1" x2="1" y2="9"/>
      </svg>
    </button>
  </div>

  {#if !bridge.tracking}
    <div class="paused-banner">
      Tracking paused — click
      <svg width="9" height="11" viewBox="0 0 11 13" fill="currentColor" style="vertical-align:-1px;margin:0 2px" aria-hidden="true"><polygon points="0,0 11,6.5 0,13"/></svg>
      to resume
    </div>
  {/if}

  <nav class="tabs">
    {#each TABS as tab}
      {#if tab.id !== 'settings'}
        <button
          role="tab"
          aria-selected={bridge.activeTab === tab.id}
          class:active={bridge.activeTab === tab.id}
          onclick={() => (bridge.activeTab = tab.id)}
        >
          {tab.label}{tab.id === 'history' && bridge.propHistory.length ? ` (${bridge.propHistory.length})` : ''}
        </button>
      {/if}
    {/each}
    <button
      role="tab"
      aria-selected={bridge.activeTab === 'settings'}
      class:active={bridge.activeTab === 'settings'}
      class="settings-tab"
      onclick={() => (bridge.activeTab = 'settings')}
    >
      Settings
    </button>
  </nav>

  <div class="content">
    {#if bridge.activeTab === 'inspector'}
      <InspectorPane />
    {:else if bridge.activeTab === 'stores'}
      <StoreInspector />
    {:else if bridge.activeTab === 'perf'}
      <PerfPanel />
    {:else if bridge.activeTab === 'history'}
      <HistoryPanel />
    {:else if bridge.activeTab === 'settings'}
      <SettingsPanel />
    {/if}
  </div>
</div>
{/if}

{#if !open && !alwaysOpen}
<button
  class="badge"
  onclick={() => (open = true)}
  title="Open Svelte DevTools"
  aria-label="Open Svelte DevTools"
>
  ⬡
</button>
{/if}
