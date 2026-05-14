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
</script>

<div
  class="panel"
  class:pick-active={bridge.pickMode}
  class:paused={!bridge.tracking}
  role="complementary"
  aria-label="Svelte DevTools"
  style="font-size: {settings.fontSize}px"
>
  <div class="titlebar" role="toolbar" tabindex="0">
    <div class="titlebar-left">
      <!-- Pause / Resume tracking -->
      <button
        class="tb-btn"
        class:tb-btn--paused={!bridge.tracking}
        onclick={() => setTracking(!bridge.tracking)}
        title={bridge.tracking ? 'Pause tracking' : 'Resume tracking'}
        aria-label={bridge.tracking ? 'Pause tracking' : 'Resume tracking'}
        aria-pressed={bridge.tracking}
      >
        {#if bridge.tracking}
          <!-- pause icon: two vertical bars -->
          <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
            <rect x="0" y="0" width="3.5" height="13" rx="1"/>
            <rect x="7.5" y="0" width="3.5" height="13" rx="1"/>
          </svg>
        {:else}
          <!-- play icon: triangle -->
          <svg width="11" height="13" viewBox="0 0 11 13" fill="currentColor" aria-hidden="true">
            <polygon points="0,0 11,6.5 0,13"/>
          </svg>
        {/if}
      </button>

      <!-- Pick component -->
      <button
        class="tb-btn"
        class:tb-btn--active={bridge.pickMode}
        onclick={togglePickMode}
        title="Pick component (Alt+C)"
        aria-label="Pick component"
        aria-pressed={bridge.pickMode}
      >
        <!-- cursor / crosshair icon -->
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
    <!-- Settings tab on the right -->
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

<style>
  .titlebar-left {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  /* Unified toolbar icon button */
  .tb-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 5px;
    color: #778899;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    flex-shrink: 0;
  }

  .tb-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    color: #ccd6e0;
  }

  /* Pause state: amber/yellow to signal "recording stopped" */
  .tb-btn--paused {
    color: #c9a227;
  }
  .tb-btn--paused:hover {
    background: rgba(201, 162, 39, 0.14);
    color: #e6bc40;
  }

  /* Pick mode active: accent highlight */
  .tb-btn--active {
    background: rgba(255, 62, 0, 0.15);
    color: #ff9d6c;
  }
  .tb-btn--active:hover {
    background: rgba(255, 62, 0, 0.22);
    color: #ffb38a;
  }

  /* Thin vertical separator between actions and logo */
  .tb-divider {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.1);
    margin: 0 6px;
    flex-shrink: 0;
  }

  .paused-banner {
    background: rgba(201, 162, 39, 0.1);
    border-bottom: 1px solid rgba(201, 162, 39, 0.3);
    color: #d4a92a;
    font-size: 11px;
    padding: 4px 10px;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
  }
</style>
