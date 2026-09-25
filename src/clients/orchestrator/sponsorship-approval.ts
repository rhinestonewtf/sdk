import { chainIdFromCaip2 } from '../../chains/caip2'
import { UnsupportedSponsorshipApprovalError } from '../../errors/execution'
import type { SerializedIntentInput } from './public'

// The sponsorship approval contract: the approval input an intent-scoped grant
// commits to is a pure function of the Caucasus quote body, so the orchestrator
// can recompute it from the request it received. This is that function. Any
// field it cannot represent exactly is refused rather than approximated, and
// the orchestrator must refuse the same set. docs/sponsorship-approval.md is
// the published form of these rules.

type Json = null | boolean | number | string | Json[] | JsonObject
interface JsonObject {
  [key: string]: Json
}

function unsupported(field: string): never {
  throw new UnsupportedSponsorshipApprovalError({
    reason: 'unsupported',
    field,
  })
}

function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function object(
  value: Json | undefined,
  field: string,
  allowed: readonly string[],
): JsonObject {
  if (!isObject(value)) unsupported(field)
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) unsupported(field ? `${field}.${key}` : key)
  }
  return value
}

function array(value: Json | undefined, field: string): Json[] {
  if (!Array.isArray(value)) unsupported(field)
  return value
}

function string(value: Json | undefined, field: string): string {
  if (typeof value !== 'string') unsupported(field)
  return value
}

function chainId(value: Json | undefined, field: string): number {
  const id = chainIdFromCaip2(string(value, field))
  if (id === undefined) unsupported(field)
  return id
}

/** Re-keys a CAIP-2 map by decimal numeric chain id. */
function byChainId(value: Json | undefined, field: string): JsonObject {
  if (!isObject(value)) unsupported(field)
  const result: JsonObject = {}
  for (const [key, item] of Object.entries(value)) {
    result[String(chainId(key, `${field}.${key}`))] = item
  }
  return result
}

function executions(value: Json | undefined, field: string): Json[] {
  return array(value, field).map((call, index) => {
    object(call, `${field}.${index}`, ['to', 'value', 'data'])
    return call
  })
}

function setupOps(value: Json | undefined, field: string): Json[] {
  return array(value, field).map((op, index) => {
    object(op, `${field}.${index}`, ['to', 'data'])
    return op
  })
}

function delegations(value: Json | undefined, field: string): JsonObject {
  const entry = object(value, field, ['default', 'chains'])
  // Per-chain delegations have no representation in the approval input, which
  // only knows the chain-agnostic sentinel `0`.
  if (entry.chains !== undefined) unsupported(`${field}.chains`)
  if (entry.default === undefined) unsupported(`${field}.default`)
  const contract = object(entry.default, `${field}.default`, ['contract'])
  return {
    0: { contract: string(contract.contract, `${field}.default.contract`) },
  }
}

/** A typed EVM account or recipient, in the approval input's spelling. */
function evmAccount(
  value: JsonObject,
  field: string,
  options: { readonly signatureMode: boolean },
): { readonly account: JsonObject; readonly signatureMode?: Json } {
  const signature = options.signatureMode ? ['signatureMode'] : []
  const entry =
    value.type === 'erc7579'
      ? object(value, field, [
          'type',
          'address',
          'initData',
          'delegations',
          'simulation',
          ...signature,
        ])
      : value.type === 'eoa'
        ? object(value, field, ['type', 'address', 'delegations', ...signature])
        : unsupported(`${field}.type`)
  const account: JsonObject = {
    address: string(entry.address, `${field}.address`),
    accountType: entry.type === 'eoa' ? 'EOA' : 'ERC7579',
    setupOps:
      entry.initData === undefined
        ? []
        : setupOps(
            object(entry.initData, `${field}.initData`, ['setupOps']).setupOps,
            `${field}.initData.setupOps`,
          ),
  }
  if (entry.delegations !== undefined) {
    account.delegations = delegations(entry.delegations, `${field}.delegations`)
  }
  if (entry.simulation !== undefined) {
    const simulation = object(entry.simulation, `${field}.simulation`, [
      'mockSignature',
      'mockSignaturesByChain',
    ])
    if (simulation.mockSignature !== undefined) {
      unsupported(`${field}.simulation.mockSignature`)
    }
    if (simulation.mockSignaturesByChain !== undefined) {
      account.mockSignatures = byChainId(
        simulation.mockSignaturesByChain,
        `${field}.simulation.mockSignaturesByChain`,
      )
    }
  }
  return {
    account,
    ...(entry.signatureMode === undefined
      ? {}
      : { signatureMode: entry.signatureMode }),
  }
}

