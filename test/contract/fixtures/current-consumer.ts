import {
  type BridgeFill,
  type CrossChainSolanaOriginTransaction,
  type EvmAccountConfig,
  type IntentOperationGroup,
  RhinestoneSDK,
  type SameChainSolanaTransaction,
  type SigningProof,
  type SigningRequest,
  type SolanaCrossChainExecutionMetadata,
  type SolanaExecutionMetadata,
  solanaAddress,
  solanaDevnet,
  solanaMainnet,
} from '@rhinestone/sdk'
import {
  InvalidSolanaTransactionArtifactError,
  isInvalidSolanaTransactionArtifactError,
  isSolanaAccountNotCreated,
  isSolanaQuoteExpiredError,
  type SolanaAccountNotCreatedError,
  SolanaQuoteExpiredError,
} from '@rhinestone/sdk/errors'
import { privateKeyToAccount } from 'viem/accounts'
import { base, mainnet } from 'viem/chains'

function readEcoIntentHash(bridgeFill: BridgeFill): string | undefined {
  if (bridgeFill.type !== 'ECO') return undefined
  return bridgeFill.intentHash
}

const ecoBridgeFill = {
  type: 'ECO',
  destinationChainId: `eip155:${mainnet.id}`,
  intentHash: `0x${'11'.repeat(32)}`,
  fillStatusTimeout: 30,
} as const satisfies BridgeFill
const ecoIntentHash: string | undefined = readEcoIntentHash(ecoBridgeFill)
const solanaDeliveryBridgeFill = {
  type: 'ECO',
  destinationChainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  providerDestinationChainId: 1399811149,
  intentHash: `0x${'22'.repeat(32)}`,
  fillStatusTimeout: 14400,
} as const satisfies BridgeFill
const solanaOperation = {
  chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
  items: [
    {
      type: 'FILL',
      status: 'COMPLETED',
      transaction: {
        vm: 'svm',
        chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        signature: '5VERv8NM8A8f8hG1rjzAygzYwGwjBQD5rKpH8u8x2QfP',
      },
      timestamp: 1_700_000_000,
    },
  ],
} satisfies IntentOperationGroup

const owner = privateKeyToAccount(
  '0x0000000000000000000000000000000000000000000000000000000000000001',
)
const evm = {
  owners: { type: 'ecdsa', accounts: [owner] },
} satisfies EvmAccountConfig
const solana = solanaAddress('11111111111111111111111111111111')
const solanaMint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const solanaRecipient = solanaAddress(
  'Vote111111111111111111111111111111111111111',
)
const sdk = new RhinestoneSDK({ apiKey: 'contract' })

async function useCurrentAccountApi() {
  const account = await sdk.createAccount({ evm, solana: { address: solana } })
  account.getAddress('evm')
  account.getAddress('solana')
  await account.prepareTransaction({
    sourceChains: [mainnet],
    targetChain: solanaMainnet,
    tokenRequests: [{ address: solana, amount: 1n }],
  })

  const delivery = await account.prepareTransaction({
    targetChain: solanaMainnet,
    tokenRequests: [{ address: solanaMint, amount: 1n }],
    recipient: solanaRecipient,
    sponsored: true,
  })
  const deliveryFill: BridgeFill | undefined = delivery.quotes.best.bridgeFill
  void deliveryFill

  const receiver = await sdk.createAccount({ solana: { address: solana } })
  receiver.getAddress('solana')
  // @ts-expect-error receiver-only handles cannot transact
  receiver.prepareTransaction({})
  // @ts-expect-error the legacy flat constructor is intentionally removed
  sdk.createAccount(evm)
  // @ts-expect-error VM selection is required
  account.getAddress()
}

async function useManagedSolanaApi() {
  const devSdk = new RhinestoneSDK({
    apiKey: 'contract',
    useDevContracts: true,
  })
  const account = await devSdk.createAccount({
    evm,
    solana: { owner: { type: 'ecdsa', account: owner } },
  })
  const transaction = {
    chain: solanaDevnet,
    tokenRequests: [{ address: solanaMint, amount: 1n }],
    recipient: solanaRecipient,
  } satisfies SameChainSolanaTransaction
  const prepared = await account.prepareTransaction(transaction)
  const metadata: SolanaExecutionMetadata | undefined =
    prepared.execution?.kind === 'solana' ? prepared.execution : undefined
  const delivery = {
    sourceChains: [solanaDevnet],
    sourceTokens: [{ address: solanaMint }],
    targetChain: base,
    tokenRequests: [{ address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }],
  } satisfies CrossChainSolanaOriginTransaction
  const preparedDelivery = await account.prepareTransaction(delivery)
  const deliveryMetadata: SolanaCrossChainExecutionMetadata | undefined =
    preparedDelivery.execution?.kind === 'solana-cross-chain'
      ? preparedDelivery.execution
      : undefined
  const signingRequests: SigningRequest[] = prepared.quotes.best.signingRequests
  const purposes = signingRequests.map(({ purpose }) => purpose)
  const signed = await account.signTransaction(prepared)
  // One proof per request, in the same order.
  const proofs: SigningProof[] = signed.proofs

  void metadata
  void deliveryMetadata
  void signingRequests
  void purposes
  void proofs
}

const invalidArtifact = new InvalidSolanaTransactionArtifactError('fixture')
const expired = new SolanaQuoteExpiredError('intent-id')
declare const uncreated: SolanaAccountNotCreatedError
const recognizedErrors: boolean[] = [
  isInvalidSolanaTransactionArtifactError(invalidArtifact),
  isSolanaQuoteExpiredError(expired),
  isSolanaAccountNotCreated(uncreated),
]

void ecoIntentHash
void solanaDeliveryBridgeFill
void solanaOperation
void useCurrentAccountApi
void useManagedSolanaApi
void recognizedErrors
