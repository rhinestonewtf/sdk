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
import {
  type BridgeFill,
  hyperCorePerp,
  hyperCoreSpot,
  MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
  type PreparedTransactionData,
  type Quote,
  type RhinestoneAccount,
  type RhinestoneAccountConfig,
  RhinestoneSDK,
  type SerializedIntentInput,
  type SessionSigning,
  type SessionSigningContent,
  type SignData,
  type SignedIntentData,
  type SignedTransactionData,
  type SignerSet,
  stellarMainnet,
  type Transaction,
  tronMainnet,
  type UserOperationResult,
} from '../../src/index'
import * as jwtServer from '../../src/jwt-server/index'
import * as passkeySigning from '../../src/signing/passkeys'
import * as smartSessions from '../../src/smart-sessions/index'
import * as utils from '../../src/utils/index'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const recipient = '0x0000000000000000000000000000000000000001'
const accountConfig = {
  account: { type: 'safe', version: '1.4.1', adapter: '2.0.0' },
  owners: { type: 'ecdsa', accounts: [owner], threshold: 1 },
} satisfies RhinestoneAccountConfig

const registryFreeMfaConfig = {
  owners: {
    type: 'multi-factor',
    module: MULTI_FACTOR_VALIDATOR_V2_ADDRESS,
    validators: [{ type: 'ecdsa', accounts: [owner] }],
  },
} satisfies RhinestoneAccountConfig

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
declare const signData: SignData
declare const typedData: HashTypedDataParameters
declare const sessionSigners: Extract<SignerSet, { type: 'session' }>

const ecoBridgeFill = {
  type: 'ECO',
  destinationChainId: mainnet.id,
  intentHash: `0x${'11'.repeat(32)}`,
} as const satisfies BridgeFill
const ecoIntentHash: Hex = ecoBridgeFill.intentHash

function readEcoIntentHash(bridgeFill: BridgeFill): Hex | undefined {
  if (bridgeFill.type !== 'ECO') return undefined
  return bridgeFill.intentHash
}
const narrowedEcoIntentHash: Hex | undefined = readEcoIntentHash(ecoBridgeFill)

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
  sourceChains: [mainnet],
  targetChain: mainnet,
  calls: [{ to: recipient, value: 1n }],
  recipient: accountConfig,
  signers: ownerSigners,
} satisfies Transaction

const sameChainTransaction = {
  chain: mainnet,
  calls: [],
  customDeadline: 9_999_999_999,
} satisfies Transaction

const crossChainWithDeadline = {
  sourceChains: [mainnet],
  targetChain: mainnet,
  calls: [],
  customDeadline: 9_999_999_999,
} as const satisfies Transaction

const crossChainNonEvmWithDeadline = {
  sourceChains: [mainnet],
  targetChain: tronMainnet,
  customDeadline: 9_999_999_999,
} as const satisfies Transaction

// Stellar is the case where recipient and token addresses are different
// shapes in the same namespace: a `G…` account receives an asset named by its
// `C…` Soroban contract. Neither is hex, so this only compiles while both
// fields stay widened past viem's `Address`.
const stellarDelivery = {
  sourceChains: [mainnet],
  targetChain: stellarMainnet,
  tokenRequests: [
    {
      address: 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
      amount: 1_000_000n,
    },
  ],
  recipient: 'GA2227KIWUQ4WBKNLR53PUFJFX6G5ERZQFMAQWS3FBERXB7QNUEOLCMO',
} as const satisfies Transaction

// RHI-5510: the delivery venue is the destination, so a caller addresses it by
// picking a chain. There is no venue field to forget, and no way to express a
// HyperCore delivery without stating which account it credits — both venues
// must therefore be publicly importable descriptors.
const hyperCoreSpotDelivery = {
  sourceChains: [mainnet],
  targetChain: hyperCoreSpot,
  tokenRequests: [{ address: recipient, amount: 1_000_000n }],
  calls: [],
} as const satisfies Transaction

const hyperCorePerpDelivery = {
  sourceChains: [mainnet],
  targetChain: hyperCorePerp,
  tokenRequests: [{ address: recipient, amount: 1_000_000n }],
  calls: [],
} as const satisfies Transaction
// A sponsorship server types its request body with the serialized input and
// reads it without casts; bigint fields arrive as decimal strings.
declare const sponsorshipBody: SerializedIntentInput
const sponsoredAccount: Address | string = sponsorshipBody.account.address
const sponsoredChainId: number = sponsorshipBody.destinationChainId
const sponsoredCallValue: string =
  sponsorshipBody.destinationExecutions[0].value
const sponsoredGasUnits: string | undefined =
  sponsorshipBody.destinationGasUnits
const sponsoredTokenAmount: string | undefined =
  sponsorshipBody.tokenRequests[0].amount
const preparedIntentInput: SerializedIntentInput = prepared.intentInput

new RhinestoneSDK({
  auth: {
    mode: 'experimental_jwt',
    accessToken: 'access-token',
    getIntentExtensionToken: async (intentInput: SerializedIntentInput) =>
      `token-${intentInput.destinationChainId}`,
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
  signData,
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
void crossChainWithDeadline
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
void actions
void ecdsaActions
void mfaActions
void passkeyActions
void sessionActions
void errors
void jwtServer
void passkeySigning
void smartSessions
void utils
