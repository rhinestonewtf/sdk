import type { Address, HashTypedDataParameters, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import * as ecdsaActions from '../../src/actions/ecdsa'
import * as actions from '../../src/actions/index'
import * as mfaActions from '../../src/actions/mfa'
import * as passkeyActions from '../../src/actions/passkeys'
import * as sessionActions from '../../src/actions/smart-sessions'
import type { SponsorLimitKey } from '../../src/errors/index'
import * as errors from '../../src/errors/index'
import * as evm from '../../src/evm/index'
import {
  type EvmAccountConfig,
  MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
} from '../../src/evm/index'
import type * as root from '../../src/index'
import {
  type BridgeFill,
  hyperCorePerp,
  hyperCoreSpot,
  type PreparedTransactionData,
  type Quote,
  type RhinestoneAccount,
  type RhinestoneAccountConfig,
  RhinestoneSDK,
  type SerializedIntentInput,
  type SessionSigning,
  type SessionSigningContent,
  type SignedIntentData,
  type SignedTransactionData,
  type SignerSet,
  type SigningRequest,
  stellarMainnet,
  type Transaction,
  tronMainnet,
  type UserOperationResult,
} from '../../src/index'
import * as jwtServer from '../../src/jwt-server/index'
import * as passkeySigning from '../../src/signing/passkeys'
import * as smartSessions from '../../src/smart-sessions/index'
import * as solanaEntry from '../../src/solana/index'
import { solanaAddress, solanaMainnet } from '../../src/solana/index'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const recipient = '0x0000000000000000000000000000000000000001'
const accountConfig = {
  account: { type: 'safe', version: '1.4.1', adapter: '2.0.0' },
  owners: { type: 'ecdsa', accounts: [owner], threshold: 1 },
} satisfies EvmAccountConfig

const registryFreeMfaConfig = {
  owners: {
    type: 'multi-factor',
    module: MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
    validators: [{ type: 'ecdsa', accounts: [owner] }],
  },
} satisfies EvmAccountConfig

new RhinestoneSDK({ apiKey: 'legacy-api-key' })
new RhinestoneSDK({
  auth: { mode: 'apiKey', apiKey: 'api-key' },
  provider: { type: 'custom', urls: { [mainnet.id]: 'https://rpc.example' } },
  bundler: { type: 'custom', url: 'https://bundler.example' },
  paymaster: {
    type: 'custom',
    url: { [mainnet.id]: 'https://paymaster.example' },
  },
  headers: { 'x-sdk-consumer': 'type-test' },
})
new RhinestoneSDK({
  auth: {
    mode: 'experimental_jwt',
    accessToken: async () => 'access-token',
    getIntentExtensionToken: async () => 'intent-extension-token',
  },
})

declare const account: RhinestoneAccount
declare const prepared: PreparedTransactionData
declare const quote: Quote
declare const signingRequests: SigningRequest[]
declare const typedData: HashTypedDataParameters
declare const sessionSigners: Extract<SignerSet, { type: 'session' }>

// Chain references on a quote are CAIP-2, including a bridge fill's.
const ecoBridgeFill = {
  type: 'ECO',
  destinationChainId: `eip155:${mainnet.id}`,
  intentHash: `0x${'11'.repeat(32)}`,
  fillStatusTimeout: 30,
} as const satisfies BridgeFill
const ecoIntentHash: string = ecoBridgeFill.intentHash

function readEcoIntentHash(bridgeFill: BridgeFill): string | undefined {
  if (bridgeFill.type !== 'ECO') return undefined
  return bridgeFill.intentHash
}
const narrowedEcoIntentHash: string | undefined =
  readEcoIntentHash(ecoBridgeFill)

// A Solana delivery is tracked with Eco's own id for the destination chain,
// which is opaque provider metadata beside the public CAIP-2 identifier.
const solanaDeliveryBridgeFill = {
  type: 'ECO',
  destinationChainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  providerDestinationChainId: 1399811149,
  intentHash: `0x${'22'.repeat(32)}`,
  fillStatusTimeout: 14400,
} as const satisfies BridgeFill
const providerDestinationChainId: number | undefined =
  quote.bridgeFill?.type === 'ECO'
    ? quote.bridgeFill.providerDestinationChainId
    : undefined
void solanaDeliveryBridgeFill
void providerDestinationChainId

const signingContent: SessionSigningContent = {
  domain: { name: 'Example', chainId: mainnet.id },
  types: { Example: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Example',
}
const sessionSigning: SessionSigning = {
  mode: 'scoped',
  allowedContents: [signingContent],
}
void sessionSigning
void ecoIntentHash
void narrowedEcoIntentHash

const ownerSigners = {
  type: 'owner',
  kind: 'ecdsa',
  accounts: [owner],
} as const satisfies SignerSet

const transaction = {
  source: { chain: mainnet, token: recipient },
  destination: {
    chain: mainnet,
    calls: [{ to: recipient, value: 1n }],
    recipient: accountConfig,
  },
  signers: ownerSigners,
} satisfies Transaction

const sameChainTransaction = {
  source: { token: recipient },
  destination: { chain: mainnet, calls: [] },
  customDeadline: 9_999_999_999,
} satisfies Transaction

// An EVM destination checks that `customDeadline` is same-chain at runtime;
// every other destination refuses it in the type.
const crossChainNonEvmWithDeadline = {
  source: { chain: mainnet, token: recipient },
  destination: { chain: tronMainnet, token: recipient, recipient },
  customDeadline: 9_999_999_999,
  // @ts-expect-error custom deadlines are same-chain only
} satisfies Transaction

// Stellar is the case where recipient and token addresses are different
// shapes in the same namespace: a `G…` account receives an asset named by its
// `C…` Soroban contract. Neither is hex, so this only compiles while both
// fields stay widened past viem's `Address`.
const stellarDelivery = {
  source: { chain: mainnet, token: recipient },
  destination: {
    chain: stellarMainnet,
    token: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
    amount: 1_000_000n,
    recipient: 'GA2227KIWUQ4WBKNLR53PUFJFX6G5ERZQFMAQWS3FBERXB7QNUEOLCMO',
  },
} as const satisfies Transaction

// RHI-5510: the delivery venue is the destination, so a caller addresses it by
// picking a chain. There is no venue field to forget, and no way to express a
// HyperCore delivery without stating which account it credits — both venues
// must therefore be publicly importable descriptors.
const hyperCoreSpotDelivery = {
  source: { chain: mainnet, token: recipient },
  destination: {
    chain: hyperCoreSpot,
    token: recipient,
    amount: 1_000_000n,
    calls: [],
  },
} as const satisfies Transaction

const hyperCorePerpDelivery = {
  source: { chain: mainnet, token: recipient },
  destination: {
    chain: hyperCorePerp,
    token: recipient,
    amount: 1_000_000n,
    calls: [],
  },
} as const satisfies Transaction
// A sponsorship server types its request body with the serialized input and
// reads it without casts; bigint fields arrive as decimal strings.
declare const sponsorshipBody: SerializedIntentInput
const sponsoredAccount: Address | string | undefined =
  sponsorshipBody.account.evm?.address ?? sponsorshipBody.account.svm?.address
const sponsoredChainId: string = sponsorshipBody.destination.chainId
const sponsoredCallValue: string | undefined =
  sponsorshipBody.destination.vm === 'evm'
    ? sponsorshipBody.destination.execution?.calls[0]?.value
    : undefined
const sponsoredGasUnits: string | undefined =
  sponsorshipBody.destination.vm === 'evm'
    ? sponsorshipBody.destination.execution?.gasLimit
    : undefined
const sponsoredTokenAmount: string | undefined =
  sponsorshipBody.destination.amount
const preparedIntentInput: SerializedIntentInput = prepared.intentInput
// A Solana-origin binding is narrowed on `kind`, which keeps the base58 and hex
// recipients apart.
const preparedRecipient: string | undefined =
  prepared.execution === undefined
    ? undefined
    : prepared.execution.kind === 'solana'
      ? prepared.execution.recipient
      : prepared.execution.kind === 'solana-cross-chain'
        ? prepared.execution.destinationToken
        : prepared.execution.walletAddress

new RhinestoneSDK({
  auth: {
    mode: 'experimental_jwt',
    accessToken: 'access-token',
    getIntentExtensionToken: async (intentInput: SerializedIntentInput) =>
      `token-${intentInput.destination.chainId}`,
  },
})

const sponsorLimitKey: SponsorLimitKey = 'perIntentUSD'
const bridgeSponsored: boolean = quote.cost.fees.breakdown.bridge.sponsored
const sponsorSurchargeUsd: number =
  quote.cost.fees.breakdown.sponsorSurcharge.usd

const preparedResult: Promise<PreparedTransactionData> =
  account.prepareTransaction(transaction)
const signedResult: Promise<SignedTransactionData> = account.signTransaction(
  prepared,
  { intentId: 'selected-intent' },
)
const messageSignature: Promise<Hex> = account.signMessage(
  'message',
  mainnet,
  ownerSigners,
)
const typedDataSignature: Promise<Hex> = account.signTypedData(
  typedData,
  mainnet,
  ownerSigners,
)
const intentSignature: Promise<SignedIntentData> = account.signIntent(
  signingRequests,
  mainnet,
  sessionSigners,
)
const userOperation: Promise<UserOperationResult> = account.sendUserOperation({
  chain: mainnet,
  calls: [{ to: recipient }],
  signers: ownerSigners,
})

void preparedResult
void signedResult
void messageSignature
void typedDataSignature
void intentSignature
void userOperation
void sameChainTransaction
void registryFreeMfaConfig
void crossChainNonEvmWithDeadline
void stellarDelivery
void hyperCoreSpotDelivery
void hyperCorePerpDelivery
void sponsorLimitKey
void bridgeSponsored
void sponsorSurchargeUsd
void sponsoredAccount
void sponsoredChainId
void sponsoredCallValue
void sponsoredGasUnits
void sponsoredTokenAmount
void preparedIntentInput
void preparedRecipient
void actions
void ecdsaActions
void mfaActions
void passkeyActions
void sessionActions
void errors
void jwtServer
void passkeySigning
void smartSessions
void evm

// VM-specific surface lives only in `/solana` and `/evm`.
void solanaEntry.createSolanaSwigId
void solanaEntry.solanaDevnet
void evm.OWNABLE_VALIDATOR_ADDRESS
void evm.WEBAUTHN_VALIDATOR_ADDRESS
void evm.MULTI_FACTOR_VALIDATOR_ADDRESS
void evm.SMART_SESSION_EMISSARY_ADDRESS
void evm.experimental_getRhinestoneInitData
type MovedTypes = [
  solanaEntry.SolanaAddress,
  solanaEntry.SolanaChain,
  solanaEntry.SolanaStandaloneAccount,
  solanaEntry.SolanaDeployOptions,
  solanaEntry.SolanaAccountConfig,
  evm.EvmAccountEntry,
  evm.EvmReceiverAccountConfig,
  evm.ManagedEvmAccount,
]
type RootValue = keyof typeof root
const rootWithoutSolanaAddress: RootValue = 'RhinestoneSDK'
// @ts-expect-error Solana helpers are not exported from the root
const rootSolanaAddress: RootValue = 'solanaAddress'
// @ts-expect-error Solana chains are not exported from the root
const rootSolanaMainnet: RootValue = 'solanaMainnet'
// @ts-expect-error Swig id helper is not exported from the root
const rootSwigId: RootValue = 'createSolanaSwigId'
// @ts-expect-error validator constants are not exported from the root
const rootOwnable: RootValue = 'OWNABLE_VALIDATOR_ADDRESS'
// @ts-expect-error Solana types are not exported from the root
type RootSolanaAddress = root.SolanaAddress
// @ts-expect-error EVM account types are not exported from the root
type RootEvmAccountConfig = root.EvmAccountConfig
void rootWithoutSolanaAddress
void rootSolanaAddress
void rootSolanaMainnet
void rootSwigId
void rootOwnable
export type { MovedTypes, RootEvmAccountConfig, RootSolanaAddress }

async function crossVmAccountSurface() {
  const sdk = new RhinestoneSDK({ apiKey: 'types' })
  const solana = solanaAddress('11111111111111111111111111111111')
  const managed = await sdk.createAccount({
    evm: accountConfig,
    solana: { address: solana },
  })
  const evmAddress: Address = managed.getAddress('evm')
  const nativeSolana: typeof solana = managed.getAddress('solana')
  managed.prepareTransaction({
    source: { chain: mainnet, token: recipient },
    destination: { chain: solanaMainnet, token: solana, amount: 1n },
  })

  // @ts-expect-error an address-only Solana entry has no Swig to check
  managed.getAuthorityStatus
  const evmOnly = await sdk.createAccount({ evm: accountConfig })
  // @ts-expect-error nor has an EVM-only account
  evmOnly.getAuthorityStatus

  const receiver = await sdk.createAccount({ solana: { address: solana } })
  // @ts-expect-error nor has a receiver-only account
  receiver.getAuthorityStatus
  receiver.getAddress('solana')
  managed.prepareTransaction({
    source: { chain: mainnet, token: recipient },
    // @ts-expect-error Solana destinations require branded Solana addresses
    destination: { chain: solanaMainnet, token: recipient, amount: 1n },
  })
  managed.prepareTransaction({
    // @ts-expect-error managed EVM accounts cannot originate on Solana
    source: { chain: solanaMainnet, token: solana },
    destination: { chain: mainnet, token: recipient },
  })
  // @ts-expect-error receiver-only accounts cannot prepare transactions
  receiver.prepareTransaction({})
  // @ts-expect-error nor change a Swig's authorities
  receiver.prepareTransaction({
    destination: {
      chain: solanaMainnet,
      authority: {
        action: 'remove',
        key: { type: 'passkey', publicKey: `0x02${'11'.repeat(32)}` },
      },
    },
  })
  // @ts-expect-error EVM is not configured
  receiver.getAddress('evm')
  // @ts-expect-error VM selection is required
  managed.getAddress()
  // @ts-expect-error legacy flat account configuration was removed
  sdk.createAccount(accountConfig)
  // @ts-expect-error at least one VM is required
  sdk.createAccount({})

  declareWidenedConfig(sdk)
  void evmAddress
  void nativeSolana
}
void crossVmAccountSurface

async function declareWidenedConfig(sdk: RhinestoneSDK) {
  const config = null as unknown as RhinestoneAccountConfig
  const widened = await sdk.createAccount(config)
  const maybeEvm: Address | undefined = widened.getAddress('evm')
  // @ts-expect-error a widened config does not prove a managed source
  widened.prepareTransaction({})
  void maybeEvm
}
void declareWidenedConfig
