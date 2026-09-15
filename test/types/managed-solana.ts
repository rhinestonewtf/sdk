import type { Address, Hex, TypedDataDefinition } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, mainnet } from 'viem/chains'
import {
  InvalidSolanaTransactionArtifactError,
  isInvalidSolanaTransactionArtifactError,
  isSolanaAccountNotCreated,
  isSolanaQuoteExpiredError,
  type SolanaAccountNotCreatedError,
  SolanaQuoteExpiredError,
} from '../../src/errors/index'
import {
  type ChainOperation,
  type CrossChainSolanaOriginTransaction,
  type Eip712OriginSignData,
  type OriginSignData,
  type PersonalSignOriginSignData,
  RhinestoneSDK,
  type SameChainSolanaTransaction,
  type SignData,
  type SolanaCrossChainExecutionMetadata,
  type SolanaExecutionMetadata,
  solanaAddress,
  solanaDevnet,
  type Transaction,
} from '../../src/index'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const recipient = solanaAddress('Vote111111111111111111111111111111111111111')

const personalSignPayload = {
  kind: 'personalSign',
  message: '11'.repeat(32),
  expiresAtSlot: '123456',
} satisfies PersonalSignOriginSignData
const eip712Payload = {
  kind: 'eip712',
  domain: { name: 'Intent' },
  types: { Intent: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Intent',
  message: { value: 1n },
} satisfies Eip712OriginSignData
const originPayloads: OriginSignData[] = [personalSignPayload, eip712Payload]
const solanaSignData = {
  origin: [personalSignPayload],
} satisfies SignData
const nativeOperation = {
  chain: 792703810,
  status: 'COMPLETED',
  txHash: '5VERv8NM8A8f8hG1rjzAygzYwGwjBQD5rKpH8u8x2QfP',
  timestamp: 1_700_000_000,
} satisfies ChainOperation
const solanaTransaction = {
  chain: solanaDevnet,
  tokenRequests: [{ address: mint, amount: 1n }],
  recipient,
  sponsored: false,
} satisfies SameChainSolanaTransaction
const deliveryTransaction = {
  sourceChains: [mainnet],
  targetChain: solanaDevnet,
  tokenRequests: [{ address: mint, amount: 1n }],
  recipient,
  sponsored: true,
} satisfies Transaction
// Both the recipient and the EVM sources are optional: the account's own Solana
// wallet and the eligible catalog chains stand in for them.
const defaultedDelivery = {
  targetChain: solanaDevnet,
  tokenRequests: [{ address: mint }],
} satisfies Transaction

const usdcOnBase = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const
const deliveryFromSolana = {
  sourceChains: [solanaDevnet],
  sourceTokens: [{ address: mint }],
  targetChain: base,
  tokenRequests: [{ address: usdcOnBase, amount: 1n }],
} satisfies CrossChainSolanaOriginTransaction
// The delivery recipient and amount are both optional: the account's own EVM
// identity receives the whole balance of the named mint.
const maxOutFromSolana = {
  sourceChains: [solanaDevnet],
  sourceTokens: [{ address: mint }],
  targetChain: base,
  tokenRequests: [{ address: usdcOnBase }],
} satisfies CrossChainSolanaOriginTransaction

const metadata: SolanaExecutionMetadata = {
  kind: 'solana',
  namespace: 'dev-v1',
  endpoint: 'https://orchestrator.example',
  chain: 792703810,
  caip2: solanaDevnet.caip2,
  accountAddress: owner.address,
  accountType: 'ERC7579',
  authority: owner.address,
  swigAddress: recipient,
  walletAddress: recipient,
  recipient,
  mint,
}

const crossChainMetadata: SolanaCrossChainExecutionMetadata = {
  kind: 'solana-cross-chain',
  namespace: 'dev-v1',
  endpoint: 'https://orchestrator.example',
  chain: 792703810,
  caip2: solanaDevnet.caip2,
  accountAddress: owner.address,
  accountType: 'ERC7579',
  authority: owner.address,
  swigAddress: recipient,
  walletAddress: recipient,
  mint,
  destinationChain: base.id,
  destinationToken: usdcOnBase,
  recipient: owner.address,
}

async function compositeCapabilitySurface() {
  const sdk = new RhinestoneSDK({ apiKey: 'types', useDevContracts: true })
  const account = await sdk.createAccount({
    evm: { owners: { type: 'ecdsa', accounts: [owner] } },
    solana: { owner: { type: 'ecdsa', account: owner } },
  })

  const evmAddress: Address = account.getAddress('evm')
  const solanaAddressValue: typeof recipient = account.getAddress('solana')
  account.prepareTransaction(solanaTransaction)
  account.prepareTransaction(deliveryFromSolana)
  account.prepareTransaction(maxOutFromSolana)
  // The same request written inline, which is how integrators write it.
  account.prepareTransaction({
    sourceChains: [solanaDevnet],
    sourceTokens: [{ address: mint }],
    targetChain: base,
    tokenRequests: [{ address: usdcOnBase }],
    recipient: owner.address,
  })
  account.prepareTransaction(deliveryTransaction)
  account.prepareTransaction(defaultedDelivery)
  account.prepareTransaction({ chain: mainnet, calls: [] })

  const messages = account.getTransactionMessages(
    null as unknown as Parameters<typeof account.getTransactionMessages>[0],
  )
  const origins: OriginSignData[] = messages.origin
  const destination: TypedDataDefinition | undefined = messages.destination

  void evmAddress
  void solanaAddressValue
  void origins
  void destination
}

const forbiddenCalls = {
  ...solanaTransaction,
  // @ts-expect-error Solana-origin transfers cannot carry EVM calls
  calls: [],
} satisfies SameChainSolanaTransaction
const forbiddenSponsorship = {
  ...solanaTransaction,
  // @ts-expect-error managed Solana transfers are not sponsorable
  sponsored: true,
} satisfies SameChainSolanaTransaction
const forbiddenSources = {
  ...solanaTransaction,
  // @ts-expect-error same-chain Solana transfers cannot select EVM sources
  sourceChains: [mainnet],
} satisfies SameChainSolanaTransaction
const forbiddenDestination = {
  ...solanaTransaction,
  // @ts-expect-error same-chain Solana transfers cannot select another target
  targetChain: solanaDevnet,
} satisfies SameChainSolanaTransaction
const forbiddenAuthorization = {
  ...solanaTransaction,
  // @ts-expect-error EIP-7702 authorization data is EVM-only
  eip7702InitSignature: '0x12' as Hex,
} satisfies SameChainSolanaTransaction

// @ts-expect-error Solana destinations take delivery only, never calls
const forbiddenDeliveryCalls: Transaction = {
  ...deliveryTransaction,
  calls: [],
}
const forbiddenDeliveryInstructions: Transaction = {
  ...deliveryTransaction,
  // @ts-expect-error Solana destinations take delivery only, never instructions
  instructions: [],
}
// @ts-expect-error a Solana delivery recipient is a base58 wallet, not an EVM address
const forbiddenDeliveryRecipient: Transaction = {
  ...deliveryTransaction,
  recipient: owner.address,
}
// @ts-expect-error a HyperCore action needs a HyperCore destination
const forbiddenDeliveryHyperCore: Transaction = {
  ...deliveryTransaction,
  hyperCore: { closePerp: { asset: 'ETH' } },
}

const forbiddenDeliveryFromSolanaCalls = {
  ...deliveryFromSolana,
  // @ts-expect-error a Solana-origin delivery carries no destination calls
  calls: [],
} satisfies CrossChainSolanaOriginTransaction
const forbiddenDeliveryFromSolanaInstructions = {
  ...deliveryFromSolana,
  // @ts-expect-error a Solana-origin delivery carries no instructions
  instructions: [],
} satisfies CrossChainSolanaOriginTransaction
const forbiddenDeliveryFromSolanaHyperCore = {
  ...deliveryFromSolana,
  // @ts-expect-error a HyperCore action needs a HyperCore destination
  hyperCore: { closePerp: { asset: 'ETH' } },
} satisfies CrossChainSolanaOriginTransaction
const forbiddenDeliveryFromSolanaSponsorship = {
  ...deliveryFromSolana,
  // @ts-expect-error Solana-origin spends are not sponsorable
  sponsored: true,
} satisfies CrossChainSolanaOriginTransaction
const forbiddenDeliveryFromSolanaRecipient = {
  ...deliveryFromSolana,
  // @ts-expect-error the delivery lands on EVM, so the recipient is hex
  recipient,
} satisfies CrossChainSolanaOriginTransaction
const forbiddenDeliveryFromSolanaTarget = {
  ...deliveryFromSolana,
  // @ts-expect-error a Solana-origin delivery targets an EVM chain
  targetChain: solanaDevnet,
} satisfies CrossChainSolanaOriginTransaction

const executionError: Error = new InvalidSolanaTransactionArtifactError(
  'fixture',
)
const expiredError: Error = new SolanaQuoteExpiredError('intent-id')
declare const uncreatedError: SolanaAccountNotCreatedError
const invalidArtifact: boolean =
  isInvalidSolanaTransactionArtifactError(executionError)
const expired: boolean = isSolanaQuoteExpiredError(expiredError)
const uncreated: boolean = isSolanaAccountNotCreated(uncreatedError)

void compositeCapabilitySurface
void originPayloads
void solanaSignData
void nativeOperation
void metadata
void crossChainMetadata
void forbiddenDeliveryFromSolanaCalls
void forbiddenDeliveryFromSolanaHyperCore
void forbiddenDeliveryFromSolanaInstructions
void forbiddenDeliveryFromSolanaRecipient
void forbiddenDeliveryFromSolanaSponsorship
void forbiddenDeliveryFromSolanaTarget
void forbiddenCalls
void forbiddenSponsorship
void forbiddenSources
void forbiddenDestination
void forbiddenAuthorization
void forbiddenDeliveryCalls
void forbiddenDeliveryHyperCore
void forbiddenDeliveryInstructions
void forbiddenDeliveryRecipient
void invalidArtifact
void expired
void uncreated
