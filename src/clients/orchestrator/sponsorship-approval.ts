import { UnsupportedSponsorshipApprovalError } from '../../errors/execution'
import type { SerializedIntentInput } from './public'
import { serializeBigInts } from './serialization'

// The sponsorship approval contract `sdk-caucasus-singular-2026-09-v1`: the
// approval input an intent-scoped grant commits to is the singular Caucasus
// quote body itself, validated field by field. The orchestrator recomputes it
// from the body it received, so any field outside this allowlist is refused
// rather than hashed: a stripped extra field would let two different requests
// share one grant. docs/sponsorship-approval.md is the published form.

export const SPONSORSHIP_APPROVAL_CONTRACT =
  'sdk-caucasus-singular-2026-09-v1' as const

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

function optionalString(value: Json | undefined, field: string): void {
  if (value !== undefined) string(value, field)
}

const CAIP2 = /^(eip155|solana|tron|hypercore|stellar):[-_a-zA-Z0-9]{1,32}$/u

function chainId(value: Json | undefined, field: string): void {
  if (!CAIP2.test(string(value, field))) unsupported(field)
}

function calls(value: Json | undefined, field: string): void {
  for (const [index, call] of array(value, field).entries()) {
    const entry = object(call, `${field}.${index}`, ['to', 'value', 'data'])
    string(entry.to, `${field}.${index}.to`)
    string(entry.value, `${field}.${index}.value`)
    string(entry.data, `${field}.${index}.data`)
  }
}

function evmExecution(value: Json | undefined, field: string): void {
  const execution = object(value, field, ['calls', 'gasLimit'])
  calls(execution.calls, `${field}.calls`)
  optionalString(execution.gasLimit, `${field}.gasLimit`)
}

function delegations(value: Json | undefined, field: string): void {
  const entry = object(value, field, ['default', 'chains'])
  if (entry.default !== undefined) {
    const target = object(entry.default, `${field}.default`, ['contract'])
    string(target.contract, `${field}.default.contract`)
  }
  if (entry.chains !== undefined) {
    if (!isObject(entry.chains)) unsupported(`${field}.chains`)
    for (const [key, target] of Object.entries(entry.chains)) {
      chainId(key, `${field}.chains.${key}`)
      string(
        object(target, `${field}.chains.${key}`, ['contract']).contract,
        `${field}.chains.${key}.contract`,
      )
    }
  }
}

/**
 * A typed EVM account (`account.evm`) or recipient. Only the account carries a
 * signature mode; a recipient never signs.
 */
function evmAccount(
  value: Json | undefined,
  field: string,
  options: { readonly signatureMode: boolean },
): void {
  if (!isObject(value)) unsupported(field)
  const signature = options.signatureMode ? ['signatureMode'] : []
  const entry =
    value.type === undefined && !options.signatureMode
      ? object(value, field, ['address'])
      : value.type === 'eoa'
        ? object(value, field, ['type', 'address', 'delegations', ...signature])
        : value.type === 'erc7579'
          ? object(value, field, [
              'type',
              'address',
              'initData',
              'delegations',
              'simulation',
              ...signature,
            ])
          : unsupported(`${field}.type`)
  string(entry.address, `${field}.address`)
  if (
    entry.signatureMode !== undefined &&
    typeof entry.signatureMode !== 'number' &&
    typeof entry.signatureMode !== 'string'
  ) {
    unsupported(`${field}.signatureMode`)
  }
  if (entry.initData !== undefined) {
    const init = object(entry.initData, `${field}.initData`, ['setupOps'])
    for (const [index, op] of array(
      init.setupOps,
      `${field}.initData.setupOps`,
    ).entries()) {
      const setup = object(op, `${field}.initData.setupOps.${index}`, [
        'to',
        'data',
      ])
      string(setup.to, `${field}.initData.setupOps.${index}.to`)
      string(setup.data, `${field}.initData.setupOps.${index}.data`)
    }
  }
  if (entry.delegations !== undefined) {
    delegations(entry.delegations, `${field}.delegations`)
  }
  if (entry.simulation !== undefined) {
    const simulation = object(entry.simulation, `${field}.simulation`, [
      'mockSignature',
      'mockSignaturesByChain',
    ])
    optionalString(
      simulation.mockSignature,
      `${field}.simulation.mockSignature`,
    )
    if (simulation.mockSignaturesByChain !== undefined) {
      const byChain = simulation.mockSignaturesByChain
      if (!isObject(byChain)) {
        unsupported(`${field}.simulation.mockSignaturesByChain`)
      }
      for (const [key, signature] of Object.entries(byChain)) {
        const at = `${field}.simulation.mockSignaturesByChain.${key}`
        chainId(key, at)
        string(signature, at)
      }
    }
  }
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

function swigAccount(value: Json | undefined, field: string): void {
  const entry = object(value, field, [
    'type',
    'address',
    'swigAccount',
    'authorization',
    'initData',
  ])
  if (entry.type !== 'swig') unsupported(`${field}.type`)
  string(entry.address, `${field}.address`)
  optionalString(entry.swigAccount, `${field}.swigAccount`)
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
    optionalString(init.id, `${field}.initData.id`)
  }
}