function evmRecipient(value: Json | undefined, field: string): JsonObject {
  if (!isObject(value)) unsupported(field)
  // A bare payee keeps the setup-free EOA spelling the released input gave it,
  // so it reads exactly like a typed `eoa` recipient with no delegations.
  if (value.type === undefined) {
    return {
      ...bareRecipient(value, field),
      accountType: 'EOA',
      setupOps: [],
    }
  }
  return evmAccount(value, field, { signatureMode: false }).account
}

function bareRecipient(value: Json | undefined, field: string): JsonObject {
  return {
    address: string(
      object(value, field, ['address']).address,
      `${field}.address`,
    ),
  }
}

function swigAccount(value: Json | undefined, field: string): JsonObject {
  const entry = object(value, field, [
    'type',
    'address',
    'swigAccount',
    'authorization',
    'initData',
  ])
  if (entry.type !== 'swig') unsupported(`${field}.type`)
  string(entry.address, `${field}.address`)
  if (entry.swigAccount !== undefined) {
    string(entry.swigAccount, `${field}.swigAccount`)
  }
  swigAuthority(entry.authorization, `${field}.authorization`)
  if (entry.initData !== undefined) {
    const init = object(entry.initData, `${field}.initData`, [
      'authority',
      'id',
    ])
    const authority = object(init.authority, `${field}.initData.authority`, [
      'kind',
      'publicKey',
    ])
    if (authority.kind !== 'secp256k1' && authority.kind !== 'secp256r1') {
      unsupported(`${field}.initData.authority.kind`)
    }
    string(authority.publicKey, `${field}.initData.authority.publicKey`)
    if (init.id !== undefined) string(init.id, `${field}.initData.id`)
  }
  // Verbatim: the approval names the paying Swig exactly as the request does.
  return entry
}

function swigAuthority(value: Json | undefined, field: string): void {
  if (!isObject(value)) unsupported(field)
  if (value.kind === 'secp256k1') {
    string(
      object(value, field, ['kind', 'address']).address,
      `${field}.address`,
    )
  } else if (value.kind === 'secp256r1') {
    string(
      object(value, field, ['kind', 'publicKey']).publicKey,
      `${field}.publicKey`,
    )
  } else {
    unsupported(`${field}.kind`)
  }
}

interface ProjectedDestination {
  readonly fields: JsonObject
  readonly hyperCore?: JsonObject
}

function evmExecution(
  value: Json | undefined,
  field: string,
  allowed: readonly string[],
): JsonObject {
  const execution = object(value, field, allowed)
  const fields: JsonObject = {
    destinationExecutions: executions(execution.calls, `${field}.calls`),
  }
  if (execution.gasLimit !== undefined) {
    fields.destinationGasUnits = string(execution.gasLimit, `${field}.gasLimit`)
  }
  return fields
}

