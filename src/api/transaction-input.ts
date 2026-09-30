// Validates and canonicalizes the public nested `{ source, destination }`
// transaction before anything is resolved, quoted or signed. The output is the
// same public shape, frozen, with the same-chain shorthand expanded: an omitted
// `source.chain` becomes `destination.chain`, and nothing else is ever
// inferred — no chain or token discovery, no first-source selection.
import { isAddress } from 'viem'
import {
  canonicalSecp256k1PublicKey,
  isEvmAddressLength,
} from '../accounts/solana/keys'
import { canonicalP256PublicKey } from '../accounts/solana/passkey'
import { formatCaip2 } from '../chains/caip2'
import {
  type SolanaAddress,
  type SolanaChain,
  type SolanaInstructionInput,
  solanaAddress,
} from '../chains/non-evm'
import type {
  CrossChainSolanaOriginTransaction,
  RhinestoneAccountConfig,
  SameChainSolanaAuthorityTransaction,
  SameChainSolanaInstructionsTransaction,
  SameChainSolanaTransaction,
  Sponsorship,
  Transaction,
} from '../config/account'
import {
  AccountVmNotConfiguredError,
  UnsupportedAccountCapabilityError,
} from '../errors/capability'
import {
  NATIVE_SOL_SENTINEL,
  solanaChainId,
} from '../transactions/intents/solana'
import {
  normalizeSolanaAddressLookupTables,
  normalizeSolanaInstructions,
} from '../transactions/intents/solana-instructions'

type ChainKind = 'evm' | 'svm' | 'tvm' | 'stellar' | 'hypercore'
type Fields = Record<string, unknown>

/** What each flat top-level field became. */
const REPLACED_FIELDS: Readonly<Record<string, string>> = {
  chain: '`destination.chain` (`source.chain` defaults to it)',
  targetChain: '`destination.chain`',
  sourceChains: '`source.chain`; a transaction spends from one source',
  sourceAssets: '`source.token` and `source.maxAmount`',
  sourceTokens: '`source.token`',
  sourceCalls: '`source.calls`',
  auxiliaryFunds: '`source.auxiliaryFunds`',
  tokenRequests: '`destination.token` and `destination.amount`',
  recipient: '`destination.recipient`',
  calls: '`destination.calls`',
  gasLimit: '`destination.gasLimit`',
  hyperCore: '`destination.hyperCore`',
  instructions: '`destination.instructions`',
  addressLookupTables: '`destination.addressLookupTables`',
  authority: '`destination.authority`',
}

/** Earlier spellings inside `source` and `destination`. */
const REPLACED_NESTED_FIELDS: Readonly<Record<string, string>> = {
  'source.address': '`source.token`',
  'source.amount': '`source.maxAmount`',
  'source.selection': '`source.chain` and `source.token`',
  'source.limits': '`source.maxAmount`',
  'source.executions': '`source.calls`',
  'destination.tokenRequests': '`destination.token` and `destination.amount`',
  'destination.address': '`destination.token`',
}

const EVM_ROOT_FIELDS = [
  'source',
  'destination',
  'signers',
  'sponsored',
  'eip7702InitSignature',
  'appFees',
  'protocolFees',
  'settlementLayers',
  'quoters',
  'customDeadline',
  'experimental_accountOverride',
]

const EVM_DESTINATION_FIELDS: Readonly<
  Record<'evm' | 'hypercore' | 'svm' | 'tvm' | 'stellar', readonly string[]>
> = {
  evm: ['chain', 'token', 'amount', 'recipient', 'calls', 'gasLimit'],
  hypercore: [
    'chain',
    'token',
    'amount',
    'recipient',
    'calls',
    'gasLimit',
    'hyperCore',
  ],
  svm: ['chain', 'token', 'amount', 'recipient'],
  tvm: ['chain', 'token', 'amount', 'recipient'],
  stellar: ['chain', 'token', 'amount', 'recipient'],
}

const EVM_SOURCE_FIELDS = [
  'chain',
  'token',
  'maxAmount',
  'auxiliaryFunds',
  'calls',
]

const SAME_CHAIN_NATIVE_SOL_MESSAGE =
  'A same-chain Solana transfer cannot send native SOL; name an SPL mint.'

function refuse(message: string, field?: string, vm?: string): never {
  throw new UnsupportedAccountCapabilityError(message, {
    ...(vm ? { vm } : {}),
    ...(field ? { field } : {}),
  })
}

