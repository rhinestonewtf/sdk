// The nested transaction shape: one `source` that funds one `destination`.
import type { Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arbitrum, base, hyperEvm } from 'viem/chains'
import type { WireEstimateRequest } from '../../src/clients/orchestrator/wire'
import type {
  CrossChainNonEvmTransaction,
  CrossChainSolanaTransaction,
  EvmTransaction,
  HyperCoreTransaction,
} from '../../src/config/account'
import type {
  EvmDeployOptions,
  EvmSetupOptions,
  Transaction,
  TransactionDestination,
  TransactionSource,
} from '../../src/index'
import { hyperCorePerp, RhinestoneSDK, tronMainnet } from '../../src/index'
import {
  addPasskey,
  type CrossChainSolanaOriginTransaction,
  type SameChainSolanaAuthorityTransaction,
  type SameChainSolanaInstructionsTransaction,
  type SameChainSolanaTransaction,
  solanaAddress,
  solanaDevnet,
} from '../../src/solana/index'

const owner = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const usdcOnBase = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' as const
const usdcOnArbitrum = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const
const usdcOnHyperEvm = '0xb88339CB7199b77E23DB6E890353E22632Ba630f' as const
const mint = solanaAddress('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU')
const solanaRecipient = solanaAddress(
  'Vote111111111111111111111111111111111111111',
)

// --- positive cases ---------------------------------------------------

// Funded same-chain delivery: `source.chain` omitted, defaults to
// `destination.chain`.
const fundedSameChain = {
  source: { token: usdcOnBase },
  destination: { chain: base, token: usdcOnBase, amount: 1_000_000n },
} satisfies EvmTransaction

// Funded cross-chain delivery: `source.chain` names the origin explicitly.
const fundedCrossChain = {
  source: { chain: arbitrum, token: usdcOnArbitrum },
  destination: { chain: base, token: usdcOnBase, amount: 1_000_000n },
} satisfies EvmTransaction

// Max-output: a token without an amount takes everything the source yields.
const maxOutput = {
  source: { chain: arbitrum, token: usdcOnArbitrum },
  destination: { chain: base, token: usdcOnBase },
} satisfies EvmTransaction

// `source.chain` shorthand: an explicit same-chain source is equivalent to
// omitting `chain` entirely.
const explicitSameChainSource = {
  source: { chain: base, token: usdcOnBase },
  destination: { chain: base, token: usdcOnBase },
} satisfies EvmTransaction
const implicitSameChainSource = {
  source: { token: usdcOnBase },
  destination: { chain: base, token: usdcOnBase },
} satisfies EvmTransaction
const shorthandEquivalence: TransactionSource['chain'] =
  explicitSameChainSource.source.chain ??
  implicitSameChainSource.destination.chain

// Unsponsored same-chain calls: a token-less execution still needs a source
// to pay for it.
const unsponsoredCallsWithSource = {
  source: { token: usdcOnBase },
  destination: { chain: base, calls: [{ to: usdcOnBase, data: '0x' }] },
} satisfies EvmTransaction

// Sponsored source-free calls: gas sponsorship covers an execution that
// spends nothing.
const sponsoredSourceFreeCalls = {
  destination: { chain: base, calls: [{ to: usdcOnBase, data: '0x' }] },
  sponsored: true,
} satisfies EvmTransaction

// HyperCore: the source names its EVM chain explicitly, since HyperCore
// hosts no account of its own.
const hyperCoreWithSource = {
  source: { chain: hyperEvm, token: usdcOnHyperEvm },
  destination: {
    chain: hyperCorePerp,
    hyperCore: { closePerp: { asset: 'BTC' } },
  },
} satisfies HyperCoreTransaction

// Solana instructions, sponsored and source-free.
const sponsoredSolanaInstructions = {
  destination: {
    chain: solanaDevnet,
    instructions: [
      {
        programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        accounts: [{ pubkey: mint, isSigner: false, isWritable: true }],
        data: 'AQID',
      },
    ],
  },
  sponsored: true,
} satisfies SameChainSolanaInstructionsTransaction

