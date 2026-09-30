import type { Address, Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, mainnet } from 'viem/chains'
import {
  InvalidSolanaTransactionArtifactError,
  isInvalidSolanaTransactionArtifactError,
  isSolanaAccountNotCreated,
  isSolanaAuthorityChangeRefused,
  isSolanaQuoteExpiredError,
  type SolanaAccountNotCreatedError,
  type SolanaAuthorityChangeRefusalReason,
  SolanaQuoteExpiredError,
} from '../../src/errors/index'
import {
  type IntentOperationGroup,
  RhinestoneSDK,
  type SigningRequest,
  type Transaction,
} from '../../src/index'
import {
  addEcdsaKey,
  addPasskey,
  type CrossChainSolanaOriginTransaction,
  createSolanaSwigId,
  removeEcdsaKey,
  removePasskey,
  type SameChainSolanaAuthorityTransaction,
  type SameChainSolanaInstructionsTransaction,
  type SameChainSolanaTransaction,
  type SolanaAuthorityChange,
  type SolanaAuthorityDisclosure,
  type SolanaAuthorityExecutionMetadata,
  type SolanaAuthorityPermission,
  type SolanaAuthorityStatus,
  type SolanaCrossChainExecutionMetadata,
  type SolanaExecutionMetadata,
  type SolanaInstructionsExecutionMetadata,
  type SolanaPasskeyPermission,
  type SolanaSourceAsset,
  type SolanaStandaloneAccount,
  type SolanaStandaloneAccountConfig,
  solanaAddress,
  solanaDevnet,
} from '../../src/solana/index'

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
  sourceAssets: [{ chain: solanaDevnet, address: mint }],
  targetChain: base,
  tokenRequests: [{ address: usdcOnBase, amount: 1n }],
} satisfies CrossChainSolanaOriginTransaction
// The delivery recipient and amount are both optional: the account's own EVM
// identity receives the whole balance of the named mint.
const maxOutFromSolana = {
  sourceChains: [solanaDevnet],
  sourceAssets: [{ chain: solanaDevnet, address: mint }],
  targetChain: base,
  tokenRequests: [{ address: usdcOnBase }],
} satisfies CrossChainSolanaOriginTransaction
// A ceiling on the source debit, with or without a destination amount.
const sourceCap: SolanaSourceAsset = {
  chain: solanaDevnet,
  address: mint,
  amount: 4_000_000n,
}
const cappedMaxOutFromSolana = {
  ...maxOutFromSolana,
  sourceAssets: [sourceCap],
} satisfies CrossChainSolanaOriginTransaction
// Native SOL is named by the address the orchestrator's token registry uses.
const nativeSolFromSolana = {
  ...maxOutFromSolana,
  sourceAssets: [
    {
      chain: solanaDevnet,
      address: solanaAddress('11111111111111111111111111111111'),
      amount: 1_000_000_000n,
    },
  ],
} satisfies CrossChainSolanaOriginTransaction
const cappedTransfer = {
  ...solanaTransaction,
  sourceAssets: [sourceCap],
} satisfies SameChainSolanaTransaction
const uncappedSourceTransfer = {
  ...solanaTransaction,
  sourceAssets: [{ chain: solanaDevnet, address: mint }],
} satisfies SameChainSolanaTransaction
// @ts-expect-error a delivery names its source asset
const missingSourceAsset: CrossChainSolanaOriginTransaction = {
  sourceChains: [solanaDevnet],
  targetChain: base,
  tokenRequests: [{ address: usdcOnBase }],
}
const legacySourceTokens = {
  ...maxOutFromSolana,
  // @ts-expect-error `sourceTokens` was replaced by `sourceAssets`
  sourceTokens: [{ address: mint }],
} satisfies CrossChainSolanaOriginTransaction
const twoSourceAssets = {
  ...maxOutFromSolana,
  // @ts-expect-error a delivery spends exactly one source asset
  sourceAssets: [sourceCap, sourceCap],
} satisfies CrossChainSolanaOriginTransaction
const evmSourceAsset = {
  ...maxOutFromSolana,
  // @ts-expect-error a Solana source asset is on a Solana cluster
  sourceAssets: [{ chain: base, address: mint }],
} satisfies CrossChainSolanaOriginTransaction

