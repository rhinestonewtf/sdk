import { keccak256, toHex } from 'viem'
import type { RhinestoneAccountConfig } from '../../../src/index'
import {
  accountA,
  accountB,
  accountC,
  accountD,
  collationAccountHigh,
  collationAccountLow,
  passkeyAccount,
} from '../../consts'
import { passkey } from '../../utils/passkeys'

export type VectorCase = {
  readonly id: string
  /** `v0` derives through the legacy v0 reconstruction path (safe only). */
  readonly profile: 'current' | 'v0'
  /**
   * `deployment` pins address, factory and factoryData hash. `address` pins the
   * address alone — those configs pass an address through and have no factory
   * args.
   */
  readonly pins: 'deployment' | 'address'
  readonly config: RhinestoneAccountConfig
  /** Builds `initData` from another case's derived deployment plan. */
  readonly pinnedFrom?: string
}

const passkeyA = passkey('vector:a')
const passkeyB = passkey('vector:b')
const passkeyC = passkey('vector:c')

// Arbitrary but fixed addresses: they only need to be stable derivation inputs.
const VALIDATOR_OVERRIDE = '0x00000000000000000000000000000000000000a1'
const PASSKEY_VALIDATOR_OVERRIDE = '0x00000000000000000000000000000000000000a2'
const MULTI_FACTOR_VALIDATOR_OVERRIDE =
  '0x00000000000000000000000000000000000000a6'
const SESSION_MODULE_OVERRIDE = '0x00000000000000000000000000000000000000a3'
const COMPATIBILITY_FALLBACK_OVERRIDE =
  '0x00000000000000000000000000000000000000a4'
const HCA_FACTORY_OVERRIDE = '0x00000000000000000000000000000000000000a5'
const CUSTOM_VALIDATOR = '0x00000000000000000000000000000000000000b1'
const CUSTOM_EXECUTOR = '0x00000000000000000000000000000000000000b2'
const CUSTOM_HOOK = '0x00000000000000000000000000000000000000b3'
const CUSTOM_FALLBACK = '0x00000000000000000000000000000000000000b4'
const PINNED_ADDRESS = '0x00000000000000000000000000000000000000c1'
const ENS_EXPIRATION = new Date('2030-01-01T00:00:00.000Z')

const ecdsa = {
  type: 'ecdsa',
  accounts: [accountA],
} as const satisfies RhinestoneAccountConfig['owners']
const passkeySingle = {
  type: 'passkey',
  accounts: [passkeyAccount],
} as const satisfies RhinestoneAccountConfig['owners']
const passkeyMulti = {
  type: 'passkey',
  accounts: [passkeyA, passkeyB],
} as const satisfies RhinestoneAccountConfig['owners']
const multiFactor = {
  type: 'multi-factor',
  validators: [
    { type: 'ecdsa', accounts: [accountA] },
    { type: 'passkey', accounts: [passkeyAccount] },
  ],
} as const satisfies RhinestoneAccountConfig['owners']
const ensSingle = {
  type: 'ens',
  owners: [{ account: accountA }],
} as const satisfies RhinestoneAccountConfig['owners']

const validatorModule = {
  type: 'validator',
  address: CUSTOM_VALIDATOR,
} as const
const executorModule = { type: 'executor', address: CUSTOM_EXECUTOR } as const
const hookModule = { type: 'hook', address: CUSTOM_HOOK } as const
const fallbackModule = { type: 'fallback', address: CUSTOM_FALLBACK } as const
const customModules = [
  validatorModule,
  executorModule,
  hookModule,
  fallbackModule,
]

function deployment(id: string, config: RhinestoneAccountConfig): VectorCase {
  return { id, profile: 'current', pins: 'deployment', config }
}

function addressOnly(id: string, config: RhinestoneAccountConfig): VectorCase {
  return { id, profile: 'current', pins: 'address', config }
}

function v0(id: string, config: RhinestoneAccountConfig): VectorCase {
  return { id, profile: 'v0', pins: 'deployment', config }
}