function isRecord(value: unknown): value is Fields {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function has(value: Fields, key: string): boolean {
  return Object.hasOwn(value, key) && value[key] !== undefined
}

function assertRecord(
  value: unknown,
  field: string,
  vm?: string,
): asserts value is Fields {
  if (!isRecord(value)) refuse(`\`${field}\` must be an object.`, field, vm)
}

/** Refuses flat top-level fields by name, with what replaced each. */
function assertNoReplacedFields(transaction: Fields): void {
  for (const [key, replacement] of Object.entries(REPLACED_FIELDS)) {
    if (Object.hasOwn(transaction, key)) {
      refuse(`\`${key}\` was replaced by ${replacement}.`, key)
    }
  }
}

function assertFields(
  value: Fields,
  allowed: readonly string[],
  label: string,
  describe: (field: string) => string,
  vm?: string,
): void {
  for (const key of Object.keys(value)) {
    if (allowed.includes(key)) continue
    const field = label ? `${label}.${key}` : key
    const replacement = REPLACED_NESTED_FIELDS[field]
    if (replacement) {
      refuse(`\`${field}\` was replaced by ${replacement}.`, field, vm)
    }
    refuse(describe(field), field, vm)
  }
}

function chainKind(value: unknown, field: string): ChainKind {
  if (!isRecord(value)) refuse(`\`${field}\` must be a chain.`, field)
  if (!Object.hasOwn(value, 'kind') && !Object.hasOwn(value, 'caip2')) {
    const id = value.id
    if (
      typeof id !== 'number' ||
      !Number.isSafeInteger(id) ||
      id < 0 ||
      !formatCaip2(id).startsWith('eip155:')
    ) {
      refuse('A viem EVM chain must use an eip155 chain ID.', field)
    }
    return 'evm'
  }
  const { kind, caip2 } = value
  const matches =
    typeof caip2 === 'string' &&
    ((kind === 'svm' && caip2.startsWith('solana:')) ||
      (kind === 'tvm' && caip2.startsWith('tron:')) ||
      (kind === 'stellar' && caip2.startsWith('stellar:')) ||
      (kind === 'hypercore' &&
        (caip2 === 'hypercore:spot' || caip2 === 'hypercore:perp')))
  if (!matches) {
    refuse('The chain descriptor has mismatched VM and CAIP-2 fields.', field)
  }
  return kind as ChainKind
}

function sameChain(left: unknown, right: unknown): boolean {
  const a = left as { id?: unknown; caip2?: unknown }
  const b = right as { id?: unknown; caip2?: unknown }
  return a.caip2 !== undefined || b.caip2 !== undefined
    ? a.caip2 === b.caip2
    : a.id === b.id
}

function assertAmount(
  value: unknown,
  field: string,
  options: { readonly positive: boolean; readonly vm?: string },
): void {
  if (
    typeof value !== 'bigint' ||
    value < 0n ||
    (options.positive && value === 0n)
  ) {
    refuse(
      `\`${field}\` must be a ${options.positive ? 'positive' : 'non-negative'} bigint when provided.`,
      field,
      options.vm,
    )
  }
}

function isGasSponsored(sponsored: unknown): boolean {
  return (
    sponsored === true ||
    (isRecord(sponsored) && (sponsored as { gas?: unknown }).gas === true)
  )
}

function freezeSponsorship(sponsored: unknown): {
  sponsored?: Sponsorship
} {
  if (sponsored === undefined) return {}
  if (typeof sponsored === 'boolean') return { sponsored }
  if (!isRecord(sponsored)) {
    refuse(
      '`sponsored` must be a boolean or a sponsorship object.',
      'sponsored',
    )
  }
  return { sponsored: Object.freeze({ ...sponsored }) as Sponsorship }
}

function freezeFees(transaction: Fields): Fields {
  const result: Fields = {}
  for (const key of ['appFees', 'protocolFees']) {
    if (transaction[key] === undefined) continue
    assertRecord(transaction[key], key)
    assertFields(
      transaction[key] as Fields,
      ['feeBps'],
      key,
      (field) => `\`${field}\` is not a fee field.`,
    )
    result[key] = Object.freeze({ ...(transaction[key] as Fields) })
  }
  return result
}

function defined(value: Fields): Fields {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  )
}

