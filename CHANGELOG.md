# Changelog

## [0.1.4] - 2026-05-18

### Fixed
- **Source maps**: preprocessor now returns a `magic-string` source map with `source: filename` set, preventing Vite's `getCombinedSourcemap()` from replacing the source reference with the original unprocessed file content. Previously, almost all output lines were unmapped (browser breakpoints always snapped to line 1 of the `.svelte` file and could not be placed on specific lines). Original code lines now map correctly; injected lines are intentionally unmapped.

### Added
- **Source map regression tests**: `tests/sourcemap.test.ts` added to the plugin repo (run with `npm test`), covering: map presence, correct `sources[0]` filename, per-line mappings for original code, and absence of mappings on injected lines.
- **`npm test` script**: vitest is now a dev dependency and `npm test` runs the plugin's own unit tests.

### Changed
- `magic-string` promoted to a runtime `dependency` (was already a transitive dep; now explicit).
- `@vitejs/devtools-kit` devDependency upgraded from `0.1.21` to `0.1.24`.

---

## [0.1.3] - 2025-xx-xx

### Changed
- Removed Settings tab and `SettingsPanel.svelte` (no persistent settings remain).
- Titlebar drag and grab cursor disabled in iframe mode (`alwaysOpen={true}`).
- Removed dead code: `EventLog.svelte`, settings-related state in `bridge.svelte.ts`, `editorParam` from `openInEditor`.
- README: removed Event Log feature row, corrected setup snippet to use `DevTools()` without `async/await`.

---

## [0.1.2] - 2025-xx-xx

### Added
- Hover-only component highlight (no highlight on select).
- Copy buttons on every row in `ContextPanel`.

### Changed
- Migrated to `rolldownOptions` in `vite.config.ts`.

---

## [0.1.1] - 2025-xx-xx

### Fixed
- Minor fixes post initial release.

---

## [0.1.0] - 2025-xx-xx

### Added
- Initial release: component tree, reactive state panel, props editor, store inspector, performance profiler, open-in-editor.
