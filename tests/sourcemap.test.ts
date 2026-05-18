/**
 * Source map regression tests for devToolsPreprocessor.
 *
 * The preprocessor appends a large injection block after the original script
 * content. It must return a source map with `sources[0]` set to the filename
 * so that Vite's getCombinedSourcemap() doesn't replace it with the original
 * unprocessed file content — which would produce an all-semicolons map where
 * only one line maps back to the source file, breaking all browser breakpoints.
 *
 * Key invariants:
 *   1. A map is always returned (never undefined/null).
 *   2. sources[0] matches the filename passed in.
 *   3. Original code lines map back to their original line numbers.
 *   4. Injected lines have no source mapping (they are generated code).
 */

import { describe, it, expect } from 'vitest'
import { decode } from '@jridgewell/sourcemap-codec'
import { devToolsPreprocessor } from '../src/plugin/preprocessor'

function scriptResult(content: string, filename = '/src/Test.svelte', name = 'TestComp') {
  const pp = devToolsPreprocessor(name)
  return (pp.script as Function)({ content, filename, attributes: {} })
}

function sourceMap(content: string, filename = '/src/Test.svelte') {
  const result = scriptResult(content, filename)
  if (!result.map) throw new Error('No source map returned by preprocessor')
  return {
    decoded: decode(result.map.mappings) as number[][][],
    sources: result.map.sources as string[],
  }
}

describe('preprocessor source map integrity', () => {
  it('returns a source map (not null/undefined)', () => {
    const result = scriptResult('let x = $state(0)')
    expect(result.map).toBeDefined()
    expect(result.map).not.toBeNull()
    expect(result.map.mappings).toBeTruthy()
  })

  it('sources[0] is the filename passed to the preprocessor', () => {
    const { sources } = sourceMap('let x = $state(0)')
    expect(sources).toContain('/src/Test.svelte')
  })

  it('sources[0] reflects a different filename when passed', () => {
    const { sources } = sourceMap('let x = $state(0)', '/other/MyComp.svelte')
    expect(sources).toContain('/other/MyComp.svelte')
  })

  it('original line 1 maps to source line 1 (0-indexed: srcLine 0)', () => {
    const { decoded } = sourceMap('let x = $state(0)\nlet y = $state(1)')
    // The first output line must map to source line 0
    expect(decoded[0].some(seg => seg[2] === 0)).toBe(true)
  })

  it('original line 2 maps to source line 2 (0-indexed: srcLine 1)', () => {
    const { decoded } = sourceMap('let x = $state(0)\nlet y = $state(1)')
    // Output line 1 (0-indexed) should map to source line 1
    expect(decoded[1].length).toBeGreaterThan(0)
    expect(decoded[1][0][2]).toBe(1)
  })

  it('has more than 1 mapped output line (no all-semicolons broken map)', () => {
    // The broken map had only 1 mapped line out of ~50+ output lines.
    const content = 'let a = $state(0)\nlet b = $state(1)\nlet c = $state(2)\nfunction foo() {\n  a++\n}'
    const { decoded } = sourceMap(content)
    const mappedCount = decoded.filter(line => line.length > 0).length
    // At minimum, all 6 original source lines must each have a mapped output line
    expect(mappedCount).toBeGreaterThanOrEqual(6)
  })

  it('injected lines (after original content) do not map back to source line 1', () => {
    // Original content is 1 line at srcLine 0. All injected output lines must
    // not map to srcLine 0 (they are generated code with no source position).
    const { decoded } = sourceMap('let x = $state(0)')
    // Line 0 is the original — it maps to srcLine 0
    expect(decoded[0].some(seg => seg[2] === 0)).toBe(true)
    // All subsequent lines must not map to srcLine 0
    const injectedWithOriginalMapping = decoded.slice(1).filter(
      line => line.some(seg => seg[2] === 0)
    )
    expect(injectedWithOriginalMapping).toHaveLength(0)
  })

  it('all original source lines appear in the output map (multi-line)', () => {
    const lines = [
      'let a = $state(0)',
      'let b = $state(1)',
      'let c = $state(2)',
      'let d = $state(3)',
      'let e = $state(4)',
    ]
    const { decoded } = sourceMap(lines.join('\n'))
    const mappedSrcLines = new Set<number>()
    for (const line of decoded) {
      for (const seg of line) {
        if (seg.length >= 4) mappedSrcLines.add(seg[2])
      }
    }
    for (let i = 0; i < 5; i++) {
      expect(mappedSrcLines.has(i), `source line ${i + 1} should be mapped`).toBe(true)
    }
  })
})