/**
 * The canonical form of a transaction, refusing anything the nested model
 * does not allow. Idempotent: normalizing a normalized transaction returns an
 * equal one.
 */
export function normalizeTransaction(
  transaction: Transaction,
  config: Readonly<RhinestoneAccountConfig>,
): Transaction {
  if (!isRecord(transaction)) refuse('A transaction must be an object.')
  const input = transaction as unknown as Fields
  assertNoReplacedFields(input)
  if (!has(input, 'destination')) {
    refuse(
      'A transaction needs a `destination`: `{ chain, token?, amount?, … }`.',
      'destination',
    )
  }
  assertRecord(input.destination, 'destination')
  const destination = input.destination
  if (!has(destination, 'chain')) {
    refuse('`destination.chain` is required.', 'destination.chain')
  }
  const destinationKind = chainKind(destination.chain, 'destination.chain')
  const source = input.source
  if (source !== undefined) assertRecord(source, 'source')
  const sourceChain =
    source === undefined
      ? undefined
      : has(source as Fields, 'chain')
        ? (source as Fields).chain
        : destination.chain
  const sourceKind =
    sourceChain === undefined
      ? undefined
      : chainKind(
          sourceChain,
          has(source as Fields, 'chain') ? 'source.chain' : 'destination.chain',
        )

  if (sourceKind === 'svm' || (!source && destinationKind === 'svm')) {
    return normalizeSolanaOrigin(input, config, destinationKind, sourceChain)
  }
  return normalizeEvmOrigin(input, config, {
    destinationKind,
    sourceKind,
    sourceChain,
  })
}

