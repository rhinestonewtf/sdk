// Shared canonicalization helpers: lowercase hex, numeric chain ids, decimal
// amounts and sorted keys, so both API versions project to one shape.

const HEX = /^0x[0-9a-fA-F]*$/
const CAIP2_EIP155 = /^eip155:(\d+)$/

function lowerHex<T>(value: T): T {
  if (typeof value === 'string') {
    return (HEX.test(value) ? value.toLowerCase() : value) as T
  }
  if (Array.isArray(value)) return value.map(lowerHex) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value).sort()) {
      const entry = (value as Record<string, unknown>)[key]
      if (entry === undefined) continue
      out[HEX.test(key) ? key.toLowerCase() : key] = lowerHex(entry)
    }
    return out as T
  }
  return value
}

// `eip155:N` and `"N"` become N; non-EVM CAIP-2 ids stay strings.
function chainIdNumber(value: unknown): number | string {
  if (typeof value === 'number') return value
  if (typeof value === 'string') {
    const caip = CAIP2_EIP155.exec(value)
    if (caip) return Number(caip[1])
    if (/^\d+$/.test(value)) return Number(value)
    return value
  }
  return String(value)
}

function chainKey(value: string): string {
  return String(chainIdNumber(value))
}

function mapChainKeys<T>(
  record: Record<string, T> | undefined,
  mapValue: (value: T) => unknown = (v) => v,
): Record<string, unknown> | undefined {
  if (!record || typeof record !== 'object') return undefined
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    out[chainKey(key)] = mapValue(value)
  }
  return out
}

function amount(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'bigint') return value.toString()
  if (typeof value === 'number') return BigInt(Math.trunc(value)).toString()
  if (typeof value === 'string') {
    if (/^-?\d+n$/.test(value)) return value.slice(0, -1)
    if (/^0x[0-9a-fA-F]+$/.test(value)) return BigInt(value).toString()
    return value
  }
  return String(value)
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object'
    ? (value as Record<string, any>)
    : {}
}

function compact<T extends Record<string, unknown>>(value: T): T {
  const out: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry
  }
  return out as T
}

const SIGNATURE_MODES = [
  'EMISSARY',
  'ERC1271',
  'EMISSARY_ERC1271',
  'ERC1271_EMISSARY',
  'EMISSARY_EXECUTION',
  'EMISSARY_EXECUTION_ERC1271',
  'ERC1271_EMISSARY_EXECUTION',
] as const

function signatureModeNumber(value: unknown): unknown {
  if (typeof value === 'string') {
    const index = SIGNATURE_MODES.indexOf(
      value as (typeof SIGNATURE_MODES)[number],
    )
    return index === -1 ? value : index
  }
  return value
}

// Canonical form is `{ include }` / `{ exclude }`; a bare list means include.
function filterList(value: unknown): unknown {
  if (value === undefined || value === null) return undefined
  if (Array.isArray(value)) return { include: value }
  return value
}

export {
  amount,
  asRecord,
  chainIdNumber,
  chainKey,
  compact,
  filterList,
  lowerHex,
  mapChainKeys,
  signatureModeNumber,
}