const metadata: SolanaExecutionMetadata = {
  kind: 'solana',
  namespace: 'prod-v1',
  endpoint: 'https://orchestrator.example',
  chain: 792703810,
  caip2: solanaDevnet.caip2,
  accountAddress: recipient,
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
  accountAddress: recipient,
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
  accountAddress: recipient,
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

const swig = mint
const standaloneConfig: SolanaStandaloneAccountConfig = {
  owner: { type: 'ecdsa', account: owner },
  swig,
}
// @ts-expect-error every managed Solana account must name its existing Swig state account
const implicitConfig: SolanaStandaloneAccountConfig = {
  owner: { type: 'ecdsa', account: owner },
}
void implicitConfig

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
  account.prepareTransaction({
    ...deliveryFromSolana,
    recipient: owner.address,
    // @ts-expect-error nor an EVM account to run destination calls
    calls: [{ to: usdcOnBase, data: '0x' }],
  })
  // @ts-expect-error an account with no EVM entry cannot run EVM calls
  account.prepareTransaction({ chain: mainnet, calls: [] })
  // @ts-expect-error nor fund a delivery from EVM sources
  account.prepareTransaction(deliveryTransaction)
  // @ts-expect-error EVM is not configured
  account.getAddress('evm')
  // @ts-expect-error EVM management is unavailable
  account.deploy('evm', mainnet)
  // The Swig itself is created with the id it was minted with.
  const minted: { id: Hex; swig: typeof swig; wallet: typeof swig } =
    createSolanaSwigId()
  const created: boolean = await account.deploy('solana', solanaDevnet, {
    swigId: minted.id,
  })
  // @ts-expect-error without managed EVM the Swig is independent, so its id is required
  account.deploy('solana', solanaDevnet)
  // @ts-expect-error the Swig id is 0x-prefixed hex
  account.deploy('solana', solanaDevnet, { swigId: '07'.repeat(32) })
  // @ts-expect-error creation is always sponsored
  account.deploy('solana', solanaDevnet, { sponsored: false })
  // @ts-expect-error the VM is named first
  account.deploy(solanaDevnet, { swigId: minted.id })
  account.prepareTransaction(authorityTransaction)
  account.prepareTransaction({
    chain: solanaDevnet,
    authority: removePasskey(passkeyKey),
  })
  account.prepareTransaction(ecdsaTransaction)
  const authorityStatus: SolanaAuthorityStatus =
    await account.getAuthorityStatus(ecdsaTransaction)
  if (authorityStatus.status === 'conflict') {
    const conflictingRole: number = authorityStatus.roleId
    const held: SolanaAuthorityPermission | undefined =
      authorityStatus.permission
    void conflictingRole
    void held
  } else if (authorityStatus.status === 'applied') {
    const appliedRole: number | undefined = authorityStatus.roleId
    void appliedRole
  }
  // @ts-expect-error only an authority change has a status
  account.getAuthorityStatus(solanaTransaction)

  const handle: SolanaStandaloneAccount<{ solana: typeof standaloneConfig }> =
    account
  const prepared = await handle.prepareTransaction(solanaTransaction)
  const requests: SigningRequest[] = handle.getTransactionMessages(prepared)
  const signed = await handle.signTransaction(prepared, { intentId: 'id' })
  const status = await handle.waitForExecution(
    await handle.submitTransaction(signed),
  )
  // @ts-expect-error one owner signs every spend, so there is nothing to assemble
  handle.assembleTransaction(prepared, [])
  // @ts-expect-error a Solana spend asks for no EIP-7702 authorizations
  handle.signAuthorizations(prepared)
  // @ts-expect-error nor signs as one of several independent owners
  handle.signTransaction(prepared, { owner })
  // @ts-expect-error nor takes submission options
  handle.submitTransaction(signed, { internal_dryRun: true })

  const paired = await sdk.createAccount({
    evm: { owners: { type: 'ecdsa' as const, accounts: [owner] } },
    solana: standaloneConfig,
  })
  paired.prepareTransaction(deliveryFromSolanaWithCalls)

  const receiverPaired = await sdk.createAccount({
    evm: { address: owner.address },
    solana: standaloneConfig,
  })
  const receiverAddress: Address = receiverPaired.getAddress('evm')
  receiverPaired.prepareTransaction(deliveryFromSolana)
  receiverPaired.deploy('solana', solanaDevnet, {
    swigId: `0x${'07'.repeat(32)}`,
  })
  receiverPaired.prepareTransaction({
    ...deliveryFromSolana,
    // @ts-expect-error an address-only receiver cannot execute destination calls
    calls: [{ to: usdcOnBase, data: '0x' }],
  })
  // @ts-expect-error an address-only receiver cannot fund an EVM transaction
  receiverPaired.prepareTransaction({ chain: mainnet, calls: [] })
  void receiverAddress

  void wallet
  void requests
  void status
  void created
}