function normalizeEvmOrigin(
  input: Fields,
  config: Readonly<RhinestoneAccountConfig>,
  resolved: {
    readonly destinationKind: ChainKind
    readonly sourceKind?: ChainKind
    readonly sourceChain?: unknown
  },
): Transaction {
  const { destinationKind, sourceKind, sourceChain } = resolved
  assertFields(
    input,
    EVM_ROOT_FIELDS,
    '',
    (field) => `\`${field}\` is not a transaction field.`,
  )
  const destination = input.destination as Fields
  const destinationFields = EVM_DESTINATION_FIELDS[destinationKind]
  if (has(destination, 'hyperCore') && destinationKind !== 'hypercore') {
    refuse(
      '`destination.hyperCore` applies to a HyperCore destination (`hyperCorePerp` or `hyperCoreSpot`) only.',
      'destination.hyperCore',
    )
  }
  assertFields(
    destination,
    destinationFields,
    'destination',
    (field) =>
      `\`${field}\` is not supported for a ${destinationKind} destination.`,
  )

  const delivers = has(destination, 'token')
  if (has(destination, 'amount') && !delivers) {
    refuse(
      '`destination.amount` needs `destination.token`: name the token to receive.',
      'destination.amount',
    )
  }
  const nonEvmDestination =
    destinationKind === 'svm' ||
    destinationKind === 'tvm' ||
    destinationKind === 'stellar'
  if (delivers) {
    if (destinationKind === 'evm') {
      if (
        typeof destination.token !== 'string' ||
        !isAddress(destination.token)
      ) {
        refuse(
          '`destination.token` must be a token address on the destination chain.',
          'destination.token',
        )
      }
    } else if (
      typeof destination.token !== 'string' ||
      destination.token.length === 0
    ) {
      refuse(
        '`destination.token` must be a token address on the destination chain.',
        'destination.token',
      )
    }
    if (destinationKind === 'svm') {
      try {
        solanaAddress(destination.token as string)
      } catch {
        refuse(
          '`destination.token` must be a Solana token address.',
          'destination.token',
          'solana',
        )
      }
    }
  } else if (nonEvmDestination) {
    refuse(
      `A ${destinationKind} destination only receives tokens; name \`destination.token\`.`,
      'destination.token',
    )
  }
  if (has(destination, 'amount')) {
    assertAmount(destination.amount, 'destination.amount', {
      positive: nonEvmDestination,
    })
  }

  const runsCalls =
    Array.isArray(destination.calls) && destination.calls.length > 0
  if (destination.calls !== undefined && !Array.isArray(destination.calls)) {
    refuse(
      '`destination.calls` must be an array of calls.',
      'destination.calls',
    )
  }
  const recipient = destination.recipient
  if (recipient !== undefined) {
    if (runsCalls) {
      refuse(
        'An explicit delivery recipient cannot execute destination calls. Omit `destination.recipient` to execute with the invoking managed EVM account.',
        'destination.recipient',
      )
    }
    if (!delivers) {
      refuse(
        'An explicit delivery recipient requires `destination.token`.',
        'destination.recipient',
      )
    }
    if (destinationKind === 'evm' || destinationKind === 'hypercore') {
      if (
        !(typeof recipient === 'string' && isAddress(recipient)) &&
        !isRecord(recipient)
      ) {
        refuse(
          '`destination.recipient` must be an EVM address or an EVM account config.',
          'destination.recipient',
        )
      }
    } else if (typeof recipient !== 'string' || recipient.length === 0) {
      refuse(
        `A ${destinationKind} delivery recipient must be an address on that chain.`,
        'destination.recipient',
      )
    } else if (destinationKind === 'svm') {
      try {
        solanaAddress(recipient)
      } catch {
        refuse(
          'A Solana delivery recipient must be a Solana address.',
          'destination.recipient',
          'solana',
        )
      }
    }
  } else if (destinationKind === 'tvm' || destinationKind === 'stellar') {
    refuse(
      `A ${destinationKind} delivery needs \`destination.recipient\`: the account holds no identity there.`,
      'destination.recipient',
    )
  }

  const gasSponsored = isGasSponsored(input.sponsored)
  let source: Fields | undefined
  if (input.source === undefined) {
    if (delivers) {
      refuse(
        'A delivery needs a `source`: name the chain and token it spends, `source: { chain, token }`.',
        'source',
      )
    }
    if (destinationKind !== 'evm') {
      refuse(
        `A ${destinationKind} destination hosts no account, so the transaction needs a \`source\` on an EVM chain.`,
        'source',
      )
    }
    if (!gasSponsored) {
      refuse(
        'An execution that is not gas-sponsored needs a `source` to pay from: `source: { token }` spends on the destination chain.',
        'source',
      )
    }
  } else {
    const raw = input.source as Fields
    assertFields(
      raw,
      EVM_SOURCE_FIELDS,
      'source',
      (field) => `\`${field}\` is not a source field.`,
    )
    if (sourceKind !== 'evm') {
      refuse(
        has(raw, 'chain')
          ? `A ${sourceKind} chain cannot fund a transaction; \`source.chain\` must be an EVM chain.`
          : `A ${destinationKind} destination cannot fund itself; name \`source.chain\`.`,
        'source.chain',
      )
    }
    if (typeof raw.token !== 'string' || !isAddress(raw.token)) {
      refuse(
        '`source.token` must be a token address on the source chain.',
        'source.token',
      )
    }
    if (has(raw, 'maxAmount')) {
      assertAmount(raw.maxAmount, 'source.maxAmount', { positive: false })
    }
    if (has(raw, 'auxiliaryFunds')) {
      assertAmount(raw.auxiliaryFunds, 'source.auxiliaryFunds', {
        positive: true,
      })
    }
    if (raw.calls !== undefined) {
      if (!Array.isArray(raw.calls)) {
        refuse('`source.calls` must be an array of calls.', 'source.calls')
      }
      for (const [index, call] of raw.calls.entries()) {
        assertRecord(call, `source.calls.${index}`)
        const provides = (call as Fields).provides
        if (provides === undefined) continue
        if (!Array.isArray(provides)) {
          refuse(
            '`provides` must be an array of `{ token, amount }`.',
            `source.calls.${index}.provides`,
          )
        }
        for (const [position, provided] of provides.entries()) {
          const field = `source.calls.${index}.provides.${position}`
          assertRecord(provided, field)
          if (
            typeof provided.token !== 'string' ||
            provided.token.toLowerCase() !== (raw.token as string).toLowerCase()
          ) {
            refuse(
              `\`${field}.token\` must be \`source.token\`: source calls can only make more of the source token available.`,
              `${field}.token`,
            )
          }
          assertAmount(provided.amount, `${field}.amount`, { positive: true })
        }
      }
    }
    source = Object.freeze(
      defined({
        ...raw,
        chain: sourceChain,
        ...(raw.calls === undefined ? {} : { calls: [...(raw.calls as [])] }),
      }),
    )
  }

  if (
    input.customDeadline !== undefined &&
    source !== undefined &&
    !sameChain(source.chain, destination.chain)
  ) {
    refuse(
      '`customDeadline` applies to same-chain transactions only; this one spends on another chain.',
      'customDeadline',
    )
  }
  if (input.customDeadline !== undefined && destinationKind !== 'evm') {
    refuse(
      '`customDeadline` applies to same-chain transactions only.',
      'customDeadline',
    )
  }

  const solanaDefault =
    destinationKind === 'svm' &&
    recipient === undefined &&
    config.solana &&
    'address' in config.solana
      ? { recipient: config.solana.address }
      : {}
  if (destinationKind === 'svm' && recipient === undefined && !config.solana) {
    throw new AccountVmNotConfiguredError('solana')
  }

  return Object.freeze(
    defined({
      ...input,
      ...(source ? { source } : {}),
      destination: Object.freeze(
        defined({
          ...destination,
          ...solanaDefault,
          ...(destination.calls === undefined
            ? {}
            : { calls: [...(destination.calls as [])] }),
        }),
      ),
      ...freezeFees(input),
      ...freezeSponsorship(input.sponsored),
    }),
  ) as unknown as Transaction
}

