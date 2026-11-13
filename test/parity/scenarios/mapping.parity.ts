import { encodeFunctionData, erc20Abi } from 'viem'
import { describe, it } from 'vitest'
import type { SdkAccount } from '../builds'
import type { Layer } from '../canonical/types'
import {
  BURN_ADDRESS,
  NATIVE_TOKEN,
  USDC_BASE_SEPOLIA,
  WETH_BASE_SEPOLIA,
} from '../fixtures'
import { fixturePasskey } from '../funded/fixtures'
import { assertParity } from '../harness'
import { defineScenario, type ScenarioContext } from '../scenario'
import {
  attempts,
  auxiliaryUsdc,
  CUSTOM_DEADLINE,
  crossChain,
  crossChainToPayee,
  type FixtureKind,
  fixtureAccount,
  PAYEE_ADDRESS,
} from './shared'

// Every mapping scenario quotes against empty fixture accounts with declared
// auxiliary funds; submits are captured. Cross-chain transfers go to a payee
// so both API versions plan the same route (`crossChainToPayee`).

// No Quorum Signer validator on testnets; quoted and captured only.
const QUORUM_MODULE = '0x0000000000000000000000000000000000000001'

const REQUEST_LAYERS: Layer[] = ['quoteRequest', 'errors', 'traffic']
const SIGNED_LAYERS: Layer[] = [
  'quoteRequest',
  'typedData',
  'signatures',
  'submitRequest',
  'traffic',
]

function prepare(account: SdkAccount, transaction: Record<string, unknown>) {
  return () => account.prepareTransaction(transaction)
}

function tokenless(ctx: ScenarioContext, overrides: Record<string, unknown>) {
  return {
    chain: ctx.chains.baseSepolia,
    calls: [{ to: BURN_ADDRESS, data: '0x', value: 0n }],
    ...overrides,
  }
}

async function signAndCapture(
  ctx: ScenarioContext,
  account: SdkAccount,
  transaction: Record<string, unknown>,
) {
  const prepared = await ctx.step(
    'prepare',
    'prepare',
    prepare(account, transaction),
  )
  await ctx.step('messages', 'messages', () =>
    account.getTransactionMessages(prepared),
  )
  const signed = await ctx.step('sign', 'sign', () =>
    account.signTransaction(prepared),
  )
  await ctx.step('submit', 'submit', () => account.submitTransaction(signed))
}

const crossChainOptions = defineScenario({
  id: 'mapping/cross-chain-options',
  description:
    'Quotes setting one transaction option each: cross-chain to a payee with token by symbol, max-out, app and protocol fees, fee asset, lock funds and gas limit; full and partial sponsorship on a same-chain transfer to the payee',
  goldenLayers: REQUEST_LAYERS,
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'nexus')
    const tx = (overrides: Record<string, unknown>) =>
      prepare(account, crossChainToPayee(ctx, overrides))
    // Blanc delivers sponsored CCTP through Rhinestone's relayer even to a
    // payee, so sponsorship is compared on a same-chain transfer.
    const sponsoredTx = (sponsored: unknown) =>
      prepare(account, {
        chain: ctx.chains.baseSepolia,
        recipient: PAYEE_ADDRESS,
        tokenRequests: [{ address: USDC_BASE_SEPOLIA, amount: 100_000n }],
        auxiliaryFunds: auxiliaryUsdc(ctx),
        sponsored,
      })
    await attempts(ctx, [
      [
        'token-symbol',
        'prepare',
        tx({ tokenRequests: [{ address: 'USDC', amount: 100_000n }] }),
      ],
      [
        'max-out',
        'prepare',
        tx({
          tokenRequests: [
            {
              address: ctx.build.root.getTokenAddress(
                'USDC',
                ctx.chains.arbitrumSepolia.id,
              ),
            },
          ],
        }),
      ],
      ['sponsored-all', 'prepare', sponsoredTx(true)],
      [
        'sponsored-partial',
        'prepare',
        sponsoredTx({
          gas: true,
          bridging: false,
          swaps: true,
          protocolFees: false,
        }),
      ],
      ['app-fees', 'prepare', tx({ appFees: { feeBps: 10 } })],
      ['protocol-fees', 'prepare', tx({ protocolFees: { feeBps: 5 } })],
      ['fee-asset', 'prepare', tx({ feeAsset: 'USDC' })],
      ['lock-funds', 'prepare', tx({ lockFunds: true })],
      ['gas-limit', 'prepare', tx({ gasLimit: 200_000n })],
    ])
  },
})

