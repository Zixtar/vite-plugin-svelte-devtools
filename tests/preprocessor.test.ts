/**
 * Preprocessor unit tests
 *
 * Tests the script and markup transforms applied by devToolsPreprocessor,
 * covering real-world edge cases found in production components.
 */

import { describe, it, expect } from 'vitest'
import { devToolsPreprocessor } from '../src/plugin/preprocessor'
import { decode } from '@jridgewell/sourcemap-codec'

function scriptTransform(content: string, name = 'TestComp') {
  const pp = devToolsPreprocessor(name)
  const result = (pp.script as Function)({ content, filename: '/src/Test.svelte', attributes: {} })
  return result.code as string
}

/**
 * Run the script preprocessor and return the decoded source map.
 * Returns an array of per-output-line arrays of [genCol, srcIndex, srcLine, srcCol] tuples.
 */
function scriptSourceMap(content: string, name = 'TestComp') {
  const pp = devToolsPreprocessor(name)
  const result = (pp.script as Function)({ content, filename: '/src/Test.svelte', attributes: {} })
  if (!result.map) throw new Error('No source map returned by preprocessor')
  return {
    decoded: decode(result.map.mappings) as number[][][],
    sources: result.map.sources as string[],
  }
}

function markupTransform(content: string, name = 'TestComp') {
  const pp = devToolsPreprocessor(name)
  const result = (pp.markup as Function)({ content, filename: '/src/Test.svelte' })
  return result.code as string
}

// ── script: props extraction ─────────────────────────────────────────────────

describe('extractProps — script injection', () => {
  it('handles simple props', () => {
    const code = scriptTransform(`let { label, count } = $props()`)
    expect(code).toContain('() => ({ label, count })')
  })

  it('strips TS type annotation with nested braces containing null', () => {
    // Real-world case: }: SomeType<null> between } and = $props()
    const code = scriptTransform(`let { a, b }: { a: string | null; b: number } = $props()`)
    // Must not produce `null` as a prop name
    expect(code).not.toMatch(/\(\s*\{[^}]*\bnull\b[^}]*\}\s*\)/)
    expect(code).toContain('() => ({ a, b })')
  })

  it('filters out reserved words from props', () => {
    // Safeguard: even if extraction somehow yields a reserved word, it is dropped
    const code = scriptTransform(`let { valid } = $props()`)
    expect(code).toContain('valid')
    expect(code).not.toMatch(/\b(null|undefined|true|false)\b.*=>\s*\(/)
  })

  it('skips rest elements (...rest)', () => {
    const code = scriptTransform(`let { a, b, ...rest } = $props()`)
    expect(code).toContain('() => ({ a, b })')
    // rest should not appear as a prop key in the snapshot object literal
    expect(code).not.toMatch(/=> \(\{[^}]*\brest\b[^}]*\}\)/)
  })

  it('handles ternary default values containing null', () => {
    // Real-world case: selectedTab = childControls.length > 0 ? childControls[0].uid : null
    const code = scriptTransform(
      `let { uid, childControls = [], selectedTab = childControls.length > 0 ? childControls[0].uid : null }: IProps = $props()`
    )
    expect(code).toContain('uid')
    expect(code).toContain('childControls')
    expect(code).toContain('selectedTab')
    expect(code).not.toMatch(/=> \(\{[^}]*\bnull\b[^}]*\}\)/)
  })

  it('handles default values', () => {
    const code = scriptTransform(`let { label = 'hi', count = 0 } = $props()`)
    expect(code).toContain('() => ({ label, count })')
  })

  it('handles object literal default value (contains })', () => {
    const code = scriptTransform(`let { opts = {}, label } = $props()`)
    expect(code).toContain('opts')
    expect(code).toContain('label')
  })

  it('handles array literal default value', () => {
    const code = scriptTransform(`let { items = [], count } = $props()`)
    expect(code).toContain('items')
    expect(code).toContain('count')
  })

  it('handles function call default with comma inside (e.g. paddingX("2"))', () => {
    const code = scriptTransform(`let { padding = paddingX("2"), margin }: Props = $props()`)
    expect(code).toContain('padding')
    expect(code).toContain('margin')
  })

  it('handles multi-arg function call default (foo = fn(a, b))', () => {
    const code = scriptTransform(`let { foo = fn(a, b), bar } = $props()`)
    expect(code).toContain('foo')
    expect(code).toContain('bar')
  })

  it('does not confuse interface body with destructuring', () => {
    // interface Props { color?: Color } precedes let { color }: Props = $props()
    // Previously the interface { } was mistaken for the destructuring brace,
    // causing type names like Color to be extracted as prop variable names.
    const code = scriptTransform(
      `interface Props {\n  color?: Color;\n  class?: ClassValue;\n}\nlet {\n  color,\n  class: className = "",\n  variant,\n}: Props = $props()`
    )
    expect(code).toContain('color')
    expect(code).toContain('className')
    expect(code).toContain('variant')
    // Type names must NOT appear as prop snapshot keys
    expect(code).not.toMatch(/=> \(\{[^}]*\bColor\b/)
    expect(code).not.toMatch(/=> \(\{[^}]*\bClassValue\b/)
  })

  it('handles renamed props (key: localName)', () => {
    const code = scriptTransform(`let { foo: bar, baz } = $props()`)
    expect(code).toContain('bar')
    expect(code).toContain('baz')
    expect(code).not.toContain('foo,')
  })

  it('does not generate setter cases for $derived variables', () => {
    // $derived vars are readonly — assigning them causes a Svelte compile error
    const code = scriptTransform(`
      let { label } = $props()
      let count = $state(0)
      const doubled = $derived(count * 2)
    `)
    // doubled must NOT appear in the setter
    expect(code).not.toMatch(/__sdt_pk__ === "doubled"/)
    // count (writable $state) SHOULD appear in the setter
    expect(code).toMatch(/__sdt_pk__ === "count"/)
  })
})

