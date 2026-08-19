import { type Account, type Hex, keccak256, stringToHex } from 'viem'
import type { EvmChainReference } from '../chains/types'
import { planModuleSetup } from '../modules/plan'
import type { ConfiguredModule, ModuleSetup } from '../modules/types'
import { resolveValidator } from '../modules/validators/resolve'
import type {
  AtomicValidatorDefinition,
  ResolvedValidatorDefinition,
} from '../modules/validators/types'
import {
  orderWebauthnCredentials,
  toWebauthnInstallCredentials,
  type WebauthnCredentialOrdering,
  webauthnDefinitionCredentials,
} from '../modules/validators/webauthn'
import {
  accountSupportsSaltSearch,
  assertPasskeySetInstallable,
  selectPasskeyAccount,
} from './passkey-install'
import { createAccountAdapter } from './registry'
import type {
  AccountConstruction,
  AccountDefinition,
  AccountInitData,
} from './types'

export interface AccountConstructionMaterial {
  readonly account: AccountDefinition
  readonly owner?: ResolvedValidatorDefinition
  readonly modules: readonly ConfiguredModule[]
  readonly initData?: AccountInitData
  readonly eoa?: Account
  readonly sessions: {
    readonly enabled: boolean
    readonly environment: 'production' | 'development'
    readonly module?: `0x${string}`
    readonly compatibilityFallback?: `0x${string}`
  }
}

function passkeyOwner(
  owner: ResolvedValidatorDefinition | undefined,
): AtomicValidatorDefinition | undefined {
  return owner?.kind === 'passkey' ? owner : undefined
}

function setupFingerprint(input: {
  readonly account: AccountDefinition
  readonly setup: ModuleSetup
}): Hex {
  return keccak256(
    stringToHex(
      JSON.stringify(input, (_key, value) =>
        typeof value === 'bigint' ? `${value}n` : value,
      ),
    ),
  )
}

export function createAccountConstruction(input: {
  readonly material: AccountConstructionMaterial
  readonly chain: EvmChainReference
  readonly deployed: boolean
  readonly setup?: ModuleSetup
}): AccountConstruction {
  const material = input.material
  const passkey = passkeyOwner(material.owner)
  // Caller-pinned init data carrying a factory is used verbatim, so neither the
  // credential order nor the salt has any effect on the deployed account.
  const pinned =
    material.initData !== undefined && 'factory' in material.initData
  const knownAddress = material.eoa?.address ?? material.initData?.address
  const credentials =
    passkey && !pinned
      ? toWebauthnInstallCredentials(webauthnDefinitionCredentials(passkey))
      : undefined
  const searchable =
    credentials !== undefined &&
    credentials.length > 1 &&
    knownAddress === undefined &&
    accountSupportsSaltSearch(material.account)
  if (credentials && (knownAddress !== undefined || searchable)) {
    assertPasskeySetInstallable({ credentials, atDeployment: searchable })
  }
  const ordering: WebauthnCredentialOrdering | undefined = knownAddress
    ? // The address is already fixed (EIP-7702 adoption or a caller-supplied
      // address), so the exact order the validator requires is computable.
      { kind: 'credential-id', account: knownAddress }
    : searchable
      ? { kind: 'canonical' }
      : undefined
  const ownerModule = material.owner
    ? resolveValidator(material.owner, ordering)
    : undefined
  if (!ownerModule && material.account.kind !== 'eoa') {
    throw new Error('Smart account owner is required')
  }
  const setup =
    input.setup ??
    (ownerModule
      ? planModuleSetup({
          accountKind: material.account.kind,
          owner: ownerModule,
          configured: material.modules,
          environment: material.sessions.environment,
          sessions: material.sessions,
        })
      : { validators: [], executors: [], hooks: [], fallbacks: [] })
  const base: AccountConstruction = {
    account: material.account,
    ...(material.owner ? { owner: material.owner } : {}),
    modules: material.modules,
    setup,
    sessions: {
      enabled: material.sessions.enabled,
      environment: material.sessions.environment,
    },
    ...(material.initData ? { initData: material.initData } : {}),
    ...(material.eoa ? { eoa: material.eoa } : {}),
    chain: input.chain,
    deployed: input.deployed,
  }
  if (!searchable || !credentials) return base
  // The module setup is salt-independent, so only the account definition varies
  // across attempts.
  const account = selectPasskeyAccount({
    account: material.account,
    credentials: orderWebauthnCredentials(credentials, { kind: 'canonical' }),
    fingerprint: setupFingerprint({ account: material.account, setup }),
    deriveAddress: (candidate) => {
      const construction = { ...base, account: candidate }
      return createAccountAdapter(construction).getIdentity(construction)
        .address
    },
  })
  return { ...base, account }
}