const crossChainRouting = defineScenario({
  id: 'mapping/cross-chain-routing',
  description:
    'Cross-chain quotes to a payee setting recipient (address and account), a CCTP settlement-layer pin, a quoter filter, source calls, an account setup-ops override and a native-token request',
  goldenLayers: REQUEST_LAYERS,
  async run(ctx) {
    const { baseSepolia, arbitrumSepolia } = ctx.chains
    const account = await fixtureAccount(ctx, 'nexus')
    const tx = (overrides: Record<string, unknown>) =>
      prepare(account, crossChainToPayee(ctx, overrides))
    await attempts(ctx, [
      ['recipient-address', 'prepare', tx({ recipient: BURN_ADDRESS })],
      [
        'recipient-account',
        'prepare',
        tx({
          recipient: {
            owners: { type: 'ecdsa', accounts: [ctx.signer('ownerB')] },
          },
        }),
      ],
      ['settlement-layers', 'prepare', tx({ settlementLayers: ['CCTP'] })],
      ['quoters', 'prepare', tx({ quoters: { exclude: ['bebop'] } })],
      [
        'source-calls',
        'prepare',
        tx({
          sourceCalls: {
            [baseSepolia.id]: [
              {
                to: USDC_BASE_SEPOLIA,
                data: encodeFunctionData({
                  abi: erc20Abi,
                  functionName: 'approve',
                  args: [BURN_ADDRESS, 1n],
                }),
              },
            ],
          },
        }),
      ],
      [
        'account-override',
        'prepare',
        tx({ experimental_accountOverride: { setupOps: [] } }),
      ],
      [
        'native-token',
        'prepare',
        tx({
          tokenRequests: [
            {
              address: ctx.build.root.getTokenAddress(
                'ETH',
                arbitrumSepolia.id,
              ),
              amount: 1_000_000_000_000n,
            },
          ],
          auxiliaryFunds: {
            [baseSepolia.id]: { [NATIVE_TOKEN]: 10_000_000_000_000_000n },
          },
        }),
      ],
    ])
  },
})

const sourceSelection = defineScenario({
  id: 'mapping/source-selection',
  description:
    'Cross-chain quotes to a payee for each way of choosing sources: no source chains, a token list with and without chains, a per-chain token map and exact inputs with and without an amount',
  goldenLayers: REQUEST_LAYERS,
  async run(ctx) {
    const { baseSepolia } = ctx.chains
    const account = await fixtureAccount(ctx, 'nexus')
    const tx = (overrides: Record<string, unknown>) =>
      prepare(account, crossChainToPayee(ctx, overrides))
    await attempts(ctx, [
      ['source-chains-omitted', 'prepare', tx({ sourceChains: undefined })],
      ['source-assets-list', 'prepare', tx({ sourceAssets: ['USDC'] })],
      [
        'source-assets-list-no-chains',
        'prepare',
        tx({ sourceChains: undefined, sourceAssets: ['USDC'] }),
      ],
      [
        'source-assets-chain-map',
        'prepare',
        tx({
          sourceChains: undefined,
          sourceAssets: { [baseSepolia.id]: ['USDC'] },
        }),
      ],
      [
        'source-assets-exact',
        'prepare',
        tx({
          sourceChains: undefined,
          sourceAssets: [
            { chain: baseSepolia, address: 'USDC', amount: 200_000n },
          ],
        }),
      ],
      [
        'source-assets-exact-no-amount',
        'prepare',
        tx({
          sourceChains: undefined,
          sourceAssets: [{ chain: baseSepolia, address: 'USDC' }],
        }),
      ],
    ])
  },
})

