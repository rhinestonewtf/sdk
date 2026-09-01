import fc from 'fast-check'
import { type Account, type Address, checksumAddress, type Hex } from 'viem'
import {
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'
import { describe, expect, test } from 'vitest'
import type { EvmChainReference } from '../../../src/chains/types'
import { createStaticAccountRuntime } from '../../../src/config/account-runtime'
import { resolveStandaloneAccountConfig } from '../../../src/config/resolve'
import { type RhinestoneAccountConfig, RhinestoneSDK } from '../../../src/index'
import type { ModuleInput } from '../../../src/modules/types'
import { compareHexValues } from '../../../src/modules/validators/ordering'
import type { OwnerSet } from '../../../src/modules/validators/types'
import { experimental_getV0InitData } from '../../../src/utils/index'
import {
  accountA,
  accountB,
  accountC,
  accountD,
  collationAccountHigh,
  collationAccountLow,
} from '../../consts'
import { withoutHostCollation } from '../../utils/locale'
import { passkey } from '../../utils/passkeys'
import { propertyParameters } from '../../utils/property'

// Derivation outcomes are compared as values, so an unsupported configuration
// is a meaningful input (both sides reject identically) rather than something
// the generators have to exclude.
type Outcome =
  | {
      readonly kind: 'derived'
      readonly address: string
      readonly factory?: string
      readonly factoryData?: string
      readonly initDataError?: string
    }
  | { readonly kind: 'rejected'; readonly message: string }

const MAINNET: EvmChainReference = { kind: 'evm', id: 1, caip2: 'eip155:1' }
const CHAINS: readonly EvmChainReference[] = [
  MAINNET,
  { kind: 'evm', id: 8453, caip2: 'eip155:8453' },
  { kind: 'evm', id: 42161, caip2: 'eip155:42161' },
]

const sdk = new RhinestoneSDK({ apiKey: 'vector-only' })

function lower(value: string): string {
  return value.toLowerCase()
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function deriveStatic(
  config: RhinestoneAccountConfig,
  options: { chain?: EvmChainReference; deployed?: boolean } = {},
): Outcome {
  try {
    const resolved = resolveStandaloneAccountConfig(config, 'current-v2')
    const runtime = createStaticAccountRuntime(
      resolved,
      options.chain ?? MAINNET,
      options.deployed ?? false,
    )
    const plan = runtime.adapter.getDeploymentPlan(runtime.construction)
    return {
      kind: 'derived',
      address: lower(runtime.identity.address),
      ...(plan.factory ? { factory: lower(plan.factory) } : {}),
      ...(plan.factoryData ? { factoryData: lower(plan.factoryData) } : {}),
    }
  } catch (error) {
    return { kind: 'rejected', message: failure(error) }
  }
}

async function derivePublic(config: RhinestoneAccountConfig): Promise<Outcome> {
  let address: string
  try {
    const account = await sdk.createAccount(config)
    address = lower(account.getAddress())
    try {
      const initData = account.getInitData()
      return {
        kind: 'derived',
        address,
        factory: lower(initData.factory),
        factoryData: lower(initData.factoryData),
      }
    } catch (error) {
      return { kind: 'derived', address, initDataError: failure(error) }
    }
  } catch (error) {
    return { kind: 'rejected', message: failure(error) }
  }
}

function deriveV0(config: RhinestoneAccountConfig): Outcome {
  try {
    const initData = experimental_getV0InitData(config)
    return {
      kind: 'derived',
      address: lower(initData.address),
      factory: lower(initData.factory),
      factoryData: lower(initData.factoryData),
    }
  } catch (error) {
    return { kind: 'rejected', message: failure(error) }
  }
}

function derived(
  outcome: Outcome,
): outcome is Extract<Outcome, { kind: 'derived' }> {
  return outcome.kind === 'derived'
}

function replaceOpaque(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return `${value}n`
  if (typeof value === 'function') return '[function]'
  return value
}

// `Account` holds functions, so `structuredClone` cannot snapshot a config.
function serializeConfig(config: RhinestoneAccountConfig): string {
  return JSON.stringify(config, replaceOpaque)
}

// Seeded Fisher-Yates: one generated number reorders owner lists of any length,
// and the seed is what a counterexample reports.
function permute<T>(items: readonly T[], seed: number): T[] {
  const shuffled = [...items]
  // MINSTD, whose products stay inside the safe integer range.
  let state = (seed % 2147483646) + 1
  for (let index = shuffled.length - 1; index > 0; index--) {
    state = (state * 48271) % 2147483647
    const target = state % (index + 1)
    const left = shuffled[index] as T
    const right = shuffled[target] as T
    shuffled[index] = right
    shuffled[target] = left
  }
  return shuffled
}

type Reorder = <T>(items: readonly T[]) => T[]

const reverse: Reorder = (items) => [...items].reverse()
const seededReorder =
  (seed: number): Reorder =>
  (items) =>
    permute(items, seed)

function reorderOwners(owners: OwnerSet, reorder: Reorder): OwnerSet {
  switch (owners.type) {
    case 'ecdsa':
      return { ...owners, accounts: reorder(owners.accounts) }
    case 'quorum':
      return { ...owners, owners: reorder(owners.owners) }
    case 'passkey':
      return { ...owners, accounts: reorder(owners.accounts) }
    case 'ens':
      return { ...owners, owners: reorder(owners.owners) }
    case 'multi-factor':
      return {
        ...owners,
        validators: owners.validators.map(
          (factor) =>
            reorderOwners(
              factor,
              reorder,
            ) as (typeof owners.validators)[number],
        ),
      }
  }
}

function ownerCount(owners: OwnerSet): number {
  switch (owners.type) {
    case 'ecdsa':
    case 'passkey':
      return owners.accounts.length
    case 'quorum':
      return owners.owners.length
    case 'ens':
      return owners.owners.length
    case 'multi-factor':
      return Math.max(...owners.validators.map(ownerCount))
  }
}

type Casing = 'lower' | 'checksum'

function withAddressCasing(account: Account, casing: Casing): Account {
  const address =
    casing === 'lower'
      ? (lower(account.address) as Address)
      : checksumAddress(account.address)
  return { ...account, address }
}

function recaseOwners(owners: OwnerSet, casing: Casing): OwnerSet {
  switch (owners.type) {
    case 'ecdsa':
      return {
        ...owners,
        accounts: owners.accounts.map((account) =>
          withAddressCasing(account, casing),
        ),
      }
    case 'quorum':
      return {
        ...owners,
        owners: owners.owners.map((owner) => ({
          ...owner,
          account: withAddressCasing(owner.account, casing),
        })),
      }
    case 'ens':
      return {
        ...owners,
        owners: owners.owners.map((owner) => ({
          ...owner,
          account: withAddressCasing(owner.account, casing),
        })),
      }
    case 'passkey':
      return {
        ...owners,
        accounts: owners.accounts.map((account) =>
          recasePasskey(account, casing),
        ),
      }
    case 'multi-factor':
      return {
        ...owners,
        validators: owners.validators.map(
          (factor) =>
            recaseOwners(factor, casing) as (typeof owners.validators)[number],
        ),
      }
  }
}

function recasePasskey(
  account: WebAuthnAccount,
  casing: Casing,
): WebAuthnAccount {
  const key = account.publicKey.slice(2)
  return toWebAuthnAccount({
    credential: {
      id: account.id,
      publicKey:
        `0x${casing === 'lower' ? key.toLowerCase() : key.toUpperCase()}` as Hex,
    },
  })
}

const OWNER_ACCOUNTS: readonly Account[] = [
  accountA,
  accountB,
  accountC,
  accountD,
  collationAccountLow,
  collationAccountHigh,
]
const PASSKEYS: readonly WebAuthnAccount[] = [
  passkey('property:a'),
  passkey('property:b'),
  passkey('property:c'),
]

// Arbitrary but fixed addresses: they only need to be stable derivation inputs.
const MODULE_POOL: readonly ModuleInput[] = [
  { type: 'validator', address: '0x00000000000000000000000000000000000000d1' },
  { type: 'executor', address: '0x00000000000000000000000000000000000000d2' },
  { type: 'hook', address: '0x00000000000000000000000000000000000000d3' },
  { type: 'fallback', address: '0x00000000000000000000000000000000000000d4' },
  { type: 'executor', address: '0x00000000000000000000000000000000000000d5' },
  { type: 'executor', address: '0x00000000000000000000000000000000000000d6' },
]

type AccountConfig = NonNullable<RhinestoneAccountConfig['account']>

const safeAccountArbitrary: fc.Arbitrary<AccountConfig> = fc
  .record({
    adapter: fc.constantFrom(undefined, '1.0.0' as const, '2.0.0' as const),
    version: fc.constantFrom(undefined, '1.4.1' as const),
    nonce: fc.constantFrom(undefined, 0n, 7n),
  })
  .map(({ adapter, version, nonce }) => ({
    type: 'safe' as const,
    ...(adapter ? { adapter } : {}),
    ...(version ? { version } : {}),
    ...(nonce === undefined ? {} : { nonce }),
  }))

const saltArbitrary = fc.constantFrom(
  undefined,
  `0x${'11'.repeat(32)}` as Hex,
  `0x${'22'.repeat(32)}` as Hex,
)

const erc7579AccountArbitrary: fc.Arbitrary<AccountConfig> = fc
  .record({
    type: fc.constantFrom(
      'nexus' as const,
      'kernel' as const,
      'startale' as const,
    ),
    nexusVersion: fc.constantFrom(
      undefined,
      '1.2.0' as const,
      '1.2.1' as const,
    ),
    salt: saltArbitrary,
  })
  .map(({ type, nexusVersion, salt }) =>
    type === 'nexus'
      ? {
          type,
          ...(nexusVersion ? { version: nexusVersion } : {}),
          ...(salt ? { salt } : {}),
        }
      : { type, ...(salt ? { salt } : {}) },
  )

const hcaAccountArbitrary: fc.Arbitrary<AccountConfig> = fc
  .constantFrom(
    undefined,
    '0x00000000000000000000000000000000000000e1' as const,
  )
  .map((factory) => ({
    type: 'hca' as const,
    ...(factory ? { factory } : {}),
  }))

const accountArbitrary: fc.Arbitrary<AccountConfig> = fc.oneof(
  safeAccountArbitrary,
  erc7579AccountArbitrary,
  hcaAccountArbitrary,
  fc.constant({ type: 'eoa' as const }),
)

const thresholdArbitrary = fc.constantFrom(undefined, 1, 2)

function accountsArbitrary(max: number) {
  return fc
    .uniqueArray(fc.constantFrom(...OWNER_ACCOUNTS), {
      minLength: 1,
      maxLength: max,
    })
    .map((accounts) => accounts as Account[])
}

const ecdsaOwnersArbitrary: fc.Arbitrary<OwnerSet> = fc
  .record({ accounts: accountsArbitrary(4), threshold: thresholdArbitrary })
  .map(({ accounts, threshold }) => ({
    type: 'ecdsa' as const,
    accounts,
    ...(threshold === undefined ? {} : { threshold }),
  }))

const ensOwnersArbitrary: fc.Arbitrary<OwnerSet> = fc
  .record({
    accounts: accountsArbitrary(4),
    threshold: thresholdArbitrary,
    expiring: fc.boolean(),
  })
  .map(({ accounts, threshold, expiring }) => ({
    type: 'ens' as const,
    owners: accounts.map((account, index) => ({
      account,
      ...(expiring && index % 2 === 0
        ? { expiration: new Date('2030-01-01T00:00:00.000Z') }
        : {}),
    })),
    ...(threshold === undefined ? {} : { threshold }),
  }))

// Capped at three credentials: the multi-passkey salt search is factorial in
// the credential count, and four already costs milliseconds per derivation.
const passkeyOwnersArbitrary: fc.Arbitrary<OwnerSet> = fc
  .record({
    accounts: fc.uniqueArray(fc.constantFrom(...PASSKEYS), {
      minLength: 1,
      maxLength: 3,
      selector: (account) => account.id,
    }),
    threshold: thresholdArbitrary,
  })
  .map(({ accounts, threshold }) => ({
    type: 'passkey' as const,
    accounts: accounts as WebAuthnAccount[],
    ...(threshold === undefined ? {} : { threshold }),
  }))

// A multi-passkey factor nested in a multi-factor owner set is still installed
// in caller order (see the exception below), so nested passkey factors carry a
// single credential.
type MultiFactorValidators = Extract<
  OwnerSet,
  { type: 'multi-factor' }
>['validators']

// Factors are drawn from templates that own disjoint key sets, so reversing the
// factor list is always a real change — two factors that merely spell the same
// owner set differently would resolve to the same module and make the factor
// order sensitivity check vacuous. Each passkey template carries one credential
// because nested multi-credential factors are still order sensitive (see the
// exception below).
const FACTOR_TEMPLATES: MultiFactorValidators = [
  { type: 'ecdsa', accounts: [accountA] },
  { type: 'ecdsa', accounts: [accountB, accountC] },
  { type: 'ens', owners: [{ account: accountD }] },
  {
    type: 'ens',
    owners: [
      { account: collationAccountLow },
      { account: collationAccountHigh },
    ],
  },
  { type: 'passkey', accounts: [PASSKEYS[0] as WebAuthnAccount] },
  { type: 'passkey', accounts: [PASSKEYS[1] as WebAuthnAccount] },
]

const multiFactorOwnersArbitrary: fc.Arbitrary<OwnerSet> = fc
  .record({
    validators: fc.uniqueArray(fc.constantFrom(...FACTOR_TEMPLATES), {
      minLength: 2,
      maxLength: 3,
    }),
    threshold: thresholdArbitrary,
  })
  .map(({ validators, threshold }) => ({
    type: 'multi-factor' as const,
    validators: validators as MultiFactorValidators,
    ...(threshold === undefined ? {} : { threshold }),
  }))

const ownersArbitrary = fc.oneof(
  ecdsaOwnersArbitrary,
  ensOwnersArbitrary,
  passkeyOwnersArbitrary,
  multiFactorOwnersArbitrary,
)

const modulesArbitrary = fc.uniqueArray(fc.constantFrom(...MODULE_POOL), {
  maxLength: 4,
  selector: (module) => module.address,
})

const configArbitrary: fc.Arbitrary<RhinestoneAccountConfig> = fc
  .record({
    account: accountArbitrary,
    owners: ownersArbitrary,
    ensOwners: ensOwnersArbitrary,
    sessions: fc.constantFrom(undefined, false, true),
    guardians: fc.uniqueArray(fc.constantFrom(...OWNER_ACCOUNTS), {
      maxLength: 3,
    }),
    recoveryThreshold: thresholdArbitrary,
    modules: modulesArbitrary,
  })
  .map(
    ({
      account,
      owners,
      ensOwners,
      sessions,
      guardians,
      recoveryThreshold,
      modules,
    }): RhinestoneAccountConfig => {
      // HCA installs nothing and only accepts ENS owners; an EOA account needs
      // the EOA it adopts. Every other shape is generated freely.
      if (account.type === 'hca') {
        return { account, owners: ensOwners }
      }
      return {
        account,
        owners,
        ...(account.type === 'eoa' ? { eoa: accountD } : {}),
        ...(sessions === undefined ? {} : { sessions: { enabled: sessions } }),
        ...(guardians.length > 0
          ? {
              recovery: {
                guardians: guardians as Account[],
                ...(recoveryThreshold === undefined
                  ? {}
                  : { threshold: recoveryThreshold }),
              },
            }
          : {}),
        ...(modules.length > 0 ? { modules: modules as ModuleInput[] } : {}),
      }
    },
  )

const seedArbitrary = fc.nat({ max: 1_000_000 })

describe('derivation is invariant under owner order', () => {
  test('the static derivation ignores the order owners are listed in', () => {
    fc.assert(
      fc.property(configArbitrary, seedArbitrary, (config, seed) => {
        if (!config.owners) return
        const baseline = deriveStatic(config)
        for (const reorder of [reverse, seededReorder(seed)]) {
          const permuted = {
            ...config,
            owners: reorderOwners(config.owners, reorder),
          }
          expect(deriveStatic(permuted)).toEqual(baseline)
        }
      }),
      propertyParameters({ numRuns: 50 }),
    )
  })

  test('the public API ignores the order owners are listed in', async () => {
    await fc.assert(
      fc.asyncProperty(configArbitrary, seedArbitrary, async (config, seed) => {
        if (!config.owners) return
        const baseline = await derivePublic(config)
        const permuted = await derivePublic({
          ...config,
          owners: reorderOwners(config.owners, seededReorder(seed)),
        })
        expect(permuted).toEqual(baseline)
      }),
      propertyParameters({ numRuns: 50 }),
    )
  })

  test('owner order is ignored with host collation unavailable', () => {
    fc.assert(
      fc.property(configArbitrary, (config) => {
        const owners = config.owners
        if (!owners) return
        withoutHostCollation(() => {
          const baseline = deriveStatic(config)
          const permuted = deriveStatic({
            ...config,
            owners: reorderOwners(owners, reverse),
          })
          expect(permuted).toEqual(baseline)
        })
      }),
      propertyParameters({ numRuns: 25 }),
    )
  })

  // A nested passkey factor is stored as the sub-validator's stateless
  // configuration, whose credentials are ordered by their ID under a pinned
  // account, so caller order cannot reach the derived address.
  test('multi-passkey factors nested in a multi-factor set are order independent', () => {
    const factors = (accounts: WebAuthnAccount[]) => ({
      account: { type: 'nexus' as const },
      owners: {
        type: 'multi-factor' as const,
        validators: [
          { type: 'passkey' as const, accounts },
          { type: 'ecdsa' as const, accounts: [accountA] },
        ],
      },
    })
    const first = passkey('property:nested-a')
    const second = passkey('property:nested-b')
    const baseline = deriveStatic(factors([first, second]))
    const swapped = deriveStatic(factors([second, first]))
    if (!derived(baseline) || !derived(swapped)) {
      throw new Error('multi-factor configurations must derive')
    }
    expect(swapped.address).toBe(baseline.address)
  })

  test('the order recovery guardians are listed in is ignored', () => {
    fc.assert(
      fc.property(configArbitrary, seedArbitrary, (config, seed) => {
        if (!config.recovery) return
        const baseline = deriveStatic(config)
        for (const reorder of [reverse, seededReorder(seed)]) {
          const permuted = {
            ...config,
            recovery: {
              ...config.recovery,
              guardians: reorder(config.recovery.guardians),
            },
          }
          expect(deriveStatic(permuted)).toEqual(baseline)
        }
      }),
      propertyParameters({ numRuns: 50 }),
    )
  })
})

// Stable sort by a permuted kind ranking: the cross-kind order changes while
// each kind keeps its relative order, which is what install order is built from.
function reorderModulesAcrossKinds(
  modules: readonly ModuleInput[],
  kindOrder: readonly ModuleInput['type'][],
): ModuleInput[] {
  return [...modules].sort(
    (left, right) =>
      kindOrder.indexOf(left.type) - kindOrder.indexOf(right.type),
  )
}

const kindOrderArbitrary = fc.shuffledSubarray(
  ['validator', 'executor', 'fallback', 'hook'] as const,
  { minLength: 4, maxLength: 4 },
)

describe('derivation is invariant under module and default spelling', () => {
  test('reordering modules across kinds is ignored', () => {
    fc.assert(
      fc.property(
        configArbitrary,
        kindOrderArbitrary,
        kindOrderArbitrary,
        (config, leftOrder, rightOrder) => {
          if (!config.modules) return
          const left = deriveStatic({
            ...config,
            modules: reorderModulesAcrossKinds(config.modules, leftOrder),
          })
          const right = deriveStatic({
            ...config,
            modules: reorderModulesAcrossKinds(config.modules, rightOrder),
          })
          expect(right).toEqual(left)
        },
      ),
      propertyParameters({ numRuns: 50 }),
    )
  })

  test('spelling out a default derives the same account', () => {
    fc.assert(
      fc.property(configArbitrary, (config) => {
        const {
          sessions: _sessions,
          modules: _modules,
          ...withoutDefaults
        } = config
        const baseline = deriveStatic(withoutDefaults)
        expect(
          deriveStatic({ ...withoutDefaults, sessions: { enabled: false } }),
        ).toEqual(baseline)
        expect(deriveStatic({ ...withoutDefaults, modules: [] })).toEqual(
          baseline,
        )
        if (
          withoutDefaults.owners &&
          withoutDefaults.owners.type !== 'quorum'
        ) {
          const { threshold: _threshold, ...owners } = withoutDefaults.owners
          const implicit = deriveStatic({
            ...withoutDefaults,
            owners: owners as OwnerSet,
          })
          expect(
            deriveStatic({
              ...withoutDefaults,
              owners: { ...owners, threshold: 1 } as OwnerSet,
            }),
          ).toEqual(implicit)
        }
      }),
      propertyParameters(),
    )
  })

  test('address and public key casing is ignored', () => {
    fc.assert(
      fc.property(configArbitrary, (config) => {
        if (!config.owners) return
        const baseline = deriveStatic({
          ...config,
          owners: recaseOwners(config.owners, 'lower'),
        })
        expect(
          deriveStatic({
            ...config,
            owners: recaseOwners(config.owners, 'checksum'),
          }),
        ).toEqual(baseline)
      }),
      propertyParameters(),
    )
  })

  test('an uncompressed point prefix on a passkey key is ignored', () => {
    const base = passkey('property:prefix')
    const prefixed = toWebAuthnAccount({
      credential: {
        id: base.id,
        publicKey: `0x04${base.publicKey.slice(2)}` as Hex,
      },
    })
    for (const type of ['safe', 'nexus', 'kernel', 'startale'] as const) {
      const config = (accounts: WebAuthnAccount[]) => ({
        account: { type },
        owners: { type: 'passkey' as const, accounts },
      })
      expect(deriveStatic(config([prefixed]))).toEqual(
        deriveStatic(config([base])),
      )
    }
  })
})

describe('derivation is invariant under chain, deployment and repetition', () => {
  test('the derived account does not depend on chain or deployment state', () => {
    fc.assert(
      fc.property(
        configArbitrary,
        fc.constantFrom(...CHAINS),
        fc.boolean(),
        (config, chain, deployed) => {
          expect(deriveStatic(config, { chain, deployed })).toEqual(
            deriveStatic(config),
          )
        },
      ),
      propertyParameters(),
    )
  })

  test('derivation is deterministic, order independent, and leaves the config alone', () => {
    fc.assert(
      fc.property(configArbitrary, configArbitrary, (left, right) => {
        const leftBefore = serializeConfig(left)
        const rightBefore = serializeConfig(right)

        const leftFirst = deriveStatic(left)
        const rightSecond = deriveStatic(right)
        const rightFirst = deriveStatic(right)
        const leftSecond = deriveStatic(left)

        expect(leftSecond).toEqual(leftFirst)
        expect(rightSecond).toEqual(rightFirst)
        expect(serializeConfig(left)).toBe(leftBefore)
        expect(serializeConfig(right)).toBe(rightBefore)
      }),
      propertyParameters(),
    )
  })
})

type Mutation = {
  readonly name: string
  readonly apply: (
    config: RhinestoneAccountConfig,
  ) => RhinestoneAccountConfig | undefined
}

function replaceOwnerAccounts(
  owners: OwnerSet,
  replace: (accounts: Account[]) => Account[] | undefined,
): OwnerSet | undefined {
  if (owners.type === 'ecdsa') {
    const accounts = replace(owners.accounts)
    return accounts ? { ...owners, accounts } : undefined
  }
  if (owners.type === 'quorum') {
    const accounts = replace(owners.owners.map((owner) => owner.account))
    return accounts
      ? {
          ...owners,
          owners: accounts.map((account, index) => ({
            account,
            weight: owners.owners[index]?.weight ?? 1n,
          })),
        }
      : undefined
  }
  if (owners.type === 'ens') {
    const accounts = replace(owners.owners.map((owner) => owner.account))
    return accounts
      ? { ...owners, owners: accounts.map((account) => ({ account })) }
      : undefined
  }
  return undefined
}

const mutations: readonly Mutation[] = [
  {
    name: 'adds an owner',
    apply: (config) => {
      if (!config.owners) return undefined
      const owners = replaceOwnerAccounts(config.owners, (accounts) => {
        const extra = OWNER_ACCOUNTS.find(
          (candidate) =>
            !accounts.some((account) => account.address === candidate.address),
        )
        return extra ? [...accounts, extra] : undefined
      })
      return owners ? { ...config, owners } : undefined
    },
  },
  {
    name: 'drops an owner',
    apply: (config) => {
      if (!config.owners) return undefined
      const owners = replaceOwnerAccounts(config.owners, (accounts) =>
        accounts.length > 1 ? accounts.slice(1) : undefined,
      )
      return owners ? { ...config, owners } : undefined
    },
  },
  {
    name: 'raises the owner threshold',
    apply: (config) => {
      if (!config.owners || config.owners.type === 'quorum') return undefined
      if (ownerCount(config.owners) < 2) return undefined
      if (config.owners.threshold === 2) return undefined
      return {
        ...config,
        owners: { ...config.owners, threshold: 2 },
      }
    },
  },
  {
    name: 'swaps two modules of the same kind',
    apply: (config) => {
      if (!config.modules) return undefined
      const executors = config.modules.filter(
        (module) => module.type === 'executor',
      )
      if (executors.length < 2) return undefined
      let seen = 0
      return {
        ...config,
        modules: config.modules.map((module) => {
          if (module.type !== 'executor') return module
          const swapped = executors[executors.length - 1 - seen] as ModuleInput
          seen += 1
          return swapped
        }),
      }
    },
  },
  {
    name: 'swaps two multi-factor factors',
    apply: (config) => {
      const owners = config.owners
      if (owners?.type !== 'multi-factor') return undefined
      return {
        ...config,
        owners: {
          ...owners,
          validators: reverse(owners.validators) as typeof owners.validators,
        },
      }
    },
  },
  {
    name: 'toggles sessions',
    apply: (config) => ({
      ...config,
      sessions: { enabled: !config.sessions?.enabled },
    }),
  },
  {
    name: 'adds a guardian',
    apply: (config) => {
      const guardians = config.recovery?.guardians ?? []
      const extra = OWNER_ACCOUNTS.find(
        (candidate) =>
          !guardians.some((guardian) => guardian.address === candidate.address),
      )
      if (!extra) return undefined
      return {
        ...config,
        recovery: { ...config.recovery, guardians: [...guardians, extra] },
      }
    },
  },
  {
    name: 'changes the account salt or nonce',
    apply: (config) => {
      const account = config.account
      if (!account) return undefined
      if (account.type === 'safe') {
        return {
          ...config,
          account: { ...account, nonce: (account.nonce ?? 0n) + 1n },
        }
      }
      if (
        account.type === 'nexus' ||
        account.type === 'kernel' ||
        account.type === 'startale'
      ) {
        return {
          ...config,
          account: { ...account, salt: `0x${'33'.repeat(32)}` as Hex },
        }
      }
      return undefined
    },
  },
]

const mutationArbitrary = fc.constantFrom(...mutations)

describe('derivation is sensitive to the configuration it is given', () => {
  test('a meaningful configuration change derives a different account', () => {
    fc.assert(
      fc.property(configArbitrary, mutationArbitrary, (config, mutation) => {
        // HCA derives from its lowest ENS owner alone, and EOA accounts pass an
        // address through — both are asserted as exceptions below instead.
        fc.pre(config.account?.type !== 'hca' && config.account?.type !== 'eoa')
        const mutated = mutation.apply(config)
        fc.pre(mutated !== undefined)
        const baseline = deriveStatic(config)
        const changed = deriveStatic(mutated as RhinestoneAccountConfig)
        fc.pre(derived(baseline) && derived(changed))
        expect(changed, mutation.name).not.toEqual(baseline)
      }),
      propertyParameters(),
    )
  })
})

describe('documented derivation exceptions', () => {
  const [lowOwner, highOwner] =
    compareHexValues(
      collationAccountLow.address,
      collationAccountHigh.address,
    ) < 0
      ? [collationAccountLow, collationAccountHigh]
      : [collationAccountHigh, collationAccountLow]

  test('HCA configurations sharing their lowest ENS owner share an address', () => {
    const single = deriveStatic({
      account: { type: 'hca' },
      owners: { type: 'ens', owners: [{ account: lowOwner }] },
    })
    const pair = deriveStatic({
      account: { type: 'hca' },
      owners: {
        type: 'ens',
        owners: [{ account: lowOwner }, { account: highOwner }],
      },
    })
    if (!derived(single) || !derived(pair)) {
      throw new Error('HCA configurations must derive')
    }
    expect(pair.address).toBe(single.address)
    expect(pair.factoryData).not.toBe(single.factoryData)
  })

  test('EOA and pinned init data pass an address through', () => {
    fc.assert(
      fc.property(ownersArbitrary, ownersArbitrary, (left, right) => {
        const eoaLeft = deriveStatic({
          account: { type: 'eoa' },
          eoa: accountD,
          owners: left,
        })
        const eoaRight = deriveStatic({
          account: { type: 'eoa' },
          eoa: accountD,
          owners: right,
        })
        expect(eoaRight).toEqual(eoaLeft)

        const pinned = { address: accountC.address }
        expect(
          deriveStatic({
            account: { type: 'nexus' },
            owners: right,
            initData: pinned,
          }),
        ).toEqual(
          deriveStatic({
            account: { type: 'nexus' },
            owners: left,
            initData: pinned,
          }),
        )
      }),
      propertyParameters({ numRuns: 50 }),
    )
  })

  // `getV0InitData` reports the current path's address with the v0 factory
  // args, so only the reconstructed `factoryData` follows the caller's order.
  test('the legacy v0 Safe factory args keep their owner-order sensitivity', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.constantFrom(...OWNER_ACCOUNTS), {
          minLength: 2,
          maxLength: 4,
        }),
        (accounts) => {
          const owners = { type: 'ecdsa' as const, accounts: accounts.slice() }
          const baseline = deriveV0({ account: { type: 'safe' }, owners })
          const reversed = deriveV0({
            account: { type: 'safe' },
            owners: { ...owners, accounts: reverse(accounts) },
          })
          if (!derived(baseline) || !derived(reversed)) {
            throw new Error('v0 Safe configurations must derive')
          }
          expect(reversed.address).toBe(baseline.address)
          expect(reversed.factoryData).not.toBe(baseline.factoryData)
        },
      ),
      propertyParameters({ numRuns: 25 }),
    )
  })

  // Known gap, independent of owner order and of the Safe fix: the `address`
  // `getV0InitData` reports comes from the current path, while its factory args
  // rebuild the v0 launchpad and adapter, so the two describe different
  // accounts for every Safe including a single-owner one. Reconstruction is
  // unaffected because passing the result back as `initData` re-derives the
  // address from `factoryData`. Pinned so it cannot widen unnoticed.
  test('the v0 address field does not match the account its factory args deploy', () => {
    for (const accounts of [[accountA], [accountA, accountB, accountC]]) {
      const owners = { type: 'ecdsa' as const, accounts }
      const reported = deriveV0({ account: { type: 'safe' }, owners })
      if (!derived(reported)) {
        throw new Error('v0 Safe configurations must derive')
      }
      const reconstructed = deriveStatic({
        account: { type: 'safe' },
        owners,
        initData: {
          address: reported.address as Address,
          factory: reported.factory as Address,
          factoryData: reported.factoryData as Hex,
          intentExecutorInstalled: true,
        },
      })
      if (!derived(reconstructed)) {
        throw new Error('reconstruction from v0 init data must derive')
      }
      expect(reconstructed.factoryData).toBe(reported.factoryData)
      expect(reconstructed.address).not.toBe(reported.address)
    }
  })
})

