import type { Address, Hex } from 'viem'
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
  type CrossChainSolanaOriginTransaction,
  type IntentOperationGroup,
  RhinestoneSDK,
  type SameChainSolanaInstructionsTransaction,
  type SameChainSolanaTransaction,
  type SigningRequest,
  type SolanaCrossChainExecutionMetadata,
  type SolanaExecutionMetadata,
  type SolanaInstructionsExecutionMetadata,
  type SolanaStandaloneAccountConfig,
  type SolanaSwig,
  solanaAddress,
  solanaDevnet,
  type Transaction,
} from '../../src/index'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const recipient = solanaAddress('Vote111111111111111111111111111111111111111')

// A Solana spend is one personal-sign request, disclosing the Swig wallet it
// spends from and the slot window it stays valid for.
const solanaSpendRequest = {
  account: {
    vm: 'svm',
    wallet: 'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2',
    swigAccount: '9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs',
  },
  authority: {
    kind: 'swigRole',
    roleId: 1,
    authority: { kind: 'secp256k1', address: owner.address },
  },
  scope: {
    vm: 'svm',
    action: 'spend',
    accounts: [
      {
        chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
        address: 'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2',
      },
    ],
    instructions: [],
    addressLookupTables: [],
    feePayer: { kind: 'role', role: 'relayer' },
    slotWindow: { from: '100', to: '200' },
  },
  chainIds: ['solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1'],
  purpose: 'originAuthorization',
  validity: [
    {
      kind: 'svmSlot',
      chainId: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
      expiresAtSlot: '123456',
    },
  ],
  payload: {
    kind: 'personalSign',
    message: { encoding: 'utf8', value: '11'.repeat(32) },
  },
} satisfies SigningRequest
const solanaSigningRequests: SigningRequest[] = [solanaSpendRequest]
// A Solana signature is base58 and case-sensitive; the group keeps it verbatim.
const nativeOperation = {
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

// The wire JSON shape, assignable straight from a Jupiter `/swap-instructions`
// response without branding every address first.
const jupiterInstruction: {
  programId: string
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[]
  data: string
} = {
  programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  accounts: [{ pubkey: mint, isSigner: false, isWritable: true }],
  data: 'AQID',
}
const instructionTransaction = {
  chain: solanaDevnet,
  instructions: [
    jupiterInstruction,
    // A `@solana/web3.js` instruction, accepted structurally.
    {
      programId: { toBase58: () => mint },
      keys: [
        { pubkey: { toBase58: () => mint }, isSigner: true, isWritable: true },
      ],
      data: new Uint8Array([1, 2, 3]),
    },
  ],
  addressLookupTables: ['GAQFGfFMdW95AdrXoBsWmCoiqHiWfYCKYvvmkNAbDwZ4'],
} satisfies SameChainSolanaInstructionsTransaction

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

const instructionsMetadata: SolanaInstructionsExecutionMetadata = {
  kind: 'solana-instructions',
  namespace: 'dev-v1',
  endpoint: 'https://orchestrator.example',
  chain: 792703810,
  caip2: solanaDevnet.caip2,
  accountAddress: owner.address,
  accountType: 'ERC7579',
  authority: owner.address,
  swigAddress: recipient,
  walletAddress: recipient,
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

// An account with no EVM entry is bound by its wallet, with no EVM account type.
const standaloneMetadata: SolanaExecutionMetadata = {
  kind: 'solana',
  namespace: 'dev-v1',
  endpoint: 'https://orchestrator.example',
  chain: 792703810,
  caip2: solanaDevnet.caip2,
  accountAddress: recipient,
  authority: owner.address,
  swigAddress: mint,
  walletAddress: recipient,
  recipient,
  mint,
}

const swig = { address: recipient, swigAccount: mint } satisfies SolanaSwig
const standaloneConfig: SolanaStandaloneAccountConfig = {
  owner: { type: 'ecdsa', account: owner },
  swig,
}

async function standaloneCapabilitySurface() {
  const sdk = new RhinestoneSDK({ apiKey: 'types', useDevContracts: true })
  const account = await sdk.createAccount({ solana: standaloneConfig })

  const wallet: typeof recipient = account.getAddress('solana')
  account.prepareTransaction(solanaTransaction)
  account.prepareTransaction(instructionTransaction)
  account.prepareTransaction({
    ...deliveryFromSolana,
    recipient: owner.address,
  })
  // @ts-expect-error with no EVM account to default to, the delivery names its recipient
  account.prepareTransaction(deliveryFromSolana)
  // @ts-expect-error an account with no EVM entry cannot run EVM calls
  account.prepareTransaction({ chain: mainnet, calls: [] })
  // @ts-expect-error nor fund a delivery from EVM sources
  account.prepareTransaction(deliveryTransaction)
  // @ts-expect-error EVM is not configured
  account.getAddress('evm')
  // @ts-expect-error EVM management is unavailable
  account.deploy(mainnet)

  const paired = {
    evm: { owners: { type: 'ecdsa' as const, accounts: [owner] } },
    solana: standaloneConfig,
  }
  // @ts-expect-error a managed EVM account derives its Swig, so none is named
  sdk.createAccount(paired)

  void wallet
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
  account.prepareTransaction(instructionTransaction)
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
  // Ordered requests, not role-keyed payloads: position is the identity of the
  // authorisation, and a proof is submitted per entry in this order.
  const requests: SigningRequest[] = messages
  const firstPurpose: SigningRequest['purpose'] | undefined =
    messages[0]?.purpose

  void evmAddress
  void solanaAddressValue
  void requests
  void firstPurpose
}

const forbiddenCalls = {
  ...solanaTransaction,
  // @ts-expect-error Solana-origin transfers cannot carry EVM calls
  calls: [],
} satisfies SameChainSolanaTransaction
const sponsoredTransfer = {
  ...solanaTransaction,
  sponsored: true,
} satisfies SameChainSolanaTransaction
const sponsoredTransferCategories = {
  ...solanaTransaction,
  sponsored: { gas: true, bridging: false, swaps: false, protocolFees: true },
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
// @ts-expect-error Solana destinations take delivery only, never instructions
const forbiddenDeliveryInstructions: Transaction = {
  ...deliveryTransaction,
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
const sponsoredDeliveryFromSolana = {
  ...deliveryFromSolana,
  sponsored: true,
} satisfies CrossChainSolanaOriginTransaction
const sponsoredDeliveryFromSolanaCategories = {
  ...deliveryFromSolana,
  sponsored: { gas: true, bridging: true, swaps: false },
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

const forbiddenInstructionRecipient = {
  ...instructionTransaction,
  // @ts-expect-error an instruction execution encodes its payee in the instructions
  recipient,
} satisfies SameChainSolanaInstructionsTransaction
const forbiddenInstructionTokens = {
  ...instructionTransaction,
  // @ts-expect-error an instruction execution is tokenless
  tokenRequests: [{ address: mint, amount: 1n }],
} satisfies SameChainSolanaInstructionsTransaction
const forbiddenInstructionCalls = {
  ...instructionTransaction,
  // @ts-expect-error Solana instructions cannot be mixed with EVM calls
  calls: [],
} satisfies SameChainSolanaInstructionsTransaction
const forbiddenInstructionFees = {
  ...instructionTransaction,
  // @ts-expect-error a tokenless spend has no value leg to charge fees on
  appFees: { feeBps: 10 },
} satisfies SameChainSolanaInstructionsTransaction
const sponsoredInstructions = {
  ...instructionTransaction,
  sponsored: true,
} satisfies SameChainSolanaInstructionsTransaction
const sponsoredInstructionCategories = {
  ...instructionTransaction,
  sponsored: { gas: true, bridging: false, swaps: false },
} satisfies SameChainSolanaInstructionsTransaction
const forbiddenTransferInstructions = {
  ...solanaTransaction,
  // @ts-expect-error a transfer carries no instructions
  instructions: [jupiterInstruction],
} satisfies SameChainSolanaTransaction
const forbiddenTransferLookupTables = {
  ...solanaTransaction,
  // @ts-expect-error address lookup tables require instructions
  addressLookupTables: [mint],
} satisfies SameChainSolanaTransaction
// @ts-expect-error a Solana destination runs no instructions
const forbiddenDeliveryLookupTables: Transaction = {
  ...deliveryTransaction,
  addressLookupTables: [mint],
}

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
void standaloneCapabilitySurface
void standaloneMetadata
void solanaSigningRequests
void nativeOperation
void metadata
void crossChainMetadata
void instructionsMetadata
void forbiddenInstructionRecipient
void forbiddenInstructionTokens
void forbiddenInstructionCalls
void forbiddenInstructionFees
void sponsoredInstructions
void sponsoredInstructionCategories
void forbiddenTransferInstructions
void forbiddenTransferLookupTables
void forbiddenDeliveryLookupTables
void forbiddenDeliveryFromSolanaCalls
void forbiddenDeliveryFromSolanaHyperCore
void forbiddenDeliveryFromSolanaInstructions
void forbiddenDeliveryFromSolanaRecipient
void sponsoredDeliveryFromSolana
void sponsoredDeliveryFromSolanaCategories
void forbiddenDeliveryFromSolanaTarget
void forbiddenCalls
void sponsoredTransfer
void sponsoredTransferCategories
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