function swigAuthorityChange(value: Json | undefined, field: string): void {
  if (!isObject(value)) unsupported(field)
  const change =
    value.action === 'add'
      ? object(value, field, ['action', 'key', 'permission'])
      : value.action === 'remove'
        ? object(value, field, ['action', 'key'])
        : unsupported(`${field}.action`)
  const key = object(change.key, `${field}.key`, ['kind', 'publicKey'])
  if (key.kind !== 'secp256r1' && key.kind !== 'secp256k1') {
    unsupported(`${field}.key.kind`)
  }
  string(key.publicKey, `${field}.key.publicKey`)
  if (
    change.action === 'add' &&
    change.permission !== 'all' &&
    change.permission !== 'allButManageAuthority' &&
    change.permission !== 'manageAuthority'
  ) {
    unsupported(`${field}.permission`)
  }
}

function solanaInstructions(value: Json | undefined, field: string): void {
  for (const [index, item] of array(value, field).entries()) {
    const at = `${field}.${index}`
    const instruction = object(item, at, ['programId', 'accounts', 'data'])
    string(instruction.programId, `${at}.programId`)
    string(instruction.data, `${at}.data`)
    for (const [position, meta] of array(
      instruction.accounts,
      `${at}.accounts`,
    ).entries()) {
      const where = `${at}.accounts.${position}`
      const entry = object(meta, where, ['pubkey', 'isSigner', 'isWritable'])
      string(entry.pubkey, `${where}.pubkey`)
      if (typeof entry.isSigner !== 'boolean') unsupported(`${where}.isSigner`)
      if (typeof entry.isWritable !== 'boolean') {
        unsupported(`${where}.isWritable`)
      }
    }
  }
}

function bareRecipient(value: Json | undefined, field: string): void {
  string(object(value, field, ['address']).address, `${field}.address`)
}

const DESTINATION_VMS = ['evm', 'svm', 'tvm', 'stellar', 'hypercore']

function destination(value: Json | undefined): void {
  if (!isObject(value)) unsupported('destination')
  const vm = value.vm
  if (typeof vm !== 'string' || !DESTINATION_VMS.includes(vm)) {
    unsupported('destination.vm')
  }
  const executes = vm === 'evm' || vm === 'svm' || vm === 'hypercore'
  const entry = object(value, 'destination', [
    'vm',
    'chainId',
    'token',
    'amount',
    'recipient',
    ...(executes ? ['execution'] : []),
  ])
  chainId(entry.chainId, 'destination.chainId')
  optionalString(entry.token, 'destination.token')
  optionalString(entry.amount, 'destination.amount')
  if (entry.amount !== undefined && entry.token === undefined) {
    unsupported('destination.amount')
  }
  if (vm === 'evm' || vm === 'hypercore') {
    if (entry.recipient !== undefined) {
      evmAccount(entry.recipient, 'destination.recipient', {
        signatureMode: false,
      })
    }
  } else if (
    entry.recipient !== undefined ||
    vm === 'tvm' ||
    vm === 'stellar'
  ) {
    bareRecipient(entry.recipient, 'destination.recipient')
  }
  if (entry.execution === undefined) return
  if (vm === 'evm') {
    evmExecution(entry.execution, 'destination.execution')
  } else if (vm === 'svm') {
    if (isObject(entry.execution) && 'authority' in entry.execution) {
      const execution = object(entry.execution, 'destination.execution', [
        'authority',
      ])
      swigAuthorityChange(
        execution.authority,
        'destination.execution.authority',
      )
    } else {
      const execution = object(entry.execution, 'destination.execution', [
        'instructions',
        'addressLookupTables',
      ])
      solanaInstructions(
        execution.instructions,
        'destination.execution.instructions',
      )
      if (execution.addressLookupTables !== undefined) {
        for (const [index, table] of array(
          execution.addressLookupTables,
          'destination.execution.addressLookupTables',
        ).entries()) {
          string(table, `destination.execution.addressLookupTables.${index}`)
        }
      }
    }
  } else {
    const execution = object(entry.execution, 'destination.execution', [
      'actions',
      'settlement',
    ])
    if (execution.actions !== undefined) {
      const actions = array(execution.actions, 'destination.execution.actions')
      if (actions.length !== 1 || !isObject(actions[0])) {
        unsupported('destination.execution.actions')
      }
    }
    if (execution.settlement !== undefined) {
      evmExecution(execution.settlement, 'destination.execution.settlement')
    }
  }
}

