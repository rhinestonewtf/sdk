// Converts values from either build into plain JSON so the two can be compared
// without sharing classes. Bigints become `"<n>n"` strings.

type Plain = null | boolean | number | string | Plain[] | { [k: string]: Plain }

function isChain(value: Record<string, unknown>): boolean {
  return (
    typeof value.id === 'number' &&
    typeof value.rpcUrls === 'object' &&
    value.rpcUrls !== null
  )
}

function isAccount(value: Record<string, unknown>): boolean {
  return (
    typeof value.address === 'string' &&
    (typeof value.signMessage === 'function' ||
      typeof value.sign === 'function')
  )
}

function toPlain(value: unknown, seen = new WeakSet<object>()): Plain {
  if (value === null || value === undefined) return null
  switch (typeof value) {
    case 'bigint':
      return `${value.toString()}n`
    case 'number':
      return Number.isFinite(value) ? value : String(value)
    case 'string':
    case 'boolean':
      return value
    case 'function':
      return '[function]'
    case 'symbol':
      return value.toString()
  }
  if (value instanceof Uint8Array) {
    return `0x${Buffer.from(value).toString('hex')}`
  }
  if (value instanceof Error) {
    return { message: value.message, name: value.name }
  }
  if (value instanceof Map) {
    return toPlain(Object.fromEntries(value), seen)
  }
  if (value instanceof Set) {
    return toPlain([...value], seen)
  }
  const obj = value as object
  if (seen.has(obj)) return '[circular]'
  seen.add(obj)
  try {
    if (Array.isArray(obj)) {
      return obj.map((item) => toPlain(item, seen))
    }
    const record = obj as Record<string, unknown>
    if (isChain(record)) return { $chain: record.id as number }
    if (isAccount(record)) {
      return { $account: (record.address as string).toLowerCase() }
    }
    const out: Record<string, Plain> = {}
    for (const key of Object.keys(record).sort()) {
      const entry = record[key]
      if (entry === undefined) continue
      out[key] = toPlain(entry, seen)
    }
    return out
  } finally {
    seen.delete(obj)
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue
      out[key] = sortKeys(record[key])
    }
    return out
  }
  return value
}

function stableStringify(value: unknown): string {
  return `${JSON.stringify(
    sortKeys(value),
    (_key, v) => (typeof v === 'bigint' ? `${v.toString()}n` : v),
    2,
  )}\n`
}

function parseJson(text: string | undefined | null): unknown {
  if (text === undefined || text === null || text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

export type { Plain }
export { parseJson, sortKeys, stableStringify, toPlain }