function requireManagedSolana(config: Readonly<RhinestoneAccountConfig>): void {
  if (!config.solana || !('owner' in config.solana)) {
    refuse(
      'A managed Solana source is required for Solana-origin transfers.',
      undefined,
      'solana',
    )
  }
}

function solanaChain(value: unknown, field: string): SolanaChain {
  try {
    solanaChainId(value as SolanaChain)
  } catch {
    refuse(
      `\`${field}\` must be the canonical Solana mainnet or devnet descriptor.`,
      field,
      'solana',
    )
  }
  return Object.freeze({ ...(value as SolanaChain) })
}

function solanaToken(value: unknown, field: string): SolanaAddress {
  try {
    return solanaAddress(value as string)
  } catch {
    return refuse(
      `\`${field}\` must be a valid Solana token address.`,
      field,
      'solana',
    )
  }
}

function normalizeSolanaOrigin(
  input: Fields,
  config: Readonly<RhinestoneAccountConfig>,
  destinationKind: ChainKind,
  sourceChain: unknown,
): Transaction {
  const destination = input.destination as Fields
  const source = input.source as Fields | undefined
  const unsupported = (field: string) =>
    `Solana-origin transfers do not support \`${field}\`.`
  if (source !== undefined) {
    for (const key of ['auxiliaryFunds', 'calls']) {
      if (Object.hasOwn(source, key)) {
        refuse(
          `\`source.${key}\` is EVM-only; a Solana source spends one token and runs no source calls.`,
          `source.${key}`,
          'solana',
        )
      }
    }
  }

  if (destinationKind === 'evm') {
    return normalizeSolanaDelivery(input, config, sourceChain)
  }
  if (destinationKind !== 'svm') {
    refuse(
      'A Solana source delivers to Solana or to an EVM chain.',
      'destination.chain',
      'solana',
    )
  }
  const chain = solanaChain(destination.chain, 'destination.chain')
  if (sourceChain !== undefined && !sameChain(sourceChain, destination.chain)) {
    refuse(
      'A Solana source funds a transaction on its own cluster only.',
      'source.chain',
      'solana',
    )
  }

  if (has(destination, 'authority')) {
    assertFields(input, ['destination'], '', unsupported, 'solana')
    assertFields(
      destination,
      ['chain', 'authority'],
      'destination',
      unsupported,
      'solana',
    )
    requireManagedSolana(config)
    const { keyType, publicKey } = assertSolanaAuthorityChange(
      destination.authority,
    )
    const { action, permission } = destination.authority as {
      action: 'add' | 'remove'
      permission?: string
    }
    const key = Object.freeze({ type: keyType, publicKey })
    return Object.freeze({
      destination: Object.freeze({
        chain,
        authority: Object.freeze(
          action === 'add' ? { action, key, permission } : { action, key },
        ),
      }),
    }) as unknown as SameChainSolanaAuthorityTransaction
  }

  if (has(destination, 'instructions')) {
    assertFields(
      input,
      ['source', 'destination', 'sponsored'],
      '',
      unsupported,
      'solana',
    )
    assertFields(
      destination,
      ['chain', 'instructions', 'addressLookupTables'],
      'destination',
      unsupported,
      'solana',
    )
    requireManagedSolana(config)
    let feeSource: Fields | undefined
    if (source !== undefined) {
      assertFields(source, ['chain', 'token'], 'source', unsupported, 'solana')
      feeSource = Object.freeze({
        chain,
        token: solanaToken(source.token, 'source.token'),
      })
    } else if (!isGasSponsored(input.sponsored)) {
      refuse(
        'An instruction execution that is not gas-sponsored needs `source.token`: the SPL mint or native SOL its charge is paid in.',
        'source',
        'solana',
      )
    }
    const lookupTables = normalizeSolanaAddressLookupTables(
      destination.addressLookupTables as readonly string[] | undefined,
    )
    return Object.freeze({
      ...(feeSource ? { source: feeSource } : {}),
      destination: Object.freeze({
        chain,
        instructions: normalizeSolanaInstructions(
          destination.instructions as readonly SolanaInstructionInput[],
        ),
        ...(lookupTables ? { addressLookupTables: lookupTables } : {}),
      }),
      ...freezeSponsorship(input.sponsored),
    }) as unknown as SameChainSolanaInstructionsTransaction
  }

  assertFields(
    input,
    ['source', 'destination', 'sponsored', 'appFees', 'protocolFees'],
    '',
    unsupported,
    'solana',
  )
  assertFields(
    destination,
    ['chain', 'token', 'amount', 'recipient'],
    'destination',
    unsupported,
    'solana',
  )
  requireManagedSolana(config)
  if (!source) {
    refuse(
      'A Solana transfer needs a `source`: `source: { token }` names the mint it spends.',
      'source',
      'solana',
    )
  }
  assertFields(
    source,
    ['chain', 'token', 'maxAmount'],
    'source',
    unsupported,
    'solana',
  )
  if (!has(destination, 'token')) {
    refuse(
      'A Solana transfer needs `destination.token`, the SPL mint it sends.',
      'destination.token',
      'solana',
    )
  }
  const mint = solanaToken(destination.token, 'destination.token')
  if (mint === NATIVE_SOL_SENTINEL) {
    refuse(SAME_CHAIN_NATIVE_SOL_MESSAGE, 'destination.token', 'solana')
  }
  if (solanaToken(source.token, 'source.token') !== mint) {
    refuse(
      '`source.token` must be the mint the transfer sends, `destination.token`.',
      'source.token',
      'solana',
    )
  }
  if (has(destination, 'amount')) {
    assertAmount(destination.amount, 'destination.amount', {
      positive: true,
      vm: 'solana',
    })
  }
  if (has(source, 'maxAmount')) {
    assertAmount(source.maxAmount, 'source.maxAmount', {
      positive: true,
      vm: 'solana',
    })
    if (
      has(destination, 'amount') &&
      (destination.amount as bigint) > (source.maxAmount as bigint)
    ) {
      refuse(
        'The token amount exceeds the `source.maxAmount` that caps it.',
        'source.maxAmount',
        'solana',
      )
    }
  }
  if (typeof destination.recipient !== 'string') {
    refuse(
      'Managed Solana transfers require an explicit recipient wallet, `destination.recipient`.',
      'destination.recipient',
      'solana',
    )
  }
  try {
    solanaAddress(destination.recipient)
  } catch {
    refuse(
      'Managed Solana transfers require a valid recipient wallet.',
      'destination.recipient',
      'solana',
    )
  }
  return Object.freeze({
    source: Object.freeze(
      defined({ chain, token: mint, maxAmount: source.maxAmount }),
    ),
    destination: Object.freeze(
      defined({
        chain,
        token: mint,
        amount: destination.amount,
        recipient: destination.recipient,
      }),
    ),
    ...freezeFees(input),
    ...freezeSponsorship(input.sponsored),
  }) as unknown as SameChainSolanaTransaction
}

