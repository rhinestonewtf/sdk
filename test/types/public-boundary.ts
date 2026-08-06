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
  type HyperCoreBalance,
  hyperCoreMainnet,
  type PreparedTransactionData,
  type Quote,
  type RhinestoneAccount,
  type RhinestoneAccountConfig,
  RhinestoneSDK,
  type SerializedIntentInput,
  type SignData,
  type SignedIntentData,
  type SignedTransactionData,
  type SignerSet,
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

// RHI-5510: the orchestrator requires a delivery venue on HyperCore, so the
// supported descriptor must be able to express one. `hyperCoreMainnet` is a
// `NonEvmChain`, so this resolves to `CrossChainNonEvmTransaction` — declaring
// `balance` only on the EVM arm made the venue a *compile* error here, which no
// runtime test can catch. This assertion is the guard.
const hyperCoreSpotDelivery = {
  sourceChains: [mainnet],
  targetChain: hyperCoreMainnet,
  tokenRequests: [{ address: recipient, amount: 1_000_000n, balance: 'spot' }],
  calls: [],
} as const satisfies Transaction

const hyperCorePerpDelivery = {
  sourceChains: [mainnet],
  targetChain: hyperCoreMainnet,
  tokenRequests: [{ address: recipient, amount: 1_000_000n, balance: 'perp' }],
  calls: [],
} as const satisfies Transaction

// The venue type must be importable from the package root, not just declared
// internally — a consumer typing their own helper around it is the reason it is
// named at all.
const hyperCoreVenue: HyperCoreBalance = 'spot'
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
void crossChainWithDeadline
void crossChainNonEvmWithDeadline
void hyperCoreSpotDelivery
void hyperCorePerpDelivery
void hyperCoreVenue
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