// Account kind x owner kind, on production contracts with sessions disabled.
const grid: VectorCase[] = [
  deployment('safe-ecdsa', { account: { type: 'safe' }, owners: ecdsa }),
  deployment('safe-passkey-single', {
    account: { type: 'safe' },
    owners: passkeySingle,
  }),
  deployment('safe-passkey-multi', {
    account: { type: 'safe' },
    owners: passkeyMulti,
  }),
  deployment('safe-multi-factor', {
    account: { type: 'safe' },
    owners: multiFactor,
  }),
  deployment('nexus-ecdsa', { account: { type: 'nexus' }, owners: ecdsa }),
  deployment('nexus-passkey-single', {
    account: { type: 'nexus' },
    owners: passkeySingle,
  }),
  deployment('nexus-passkey-multi', {
    account: { type: 'nexus' },
    owners: passkeyMulti,
  }),
  deployment('nexus-passkey-three', {
    account: { type: 'nexus' },
    owners: { type: 'passkey', accounts: [passkeyA, passkeyB, passkeyC] },
  }),
  deployment('nexus-multi-factor', {
    account: { type: 'nexus' },
    owners: multiFactor,
  }),
  deployment('nexus-ens-single', {
    account: { type: 'nexus' },
    owners: ensSingle,
  }),
  deployment('nexus-ens-multi', {
    account: { type: 'nexus' },
    owners: {
      type: 'ens',
      owners: [{ account: accountA }, { account: accountB }],
    },
  }),
  deployment('kernel-ecdsa', { account: { type: 'kernel' }, owners: ecdsa }),
  deployment('kernel-passkey-single', {
    account: { type: 'kernel' },
    owners: passkeySingle,
  }),
  deployment('kernel-multi-factor', {
    account: { type: 'kernel' },
    owners: multiFactor,
  }),
  deployment('startale-ecdsa', {
    account: { type: 'startale' },
    owners: ecdsa,
  }),
  deployment('startale-passkey-single', {
    account: { type: 'startale' },
    owners: passkeySingle,
  }),
  deployment('startale-multi-factor', {
    account: { type: 'startale' },
    owners: multiFactor,
  }),
  deployment('hca-ens-single', { account: { type: 'hca' }, owners: ensSingle }),
  deployment('hca-ens-collation-pair', {
    account: { type: 'hca' },
    owners: {
      type: 'ens',
      owners: [
        { account: collationAccountLow },
        { account: collationAccountHigh },
      ],
    },
  }),
  addressOnly('eoa-ecdsa', {
    account: { type: 'eoa' },
    eoa: accountD,
    owners: { type: 'ecdsa', accounts: [accountD] },
  }),
  addressOnly('eoa-passkey', {
    account: { type: 'eoa' },
    eoa: accountD,
    owners: passkeySingle,
  }),
]

// Account-level variants: adapter, version, salt, nonce, factory.
const accountVariants: VectorCase[] = [
  deployment('safe-adapter-1', {
    account: { type: 'safe', adapter: '1.0.0' },
    owners: ecdsa,
  }),
  deployment('safe-adapter-2', {
    account: { type: 'safe', adapter: '2.0.0' },
    owners: ecdsa,
  }),
  deployment('safe-version-1-4-1', {
    account: { type: 'safe', version: '1.4.1' },
    owners: ecdsa,
  }),
  deployment('safe-nonce', {
    account: { type: 'safe', nonce: 7n },
    owners: ecdsa,
  }),
  deployment('nexus-version-1-2-0', {
    account: { type: 'nexus', version: '1.2.0' },
    owners: ecdsa,
  }),
  deployment('nexus-version-1-2-1', {
    account: { type: 'nexus', version: '1.2.1' },
    owners: ecdsa,
  }),
  deployment('nexus-salt', {
    account: { type: 'nexus', salt: keccak256(toHex('vector:salt')) },
    owners: ecdsa,
  }),
  deployment('kernel-version-3-3', {
    account: { type: 'kernel', version: '3.3' },
    owners: ecdsa,
  }),
  deployment('kernel-salt', {
    account: { type: 'kernel', salt: keccak256(toHex('vector:salt')) },
    owners: ecdsa,
  }),
  deployment('startale-salt', {
    account: { type: 'startale', salt: keccak256(toHex('vector:salt')) },
    owners: ecdsa,
  }),
  deployment('hca-custom-factory', {
    account: { type: 'hca', factory: HCA_FACTORY_OVERRIDE },
    owners: ensSingle,
  }),
]