function normalizeSolanaDelivery(
  input: Fields,
  config: Readonly<RhinestoneAccountConfig>,
  sourceChain: unknown,
): Transaction {
  const destination = input.destination as Fields
  const source = input.source as Fields
  const unsupported = (field: string) =>
    `Solana-origin transfers do not support \`${field}\`.`
  assertFields(
    input,
    [
      'source',
      'destination',
      'eip7702InitSignature',
      'sponsored',
      'appFees',
      'protocolFees',
    ],
    '',
    unsupported,
    'solana',
  )
  assertFields(
    destination,
    ['chain', 'token', 'amount', 'recipient', 'calls', 'gasLimit'],
    'destination',
    unsupported,
    'solana',
  )
  assertFields(
    source,
    ['chain', 'token', 'maxAmount'],
    'source',
    unsupported,
    'solana',
  )
  requireManagedSolana(config)
  const cluster = solanaChain(sourceChain, 'source.chain')
  const token = solanaToken(source.token, 'source.token')
  if (has(source, 'maxAmount')) {
    assertAmount(source.maxAmount, 'source.maxAmount', {
      positive: true,
      vm: 'solana',
    })
  }
  if (destination.calls !== undefined && !Array.isArray(destination.calls)) {
    refuse(
      '`destination.calls` must be an array of destination calls.',
      'destination.calls',
      'solana',
    )
  }
  const runsCalls =
    Array.isArray(destination.calls) && destination.calls.length > 0
  const hasManagedEvm =
    config.evm !== undefined && !Object.hasOwn(config.evm, 'address')
  if (runsCalls && !hasManagedEvm) {
    refuse(
      'Destination calls require a managed EVM account; an address-only receiver can only receive a plain delivery. Omit `destination.calls`.',
      'destination.calls',
      'solana',
    )
  }
  if (runsCalls && destination.recipient !== undefined) {
    refuse(
      'An explicit delivery recipient cannot execute destination calls. Omit `destination.recipient` to execute with the invoking managed EVM account.',
      'destination.recipient',
      'solana',
    )
  }
  for (const [field, value] of [
    ['destination.gasLimit', destination.gasLimit],
    ['eip7702InitSignature', input.eip7702InitSignature],
  ] as const) {
    if (value !== undefined && !runsCalls) {
      refuse(
        `\`${field}\` applies to \`destination.calls\`, and this delivery has none.`,
        field,
        'solana',
      )
    }
  }
  if (typeof destination.token !== 'string' || !isAddress(destination.token)) {
    refuse(
      'A Solana-origin delivery requires an EVM `destination.token` address.',
      'destination.token',
      'solana',
    )
  }
  if (has(destination, 'amount')) {
    assertAmount(destination.amount, 'destination.amount', {
      positive: true,
      vm: 'solana',
    })
  }
  if (
    destination.recipient !== undefined &&
    (typeof destination.recipient !== 'string' ||
      !isAddress(destination.recipient))
  ) {
    refuse(
      'A Solana-origin delivery recipient must be an EVM address.',
      'destination.recipient',
      'solana',
    )
  }
  return Object.freeze(
    defined({
      ...input,
      source: Object.freeze(
        defined({ chain: cluster, token, maxAmount: source.maxAmount }),
      ),
      destination: Object.freeze(
        defined({
          ...destination,
          ...(destination.calls === undefined
            ? {}
            : { calls: [...(destination.calls as [])] }),
        }),
      ),
      ...freezeFees(input),
      ...freezeSponsorship(input.sponsored),
    }),
  ) as unknown as CrossChainSolanaOriginTransaction
}