function destination(value: Json | undefined): ProjectedDestination {
  if (!isObject(value)) unsupported('destination')
  const common = (entry: JsonObject): JsonObject => ({
    destinationChainId: chainId(entry.chainId, 'destination.chainId'),
    destinationExecutions: [],
    tokenRequests: array(entry.tokenRequests, 'destination.tokenRequests').map(
      (request, index) => {
        object(request, `destination.tokenRequests.${index}`, [
          'tokenAddress',
          'amount',
        ])
        return request
      },
    ),
  })
  switch (value.vm) {
    case 'evm': {
      const entry = object(value, 'destination', [
        'vm',
        'chainId',
        'recipient',
        'tokenRequests',
        'execution',
      ])
      return {
        fields: {
          ...common(entry),
          ...(entry.recipient === undefined
            ? {}
            : {
                recipient: evmRecipient(
                  entry.recipient,
                  'destination.recipient',
                ),
              }),
          ...(entry.execution === undefined
            ? {}
            : evmExecution(entry.execution, 'destination.execution', [
                'calls',
                'gasLimit',
              ])),
        },
      }
    }
    case 'svm': {
      const entry = object(value, 'destination', [
        'vm',
        'chainId',
        'recipient',
        'tokenRequests',
        'execution',
      ])
      const fields = common(entry)
      if (entry.recipient !== undefined) {
        fields.recipient = bareRecipient(
          entry.recipient,
          'destination.recipient',
        )
      }
      if (entry.execution !== undefined) {
        const execution = object(entry.execution, 'destination.execution', [
          'instructions',
          'addressLookupTables',
        ])
        fields.destinationInstructions = array(
          execution.instructions,
          'destination.execution.instructions',
        )
        if (execution.addressLookupTables !== undefined) {
          fields.addressLookupTableAddresses = array(
            execution.addressLookupTables,
            'destination.execution.addressLookupTables',
          )
        }
      }
      return { fields }
    }
    case 'tvm':
    case 'stellar': {
      const entry = object(value, 'destination', [
        'vm',
        'chainId',
        'recipient',
        'tokenRequests',
      ])
      return {
        fields: {
          ...common(entry),
          recipient: bareRecipient(entry.recipient, 'destination.recipient'),
        },
      }
    }
    case 'hypercore': {
      const entry = object(value, 'destination', [
        'vm',
        'chainId',
        'recipient',
        'tokenRequests',
        'execution',
      ])
      const fields = common(entry)
      if (entry.recipient !== undefined) {
        fields.recipient = evmRecipient(
          entry.recipient,
          'destination.recipient',
        )
      }
      let hyperCore: JsonObject | undefined
      if (entry.execution !== undefined) {
        const execution = object(entry.execution, 'destination.execution', [
          'actions',
          'settlement',
        ])
        if (execution.actions !== undefined) {
          const actions = array(
            execution.actions,
            'destination.execution.actions',
          )
          // The approval input carries a single `options.hyperCore.action`.
          if (actions.length !== 1) {
            unsupported('destination.execution.actions')
          }
          hyperCore = { action: actions[0]! }
        }
        if (execution.settlement !== undefined) {
          Object.assign(
            fields,
            evmExecution(
              execution.settlement,
              'destination.execution.settlement',
              ['calls', 'gasLimit'],
            ),
          )
        }
      }
      return { fields, ...(hyperCore ? { hyperCore } : {}) }
    }
    default:
      return unsupported('destination.vm')
  }
}

function onlyList(
  value: Json | undefined,
  field: string,
): string[] | undefined {
  if (value === 'all') return undefined
  const selector = object(value, field, ['only', 'except'])
  if (selector.except !== undefined) unsupported(`${field}.except`)
  return array(selector.only, `${field}.only`).map((item, index) =>
    string(item, `${field}.only.${index}`),
  )
}

function sameSet(left: readonly string[], right: readonly string[]): boolean {
  const a = new Set(left)
  const b = new Set(right)
  return a.size === b.size && [...a].every((item) => b.has(item))
}

interface ProjectedSource {
  readonly accountAccessList?: JsonObject
  readonly auxiliaryFunds?: JsonObject
  readonly preClaimExecutions?: JsonObject
}