const sameChain = defineScenario({
  id: 'mapping/same-chain',
  description:
    'Same-chain quotes on Base Sepolia: a transfer to a recipient, a USDC → WETH swap (rejected: no testnet swap venue, but the request is still compared) and the tokenless route with destination calls, sponsored, with auxiliary funds and with a custom deadline',
  goldenLayers: REQUEST_LAYERS,
  // The deadline is relative to the run's start time.
  goldenIgnore: [
    '/quoteRequest/tokenless-custom-deadline/options/customDeadline',
  ],
  async run(ctx) {
    const { baseSepolia } = ctx.chains
    const account = await fixtureAccount(ctx, 'nexus')
    await attempts(ctx, [
      [
        'transfer-to-recipient',
        'prepare',
        prepare(account, {
          chain: baseSepolia,
          recipient: BURN_ADDRESS,
          tokenRequests: [{ address: USDC_BASE_SEPOLIA, amount: 100_000n }],
          auxiliaryFunds: auxiliaryUsdc(ctx),
        }),
      ],
      [
        'swap',
        'prepare',
        prepare(account, {
          chain: baseSepolia,
          tokenRequests: [
            { address: WETH_BASE_SEPOLIA, amount: 10_000_000_000_000n },
          ],
          auxiliaryFunds: auxiliaryUsdc(ctx),
        }),
      ],
      [
        'tokenless-sponsored',
        'prepare',
        prepare(account, tokenless(ctx, { sponsored: true })),
      ],
      [
        'tokenless-auxiliary-funds',
        'prepare',
        prepare(
          account,
          tokenless(ctx, { auxiliaryFunds: auxiliaryUsdc(ctx) }),
        ),
      ],
      [
        'tokenless-custom-deadline',
        'prepare',
        prepare(
          account,
          tokenless(ctx, { sponsored: true, customDeadline: CUSTOM_DEADLINE }),
        ),
      ],
    ])
  },
})

const tokenlessSignSubmit = defineScenario({
  id: 'mapping/tokenless-sign-submit',
  description:
    'Sponsored tokenless same-chain calls on Base Sepolia: quote, messages, sign and captured submit',
  goldenLayers: SIGNED_LAYERS,
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'nexus')
    await signAndCapture(ctx, account, tokenless(ctx, { sponsored: true }))
  },
})

const sessions = defineScenario({
  id: 'mapping/sessions',
  description:
    'Session signers on a sessions-enabled account, paying a payee cross-chain: one session on the target chain, and per-chain sessions with execution verification and enable data (pre-claim operations, per-chain mock signatures, signature mode 5)',
  goldenLayers: REQUEST_LAYERS,
  async run(ctx) {
    const { baseSepolia, arbitrumSepolia } = ctx.chains
    const account = await fixtureAccount(ctx, 'sessions')
    const session = (chain: unknown) => ({
      chain,
      owners: { type: 'ecdsa', accounts: [ctx.signer('ownerB')] },
    })
    await attempts(ctx, [
      [
        'session-single',
        'prepare',
        prepare(
          account,
          crossChainToPayee(ctx, {
            signers: {
              type: 'experimental_session',
              session: session(arbitrumSepolia),
            },
          }),
        ),
      ],
      [
        'session-per-chain-enable',
        'prepare',
        prepare(
          account,
          crossChainToPayee(ctx, {
            signers: {
              type: 'experimental_session',
              verifyExecutions: true,
              sessions: {
                [baseSepolia.id]: {
                  session: session(baseSepolia),
                  enableData: {
                    userSignature: '0x1234',
                    hashesAndChainIds: [],
                    sessionToEnableIndex: 0,
                  },
                },
                [arbitrumSepolia.id]: { session: session(arbitrumSepolia) },
              },
            },
          }),
        ),
      ],
    ])
  },
})

function accountShape(kind: FixtureKind, label: string) {
  return defineScenario({
    id: `mapping/account-${kind === 'multiOwner' ? 'multi-owner' : kind}`,
    description: `${label}: cross-chain quote to a payee, messages, local signature and captured submit`,
    goldenLayers: SIGNED_LAYERS,
    async run(ctx) {
      const account = await fixtureAccount(ctx, kind)
      await signAndCapture(ctx, account, crossChainToPayee(ctx))
    },
  })
}

const accountMultiFactor = defineScenario({
  id: 'mapping/account-multi-factor',
  description:
    'Nexus with a 2-of-2 multi-factor owner (ECDSA and a software passkey): cross-chain quote to a payee, messages, local signature and captured submit',
  goldenLayers: SIGNED_LAYERS,
  async run(ctx) {
    // The software passkey signs deterministically; `ctx.passkey()` cannot
    // sign in Node.
    const account = await ctx.sdk().createAccount({
      owners: {
        type: 'multi-factor',
        validators: [
          { type: 'ecdsa', accounts: [ctx.signer('ownerA')] },
          { type: 'passkey', accounts: [fixturePasskey()] },
        ],
        threshold: 2,
      },
    })
    await signAndCapture(ctx, account, crossChainToPayee(ctx))
  },
})

