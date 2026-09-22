import type { Address, Hex } from 'viem'
import type {
  HyperCoreAction,
  SerializedIntentInput,
  SolanaWireInstruction,
} from './public'
import { serializeBigInts } from './serialization'

/**
 * The SDK's normalized intent input.
 *
 * This is deliberately NOT the Caucasus HTTP body. It is the stable shape the
 * SDK exposes as `PreparedTransactionData.intentInput`, hands to a JWT auth
 * `getIntentExtensionToken` callback, and whose canonical digest a sponsorship
 * JWT commits to — so it keeps its numeric chain ids and its original field
 * names across the wire migration. Changing it would invalidate every
 * integrator's sponsorship policy and every issued grant, which the API version
 * bump has no business doing.
 *
 * It is a projection, not a second protocol: nothing sends it anywhere.
 */
export interface NormalizedIntentAccount {
  readonly address: Address | string
  readonly accountType?: 'GENERIC' | 'ERC7579' | 'EOA'
  readonly setupOps?: readonly { readonly to: Address; readonly data: Hex }[]
  readonly delegations?: Readonly<
    Record<number, { readonly contract: Address }>
  >
  readonly mockSignatures?: Readonly<Record<`${number}`, Hex>>
}

export interface NormalizedAccessList {
  readonly chainIds?: readonly number[]
  readonly tokens?: readonly (Address | string)[]
  readonly chainTokens?: Readonly<Record<number, readonly (Address | string)[]>>
  readonly chainTokenAmounts?: Readonly<
    Record<number, Readonly<Record<Address, bigint>>>
  >
}

export interface NormalizedIntentOptions {
  readonly appFees?: { readonly feeBps: number }
  readonly protocolFees?: { readonly feeBps: number }
  readonly customDeadline?: number
  readonly sponsorSettings?: {
    readonly gas: boolean
    readonly bridgeFees: boolean
    readonly swapFees: boolean
    readonly protocolFees?: boolean
  }
  readonly settlementLayers?:
    | { readonly include: readonly string[] }
    | { readonly exclude: readonly string[] }
  readonly quoters?:
    | { readonly include: readonly string[] }
    | { readonly exclude: readonly string[] }
  readonly signatureMode?: number
  readonly auxiliaryFunds?: Readonly<
    Record<number, Readonly<Record<Address, bigint>>>
  >
  readonly hyperCore?: { readonly action: HyperCoreAction }
}

export interface NormalizedIntentInput {
  readonly account: NormalizedIntentAccount
  readonly destinationChainId: number
  readonly destinationExecutions: readonly {
    readonly to: Address
    readonly value: bigint
    readonly data: Hex
  }[]
  readonly destinationGasUnits?: bigint
  readonly tokenRequests: readonly {
    readonly tokenAddress: Address | string
    readonly amount?: bigint
  }[]
  readonly recipient?: NormalizedIntentAccount
  readonly destinationInstructions?: readonly SolanaWireInstruction[]
  readonly addressLookupTableAddresses?: readonly string[]
  readonly accountAccessList?: NormalizedAccessList
  readonly options: NormalizedIntentOptions
  readonly preClaimExecutions?: Readonly<
    Record<
      number,
      readonly {
        readonly to: Address
        readonly value: bigint
        readonly data: Hex
      }[]
    >
  >
}

// The normalized input is structurally the public `IntentInput` with `readonly`
// modifiers, so the serialized value is a `SerializedIntentInput` — the cast
// only re-attaches the type `serializeBigInts` erases.
export function projectCompatibleIntentInput(
  input: NormalizedIntentInput,
): SerializedIntentInput {
  return serializeBigInts(input) as SerializedIntentInput
}

/** Whether the normalized input asks for any sponsorship. */
export function isSponsoredIntentInput(input: NormalizedIntentInput): boolean {
  return Boolean(input.options.sponsorSettings)
}