function accessList(source: JsonObject): JsonObject | undefined {
  const limits =
    source.limits === undefined
      ? []
      : array(source.limits, 'source.limits').map((limit, index) => {
          const entry = object(limit, `source.limits.${index}`, [
            'chainId',
            'tokenAddress',
            'maxAmount',
          ])
          return {
            chainId: string(entry.chainId, `source.limits.${index}.chainId`),
            tokenAddress: string(
              entry.tokenAddress,
              `source.limits.${index}.tokenAddress`,
            ),
            maxAmount: string(
              entry.maxAmount,
              `source.limits.${index}.maxAmount`,
            ),
          }
        })
  if (source.selection === undefined) {
    if (limits.length > 0) unsupported('source.limits')
    return undefined
  }
  const selection = object(source.selection, 'source.selection', [
    'chains',
    'tokens',
    'perChain',
  ])
  const chains = onlyList(selection.chains, 'source.selection.chains')
  const tokens = onlyList(selection.tokens, 'source.selection.tokens')

  if (selection.perChain === undefined) {
    // A cap without a per-chain map has no approval-input spelling: a capped
    // pair is always named in `chainTokenAmounts`.
    if (limits.length > 0) unsupported('source.limits')
    if (!chains && !tokens) return undefined
    return {
      ...(chains
        ? {
            chainIds: chains.map((chain, index) =>
              chainId(chain, `source.selection.chains.only.${index}`),
            ),
          }
        : {}),
      ...(tokens ? { tokens } : {}),
    }
  }

  const perChain = selection.perChain
  if (!isObject(perChain)) unsupported('source.selection.perChain')
  const lists = Object.entries(perChain).map(([caip2, entry]) => {
    const field = `source.selection.perChain.${caip2}`
    const list = onlyList(
      object(entry, field, ['tokens']).tokens,
      `${field}.tokens`,
    )
    if (!list) unsupported(`${field}.tokens`)
    return { caip2, id: chainId(caip2, field), tokens: list }
  })
  // The per-chain map is the whole allowlist; the global selectors must say
  // exactly the same thing or they would carry a constraint the input lacks.
  if (
    !chains ||
    !sameSet(
      chains,
      lists.map(({ caip2 }) => caip2),
    )
  ) {
    unsupported('source.selection.chains')
  }
  if (
    !tokens ||
    !sameSet(
      tokens,
      lists.flatMap((list) => list.tokens),
    )
  ) {
    unsupported('source.selection.tokens')
  }
  const caps = new Map<string, string>()
  for (const [index, limit] of limits.entries()) {
    const key = `${limit.chainId}|${limit.tokenAddress}`
    const listed = lists
      .find(({ caip2 }) => caip2 === limit.chainId)
      ?.tokens.includes(limit.tokenAddress)
    if (!listed || caps.has(key)) unsupported(`source.limits.${index}`)
    caps.set(key, limit.maxAmount)
  }
  const chainTokens: JsonObject = {}
  const chainTokenAmounts: JsonObject = {}
  for (const { caip2, id, tokens: list } of lists) {
    const uncapped = list.filter((token) => !caps.has(`${caip2}|${token}`))
    // An empty list is still a named chain; a fully capped one is named by its
    // caps alone.
    if (uncapped.length > 0 || list.length === 0) {
      chainTokens[String(id)] = uncapped
    }
    for (const token of list) {
      const cap = caps.get(`${caip2}|${token}`)
      if (cap === undefined) continue
      const amounts = (chainTokenAmounts[String(id)] ??= {}) as JsonObject
      amounts[token] = cap
    }
  }
  return {
    ...(Object.keys(chainTokens).length > 0 ? { chainTokens } : {}),
    ...(Object.keys(chainTokenAmounts).length > 0 ? { chainTokenAmounts } : {}),
  }
}

function source(value: Json | undefined): ProjectedSource {
  if (value === undefined) return {}
  const entry = object(value, 'source', [
    'selection',
    'limits',
    'auxiliaryFunds',
    'executions',
  ])
  const list = accessList(entry)
  const result: {
    accountAccessList?: JsonObject
    auxiliaryFunds?: JsonObject
    preClaimExecutions?: JsonObject
  } = list ? { accountAccessList: list } : {}
  if (entry.auxiliaryFunds !== undefined) {
    result.auxiliaryFunds = byChainId(
      entry.auxiliaryFunds,
      'source.auxiliaryFunds',
    )
  }
  if (entry.executions !== undefined) {
    const preClaim: JsonObject = {}
    for (const [index, item] of array(
      entry.executions,
      'source.executions',
    ).entries()) {
      const field = `source.executions.${index}`
      const execution = object(item, field, ['vm', 'chainId', 'calls'])
      if (execution.vm !== 'evm') unsupported(`${field}.vm`)
      const id = String(chainId(execution.chainId, `${field}.chainId`))
      if (preClaim[id] !== undefined) unsupported(`${field}.chainId`)
      preClaim[id] = executions(execution.calls, `${field}.calls`)
    }
    result.preClaimExecutions = preClaim
  }
  return result
}