// Solana instructions, unsponsored: `source.token` names the fee token.
const unsponsoredSolanaInstructions = {
  source: { token: mint },
  destination: {
    chain: solanaDevnet,
    instructions: [
      {
        programId: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
        accounts: [{ pubkey: mint, isSigner: false, isWritable: true }],
        data: 'AQID',
      },
    ],
  },
} satisfies SameChainSolanaInstructionsTransaction

// Solana authority change: no source, no sponsorship.
const passkeyKey = `0x02${'11'.repeat(32)}` as Hex
const solanaAuthorityChange = {
  destination: {
    chain: solanaDevnet,
    authority: addPasskey(passkeyKey, { permission: 'all' }),
  },
} satisfies SameChainSolanaAuthorityTransaction

// deploy/setup options.
const deployUnsponsoredWithSource = {
  source: { token: usdcOnBase },
} satisfies EvmDeployOptions
const deploySponsored = { sponsored: true } satisfies EvmDeployOptions
const setupWithSource = {
  source: { token: usdcOnBase },
} satisfies EvmSetupOptions

async function deploySetupSurface() {
  const sdk = new RhinestoneSDK({ apiKey: 'types' })
  const account = await sdk.createAccount({
    evm: { owners: { type: 'ecdsa', accounts: [owner] } },
  })
  const deployed: boolean = await account.deploy('evm', base, deploySponsored)
  const deployedWithSource: boolean = await account.deploy(
    'evm',
    base,
    deployUnsponsoredWithSource,
  )
  const setUp: boolean = await account.setup(base, setupWithSource)
  void deployed
  void deployedWithSource
  void setUp
}
void deploySetupSurface

// --- negative cases -----------------------------------------------------

// An amount without a token on an EVM destination is meaningless.
const amountWithoutToken = {
  source: { token: usdcOnBase },
  // @ts-expect-error `amount` requires `token` on the same destination
  destination: { chain: base, amount: 1_000_000n },
} satisfies EvmTransaction

// Obsolete top-level fields are refused by name, one at a time.
const obsoleteTokenRequests = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `destination.token`/`destination.amount`
  tokenRequests: [{ address: usdcOnBase, amount: 1n }],
} satisfies Transaction
const obsoleteTargetChain = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `destination.chain`
  targetChain: base,
} satisfies Transaction
const obsoleteSourceChains = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `source.chain`
  sourceChains: [arbitrum],
} satisfies Transaction
const obsoleteSourceAssets = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `source.token`/`source.maxAmount`
  sourceAssets: [{ chain: arbitrum, address: usdcOnArbitrum }],
} satisfies Transaction
const obsoleteSourceCalls = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `source.calls`
  sourceCalls: { [base.id]: [{ to: usdcOnBase, data: '0x' }] },
} satisfies Transaction
const obsoleteAuxiliaryFunds = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `source.auxiliaryFunds`
  auxiliaryFunds: { [base.id]: { [usdcOnBase]: 1n } },
} satisfies Transaction
const obsoleteChain = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `destination.chain`
  chain: base,
} satisfies Transaction
const obsoleteCalls = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `destination.calls`
  calls: [{ to: usdcOnBase, data: '0x' }],
} satisfies Transaction
const obsoleteRecipient = {
  destination: { chain: base, token: usdcOnBase },
  // @ts-expect-error replaced by `destination.recipient`
  recipient: owner.address,
} satisfies Transaction

// Cross-chain `customDeadline` is refused on a HyperCore destination.
const crossChainDeadlineOnHyperCore = {
  source: { chain: hyperEvm, token: usdcOnHyperEvm },
  destination: {
    chain: hyperCorePerp,
    hyperCore: { closePerp: { asset: 'BTC' } },
  },
  // @ts-expect-error a HyperCore destination takes no custom deadline
  customDeadline: 9_999_999_999,
} satisfies HyperCoreTransaction

// Cross-chain `customDeadline` is refused on a Tron destination.
const crossChainDeadlineOnTron = {
  source: { chain: base, token: usdcOnBase },
  destination: { chain: tronMainnet, token: usdcOnBase, recipient: usdcOnBase },
  // @ts-expect-error a Tron destination takes no custom deadline
  customDeadline: 9_999_999_999,
} satisfies CrossChainNonEvmTransaction

