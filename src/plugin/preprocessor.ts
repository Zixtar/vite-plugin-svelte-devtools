/**
 * Svelte preprocessor that automatically instruments every component.
 *
 * Given a component like:
 *
 *   <script>
 *     let { label = 'hi' } = $props()
 *     let count = $state(0)
 *     const doubled = $derived(count * 2)
 *   </script>
 *
 * It rewrites the script block to:
 *
 *   <script>
 *     import { onMount as __sdt_om__, onDestroy as __sdt_od__ } from 'svelte'
 *     import {
 *       __sdt_mount__, __sdt_unmount__, __sdt_update__, __sdt_event__
 *     } from 'virtual:svelte-devtools/runtime'
 *
 *     let { label = 'hi' } = $props()   // ← original code untouched
 *     let count = $state(0)
 *     const doubled = $derived(count * 2)
 *
 *     // ── injected ──────────────────────────────────────────────────────
 *     let __sdt_id__ = ''
 *     const __sdt_inst__ = {}
 *     __sdt_om__(() => {
 *       __sdt_id__ = __sdt_mount__(
 *         __sdt_inst__, 'MyComponent', null,
 *         () => ({ label }),
 *         () => ({ count, doubled }),
 *         () => ({}),
 *         () => document.querySelector('[data-sdt-id]') ?? null,
 *       )
 *     })
 *     __sdt_od__(() => __sdt_unmount__(__sdt_id__))
 *     $effect(() => {
 *       const __t0__ = performance.now()
 *       void label; void count; void doubled
 *       __sdt_update__(__sdt_id__, performance.now() - __t0__,
 *         () => ({ label }),
 *         () => ({ count, doubled }),
 *         () => ({}),
 *       )
 *     })
 *   </script>
 *
 * Store subscriptions are detected by looking for `$store` rune-style access
 * or explicit `subscribe` call patterns — that is handled at runtime via a
 * separate proxy mechanism rather than preprocessor injection to keep things
 * simple.
 */

import type { PreprocessorGroup } from 'svelte/compiler'
import { readFileSync } from 'fs'
import MagicString from 'magic-string'