function options(value: Json | undefined): JsonObject {
  if (value === undefined) return {}
  const entry = object(value, 'options', [
    'appFees',
    'protocolFees',
    'customDeadline',
    'sponsorship',
    'settlementLayers',
    'quoters',
  ])
  const result: JsonObject = {}
  for (const key of [
    'appFees',
    'protocolFees',
    'customDeadline',
    'settlementLayers',
    'quoters',
  ] as const) {
    if (entry[key] !== undefined) result[key] = entry[key]
  }
  // Renamed, not reshaped: an explicit `false` category is kept.
  if (entry.sponsorship !== undefined) {
    result.sponsorSettings = object(entry.sponsorship, 'options.sponsorship', [
      'gas',
      'bridgeFees',
      'swapFees',
      'protocolFees',
    ])
  }
  return result
}

function account(value: Json | undefined): {
  readonly account: JsonObject
  readonly signatureMode?: Json
} {
  const entry = object(value, 'account', ['evm', 'svm'])
  const svm =
    entry.svm === undefined ? undefined : swigAccount(entry.svm, 'account.svm')
  if (entry.evm !== undefined) {
    if (!isObject(entry.evm)) unsupported('account.evm')
    const evm = evmAccount(entry.evm, 'account.evm', { signatureMode: true })
    return {
      account: { ...evm.account, ...(svm ? { svm } : {}) },
      ...(evm.signatureMode === undefined
        ? {}
        : { signatureMode: evm.signatureMode }),
    }
  }
  if (!svm) unsupported('account')
  return { account: { address: svm.address as string, svm } }
}

/**
 * Derives the sponsorship approval input from a Caucasus `POST /quotes` body.
 *
 * Throws {@link UnsupportedSponsorshipApprovalError} on any field the approval
 * input cannot represent exactly.
 */
export function projectSponsorshipApproval(
  body: unknown,
): SerializedIntentInput {
  // Projected from the JSON that is sent, so an `undefined` member or a value
  // `JSON.stringify` rewrites cannot make the two disagree.
  const json = toJson(body)
  const root = object(json, '', ['account', 'destination', 'source', 'options'])
  const projectedAccount = account(root.account)
  const projectedDestination = destination(root.destination)
  const projectedSource = source(root.source)
  const projectedOptions = options(root.options)
  if (projectedAccount.signatureMode !== undefined) {
    projectedOptions.signatureMode = projectedAccount.signatureMode
  }
  if (projectedSource.auxiliaryFunds) {
    projectedOptions.auxiliaryFunds = projectedSource.auxiliaryFunds
  }
  if (projectedDestination.hyperCore) {
    projectedOptions.hyperCore = projectedDestination.hyperCore
  }
  return {
    account: projectedAccount.account,
    ...projectedDestination.fields,
    ...(projectedSource.accountAccessList
      ? { accountAccessList: projectedSource.accountAccessList }
      : {}),
    options: projectedOptions,
    ...(projectedSource.preClaimExecutions
      ? { preClaimExecutions: projectedSource.preClaimExecutions }
      : {}),
  } as unknown as SerializedIntentInput
}

/**
 * Refuses a quote whose approval input is not exactly the one derivable from
 * its body, so an integrator is never asked to approve something the
 * orchestrator would bind differently.
 */
export function assertSponsorshipApproval(
  body: unknown,
  intentInput: SerializedIntentInput,
): void {
  const projected = toJson(projectSponsorshipApproval(body))
  const field = firstDifference(projected, toJson(intentInput), '')
  if (field !== undefined) {
    throw new UnsupportedSponsorshipApprovalError({
      reason: 'mismatch',
      ...(field ? { field } : {}),
    })
  }
}

function toJson(value: unknown): Json {
  return JSON.parse(JSON.stringify(value)) as Json
}

/** Path of the first value that differs, or `undefined` when equal. */
function firstDifference(
  left: Json,
  right: Json,
  path: string,
): string | undefined {
  const at = (key: string | number) => (path ? `${path}.${key}` : String(key))
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return path
    if (left.length !== right.length) return path
    for (const [index, item] of left.entries()) {
      const difference = firstDifference(item, right[index]!, at(index))
      if (difference !== undefined) return difference
    }
    return undefined
  }
  if (isObject(left) || isObject(right)) {
    if (!isObject(left) || !isObject(right)) return path
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])]
    for (const key of keys.sort()) {
      if (!(key in left) || !(key in right)) return at(key)
      const difference = firstDifference(left[key]!, right[key]!, at(key))
      if (difference !== undefined) return difference
    }
    return undefined
  }
  return left === right ? undefined : path
}
