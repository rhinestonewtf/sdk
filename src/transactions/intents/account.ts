import type { Address, Hex } from 'viem'
import type { AccountRuntime } from '../../accounts/adapter'
import type { NormalizedIntentAccount } from '../../clients/orchestrator/normalized'
import type {
  OrchestratorEvmAccount,
  OrchestratorEvmRecipient,
} from '../../clients/orchestrator/types'
import { Eip7702InitSignatureRequiredError } from '../../errors/execution'

/**
 * An account the way the SDK resolves it, before either wire shape is chosen.
 *
 * Caucasus and the normalized sponsorship input disagree about spelling but
 * not about facts, so both are projected from this rather than from each other.
 */
export interface IntentAccountProjection {
  readonly kind: 'eoa' | 'erc7579'
  readonly address: Address
  readonly setupOps: readonly { readonly to: Address; readonly data: Hex }[]
  /**
   * The contract an EIP-7702 adoption delegates to, on every chain the intent
   * touches. Caucasus spells that `delegations.default`; a launch delegation
   * request names concrete chains and has no any-chain sentinel.
   */
  readonly delegationContract?: Address
}

/** A payee that cannot authorise execution, distinct from a configured account. */
export interface IntentBareRecipient {
  readonly kind: 'bare'
  readonly address: string
}

export type IntentRecipientProjection =
  | IntentBareRecipient
  | ({
      readonly kind: 'account'
      readonly accountKind: 'eoa' | 'erc7579'
    } & Omit<IntentAccountProjection, 'kind'>)

/** Wraps a resolved account so it can be used as an intent recipient. */
export function asIntentRecipient(
  account: IntentAccountProjection,
): IntentRecipientProjection {
  const { kind, ...rest } = account
  return { kind: 'account', accountKind: kind, ...rest }
}

export function projectIntentAccount(input: {
  readonly runtime: AccountRuntime
  readonly setupOverride?: readonly {
    readonly to: Address
    readonly data: `0x${string}`
  }[]
  readonly eip7702InitSignature?: Hex
}): IntentAccountProjection {
  const { runtime } = input
  const adoption = runtime.construction.eoa
    ? runtime.adapter.getEip7702AdoptionPlan?.(runtime.construction)
    : undefined
  const setupOps = input.setupOverride
    ? [...input.setupOverride]
    : adoption
      ? [eip7702SetupOp(runtime, input.eip7702InitSignature)]
      : deploymentSetupOps(runtime)
  return {
    // An adopted 7702 account is an ERC-7579 account WITH delegations, not a
    // stripped EOA: it still routes through its setup op and its signature is
    // still validated by the account.
    kind: runtime.construction.account.kind === 'eoa' ? 'eoa' : 'erc7579',
    address: runtime.identity.address,
    setupOps,
    ...(adoption ? { delegationContract: adoption.contract } : {}),
  }
}

/** The Caucasus `account.evm` entry. */
export function toWireEvmAccount(
  projection: IntentAccountProjection,
  extras?: {
    readonly signatureMode?: number
    readonly mockSignaturesByChain?: Readonly<Record<string, Hex>>
  },
): OrchestratorEvmAccount {
  const delegations = projection.delegationContract
    ? { default: { contract: projection.delegationContract } }
    : undefined
  if (projection.kind === 'eoa') {
    // A true EOA permits neither setup operations nor simulation stubs.
    return {
      type: 'eoa',
      address: projection.address,
      ...(extras?.signatureMode === undefined
        ? {}
        : { signatureMode: extras.signatureMode }),
      ...(delegations ? { delegations } : {}),
    }
  }
  return {
    type: 'erc7579',
    address: projection.address,
    ...(projection.setupOps.length > 0
      ? { initData: { setupOps: projection.setupOps } }
      : {}),
    ...(extras?.signatureMode === undefined
      ? {}
      : { signatureMode: extras.signatureMode }),
    ...(delegations ? { delegations } : {}),
    ...(extras?.mockSignaturesByChain
      ? { simulation: { mockSignaturesByChain: extras.mockSignaturesByChain } }
      : {}),
  }
}

export function toWireRecipient(
  recipient: IntentRecipientProjection,
): OrchestratorEvmRecipient {
  if (recipient.kind === 'bare') {
    return { address: recipient.address as Address }
  }
  const { accountKind: kind, address, setupOps, delegationContract } = recipient
  const delegations = delegationContract
    ? { default: { contract: delegationContract } }
    : undefined
  if (kind === 'eoa') {
    return { type: 'eoa', address, ...(delegations ? { delegations } : {}) }
  }
  return {
    type: 'erc7579',
    address,
    ...(setupOps.length > 0 ? { initData: { setupOps } } : {}),
    ...(delegations ? { delegations } : {}),
  }
}

/** The account as the normalized sponsorship input has always spelled it. */
export function toNormalizedAccount(
  projection: IntentAccountProjection,
  extras?: {
    readonly mockSignatures?: Readonly<Record<`${number}`, Hex>>
  },
): NormalizedIntentAccount {
  return {
    address: projection.address,
    accountType: projection.kind === 'eoa' ? 'EOA' : 'ERC7579',
    setupOps: projection.setupOps,
    // The key is always present (undefined for non-7702 accounts, a chain-zero
    // map for 7702). That is the shape existing sponsorship digests were
    // computed over, so it survives the wire migration unchanged.
    delegations: projection.delegationContract
      ? { 0: { contract: projection.delegationContract } }
      : undefined,
    ...(extras?.mockSignatures
      ? { mockSignatures: extras.mockSignatures }
      : {}),
  }
}

export function toNormalizedRecipient(
  recipient: IntentRecipientProjection,
): NormalizedIntentAccount {
  return recipient.kind === 'bare'
    ? { address: recipient.address }
    : toNormalizedAccount({
        kind: recipient.accountKind,
        address: recipient.address,
        setupOps: recipient.setupOps,
        ...(recipient.delegationContract
          ? { delegationContract: recipient.delegationContract }
          : {}),
      })
}

function deploymentSetupOps(
  runtime: AccountRuntime,
): { to: Address; data: Hex }[] {
  const deployment = runtime.adapter.getDeploymentPlan(runtime.construction)
  return !deployment.factory || !deployment.factoryData
    ? []
    : [{ to: deployment.factory, data: deployment.factoryData }]
}

// A 7702 account is routed by its `initializeAccount` setup op, which requires
// the EIP-7702 init signature at preparation time — even when the account is
// already deployed. Without it the orchestrator sees a bare smart account and
// finds no viable route.
function eip7702SetupOp(
  runtime: AccountRuntime,
  eip7702InitSignature: Hex | undefined,
): { to: Address; data: Hex } {
  if (
    !eip7702InitSignature ||
    eip7702InitSignature === '0x' ||
    !runtime.adapter.getEip7702InitCall
  ) {
    throw new Eip7702InitSignatureRequiredError()
  }
  return {
    to: runtime.identity.address,
    data: runtime.adapter.getEip7702InitCall(
      runtime.construction,
      eip7702InitSignature,
    ),
  }
}

export function projectIntentRecipient(
  recipient: Address | string,
): IntentBareRecipient
export function projectIntentRecipient(recipient: undefined): undefined
export function projectIntentRecipient(
  recipient: Address | string | undefined,
): IntentBareRecipient | undefined {
  // A bare address is a payee and nothing more. The old projection attached an
  // `EOA` account type with empty setup ops on EVM destinations, which read on
  // the wire as "this recipient can execute" — it cannot.
  return recipient ? { kind: 'bare', address: recipient } : undefined
}