// ── script: state extraction (display snapshot) ──────────────────────────────

describe('extractStateAndDerived — display snapshot', () => {
  it('captures basic $state vars', () => {
    const code = scriptTransform(`let count = $state(0)`)
    expect(code).toContain('count')
  })

  it('captures $state with generic type annotation', () => {
    const code = scriptTransform(`let items = $state<string[]>([])`)
    expect(code).toContain('items')
  })

  it('captures $state.raw vars', () => {
    const code = scriptTransform(`let raw = $state.raw({})`)
    // raw must appear in the state snapshot
    expect(code).toMatch(/=> \(\{[^}]*\braw\b/)
  })

  it('captures $state.eager vars', () => {
    const code = scriptTransform(`let eager = $state.eager(0)`)
    expect(code).toMatch(/=> \(\{[^}]*\beager\b/)
  })

  it('captures $derived vars in state snapshot', () => {
    const code = scriptTransform(`let count = $state(0)\nlet doubled = $derived(count * 2)`)
    expect(code).toMatch(/=> \(\{[^}]*\bdoubled\b/)
  })

  it('captures $derived.by vars in state snapshot', () => {
    const code = scriptTransform(`let count = $state(0)\nlet total = $derived.by(() => count * 3)`)
    expect(code).toMatch(/=> \(\{[^}]*\btotal\b/)
  })
})

// ── script: writableKeys (setter generation) ─────────────────────────────────

describe('writableKeys — setter generation', () => {
  it('let $state → in setter', () => {
    const code = scriptTransform(`let count = $state(0)`)
    expect(code).toMatch(/__sdt_pk__ === "count"/)
  })

  it('const $state → NOT in setter (reassignment is compile error)', () => {
    const code = scriptTransform(`const count = $state(0)`)
    expect(code).not.toMatch(/__sdt_pk__ === "count"/)
  })

  it('let $state.raw → in setter', () => {
    const code = scriptTransform(`let raw = $state.raw({})`)
    expect(code).toMatch(/__sdt_pk__ === "raw"/)
  })

  it('const $state.raw → NOT in setter', () => {
    const code = scriptTransform(`const raw = $state.raw({})`)
    expect(code).not.toMatch(/__sdt_pk__ === "raw"/)
  })

  it('let $derived → NOT in setter (snaps back on dependency update)', () => {
    const code = scriptTransform(`let count = $state(0)\nlet doubled = $derived(count * 2)`)
    expect(code).not.toMatch(/__sdt_pk__ === "doubled"/)
    expect(code).toMatch(/__sdt_pk__ === "count"/)
  })

  it('const $derived → NOT in setter', () => {
    const code = scriptTransform(`let count = $state(0)\nconst doubled = $derived(count * 2)`)
    expect(code).not.toMatch(/__sdt_pk__ === "doubled"/)
  })

  it('let $derived.by → NOT in setter', () => {
    const code = scriptTransform(`let count = $state(0)\nlet total = $derived.by(() => count + 1)`)
    expect(code).not.toMatch(/__sdt_pk__ === "total"/)
  })

  it('let $props() → props NOT in setter (props are read-only; parent owns the value)', () => {
    // Writing to a child prop variable bypasses the parent — the parent overwrites
    // it on the next render, breaking component interactions (RadioButtonGroup regression).
    // Only $state variables are truly independently writable in devtools.
    const code = scriptTransform(`let { label, value = 0 } = $props()`)
    expect(code).not.toMatch(/__sdt_pk__ === "label"/)
    expect(code).not.toMatch(/__sdt_pk__ === "value"/)
  })

  it('const $props() → props NOT in setter (constant_assignment regression)', () => {
    // Real-world case: CalendarModal uses const { moduleUid, uid, calendars } = $props()
    const code = scriptTransform(`const { moduleUid, uid, calendars = [] } = $props()`)
    expect(code).not.toMatch(/__sdt_pk__ === "moduleUid"/)
    expect(code).not.toMatch(/__sdt_pk__ === "uid"/)
    expect(code).not.toMatch(/__sdt_pk__ === "calendars"/)
  })

  it('const $props() with TS annotation → props NOT in setter', () => {
    const code = scriptTransform(
      `const { moduleUid, uid, calendars = [], currentCalendar }: Props = $props()`
    )
    expect(code).not.toMatch(/__sdt_pk__ === "moduleUid"/)
    expect(code).not.toMatch(/__sdt_pk__ === "uid"/)
    expect(code).not.toMatch(/__sdt_pk__ === "currentCalendar"/)
  })

  it('Spinner case: const $derived → NOT in setter (was causing compile error)', () => {
    const code = scriptTransform(`
      let { isSmall = false, color = "secondary" } = $props()
      const maskImageUrl = $derived(\`url(\${color})\`)
    `)
    expect(code).not.toMatch(/__sdt_pk__ === "maskImageUrl"/)
    // props also not in setter
    expect(code).not.toMatch(/__sdt_pk__ === "isSmall"/)
    expect(code).not.toMatch(/__sdt_pk__ === "color"/)
  })

  it('mixed component: only let $state in setter; props and derived excluded', () => {
    const code = scriptTransform(`
      let { title, count: initialCount = 0 } = $props()
      let count = $state(initialCount)
      let name = $state('hello')
      const doubled = $derived(count * 2)
      let total = $derived.by(() => count + 1)
      const RAW = $state.raw([1,2,3])
      let mutableRaw = $state.raw({ x: 0 })
    `)
    // writable: only let $state (count, name, mutableRaw)
    expect(code).toMatch(/__sdt_pk__ === "count"/)
    expect(code).toMatch(/__sdt_pk__ === "name"/)
    expect(code).toMatch(/__sdt_pk__ === "mutableRaw"/)
    // props are read-only — never in setter
    expect(code).not.toMatch(/__sdt_pk__ === "title"/)
    expect(code).not.toMatch(/__sdt_pk__ === "initialCount"/)
    // derived/const also excluded
    expect(code).not.toMatch(/__sdt_pk__ === "doubled"/)
    expect(code).not.toMatch(/__sdt_pk__ === "total"/)
    expect(code).not.toMatch(/__sdt_pk__ === "RAW"/)
  })

  it('writableKeys array passed to __sdt_mount__', () => {
    const code = scriptTransform(`
      let count = $state(0)
      const doubled = $derived(count * 2)
    `)
    // writableKeys should be passed as JSON array to __sdt_mount__
    expect(code).toMatch(/__sdt_mount__[\s\S]*\["count"\]/)
  })
})

// ── markup: data-sdt injection ────────────────────────────────────────────────

describe('markup transform', () => {
  it('injects data-sdt on the root element', () => {
    const code = markupTransform(`<script>let x = 1</script><div class="app"><slot /></div>`)
    expect(code).toContain('data-sdt="TestComp"')
  })

  it('does NOT inject data-sdt on <title> inside svelte:head', () => {
    const code = markupTransform(`<script>let x = 1</script><svelte:head><title>My App</title></svelte:head><div></div>`)
    expect(code).not.toContain('<title data-sdt')
    // Should inject on the <div> instead, or not inject at all if title is first match
    // Key assertion: title must remain attribute-free
    expect(code).toMatch(/<title[^>]*>/)
    expect(code).not.toMatch(/<title[^>]+data-sdt/)
  })

  it('does NOT inject on svelte: special elements', () => {
    const code = markupTransform(`<script>let x = 1</script><svelte:window on:resize={handler} /><div></div>`)
    expect(code).not.toContain('<svelte:window data-sdt')
  })

  it('skips node_modules files', () => {
    const pp = devToolsPreprocessor('Lib')
    const result = pp.markup!({ content: '<div></div>', filename: '/node_modules/lib/Comp.svelte' } as any)
    expect((result as any).code).toBe('<div></div>')
  })

  it('injects use:__sdt_root__ action on the root element', () => {
    const code = markupTransform(`<script>let x = 1</script><div class="app"><slot /></div>`)
    expect(code).toContain('use:__sdt_root__')
  })

  it('does NOT inject use: action on Svelte component tags', () => {
    const code = markupTransform(`<script>let x = 1</script><Portal><div>content</div></Portal>`)
    expect(code).not.toContain('<Portal data-sdt')
    expect(code).not.toContain('<Portal use:')
    // It should still find the first real HTML element (the inner <div>)
    expect(code).toContain('<div data-sdt="TestComp" use:__sdt_root__')
  })

  it('does NOT inject use: action when component only has <script module>', () => {
    // Real-world case: a component that only exports a snippet from <script module>
    // has no regular <script> block to define __sdt_root__ in.
    const code = markupTransform(`<script module>
  import BaseTooltip from "@/components/system/BaseTooltip.svelte"
  export { add }
</script>

{#snippet add()}
  <span class="tip">
    <BaseTooltip content="hint"><div>icon</div></BaseTooltip>
  </span>
{/snippet}`)
    expect(code).not.toContain('use:__sdt_root__')
    expect(code).not.toContain('data-sdt="TestComp"')
  })
})

// ── script: root element registration (performance) ───────────────────────────

describe('root element registration', () => {
  it('defines a __sdt_root__ action that calls __sdt_update_el__', () => {
    const code = scriptTransform(`let count = $state(0)`)
    expect(code).toMatch(/function\s+__sdt_root__\s*\(\s*el\s*\)\s*\{\s*__sdt_update_el__\s*\(\s*__sdt_id__\s*,\s*el\s*\)\s*;?\s*\}/)
  })

  it('does NOT scan the DOM with document.querySelectorAll on mount', () => {
    const code = scriptTransform(`let count = $state(0)`)
    expect(code).not.toContain('document.querySelectorAll')
  })

  it('does NOT querySelector for data-sdt-id during mount', () => {
    const code = scriptTransform(`let count = $state(0)`)
    expect(code).not.toMatch(/querySelector\([^)]*data-sdt-id/)
  })
})

// ── script: perf timing injection ────────────────────────────────────────────

describe('perf timing injection', () => {
  it('captures __t0__ BEFORE reading reactive vars', () => {
    const code = scriptTransform(`let { label } = $props()\nlet count = $state(0)`)
    // __t0__ must be assigned before the props/state snapshot reads
    const t0Pos    = code.indexOf('const __t0__')
    const propsPos = code.indexOf('const __props__')
    const statePos = code.indexOf('const __state__')
    expect(t0Pos).toBeGreaterThan(-1)
    expect(propsPos).toBeGreaterThan(t0Pos)
    expect(statePos).toBeGreaterThan(t0Pos)
  })

  it('computes __dur__ AFTER reading reactive vars but BEFORE __sdt_untrack__ call', () => {
    const code = scriptTransform(`let count = $state(0)`)
    const statePos    = code.indexOf('const __state__')
    const durPos      = code.indexOf('const __dur__')
    // Find the actual __sdt_untrack__( call (not the import alias)
    const untrackPos  = code.indexOf('__sdt_untrack__(')
    expect(durPos).toBeGreaterThan(statePos)
    expect(durPos).toBeLessThan(untrackPos)
  })

  it('passes __dur__ (not a raw performance.now()) to __sdt_update__ inside untrack', () => {
    const code = scriptTransform(`let count = $state(0)`)
    // Extract everything from the __sdt_untrack__( call onwards
    const untrackCallPos = code.indexOf('__sdt_untrack__(')
    const untrackBlock = code.slice(untrackCallPos)
    expect(untrackBlock).toContain('__dur__')
    // No additional performance.now() should be inside the untrack closure
    expect(untrackBlock).not.toContain('performance.now()')
  })
})

// ── script: createEventDispatcher wrapping ───────────────────────────────────

describe('createEventDispatcher wrapping', () => {
  it('replaces createEventDispatcher() with __sdt_ced__()', () => {
    const code = scriptTransform(
      `import { createEventDispatcher } from 'svelte'\nconst dispatch = createEventDispatcher()`
    )
    expect(code).toContain('__sdt_ced__()')
    // The original call must be replaced
    expect(code).not.toMatch(/=\s*createEventDispatcher\s*\(\s*\)/)
  })

  it('injects __sdt_ced__ function definition', () => {
    const code = scriptTransform(
      `import { createEventDispatcher } from 'svelte'\nconst dispatch = createEventDispatcher()`
    )
    expect(code).toContain('function __sdt_ced__()')
    expect(code).toContain('__sdt_ced_orig__()')
    expect(code).toContain('__sdt_event__')
  })

  it('imports createEventDispatcher as __sdt_ced_orig__ from svelte', () => {
    const code = scriptTransform(
      `import { createEventDispatcher } from 'svelte'\nconst dispatch = createEventDispatcher()`
    )
    expect(code).toContain('createEventDispatcher as __sdt_ced_orig__')
  })

  it('does NOT inject __sdt_ced__ when createEventDispatcher is not used', () => {
    const code = scriptTransform(`let count = $state(0)`)
    expect(code).not.toContain('__sdt_ced__')
    expect(code).not.toContain('__sdt_ced_orig__')
  })

  it('handles createEventDispatcher with TypeScript generic', () => {
    const code = scriptTransform(
      `import { createEventDispatcher } from 'svelte'\nconst dispatch = createEventDispatcher<{ click: null }>()`
    )
    expect(code).toContain('__sdt_ced__()')
    expect(code).toContain('function __sdt_ced__()')
  })

  it('wraps dispatch with componentName in __sdt_event__ call', () => {
    const code = scriptTransform(
      `import { createEventDispatcher } from 'svelte'\nconst dispatch = createEventDispatcher()`,
      'MyButton'
    )
    expect(code).toContain('"MyButton"')
    expect(code).toContain('__sdt_event__')
  })

  it('also imports __sdt_event__ from runtime', () => {
    const code = scriptTransform(
      `import { createEventDispatcher } from 'svelte'\nconst dispatch = createEventDispatcher()`
    )
    expect(code).toContain('__sdt_event__ as __sdt_event__')
  })
})
// ── (callback prop wrapping removed — feature dropped) ───────────────────────

// ── source map integrity ──────────────────────────────────────────────────────
//
// Regression tests for the source map returned by the script preprocessor.
//
// Background: the preprocessor appends a large injection block after the
// original script content. It must return a source map so that Vite's
// getCombinedSourcemap() does not replace sources[0] with the original
// unprocessed file content — which would break all source mappings.
//
// Key invariants:
//   1. A map is always returned (never undefined/null).
//   2. sources[0] matches the filename passed in.
//   3. Original code lines map back to their original line numbers.
//   4. Injected lines have no source mapping (they are generated code).

describe('source map integrity', () => {
  it('returns a source map (not null/undefined)', () => {
    const pp = devToolsPreprocessor('TestComp')
    const result = (pp.script as Function)({ content: 'let x = $state(0)', filename: '/src/Test.svelte', attributes: {} })
    expect(result.map).toBeDefined()
    expect(result.map).not.toBeNull()
    expect(result.map.mappings).toBeTruthy()
  })

  it('sources[0] is the filename passed to the preprocessor', () => {
    const { sources } = scriptSourceMap('let x = $state(0)')
    expect(sources).toContain('/src/Test.svelte')
  })

  it('original line 1 maps to source line 1', () => {
    // Content: two lines. Line 1 in output should map to source line 1.
    const content = 'let x = $state(0)\nlet y = $state(1)'
    const { decoded } = scriptSourceMap(content)
    // Find the first output line that has a mapping to source line 0 (0-indexed)
    const firstMapped = decoded.findIndex(line => line.some(seg => seg[2] === 0))
    expect(firstMapped).toBeGreaterThanOrEqual(0)
    // That output line must be line 0 (the first output line)
    expect(firstMapped).toBe(0)
  })

  it('original line 2 maps to source line 2', () => {
    const content = 'let x = $state(0)\nlet y = $state(1)'
    const { decoded } = scriptSourceMap(content)
    // Output line 1 (0-indexed) should map to source line 1 (0-indexed)
    const line2 = decoded[1]
    expect(line2.length).toBeGreaterThan(0)
    expect(line2[0][2]).toBe(1) // srcLine = 1 (0-indexed = original line 2)
  })

  it('has more mapped lines than just the first line (no all-semicolons map)', () => {
    // The broken map had only 1 mapped line out of ~50 output lines.
    // A correct map has one mapping per original code line.
    const content = 'let a = $state(0)\nlet b = $state(1)\nlet c = $state(2)\nfunction foo() {\n  a++\n}'
    const { decoded } = scriptSourceMap(content)
    const mappedCount = decoded.filter(line => line.length > 0).length
    // At minimum, all 6 original lines should each have a mapped output line
    expect(mappedCount).toBeGreaterThanOrEqual(6)
  })

  it('injected lines (after original content) have no source mapping', () => {
    // The original content is 1 line. After it, all injected lines should be unmapped.
    const content = 'let x = $state(0)'
    const { decoded } = scriptSourceMap(content)
    // Line 0 is the original — it should be mapped (srcLine = 0)
    expect(decoded[0].some(seg => seg[2] === 0)).toBe(true)
    // Lines after the original content are injected — find where they start.
    // The injection starts with a blank line (\n before imports), so line 1 is empty.
    // Injected lines must not map to source line 0.
    const injectedLines = decoded.slice(1)
    // All injected lines must either be empty (no segments) or map to no source
    // (length === 0 means no mappings for that line)
    const injectedWithOriginalMapping = injectedLines.filter(
      line => line.some(seg => seg[2] === 0)
    )
    expect(injectedWithOriginalMapping).toHaveLength(0)
  })

  it('multi-line original code preserves all line-to-line mappings', () => {
    // 5 distinct original lines — each should appear in a distinct output line's mapping
    const lines = [
      'let a = $state(0)',
      'let b = $state(1)',
      'let c = $state(2)',
      'let d = $state(3)',
      'let e = $state(4)',
    ]
    const content = lines.join('\n')
    const { decoded } = scriptSourceMap(content)
    // Collect all source lines that appear anywhere in the output map
    const mappedSrcLines = new Set<number>()
    for (const line of decoded) {
      for (const seg of line) {
        if (seg.length >= 4) mappedSrcLines.add(seg[2])
      }
    }
    // All 5 original source lines (0–4) must appear
    for (let i = 0; i < 5; i++) {
      expect(mappedSrcLines.has(i), `source line ${i + 1} should be mapped`).toBe(true)
    }
  })
})
