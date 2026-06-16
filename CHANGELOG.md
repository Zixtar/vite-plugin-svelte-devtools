# Changelog

## [0.1.6] - 2026-06-16

### Fixed
- **Major performance fix for high-churn apps**: eliminated all `document.querySelector` / `querySelectorAll` calls from the component mount/unmount hot path. The preprocessor now registers each instance's root element via a `use:__sdt_root__` action instead of scanning the whole DOM for `[data-sdt="ComponentName"]` on every mount. The runtime now caches element references directly, so unmount, highlight, scroll-to, and picker lookups no longer query the document. This removes the 4–5 second freezes reported when large numbers of components mount/unmount together.
- **Props/state snapshot cloning is now much faster**: replaced the hot-path `JSON.parse(JSON.stringify(v))` in `safeClone` with a recursive, depth-capped walk that handles plain objects, arrays, Dates, Maps, Sets, and typed arrays without serialization. Empty props/state objects now take a fast path. This significantly reduces overhead when many components mount or update while devtools tracking is enabled.
- **Batch node cloning uses native `structuredClone`**: `deepClone` now prefers `structuredClone` and only falls back to `JSON.parse/stringify` when unavailable. This makes sending large batched snapshots (hundreds or thousands of components mounting at once) substantially faster and less likely to freeze the main thread.
- **Flushing is now chunked**: the runtime processes at most 100 pending node add/updates/removals per animation frame. During a startup burst with hundreds or thousands of components, this spreads the props/state/context snapshot work across multiple frames instead of blocking the main thread in a single long `safeClone` pass. Background component updates remain fully visible.
- **Lazy props/state/context inspection**: the runtime no longer clones props/state/context for every node on every batch. Only the selected/inspected node and nodes with pinned props/state are fully snapshotted; all other pending nodes are sent as lightweight skeletons. Selecting a component or pinning a value requests a full `dt:inspected` snapshot on demand. This removes the remaining startup freeze caused by `safeClone` while still keeping selected and pinned data live.
- **Tree scrolling no longer fights the user**: the auto-scroll effect that keeps the selected component in view was reacting to every scroll and every runtime batch update, making manual scrolling impossible. It now only scrolls when the selection changes or the tree is expanded/collapsed, and reads the current scroll position from the DOM instead of reactive state.
- **Context is no longer eagerly cloned on mount**: `__sdt_mount__` used to call `snapshotOwnContext()` immediately, running `safeClone` on every object-shaped context value during a startup burst. Context is now left empty in the skeleton node and only snapshotted when the node is inspected or pinned.

## [0.1.5] - 2026-05-19

### Fixed
- **Component tree collapse on selection**: selecting a component (via click, component picker, or programmatically) now automatically expands all collapsed ancestor nodes so the selected item is always visible and scrolled into view. Previously the tree could collapse around the selected node, leaving it invisible.

### Changed
- **Dropped collapsed-state persistence**: the buggy name-based localStorage persistence for collapsed tree nodes has been removed. Collapsed state now resets on page refresh. The previous implementation collapsed every component sharing the same name whenever any one of them was collapsed, and could re-collapse nodes that were intentionally expanded during selection.

### Added
- **Plugin-level tests moved into repo**: `tests/preprocessor.test.ts` (53 tests) and `tests/open-in-editor.test.ts` (9 tests) are now versioned in the plugin repo. Previously they lived only in the untracked demo-app.

---

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
