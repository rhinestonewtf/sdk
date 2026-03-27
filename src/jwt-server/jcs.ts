/**
 * RFC 8785 JSON Canonicalization Scheme (JCS).
 *
 * Produces a deterministic JSON serialization by:
 * 1. Sorting object keys lexicographically (Unicode code-point order)
 * 2. Using ES2015+ `JSON.stringify` number serialization (IEEE 754 → shortest round-trip)
 * 3. No whitespace
 *
 * Reference: https://www.rfc-editor.org/rfc/rfc8785
 */

export function jcsCanonicalise(value: unknown): string {
  return serialize(value)
}

function serialize(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'

    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error(`JCS: non-finite number: ${value}`)
      }
      // ES2015 Number-to-String satisfies RFC 8785 §3.2.2.3
      return Object.is(value, -0) ? '0' : String(value)

    case 'string':
      return JSON.stringify(value)

    case 'bigint':
      // BigInt is not valid JSON; coerce to number string for interop
      return String(value)

    default:
      break
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => serialize(item))
    return `[${items.join(',')}]`
  }

  // Object — sort keys by Unicode code-point order
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const members: string[] = []
  for (const key of keys) {
    const v = obj[key]
    if (v === undefined) continue // skip undefined properties
    members.push(`${JSON.stringify(key)}:${serialize(v)}`)
  }
  return `{${members.join(',')}}`
}