// Cross-chain `customDeadline` is refused on a Solana destination.
const crossChainDeadlineOnSolana = {
  source: { chain: base, token: usdcOnBase },
  destination: { chain: solanaDevnet, token: mint },
  // @ts-expect-error a Solana destination takes no custom deadline
  customDeadline: 9_999_999_999,
} satisfies CrossChainSolanaTransaction

// An SVM source carries no `auxiliaryFunds` or `calls` \u2014 EVM-only fields.
const svmSourceWithAuxiliaryFunds = {
  source: {
    token: mint,
    // @ts-expect-error a Solana source carries no auxiliary funds
    auxiliaryFunds: 1_000_000n,
  },
  destination: { chain: solanaDevnet, token: mint, recipient: solanaRecipient },
} satisfies SameChainSolanaTransaction
const svmSourceWithCalls = {
  source: {
    token: mint,
    // @ts-expect-error a Solana source carries no calls
    calls: [],
  },
  destination: { chain: solanaDevnet, token: mint, recipient: solanaRecipient },
} satisfies SameChainSolanaTransaction

// `hyperCore` is refused on a non-HyperCore destination.
const hyperCoreOnEvmDestination = {
  source: { token: usdcOnBase },
  destination: {
    chain: base,
    // @ts-expect-error `hyperCore` only applies to a HyperCore destination
    hyperCore: { closePerp: { asset: 'BTC' } },
  },
} satisfies EvmTransaction

// An authority change carries no `source` and is never explicitly sponsored.
const authorityWithSource = {
  // @ts-expect-error an authority change carries no source
  source: { token: mint },
  destination: {
    chain: solanaDevnet,
    authority: addPasskey(passkeyKey, { permission: 'all' }),
  },
} satisfies SameChainSolanaAuthorityTransaction
const authorityWithSponsorship = {
  destination: {
    chain: solanaDevnet,
    authority: addPasskey(passkeyKey, { permission: 'all' }),
  },
  // @ts-expect-error an authority change is always sponsored, never chosen
  sponsored: false,
} satisfies SameChainSolanaAuthorityTransaction

// Account-branch gating: a Solana-only account cannot prepare an EVM-origin
// transaction, and an EVM-only account cannot prepare a Solana-origin one.
async function accountBranchGating() {
  const sdk = new RhinestoneSDK({ apiKey: 'types' })
  const solanaOnly = await sdk.createAccount({
    solana: { address: solanaRecipient },
  })
  // @ts-expect-error a Solana-only account has no EVM entry to originate from
  solanaOnly.prepareTransaction(fundedSameChain)

  const evmOnly = await sdk.createAccount({
    evm: { owners: { type: 'ecdsa', accounts: [owner] } },
  })
  // @ts-expect-error an EVM-only account has no Solana entry to originate from
  evmOnly.prepareTransaction(unsponsoredSolanaInstructions)
}
void accountBranchGating

void fundedSameChain
void fundedCrossChain
void maxOutput
void explicitSameChainSource
void implicitSameChainSource
void shorthandEquivalence
void unsponsoredCallsWithSource
void sponsoredSourceFreeCalls
void hyperCoreWithSource
void sponsoredSolanaInstructions
void unsponsoredSolanaInstructions
void solanaAuthorityChange
void amountWithoutToken
void obsoleteTokenRequests
void obsoleteTargetChain
void obsoleteSourceChains
void obsoleteSourceAssets
void obsoleteSourceCalls
void obsoleteAuxiliaryFunds
void obsoleteChain
void obsoleteCalls
void obsoleteRecipient
void crossChainDeadlineOnHyperCore
void crossChainDeadlineOnTron
void crossChainDeadlineOnSolana
void svmSourceWithAuxiliaryFunds
void svmSourceWithCalls
void hyperCoreOnEvmDestination
void authorityWithSource
void authorityWithSponsorship
export type { TransactionDestination, CrossChainSolanaOriginTransaction }

// The estimate endpoint's singular branch; the SDK has no estimate method, so
// only this fixture pins it.
type SingularEstimate = Extract<
  WireEstimateRequest,
  { source: { vm: string; amount?: string } }
>
const estimate: SingularEstimate = {
  account: { evm: { type: 'eoa' } },
  source: { vm: 'evm', chainId: 'eip155:1', token: 'USDC', amount: '1000000' },
  destination: { vm: 'evm', chainId: 'eip155:8453', token: 'USDC' },
}
void estimate
