import type { CanonicalCostToken, CanonicalQuoteRequest } from './types'

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

function account(value: unknown): Record<string, unknown> | undefined {
  if (!value) return undefined
  const input = asRecord(value)
  return lowerHex(
    compact({
      ...input,
      delegations: mapChainKeys(input.delegations),
      mockSignatures: mapChainKeys(input.mockSignatures),
    }),
  )
}

function executions(value: unknown): unknown[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.map((execution) => {
    const input = asRecord(execution)
    return lowerHex(compact({ ...input, value: amount(input.value) }))
  })
}

function authorization(value: unknown) {
  const input = asRecord(value)
  return lowerHex(compact({ ...input, chainId: chainIdNumber(input.chainId) }))
}

function tokenAmountRecord(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [token, entry] of Object.entries(asRecord(value))) {
    out[token.toLowerCase()] = amount(entry) as string
  }
  return out
}

// The quote request shape both versions share; the version-specific parts are
// the gas field name, the access list and the options.
function quoteRequest(
  body: unknown,
  version: {
    gasLimitKey: string
    accessList(value: unknown): unknown
    options(value: unknown): Record<string, unknown>
  },
): CanonicalQuoteRequest {
  const {
    account: rawAccount,
    recipient,
    destinationChainId,
    destinationExecutions,
    [version.gasLimitKey]: gasLimit,
    tokenRequests,
    accountAccessList,
    options,
    preClaimExecutions,
    ...rest
  } = asRecord(body)
  return compact({
    ...lowerHex(rest),
    destinationChainId: chainIdNumber(destinationChainId),
    tokenRequests: (Array.isArray(tokenRequests) ? tokenRequests : []).map(
      (request) => {
        const item = asRecord(request)
        return compact({
          token: String(item.tokenAddress).toLowerCase(),
          amount: amount(item.amount),
        })
      },
    ),
    account: account(rawAccount) ?? {},
    recipient: account(recipient),
    destinationExecutions: executions(destinationExecutions) ?? [],
    destinationGasLimit: amount(gasLimit),
    preClaimExecutions: mapChainKeys(preClaimExecutions, executions) as
      | Record<string, unknown[]>
      | undefined,
    accountAccessList: version.accessList(accountAccessList),
    options: version.options(options),
  })
}

function portfolioQuery(query: Record<string, string>) {
  const tokens: Record<string, string[]> = {}
  for (const entry of (query.tokens ?? '').split(',').filter(Boolean)) {
    const separator = entry.lastIndexOf(':')
    const chain = String(chainIdNumber(entry.slice(0, separator)))
    tokens[chain] ??= []
    tokens[chain].push(entry.slice(separator + 1).toLowerCase())
  }
  return compact({
    chainIds: query.chainIds
      ? query.chainIds.split(',').filter(Boolean).map(chainIdNumber)
      : undefined,
    tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
    filterEmpty: query.filterEmpty,
  })
}

type ReadOp = 'status' | 'portfolio' | 'splits' | 'appFeeBalances'

// Read requests differ between versions only in path and chain-id encoding.
function readParams(
  op: ReadOp,
  request: { path: string; query: Record<string, string>; body: unknown },
): Record<string, unknown> {
  switch (op) {
    case 'status':
      return {
        intentId: decodeURIComponent(request.path.split('/').pop() ?? ''),
      }
    case 'portfolio':
      return compact({
        account: decodeURIComponent(
          request.path.split('/')[2] ?? '',
        ).toLowerCase(),
        ...portfolioQuery(request.query),
      })
    case 'splits': {
      const input = asRecord(request.body)
      return compact({
        chainId: chainIdNumber(input.chainId),
        tokens: tokenAmountRecord(input.tokens),
        settlementLayers: filterList(input.settlementLayers),
      })
    }
    case 'appFeeBalances':
      return {}
  }
}

// The domain code of an alps error body: the first error's context code, the
// flat liquidity body's `error`, or the gateway auth body's `code`.
function alpsWireCode(body: unknown): string | undefined {
  const input = asRecord(body)
  const first = Array.isArray(input.errors) ? asRecord(input.errors[0]) : {}
  const code = asRecord(first.context).code ?? input.error ?? input.code
  return typeof code === 'string' ? code : undefined
}

function sumAmounts(values: unknown[]): string {
  let total = 0n
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue
    total += BigInt(String(value))
  }
  return total.toString()
}

function sortCostTokens(tokens: CanonicalCostToken[]): CanonicalCostToken[] {
  return [...tokens].sort((a, b) => {
    const left = `${a.chainId}:${a.token}`
    const right = `${b.chainId}:${b.token}`
    return left < right ? -1 : left > right ? 1 : 0
  })
}

export type { ReadOp }
export {
  alpsWireCode,
  amount,
  asRecord,
  authorization,
  chainIdNumber,
  compact,
  filterList,
  lowerHex,
  mapChainKeys,
  quoteRequest,
  readParams,
  signatureModeNumber,
  sortCostTokens,
  sumAmounts,
  tokenAmountRecord,
}
