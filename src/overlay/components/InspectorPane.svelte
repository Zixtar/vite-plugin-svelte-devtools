<script lang="ts">
  import ComponentTree from './ComponentTree.svelte'
  import ComponentDetail from './ComponentDetail.svelte'

  // Resizable split: left pane width as a percentage
  let splitPct = $state(40)
  let dragging = $state(false)
  let containerEl = $state<HTMLDivElement | undefined>(undefined)

  function onDividerMousedown(e: MouseEvent) {
    e.preventDefault()
    dragging = true
    const startX = e.clientX
    const startPct = splitPct

    function onMove(ev: MouseEvent) {
      if (!containerEl) return
      const w = containerEl.getBoundingClientRect().width
      const delta = ((ev.clientX - startX) / w) * 100
      splitPct = Math.min(70, Math.max(20, startPct + delta))
    }
    function onUp() {
      dragging = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
</script>

<div class="inspector" bind:this={containerEl} class:dragging>
  <!-- Left: Component tree -->
  <div class="pane pane-left" style="width: {splitPct}%">
    <ComponentTree />
  </div>

  <!-- Drag handle -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_no_noninteractive_tabindex -->
  <div
    class="divider"
    role="separator"
    aria-orientation="vertical"
    tabindex="0"
    onmousedown={onDividerMousedown}
  ></div>

  <!-- Right: Detail -->
  <div class="pane pane-right">
    <div class="detail-scroll">
      <ComponentDetail />
    </div>
  </div>
</div>

<style>
  .inspector {
    display: flex;
    height: 100%;
    overflow: hidden;
  }
  .inspector.dragging { cursor: col-resize; user-select: none; }

  .pane { height: 100%; overflow: hidden; flex-shrink: 0; display: flex; flex-direction: column; }
  .pane-left { border-right: 1px solid rgba(255,255,255,0.08); }
  .pane-right { flex: 1; min-width: 0; }

  .divider {
    width: 5px;
    cursor: col-resize;
    flex-shrink: 0;
    background: transparent;
    transition: background 0.15s;
  }
  .divider:hover, .dragging .divider { background: rgba(99,179,237,0.3); }

  .detail-scroll {
    height: 100%;
    overflow-y: auto;
  }
</style>