/**
 * Checks an authority change's shape, and returns its key in canonical form.
 * A literal is held to the same rules the `addPasskey`, `addEcdsaKey`,
 * `removePasskey` and `removeEcdsaKey` builders apply.
 */
function assertSolanaAuthorityChange(value: unknown): {
  readonly keyType: 'passkey' | 'ecdsa'
  readonly publicKey: `0x${string}`
} {
  const fail = (message: string, field: string): never =>
    refuse(message, field, 'solana')
  const field = 'destination.authority'
  const builders =
    '`addPasskey`, `addEcdsaKey`, `removePasskey` or `removeEcdsaKey`'
  if (!isRecord(value)) {
    fail(`\`${field}\` must be a change from ${builders}.`, field)
  }
  const change = value as Fields
  if (change.action !== 'add' && change.action !== 'remove') {
    fail(
      `\`${field}.action\` must be 'add' or 'remove'; build it with ${builders}.`,
      `${field}.action`,
    )
  }
  const unsupported = (at: string) =>
    `Solana-origin transfers do not support \`${at}\`.`
  assertFields(
    change,
    change.action === 'add'
      ? ['action', 'key', 'permission']
      : ['action', 'key'],
    field,
    unsupported,
    'solana',
  )
  if (
    change.action === 'add' &&
    change.permission !== 'all' &&
    change.permission !== 'allButManageAuthority' &&
    change.permission !== 'manageAuthority'
  ) {
    fail(
      `Adding a key needs \`${field}.permission\`: 'all', 'allButManageAuthority' or 'manageAuthority'.`,
      `${field}.permission`,
    )
  }
  assertRecord(change.key, `${field}.key`, 'solana')
  const key = change.key as Fields
  assertFields(
    key,
    ['type', 'publicKey'],
    `${field}.key`,
    unsupported,
    'solana',
  )
  if (key.type === 'passkey') {
    const publicKey = canonicalP256PublicKey(key.publicKey)
    if (!publicKey) {
      fail(
        `\`${field}.key.publicKey\` must be a P-256 public key as 64-byte x‖y, 65-byte uncompressed or 33-byte compressed hex.`,
        `${field}.key.publicKey`,
      )
    }
    return { keyType: 'passkey', publicKey: publicKey! }
  }
  if (key.type === 'ecdsa') {
    if (isEvmAddressLength(key.publicKey)) {
      fail(
        `\`${field}.key.publicKey\` is an EVM address, not a public key; pass the secp256k1 public key the address derives from.`,
        `${field}.key.publicKey`,
      )
    }
    const publicKey = canonicalSecp256k1PublicKey(key.publicKey)
    if (!publicKey) {
      fail(
        `\`${field}.key.publicKey\` must be a secp256k1 public key as 33-byte compressed, 65-byte uncompressed or 64-byte x‖y hex, on the secp256k1 curve.`,
        `${field}.key.publicKey`,
      )
    }
    return { keyType: 'ecdsa', publicKey: publicKey! }
  }
  return fail(
    `\`${field}.key.type\` must be 'passkey' or 'ecdsa'.`,
    `${field}.key.type`,
  )
}