const accountQuorum = defineScenario({
  id: 'mapping/account-quorum',
  description:
    'Nexus with a 2-of-2 quorum owner set: cross-chain quote to a payee, messages, local signature and captured submit',
  goldenLayers: SIGNED_LAYERS,
  async run(ctx) {
    const account = await ctx.sdk().createAccount({
      owners: {
        type: 'quorum',
        owners: [
          { account: ctx.signer('ownerA'), weight: 1n },
          { account: ctx.signer('ownerB'), weight: 1n },
        ],
        thresholdWeight: 2n,
        module: QUORUM_MODULE,
      },
    })
    await signAndCapture(ctx, account, crossChainToPayee(ctx))
  },
})

const accountEip7702 = defineScenario({
  id: 'mapping/account-eip7702',
  description:
    "Nexus via EIP-7702 on ownerA's EOA: init signature, quote to a payee with delegation, messages, sign, authorizations and captured submit",
  goldenLayers: SIGNED_LAYERS,
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'eip7702')
    const eip7702InitSignature = await ctx.step('init-signature', 'other', () =>
      account.signEip7702InitData(),
    )
    const prepared = await ctx.step(
      'prepare',
      'prepare',
      prepare(account, crossChainToPayee(ctx, { eip7702InitSignature })),
    )
    await ctx.step('messages', 'messages', () =>
      account.getTransactionMessages(prepared),
    )
    const signed = await ctx.step('sign', 'sign', () =>
      account.signTransaction(prepared),
    )
    const authorizations = await ctx.step('authorizations', 'other', () =>
      account.signAuthorizations(prepared),
    )
    await ctx.step('submit', 'submit', () =>
      account.submitTransaction(signed, authorizations),
    )
  },
})

// Into the account itself, the 7702 flow that also needs the target chain
// authorized. Over Across to OP Sepolia both versions plan the same route,
// unlike CCTP self-delivery, so authorizations are compared on equal plans.
const accountEip7702Self = defineScenario({
  id: 'mapping/account-eip7702-self',
  description:
    "Nexus via EIP-7702 on ownerA's EOA: Across quote into the account itself on OP Sepolia, sign, authorizations for the origin and target chains, captured submit",
  goldenLayers: SIGNED_LAYERS,
  async run(ctx) {
    const { optimismSepolia } = ctx.chains
    const account = await fixtureAccount(ctx, 'eip7702')
    const eip7702InitSignature = await ctx.step('init-signature', 'other', () =>
      account.signEip7702InitData(),
    )
    const prepared = await ctx.step(
      'prepare',
      'prepare',
      prepare(
        account,
        crossChain(ctx, {
          targetChain: optimismSepolia,
          tokenRequests: [
            {
              address: ctx.build.root.getTokenAddress(
                'USDC',
                optimismSepolia.id,
              ),
              amount: 100_000n,
            },
          ],
          settlementLayers: ['ACROSS'],
          eip7702InitSignature,
        }),
      ),
    )
    const signed = await ctx.step('sign', 'sign', () =>
      account.signTransaction(prepared),
    )
    const authorizations = await ctx.step('authorizations', 'other', () =>
      account.signAuthorizations(prepared),
    )
    await ctx.step('submit', 'submit', () =>
      account.submitTransaction(signed, authorizations),
    )
  },
})

const accountPasskey = defineScenario({
  id: 'mapping/account-passkey',
  description:
    'Nexus with a passkey owner: cross-chain quote to a payee only (passkey signing is covered by the funded scenarios)',
  goldenLayers: ['quoteRequest', 'traffic'],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'passkey')
    await ctx.step(
      'prepare',
      'prepare',
      prepare(account, crossChainToPayee(ctx)),
    )
  },
})

const SCENARIOS = [
  crossChainOptions,
  crossChainRouting,
  sourceSelection,
  sameChain,
  tokenlessSignSubmit,
  sessions,
  accountShape('safe', 'Safe'),
  accountShape('kernel', 'Kernel'),
  accountShape('startale', 'Startale'),
  accountShape('multiOwner', 'Nexus with a 2-of-2 ECDSA owner set'),
  accountMultiFactor,
  accountQuorum,
  accountShape(
    'eoa',
    'Plain EOA (ERC-2612 permit signatures in the submission)',
  ),
  accountEip7702,
  accountEip7702Self,
  accountPasskey,
]

describe.sequential('parity: request mapping', () => {
  for (const scenario of SCENARIOS) {
    it(scenario.id, () => assertParity(scenario))
  }
})
