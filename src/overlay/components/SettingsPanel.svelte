<script lang="ts">
  import { bridge, setTracking, settings, saveSettings } from '../bridge.svelte'

  const EDITORS = [
    { value: '', label: 'Auto-detect' },
    { value: 'code', label: 'VS Code' },
    { value: 'code-insiders', label: 'VS Code Insiders' },
    { value: 'cursor', label: 'Cursor' },
    { value: 'webstorm', label: 'WebStorm' },
    { value: 'rider', label: 'Rider' },
    { value: 'visualstudio', label: 'Visual Studio' },
    { value: 'notepad++', label: 'Notepad++' },
    { value: 'vim', label: 'Vim' },
    { value: 'neovim', label: 'Neovim' },
  ]

  const FONT_SIZES = [
    { value: 11, label: '11px (compact)' },
    { value: 12, label: '12px (default)' },
    { value: 13, label: '13px' },
    { value: 14, label: '14px (large)' },
  ]

  function onEditorChange(e: Event) {
    settings.editor = (e.target as HTMLSelectElement).value
    saveSettings()
  }

  function onFontSizeChange(e: Event) {
    settings.fontSize = Number((e.target as HTMLSelectElement).value)
    saveSettings()
  }

  function onStartPausedChange(e: Event) {
    const checked = (e.target as HTMLInputElement).checked
    settings.startPaused = checked
    saveSettings()
    // Also update the current tracking state
    setTracking(!checked)
  }
</script>

<div class="section">
  <h3>Settings</h3>

  <table class="settings-table">
    <tbody>
      <tr>
        <td class="label">Preferred editor</td>
        <td>
          <select value={settings.editor} onchange={onEditorChange}>
            {#each EDITORS as ed}
              <option value={ed.value}>{ed.label}</option>
            {/each}
          </select>
          <p class="hint">Set <code>LAUNCH_EDITOR</code> env var to override globally.</p>
        </td>
      </tr>
      <tr>
        <td class="label">Tracking mode on app start</td>
        <td>
          <label class="checkbox-label">
            <input
              type="checkbox"
              checked={settings.startPaused}
              onchange={onStartPausedChange}
            />
            Start paused (tracking disabled until manually resumed)
          </label>
        </td>
      </tr>
      <tr>
        <td class="label">Font size</td>
        <td>
          <select value={settings.fontSize} onchange={onFontSizeChange}>
            {#each FONT_SIZES as fs}
              <option value={fs.value}>{fs.label}</option>
            {/each}
          </select>
        </td>
      </tr>
    </tbody>
  </table>
</div>

<style>
  .settings-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .settings-table td { padding: 5px 4px; vertical-align: top; }
  .label { color: rgba(255,255,255,0.5); white-space: nowrap; padding-right: 12px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; padding-top: 8px; }
  select {
    background: #1a1a2e; border: 1px solid rgba(255,255,255,0.15);
    color: #ccd6e0; font-size: 12px; padding: 3px 6px; border-radius: 3px;
    cursor: pointer;
  }
  select:focus { outline: 1px solid #4a90d9; }
  .hint { font-size: 10px; opacity: 0.4; margin: 3px 0 0; font-style: italic; }
  .hint code { font-family: monospace; }
  .checkbox-label { display: flex; align-items: center; gap: 6px; cursor: pointer; }
  input[type="checkbox"] { accent-color: #ff9d6c; cursor: pointer; }
</style>