// Owner-set variants: multi-owner, thresholds, module overrides, multi-factor.
const ownerVariants: VectorCase[] = [
  deployment('safe-ecdsa-two-default-threshold', {
    account: { type: 'safe' },
    owners: { type: 'ecdsa', accounts: [accountA, accountB] },
  }),
  deployment('safe-ecdsa-three-threshold-2', {
    account: { type: 'safe' },
    owners: {
      type: 'ecdsa',
      accounts: [accountA, accountB, accountC],
      threshold: 2,
    },
  }),
  deployment('safe-ens-two', {
    account: { type: 'safe' },
    owners: {
      type: 'ens',
      owners: [{ account: accountA }, { account: accountB }],
    },
  }),
  deployment('safe-ecdsa-collation-pair', {
    account: { type: 'safe' },
    owners: {
      type: 'ecdsa',
      accounts: [collationAccountLow, collationAccountHigh],
    },
  }),
  deployment('nexus-ecdsa-three-threshold-2', {
    account: { type: 'nexus' },
    owners: {
      type: 'ecdsa',
      accounts: [accountA, accountB, accountC],
      threshold: 2,
    },
  }),
  deployment('nexus-ecdsa-two-default-threshold', {
    account: { type: 'nexus' },
    owners: { type: 'ecdsa', accounts: [accountA, accountB] },
  }),
  deployment('nexus-passkey-pair-threshold-2', {
    account: { type: 'nexus' },
    owners: { type: 'passkey', accounts: [passkeyA, passkeyB], threshold: 2 },
  }),
  deployment('nexus-ens-pair-threshold-2', {
    account: { type: 'nexus' },
    owners: {
      type: 'ens',
      owners: [{ account: accountA }, { account: accountB }],
      threshold: 2,
    },
  }),
  deployment('nexus-ecdsa-module-override', {
    account: { type: 'nexus' },
    owners: { type: 'ecdsa', accounts: [accountA], module: VALIDATOR_OVERRIDE },
  }),
  deployment('nexus-passkey-module-override', {
    account: { type: 'nexus' },
    owners: {
      type: 'passkey',
      accounts: [passkeyAccount],
      module: PASSKEY_VALIDATOR_OVERRIDE,
    },
  }),
  deployment('nexus-multi-factor-ecdsa-ens', {
    account: { type: 'nexus' },
    owners: {
      type: 'multi-factor',
      validators: [
        { type: 'ecdsa', accounts: [accountA] },
        { type: 'ens', owners: [{ account: accountB }] },
      ],
    },
  }),
  deployment('nexus-multi-factor-threshold-2', {
    account: { type: 'nexus' },
    owners: {
      type: 'multi-factor',
      validators: [
        { type: 'ecdsa', accounts: [accountA] },
        { type: 'passkey', accounts: [passkeyAccount] },
      ],
      threshold: 2,
    },
  }),
  deployment('nexus-multi-factor-module-override', {
    account: { type: 'nexus' },
    owners: {
      type: 'multi-factor',
      validators: [
        { type: 'ecdsa', accounts: [accountA] },
        { type: 'passkey', accounts: [passkeyAccount] },
      ],
      module: MULTI_FACTOR_VALIDATOR_OVERRIDE,
    },
  }),
  deployment('nexus-ens-expiration', {
    account: { type: 'nexus' },
    owners: {
      type: 'ens',
      owners: [{ account: accountA, expiration: ENS_EXPIRATION }],
    },
  }),
]