function source(value: Json | undefined): void {
  const entry = object(value, 'source', [
    'vm',
    'chainId',
    'token',
    'maxAmount',
    'auxiliaryFunds',
    'execution',
  ])
  if (entry.vm !== 'evm' && entry.vm !== 'svm') unsupported('source.vm')
  chainId(entry.chainId, 'source.chainId')
  string(entry.token, 'source.token')
  optionalString(entry.maxAmount, 'source.maxAmount')
  optionalString(entry.auxiliaryFunds, 'source.auxiliaryFunds')
  if (entry.execution !== undefined) {
    if (entry.vm !== 'evm') unsupported('source.execution')
    calls(
      object(entry.execution, 'source.execution', ['calls']).calls,
      'source.execution.calls',
    )
  }
}

function venueFilter(value: Json | undefined, field: string): void {
  const filter = object(value, field, ['include', 'exclude'])
  const keys = Object.keys(filter)
  if (keys.length !== 1) unsupported(field)
  for (const [index, venue] of array(
    filter[keys[0]!],
    `${field}.${keys[0]}`,
  ).entries()) {
    string(venue, `${field}.${keys[0]}.${index}`)
  }
}

function options(value: Json | undefined): void {
  const entry = object(value, 'options', [
    'appFees',
    'protocolFees',
    'customDeadline',
    'settlementLayers',
    'quoters',
    'sponsorship',
  ])
  for (const key of ['appFees', 'protocolFees'] as const) {
    if (entry[key] === undefined) continue
    const fee = object(entry[key], `options.${key}`, ['feeBps'])
    if (typeof fee.feeBps !== 'number') unsupported(`options.${key}.feeBps`)
  }
  if (
    entry.customDeadline !== undefined &&
    typeof entry.customDeadline !== 'number'
  ) {
    unsupported('options.customDeadline')
  }
  for (const key of ['settlementLayers', 'quoters'] as const) {
    if (entry[key] !== undefined) venueFilter(entry[key], `options.${key}`)
  }
  if (entry.sponsorship !== undefined) {
    const sponsorship = object(entry.sponsorship, 'options.sponsorship', [
      'gas',
      'bridgeFees',
      'swapFees',
      'protocolFees',
    ])
    for (const [key, category] of Object.entries(sponsorship)) {
      if (typeof category !== 'boolean') {
        unsupported(`options.sponsorship.${key}`)
      }
    }
  }
}

function account(value: Json | undefined): void {
  const entry = object(value, 'account', ['evm', 'svm'])
  if (entry.evm === undefined && entry.svm === undefined) unsupported('account')
  if (entry.evm !== undefined) {
    evmAccount(entry.evm, 'account.evm', { signatureMode: true })
  }
  if (entry.svm !== undefined) swigAccount(entry.svm, 'account.svm')
}

/**
 * The approval input of a singular Caucasus request, unvalidated: the body
 * verbatim, versioned, with `source` omitted when absent and `options`
 * defaulted to `{}`. {@link assertSponsorshipApproval} validates it against the
 * contract before any grant is requested.
 */
export function toSponsorshipApprovalInput(
  body: unknown,
): SerializedIntentInput {
  const root = toJson(body) as JsonObject
  return {
    contractVersion: SPONSORSHIP_APPROVAL_CONTRACT,
    account: root.account,
    ...(root.source === undefined ? {} : { source: root.source }),
    destination: root.destination,
    options: root.options ?? {},
  } as unknown as SerializedIntentInput
}

/**
 * Derives the sponsorship approval input from a singular Caucasus
 * `POST /quotes` body, validating every field against the contract.
 *
 * Throws {@link UnsupportedSponsorshipApprovalError} on any field outside the
 * contract's allowlist, including a legacy-shaped body.
 */
export function projectSponsorshipApproval(
  body: unknown,
): SerializedIntentInput {
  // Projected from the JSON that is sent, so an `undefined` member or a value
  // `JSON.stringify` rewrites cannot make the two disagree.
  const json = toJson(body)
  const root = object(json, '', ['account', 'source', 'destination', 'options'])
  account(root.account)
  if (root.source !== undefined) source(root.source)
  destination(root.destination)
  if (root.options !== undefined) options(root.options)
  return toSponsorshipApprovalInput(root)
}

/** Whether a sponsorship approval input asks for any sponsorship. */
export function isSponsoredIntentInput(input: SerializedIntentInput): boolean {
  return input.options.sponsorship !== undefined
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
  return JSON.parse(JSON.stringify(serializeBigInts(value))) as Json
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