async function compositeCapabilitySurface() {
  const sdk = new RhinestoneSDK({ apiKey: 'types', useDevContracts: true })
  const account = await sdk.createAccount({
    evm: { owners: { type: 'ecdsa', accounts: [owner] } },
    solana: standaloneConfig,
  })

  const evmAddress: Address = account.getAddress('evm')
  const solanaAddressValue: typeof recipient = account.getAddress('solana')
  account.prepareTransaction(solanaTransaction)
  account.prepareTransaction(instructionTransaction)
  account.prepareTransaction(authorityTransaction)
  await account.getAuthorityStatus(ecdsaTransaction)
  account.prepareTransaction(deliveryFromSolana)
  account.prepareTransaction(maxOutFromSolana)
  account.prepareTransaction(deliveryFromSolanaWithCalls)
  // The same request written inline, which is how integrators write it.
  account.prepareTransaction({
    sourceChains: [solanaDevnet],
    sourceAssets: [{ chain: solanaDevnet, address: mint, amount: 1n }],
    targetChain: base,
    tokenRequests: [{ address: usdcOnBase }],
    recipient: owner.address,
  })
  account.prepareTransaction(cappedMaxOutFromSolana)
  account.prepareTransaction(nativeSolFromSolana)
  account.prepareTransaction(cappedTransfer)
  account.prepareTransaction(deliveryTransaction)
  account.prepareTransaction(defaultedDelivery)
  account.prepareTransaction({ chain: mainnet, calls: [] })
  // `deploy` names its VM: EVM deploys the smart account, Solana creates the
  // Swig, whose id the SDK computes when it is derived from the EVM account.
  const evmDeployed: boolean = await account.deploy('evm', mainnet, {
    sponsored: true,
  })
  const swigCreated: boolean = await account.deploy('solana', solanaDevnet)
  account.deploy('solana', solanaDevnet, { swigId: `0x${'07'.repeat(32)}` })
  // @ts-expect-error the Solana cluster takes a Swig id, not EVM sponsorship
  account.deploy('solana', solanaDevnet, { sponsored: true })
  // @ts-expect-error an EVM deployment takes an EVM chain
  account.deploy('evm', solanaDevnet)
  // @ts-expect-error a Swig is created on a Solana cluster
  account.deploy('solana', mainnet)
  // @ts-expect-error the VM is named first
  account.deploy(mainnet)

  const evmOnly = await sdk.createAccount({
    evm: { owners: { type: 'ecdsa', accounts: [owner] } },
  })
  evmOnly.deploy('evm', mainnet)
  // @ts-expect-error an account with no managed Solana entry has no Swig to create
  evmOnly.deploy('solana', solanaDevnet)

  const messages = account.getTransactionMessages(
    null as unknown as Parameters<typeof account.getTransactionMessages>[0],
  )
  // Ordered requests, not role-keyed payloads: position is the identity of the
  // authorisation, and a proof is submitted per entry in this order.
  const requests: SigningRequest[] = messages
  const firstPurpose: SigningRequest['purpose'] | undefined =
    messages[0]?.purpose

  void evmAddress
  void evmDeployed
  void swigCreated
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

// Calls run on the account's own EVM account once the delivery lands.
const deliveryFromSolanaWithCalls = {
  ...deliveryFromSolana,
  calls: [{ to: usdcOnBase, data: '0x' }],
  gasLimit: 200_000n,
  eip7702InitSignature: '0x12',
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
const forbiddenInstructionSourceAssets = {
  ...instructionTransaction,
  // @ts-expect-error the orchestrator refuses source limits on instructions
  sourceAssets: [sourceCap],
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

// A Swig passkey add or remove, built from a WebAuthn key or any P-256 encoding.
const passkeyKey = `0x02${'11'.repeat(32)}` as Hex
const permission: SolanaPasskeyPermission = 'allButManageAuthority'
const authorityTransaction = {
  chain: solanaDevnet,
  authority: addPasskey(passkeyKey, { permission }),
} satisfies SameChainSolanaAuthorityTransaction
const literalAuthority = {
  chain: solanaDevnet,
  authority: {
    action: 'remove',
    key: { type: 'passkey', publicKey: passkeyKey },
  },
} satisfies SameChainSolanaAuthorityTransaction
const addChange: SolanaAuthorityChange = addPasskey(passkeyKey, {
  permission: 'all',
})
// @ts-expect-error adding a passkey requires a permission
addPasskey(passkeyKey)
// A passkey may also be a manage-only role.
addPasskey(passkeyKey, { permission: 'manageAuthority' })
// @ts-expect-error nor takes any other permission
addPasskey(passkeyKey, { permission: 'programAll' })

// A secp256k1 key, from a local account or its public key; never an address.
declare const localSigner: import('viem').LocalAccount
const ecdsaTransaction = {
  chain: solanaDevnet,
  authority: addEcdsaKey(localSigner, { permission: 'manageAuthority' }),
} satisfies SameChainSolanaAuthorityTransaction
const ecdsaChange: SolanaAuthorityChange = removeEcdsaKey(passkeyKey)
const literalEcdsa = {
  chain: solanaDevnet,
  authority: {
    action: 'add',
    key: { type: 'ecdsa', publicKey: passkeyKey },
    permission: 'allButManageAuthority',
  },
} satisfies SameChainSolanaAuthorityTransaction
// @ts-expect-error adding an ECDSA key requires a permission
addEcdsaKey(passkeyKey)
// @ts-expect-error removing one takes no permission
removeEcdsaKey(passkeyKey, { permission: 'all' })
const deprecatedAlias: SolanaAuthorityPermission = permission
// @ts-expect-error removing a passkey takes no permission
removePasskey(passkeyKey, { permission: 'all' })
const forbiddenRemovePermission = {
  chain: solanaDevnet,
  authority: {
    action: 'remove',
    key: { type: 'passkey', publicKey: passkeyKey },
    // @ts-expect-error a removal carries no permission
    permission: 'all',
  },
} satisfies SameChainSolanaAuthorityTransaction
const forbiddenAuthorityInstructions = {
  ...authorityTransaction,
  // @ts-expect-error an authority change runs no caller instructions
  instructions: [jupiterInstruction],
} satisfies SameChainSolanaAuthorityTransaction
const forbiddenInstructionAuthority = {
  ...instructionTransaction,
  // @ts-expect-error nor does an instruction execution change authorities
  authority: addChange,
} satisfies SameChainSolanaInstructionsTransaction
const forbiddenTransferAuthority = {
  ...solanaTransaction,
  // @ts-expect-error nor does a transfer
  authority: addChange,
} satisfies SameChainSolanaTransaction
const forbiddenAuthorityTokens = {
  ...authorityTransaction,
  // @ts-expect-error an authority change is tokenless
  tokenRequests: [{ address: mint, amount: 1n }],
} satisfies SameChainSolanaAuthorityTransaction
const forbiddenAuthoritySponsorship = {
  ...authorityTransaction,
  // @ts-expect-error an authority change is always sponsored
  sponsored: false,
} satisfies SameChainSolanaAuthorityTransaction

const authorityMetadata: SolanaAuthorityExecutionMetadata = {
  kind: 'solana-authority',
  namespace: 'dev-v1',
  endpoint: 'https://orchestrator.example',
  chain: 792703810,
  caip2: solanaDevnet.caip2,
  accountAddress: recipient,
  authority: owner.address,
  swigAddress: recipient,
  walletAddress: recipient,
  action: 'remove',
  keyType: 'passkey',
  key: passkeyKey,
}

declare const preparedExecution: NonNullable<
  Awaited<
    ReturnType<SolanaStandaloneAccount['prepareTransaction']>
  >['execution']
>
if (preparedExecution.kind === 'solana-authority') {
  const changed: 'add' | 'remove' = preparedExecution.action
  const key: Hex = preparedExecution.key
  void changed
  void key
}

declare const disclosure: SolanaAuthorityDisclosure
const rentLamports: string = disclosure.rent.amount
const addedRole: number = disclosure.roleId
if (solanaSpendRequest.scope.action === 'spend') {
  void solanaSpendRequest.scope.addressLookupTables
}
declare const anyRequest: SigningRequest
if (
  anyRequest.scope.vm === 'svm' &&
  anyRequest.scope.action === 'manageAuthority'
) {
  const signed: SolanaAuthorityDisclosure = anyRequest.scope.authority
  void signed
}

declare const refusal: unknown
if (isSolanaAuthorityChangeRefused(refusal)) {
  const reason: SolanaAuthorityChangeRefusalReason | undefined = refusal.reason
  const roleId: number | undefined = refusal.roleId
  const roleIds: number[] | undefined = refusal.roleIds
  const existing: SolanaPasskeyPermission | undefined = refusal.permission
  const swigAddress: string | undefined = refusal.swigAddress
  void reason
  void roleId
  void roleIds
  void existing
  void swigAddress
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
type WaitedStatus = Awaited<
  ReturnType<SolanaStandaloneAccount['waitForExecution']>
>
const deploymentPurpose: WaitedStatus['purpose'] = 'deployment'

void compositeCapabilitySurface
void literalAuthority
void ecdsaChange
void literalEcdsa
void deprecatedAlias
void forbiddenRemovePermission
void forbiddenAuthorityInstructions
void forbiddenInstructionAuthority
void forbiddenTransferAuthority
void forbiddenAuthorityTokens
void forbiddenAuthoritySponsorship
void authorityMetadata
void rentLamports
void addedRole
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
void forbiddenInstructionSourceAssets
void uncappedSourceTransfer
void missingSourceAsset
void legacySourceTokens
void twoSourceAssets
void evmSourceAsset
void sponsoredInstructions
void sponsoredInstructionCategories
void forbiddenTransferInstructions
void forbiddenTransferLookupTables
void forbiddenDeliveryLookupTables
void deliveryFromSolanaWithCalls
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
void deploymentPurpose
