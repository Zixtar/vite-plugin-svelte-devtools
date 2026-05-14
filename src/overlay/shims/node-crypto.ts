/**
 * Browser shim for node:crypto — only the `createHash` API is needed
 * (used transitively by ohash inside devframe/client).
 *
 * The ohash code that actually calls createHash is only reached when
 * `globalThis.process?.getBuiltinModule?.("crypto")?.hash` is falsy AND
 * we are not in a WebContainer — i.e. a plain browser.  We provide a
 * synchronous SHA-256 implementation backed by SubtleCrypto.
 *
 * Because SubtleCrypto is async, but ohash calls .digest() synchronously,
 * we fall back to a simple djb2-style string hash that is good enough for
 * the cache-key purpose devframe uses it for.
 */

class BrowserHash {
  private _data = ''
  private _algo: string

  constructor(algo: string) {
    this._algo = algo
  }

  update(data: string | Uint8Array): this {
    if (typeof data === 'string') {
      this._data += data
    } else {
      this._data += new TextDecoder().decode(data)
    }
    return this
  }

  digest(encoding?: string): string {
    // Simple but stable djb2-based hash — sufficient for devframe's cache keys
    let h = 5381
    for (let i = 0; i < this._data.length; i++) {
      h = ((h << 5) + h) ^ this._data.charCodeAt(i)
      h = h >>> 0
    }
    const hex = h.toString(16).padStart(8, '0')
    if (encoding === 'base64url' || encoding === 'base64') {
      return btoa(hex).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
    }
    return hex
  }
}

export function createHash(algo: string) {
  return new BrowserHash(algo)
}