/**
 * The canonical form of a `getAuthorityStatus` argument, refusing anything
 * that is not a Solana authority change.
 */
export function normalizeAuthorityChange(
  transaction: unknown,
  config: Readonly<RhinestoneAccountConfig>,
): SameChainSolanaAuthorityTransaction {
  if (
    !isRecord(transaction) ||
    !isRecord(transaction.destination) ||
    transaction.destination.authority === undefined
  ) {
    refuse(
      '`getAuthorityStatus` takes a `{ destination: { chain, authority } }` Solana authority change.',
      'destination.authority',
      'solana',
    )
  }
  const normalized = normalizeTransaction(
    transaction as unknown as Transaction,
    config,
  )
  if (!isSolanaAuthorityChange(normalized)) {
    refuse(
      '`getAuthorityStatus` takes a `{ destination: { chain, authority } }` Solana authority change.',
      'destination.authority',
      'solana',
    )
  }
  return normalized
}

function destinationOf(transaction: Transaction): Fields {
  return (transaction as unknown as { destination: Fields }).destination
}

function isSvmChain(chain: unknown): boolean {
  return isRecord(chain) && chain.kind === 'svm'
}

/** Whether a normalized transaction spends from the managed Solana account. */
export function isSolanaOrigin(
  transaction: Transaction,
): transaction is
  | SameChainSolanaTransaction
  | SameChainSolanaInstructionsTransaction
  | SameChainSolanaAuthorityTransaction
  | CrossChainSolanaOriginTransaction {
  // Resolves the shorthand itself, so an artifact that omits `source.chain` is
  // routed exactly as its normalized form would be.
  const source = (transaction as { source?: { chain?: unknown } }).source
  return isSvmChain(source?.chain ?? destinationOf(transaction).chain)
}

/** Whether a normalized transaction delivers from Solana to an EVM chain. */
export function isCrossChainSolanaOrigin(
  transaction: Transaction,
): transaction is CrossChainSolanaOriginTransaction {
  return (
    isSolanaOrigin(transaction) && !isSvmChain(destinationOf(transaction).chain)
  )
}

export function isSolanaInstructionExecution(
  transaction: Transaction,
): transaction is SameChainSolanaInstructionsTransaction {
  return (
    isSolanaOrigin(transaction) &&
    destinationOf(transaction).instructions !== undefined
  )
}

export function isSolanaAuthorityChange(
  transaction: Transaction,
): transaction is SameChainSolanaAuthorityTransaction {
  return (
    isSolanaOrigin(transaction) &&
    destinationOf(transaction).authority !== undefined
  )
}