export function devToolsPreprocessor(componentName: string): PreprocessorGroup {
  return {
    name: 'svelte-devtools',
    script({ content, filename, attributes }) {
      // Skip <script module> / <script context="module">
      if (attributes.context === 'module' || attributes.module != null) {
        return { code: content }
      }
      // Skip node_modules
      if (filename?.includes('node_modules')) return { code: content }
      // Skip the overlay itself
      if (filename?.includes('svelte-devtools')) return { code: content }

      const { names: props } = extractProps(content)
      const state = extractStateAndDerived(content)    // $state + $derived — for display
      const writableState = extractWritableState(content) // let $state only — for setter
      // Read the full file so we can detect $store usage in the template too
      const fullFile = filename ? (() => { try { return readFileSync(filename, 'utf-8') } catch { return content } })() : content
      const stores = extractStores(content, fullFile)
      const contextVars = extractContextVars(content)
      const dispatchVarName = extractCreateEventDispatcherVar(content)
      // Build the injected lines
      const propsSnap = objLiteral(props)
      const stateSnap = objLiteral(state)

      // Store subscriptions
      const storeSubscriptions = stores.length
        ? stores
            .map(
              (s) =>
                `  if (typeof ${s} !== 'undefined' && ${s} && typeof ${s}.subscribe === 'function') ` +
                `__sdt_ss__(__sdt_id__, ${JSON.stringify(s)}, ${s});`,
            )
            .join('\n')
        : ''

      // Props are ALWAYS read-only in devtools. Unlike Vue, Svelte 5 has no
      // reactive bridge from child prop variable back to the parent — writing
      // to a prop variable bypasses the parent's state and causes the parent to
      // overwrite the change on its next render, breaking component interactions.
      // Only let $state / $state.raw / $state.eager variables are truly writable.
      const writableKeys = [...writableState]
      const setterCases = writableKeys.map((s) => `    if (__sdt_pk__ === ${JSON.stringify(s)}) { ${s} = __sdt_pv__; }`)
      const propSetterCases = setterCases.length ? setterCases.join('\n') : '    /* no editable keys */'

      const dispatchWrapper = dispatchVarName
        ? `// __sdt_ced__ replaces createEventDispatcher() — returns a wrapped dispatch\n` +
          `// that logs every event to the devtools event log.\n` +
          `function __sdt_ced__() {\n` +
          `  const __sdt_real__ = __sdt_ced_orig__();\n` +
          `  return (event, detail, opts) => {\n` +
          `    __sdt_event__(__sdt_id__, ${JSON.stringify(componentName)}, event, detail);\n` +
          `    return __sdt_real__(event, detail, opts);\n` +
          `  };\n` +
          `}`
        : ''

      const injection = `
import { onMount as __sdt_om__, onDestroy as __sdt_od__, untrack as __sdt_untrack__, getContext as __sdt_gc__, setContext as __sdt_sc__, getAllContexts as __sdt_gac__${dispatchVarName ? ', createEventDispatcher as __sdt_ced_orig__' : ''} } from 'svelte';
import {
  __sdt_mount__ as __sdt_mount__,
  __sdt_unmount__ as __sdt_unmount__,
  __sdt_update__ as __sdt_update__,
  __sdt_update_el__ as __sdt_update_el__,
  __sdt_subscribe_store__ as __sdt_ss__,
  __sdt_register_prop_setter__ as __sdt_rps__,
  __sdt_event__ as __sdt_event__,
} from 'virtual:svelte-devtools/runtime';
// Use Svelte context to get the nearest ancestor's devtools id.
// getContext runs synchronously during component init and correctly returns
// the value set by the nearest parent, even for siblings in an {#each}.
const __sdt_parent_id__ = __sdt_gc__('__sdt__') ?? null;
const __sdt_inst__ = {};
const __sdt_id__ = __sdt_mount__(
  __sdt_inst__,
  ${JSON.stringify(componentName)},
  __sdt_parent_id__,
  () => (${propsSnap}),
  () => (${stateSnap}),
  __sdt_gac__,
  ${JSON.stringify(writableKeys)},
  ${JSON.stringify(filename ?? '')},
);
// Register a setter so the devtools panel can write back into prop bindings.
__sdt_rps__(__sdt_id__, (__sdt_pk__, __sdt_pv__) => {
${propSetterCases}
});
// Expose our id so direct children can read it via getContext.
__sdt_sc__('__sdt__', __sdt_id__);
${dispatchWrapper}
__sdt_om__(() => {
  // Now the DOM exists — find this instance's root element and register it.
  const __sdt_el__ = Array.from(
    document.querySelectorAll('[data-sdt="${componentName}"]')
  ).find(el => !el.hasAttribute('data-sdt-id')) ?? null;
  __sdt_update_el__(__sdt_id__, __sdt_el__);
${storeSubscriptions}
});
__sdt_od__(() => __sdt_unmount__(__sdt_id__));
$effect(() => {
  if (!__sdt_id__) return;
  // Capture the start time BEFORE reading reactive vars — this way the timer
  // includes the snapshot work (the actual "render cost" from devtools' POV).
  const __t0__ = performance.now();
  // Read reactive vars here to subscribe — Svelte tracks these reads.
  const __props__ = (${propsSnap});
  const __state__ = (${stateSnap});${contextVars.length ? `\n  // Read context object properties so Svelte tracks mutations to reactive context values.\n  void JSON.stringify([${contextVars.join(', ')}]);` : ''}
  const __dur__ = performance.now() - __t0__;
  // Emit outside Svelte's tracking so the bridge $state mutation
  // does not feed back into this effect and cause an infinite loop.
  __sdt_untrack__(() => {
    __sdt_update__(
      __sdt_id__,
      __dur__,
      () => __props__,
      () => __state__,
      () => __sdt_gac__(),
    );
  });
});
`

      // Wrap createEventDispatcher calls so dispatched events are logged.
      // We replace the call site with __sdt_ced__() — a wrapper defined in the
      // injection that creates a proxy dispatch function.
      const rewrittenContent = dispatchVarName
        ? content.replace(
            /createEventDispatcher\s*(<[^>]*>)?\s*\(\s*\)/g,
            '__sdt_ced__()',
          )
        : content

      // Use MagicString so the original code lines keep their source positions.
      // The appended injection lines have no source mapping (they are generated).
      // Passing source: filename ensures Vite's combineSourcemaps() doesn't
      // replace sources[0] with the original unpreprocessed file content.
      const ms = new MagicString(rewrittenContent)
      ms.append(injection)
      return {
        code: ms.toString(),
        map: ms.generateMap({ hires: true, includeContent: true, source: filename ?? '' }),
      }
    },

    // Inject data-sdt attribute onto the root element so the runtime can
    // find it via querySelector.
    markup({ content, filename }) {
      if (filename?.includes('node_modules')) return { code: content }
      if (filename?.includes('svelte-devtools')) return { code: content }

      // Inject data-sdt on the first real HTML element in the template
      // portion (after all <script> and <style> blocks).
      const name = componentName

      // Strip out script/style blocks first so the regex won't match them
      const withoutScriptsStyles = content
        .replace(/<script[\s\S]*?<\/script>/gi, (m) => ' '.repeat(m.length))
        .replace(/<style[\s\S]*?<\/style>/gi, (m) => ' '.repeat(m.length))

      // Find the first real HTML element in the template that can accept attributes.
      // Excluded: svelte: special tags, comments, <title> (Svelte forbids attrs on it),
      // and other void/metadata elements that cannot have arbitrary attributes.
      const FORBIDDEN_TAGS = new Set(['title', 'base', 'meta', 'link', 'script', 'style'])
      const match = withoutScriptsStyles.match(
        /(<(?!svelte:|!--)[a-zA-Z][a-zA-Z0-9-]*)(\s|>)/,
      )
      if (!match || match.index == null) return { code: content }
      // Extract just the tag name (strip the leading '<')
      const tagName = match[1].slice(1).toLowerCase()
      if (FORBIDDEN_TAGS.has(tagName)) return { code: content }

      const idx = match.index
      const patched =
        content.slice(0, idx + match[1].length) +
        ` data-sdt="${name}"` +
        content.slice(idx + match[1].length)
      return { code: patched }
    },
  }
}

// ── AST helpers ──────────────────────────────────────────────────────────────

/**
 * Extract variable names bound via $props().
 * Handles:  let { a, b = 0, c: renamed } = $props()
 *           let { a, b }: Props = $props()          (TS type annotation)
 *           let { a, b }: { a: string } = $props()  (TS inline type)
 *
 * Returns: { names: string[], isConst: boolean }
 * isConst=true when `const { ... } = $props()` — those props cannot be assigned to.
 */
function extractProps(code: string): { names: string[]; isConst: boolean } {
  const names: string[] = []
  // Strip TS type annotation between the destructuring } and = $props().
  // The annotation may contain nested braces e.g. }: { a: string | null } = $props()
  // Strategy: find $props(, then find the last } before it, then replace everything
  // between that } and $props( with just " = $props(".
  const propsCall = /\$props\s*\(/.exec(code)
  if (!propsCall) return { names, isConst: false }

  // Find the destructuring { ... } that feeds $props() by scanning BACKWARDS
  // from $props(. This avoids mistaking interface/type bodies earlier in the
  // script for the destructuring brace.
  //
  // Pattern:  let { ...bindings... }: OptionalTSAnnotation = $props()
  //                                ^--- destructuringClose
  //               ^--- openBrace
  //
  // Walking backwards from $props.index, skip whitespace/=, then find the
  // rightmost } (end of TS annotation or end of destructuring if no annotation),
  // then brace-match to find its opening {, check let/const/var precedes it.
  const beforeProps = code.slice(0, propsCall.index)

  // Find the last } before $props( — this is either the destructuring close
  // (no annotation) or the annotation close (with annotation).
  const lastClose = beforeProps.lastIndexOf('}')
  if (lastClose < 0) return { names, isConst: false }

  // Walk backwards from lastClose to find the matching {
  let openBrace = -1
  {
    let depth = 0
    for (let i = lastClose; i >= 0; i--) {
      if (beforeProps[i] === '}') depth++
      else if (beforeProps[i] === '{') {
        depth--
        if (depth === 0) { openBrace = i; break }
      }
    }
  }
  if (openBrace < 0) return { names, isConst: false }

  // Check what precedes the opening {
  const beforeBrace = beforeProps.slice(0, openBrace).trimEnd()
  const isDestructuring = /\b(?:let|const|var)\s*$/.test(beforeBrace)
  const isAnnotation = /[):]\s*$/.test(beforeBrace) // TS annotation like }: SomeType

  // Track whether the props binding uses const (those cannot be assigned to)
  let isConst = false
  let destructuringOpenBrace: number
  let destructuringCloseIdx: number

  if (isDestructuring) {
    // No TS annotation — { ... } is the destructuring itself
    isConst = /\bconst\s*$/.test(beforeBrace)
    destructuringOpenBrace = openBrace
    destructuringCloseIdx = lastClose
  } else if (isAnnotation) {
    // There's a TS annotation }: { ... } between the destructuring } and $props(
    // Now find the destructuring's own { } by searching further back
    const beforeAnnotation = beforeProps.slice(0, openBrace)
    const destructClose = beforeAnnotation.lastIndexOf('}')
    if (destructClose < 0) return { names, isConst: false }
    let dOpen = -1
    {
      let depth = 0
      for (let i = destructClose; i >= 0; i--) {
        if (beforeAnnotation[i] === '}') depth++
        else if (beforeAnnotation[i] === '{') {
          depth--
          if (depth === 0) { dOpen = i; break }
        }
      }
    }
    if (dOpen < 0) return { names, isConst: false }
    const beforeDestructBrace = beforeAnnotation.slice(0, dOpen).trimEnd()
    if (!/\b(?:let|const|var)\s*$/.test(beforeDestructBrace)) return { names, isConst: false }
    isConst = /\bconst\s*$/.test(beforeDestructBrace)
    destructuringOpenBrace = dOpen
    destructuringCloseIdx = destructClose
  } else {
    return { names, isConst: false }
  }

  // Strip everything between the destructuring } and $props( (TS annotation + =)
  const stripped =
    code.slice(0, destructuringCloseIdx + 1) + ' = $props(' + code.slice(propsCall.index + propsCall[0].length)

  const letBrace = destructuringOpenBrace
  let innerDepth = 0
  let innerEnd = -1
  for (let i = letBrace; i < stripped.length; i++) {
    if (stripped[i] === '{') innerDepth++
    else if (stripped[i] === '}') {
      innerDepth--
      if (innerDepth === 0) { innerEnd = i; break }
    }
  }
  if (innerEnd < 0) return { names, isConst }
  const innerStr = stripped.slice(letBrace + 1, innerEnd)

  // Split on top-level commas only (ignore commas inside () [] {})
  const parts: string[] = []
  let depth = 0, start = 0
  for (let i = 0; i < innerStr.length; i++) {
    const ch = innerStr[i]
    if (ch === '(' || ch === '[' || ch === '{') depth++
    else if (ch === ')' || ch === ']' || ch === '}') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(innerStr.slice(start, i))
      start = i + 1
    }
  }
  parts.push(innerStr.slice(start))

  // JS reserved words that must never appear as shorthand property names
  const RESERVED = new Set([
    'null', 'undefined', 'true', 'false', 'this', 'super',
    'new', 'delete', 'typeof', 'void', 'in', 'of', 'instanceof',
    'return', 'throw', 'if', 'else', 'for', 'while', 'do', 'switch',
    'case', 'break', 'continue', 'class', 'extends', 'import', 'export',
    'default', 'const', 'let', 'var', 'function', 'async', 'await',
    'yield', 'static', 'get', 'set',
  ])
  // Each binding: "name", "name = default", "key: name", "key: name = default"
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    // Skip rest elements: "...rest"
    if (trimmed.startsWith('...')) continue
    // "key: localName = default" or "key: localName"
    const colonIdx = trimmed.indexOf(':')
    const raw = colonIdx >= 0 ? trimmed.slice(colonIdx + 1) : trimmed
    const varName = raw.split('=')[0].trim()
    if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(varName) && !RESERVED.has(varName)) {
      names.push(varName)
    }
  }
  return { names, isConst }
}

/**
 * Extract variable names declared as $state() or $derived() — for display snapshots.
 * Handles:  let x = $state(...)  /  const y = $derived(...)
 *           let x = $state.raw(...)  /  let x = $state.eager(...)
 *           let x = $derived.by(...)
 */
function extractStateAndDerived(code: string): string[] {
  const names: string[] = []
  const re = /(?:let|const|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\$(?:state(?:\.(?:raw|eager))?|derived(?:\.by)?)\s*[(<]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    names.push(m[1])
  }
  return names
}

/**
 * Extract only writable $state variable names — these are safe to include in
 * the devtools prop setter. Only `let`/`var` bindings are included; `const`
 * causes a `constant_assignment` compile error. $derived variables are excluded
 * because they snap back on the next dependency update.
 * Handles: let x = $state(...)  /  let x = $state.raw(...)  /  let x = $state.eager(...)
 */
function extractWritableState(code: string): string[] {
  const names: string[] = []
  const re = /(?:let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*\$state(?:\.(?:raw|eager))?\s*[(<]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    names.push(m[1])
  }
  return names
}

/**
 * Detect Svelte stores imported and used with the $ prefix.
 * We look for `import { xxx } from '...'` where xxx is used as $xxx anywhere
 * in the file (script or template). Simple heuristic.
 */
function extractStores(scriptContent: string, fullContent: string): string[] {
  const importedNames: string[] = []
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/g
  let m: RegExpExecArray | null
  while ((m = importRe.exec(scriptContent)) !== null) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[a-zA-Z_$]/.test(name)) importedNames.push(name)
    }
  }
  // Filter to those that look like stores (appear as $name anywhere in file, or have .subscribe)
  return importedNames.filter(
    (n) => new RegExp(`\\$${n}\\b`).test(fullContent) || new RegExp(`${n}\\.subscribe\\b`).test(scriptContent),
  )
}

function objLiteral(keys: string[]): string {
  if (keys.length === 0) return '{}'
  return `{ ${keys.map((k) => k).join(', ')} }`
}

/**
 * Finds variables assigned from getContext(...) calls, e.g.:
 *   const user = getContext('user')        → ['user']
 *   let theme = getContext<Theme>('theme') → ['theme']
 * These are reactive $state object references — reading their properties
 * inside a $effect makes Svelte track them as dependencies so the effect
 * re-runs when context values mutate.
 */
function extractContextVars(code: string): string[] {
  const vars: string[] = []
  const re = /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*getContext\s*(?:<[^>]*>)?\s*\(/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) vars.push(m[1])
  return vars
}

/**
 * If the script uses createEventDispatcher(), return the variable name it's
 * assigned to (e.g. "dispatch" from `const dispatch = createEventDispatcher()`).
 * Returns null if not found. Only matches `let`/`const`/`var` assignments.
 */
function extractCreateEventDispatcherVar(code: string): string | null {
  const m = /(?:let|const|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*createEventDispatcher\s*(?:<[^>]*>)?\s*\(/.exec(code)
  return m ? m[1] : null
}