// Account-level features: sessions, recovery, extra modules.
const features: VectorCase[] = [
  deployment('nexus-sessions', {
    account: { type: 'nexus' },
    owners: ecdsa,
    sessions: { enabled: true },
  }),
  deployment('safe-sessions', {
    account: { type: 'safe' },
    owners: ecdsa,
    sessions: { enabled: true },
  }),
  deployment('kernel-sessions', {
    account: { type: 'kernel' },
    owners: ecdsa,
    sessions: { enabled: true },
  }),
  deployment('startale-sessions', {
    account: { type: 'startale' },
    owners: ecdsa,
    sessions: { enabled: true },
  }),
  deployment('nexus-sessions-module-override', {
    account: { type: 'nexus' },
    owners: ecdsa,
    sessions: { enabled: true, module: SESSION_MODULE_OVERRIDE },
  }),
  deployment('safe-sessions-compatibility-fallback', {
    account: { type: 'safe' },
    owners: ecdsa,
    sessions: {
      enabled: true,
      compatibilityFallback: COMPATIBILITY_FALLBACK_OVERRIDE,
    },
  }),
  deployment('nexus-recovery-two-guardians', {
    account: { type: 'nexus' },
    owners: ecdsa,
    recovery: { guardians: [accountB, accountC] },
  }),
  deployment('nexus-recovery-three-threshold-2', {
    account: { type: 'nexus' },
    owners: ecdsa,
    recovery: { guardians: [accountB, accountC, accountD], threshold: 2 },
  }),
  deployment('safe-recovery-two-guardians', {
    account: { type: 'safe' },
    owners: ecdsa,
    recovery: { guardians: [accountB, accountC] },
  }),
  deployment('nexus-module-validator', {
    account: { type: 'nexus' },
    owners: ecdsa,
    modules: [validatorModule],
  }),
  deployment('nexus-module-executor', {
    account: { type: 'nexus' },
    owners: ecdsa,
    modules: [executorModule],
  }),
  deployment('nexus-module-hook', {
    account: { type: 'nexus' },
    owners: ecdsa,
    modules: [hookModule],
  }),
  deployment('nexus-module-fallback', {
    account: { type: 'nexus' },
    owners: ecdsa,
    modules: [fallbackModule],
  }),
  deployment('nexus-modules-combined', {
    account: { type: 'nexus' },
    owners: ecdsa,
    modules: customModules,
  }),
  deployment('nexus-sessions-recovery-modules', {
    account: { type: 'nexus' },
    owners: ecdsa,
    sessions: { enabled: true },
    recovery: { guardians: [accountB, accountC], threshold: 2 },
    modules: customModules,
  }),
]

// Caller-pinned init data and EIP-7702 adoption pass an address through.
const pinnedAndAdoption: VectorCase[] = [
  addressOnly('nexus-pinned-address', {
    account: { type: 'nexus' },
    owners: ecdsa,
    initData: { address: PINNED_ADDRESS },
  }),
  addressOnly('safe-pinned-address', {
    account: { type: 'safe' },
    owners: ecdsa,
    initData: { address: PINNED_ADDRESS },
  }),
  {
    id: 'nexus-pinned-factory',
    profile: 'current',
    pins: 'deployment',
    config: { account: { type: 'nexus' }, owners: ecdsa },
    pinnedFrom: 'nexus-ecdsa',
  },
  addressOnly('nexus-7702-ecdsa', {
    account: { type: 'nexus' },
    eoa: accountD,
    owners: { type: 'ecdsa', accounts: [accountD] },
  }),
  addressOnly('nexus-7702-passkey-multi', {
    account: { type: 'nexus' },
    eoa: accountD,
    owners: passkeyMulti,
  }),
]

// Legacy v0 reconstruction, supported for safe accounts only.
const legacyV0: VectorCase[] = [
  v0('v0-safe-ecdsa', { account: { type: 'safe' }, owners: ecdsa }),
  v0('v0-safe-sessions', {
    account: { type: 'safe' },
    owners: ecdsa,
    sessions: { enabled: true },
  }),
  v0('v0-safe-passkey-single', {
    account: { type: 'safe' },
    owners: passkeySingle,
  }),
  v0('v0-safe-multi-factor', {
    account: { type: 'safe' },
    owners: multiFactor,
  }),
  v0('v0-safe-ecdsa-three-threshold-2', {
    account: { type: 'safe' },
    owners: {
      type: 'ecdsa',
      accounts: [accountA, accountB, accountC],
      threshold: 2,
    },
  }),
]

export const vectorCases: readonly VectorCase[] = [
  ...grid,
  ...accountVariants,
  ...ownerVariants,
  ...features,
  ...pinnedAndAdoption,
  ...legacyV0,
].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))

export function vectorCaseById(id: string): VectorCase {
  const match = vectorCases.find((vectorCase) => vectorCase.id === id)
  if (!match) throw new Error(`Unknown vector case: ${id}`)
  return match
}