describe('Safe multi-owner derivation', () => {
  test('a Safe derives one address for every ordering of its owners', () => {
    const accounts = [accountA, accountB, accountC]
    const baseline = deriveStatic({
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts },
    })
    for (const ordering of [
      [accountC, accountB, accountA],
      [accountB, accountA, accountC],
      [accountA, accountC, accountB],
    ]) {
      expect(
        deriveStatic({
          account: { type: 'safe' },
          owners: { type: 'ecdsa', accounts: ordering },
        }),
      ).toEqual(baseline)
    }
  })

  test('a Safe owner list is installed in value order, not host collation order', () => {
    const sorted = [collationAccountLow, collationAccountHigh].sort(
      (left, right) => compareHexValues(left.address, right.address),
    )
    const baseline = deriveStatic({
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts: sorted },
    })
    withoutHostCollation(() => {
      expect(
        deriveStatic({
          account: { type: 'safe' },
          owners: { type: 'ecdsa', accounts: reverse(sorted) },
        }),
      ).toEqual(baseline)
    })
  })

  test('checksummed and lowercase Safe owners derive the same address', () => {
    const accounts = [accountA, accountB]
    const baseline = deriveStatic({
      account: { type: 'safe' },
      owners: {
        type: 'ecdsa',
        accounts: accounts.map((account) => ({
          ...account,
          address: checksumAddress(account.address),
        })),
      },
    })
    expect(
      deriveStatic({
        account: { type: 'safe' },
        owners: {
          type: 'ecdsa',
          accounts: accounts.map((account) =>
            withAddressCasing(account, 'lower'),
          ),
        },
      }),
    ).toEqual(baseline)
  })
})
