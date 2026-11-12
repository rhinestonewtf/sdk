import { arbitrumSepolia, baseSepolia, optimismSepolia } from 'viem/chains'
import { describe } from 'vitest'
import {
  FIXTURES,
  fixtureSigner,
  NOOP_CALL,
  sessionConfig,
} from '../funded/fixtures'
import { parityTest } from '../harness'
import { defineScenario } from '../scenario'
import { execute, FUNDED_LAYERS, fixtureAccount } from './funded'

// Sponsored destination calls with no tokens: they prove each signing path
// executes without moving funds.

const undeployedNexus = defineScenario({
  id: 'funded/undeployed-nexus',
  description:
    'A fresh Nexus account per side (new salt), deployed by a sponsored no-op call on Base Sepolia with a custom deadline',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  // Relative to the iteration's start time.
  goldenIgnore: ['/quoteRequest/prepare/options/customDeadline'],
  async run(ctx) {
    const salt = ctx.ephemeralSalt('salt')
    const account = await ctx.sdk().createAccount({
      account: { type: 'nexus', salt },
      owners: { type: 'ecdsa', accounts: [fixtureSigner('owner')] },
    })
    ctx.identity('account', account.getAddress())
    await execute(ctx, account, {
      chain: ctx.chains.baseSepolia,
      calls: [NOOP_CALL],
      sponsored: true,
      customDeadline: ctx.clock + 3600,
    })
  },
})

const eip7702FirstDelegation = defineScenario({
  id: 'funded/eip7702-first-delegation',
  description:
    'A fresh EOA per side delegated to Nexus through EIP-7702 by a sponsored no-op call on Arbitrum Sepolia',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  async run(ctx) {
    const eoa = ctx.ephemeralSigner('eoa')
    const account = await ctx.sdk().createAccount({
      eoa,
      owners: { type: 'ecdsa', accounts: [eoa] },
    })
    const eip7702InitSignature = await ctx.step('init-signature', 'other', () =>
      account.signEip7702InitData(),
    )
    const prepared = await ctx.step('prepare', 'prepare', () =>
      account.prepareTransaction({
        chain: ctx.chains.arbitrumSepolia,
        calls: [NOOP_CALL],
        sponsored: true,
        eip7702InitSignature,
      }),
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
    const result = await ctx.step('submit', 'submit', () =>
      account.submitTransaction(signed, authorizations),
    )
    await ctx.step('wait', 'wait', () =>
      account.waitForExecution(result, false),
    )
  },
})

const safeSendTransaction = defineScenario({
  id: 'funded/safe-send-transaction',
  description:
    'Safe with a 2-of-3 ECDSA owner set: sendTransaction of a no-op call on OP Sepolia, sponsored per category',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    {
      kind: 'deployed',
      fixture: 'safe-multisig',
      chainId: optimismSepolia.id,
    },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'safe-multisig')
    const result = await ctx.step('send', 'submit', () =>
      account.sendTransaction({
        chain: ctx.chains.optimismSepolia,
        calls: [NOOP_CALL],
        sponsored: { gas: true, bridging: true, swaps: true },
      }),
    )
    await ctx.step('wait', 'wait', () =>
      account.waitForExecution(result, false),
    )
  },
})

const startale = defineScenario({
  id: 'funded/startale-erc7739',
  description:
    'Startale with the K1 validator (ERC-7739 signing): sponsored no-op call on Arbitrum Sepolia',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    { kind: 'deployed', fixture: 'startale', chainId: arbitrumSepolia.id },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'startale')
    await execute(ctx, account, {
      chain: arbitrumSepolia,
      calls: [NOOP_CALL],
      sponsored: true,
    })
  },
})

const sessionVerifyExecutions = defineScenario({
  id: 'funded/session-verify-executions',
  description:
    'Nexus session scoped to the no-op call (execution verification: signature mode 5 and a target-execution signature), sponsored on Base Sepolia',
  funded: true,
  goldenLayers: FUNDED_LAYERS,
  steady: [
    { kind: 'deployed', fixture: 'nexus-main', chainId: baseSepolia.id },
    { kind: 'session', fixture: 'nexus-main', session: 'scoped' },
  ],
  async run(ctx) {
    const account = await fixtureAccount(ctx, 'nexus-main')
    const session = sessionConfig('scoped')
    const details = await ctx.step('session-details', 'other', () =>
      account.experimental_getSessionDetails([session]),
    )
    const userSignature = await ctx.step('enable-signature', 'other', () =>
      account.experimental_signEnableSession(details),
    )
    await execute(ctx, account, {
      chain: ctx.chains.baseSepolia,
      calls: [NOOP_CALL],
      sponsored: true,
      signers: {
        type: 'experimental_session',
        session,
        // Used only until the session is enabled (the warm-up).
        enableData: {
          userSignature,
          hashesAndChainIds: (details as { hashesAndChainIds: unknown })
            .hashesAndChainIds,
          sessionToEnableIndex: 0,
        },
      },
    })
  },
})

// Signed by a key that is not the account's owner: the orchestrator refuses
// the submit after simulating it, and nothing executes.
const invalidSignature = defineScenario({
  id: 'funded/invalid-signature',
  description:
    'The deployed Nexus fixture signed by a non-owner: sponsored no-op call on Base Sepolia, submitted for real and refused',
  funded: true,
  execution: 'reject',
  goldenLayers: [...FUNDED_LAYERS, 'steps'],
  goldenIgnore: ['/steps/(prepare|messages|sign)/**'],
  steady: [
    { kind: 'deployed', fixture: 'nexus-main', chainId: baseSepolia.id },
  ],
  async run(ctx) {
    const account = await ctx.sdk().createAccount({
      owners: { type: 'ecdsa', accounts: [fixtureSigner('owner2')] },
      initData: { address: FIXTURES['nexus-main'].address },
    })
    const prepared = await ctx.step('prepare', 'prepare', () =>
      account.prepareTransaction({
        chain: baseSepolia,
        calls: [NOOP_CALL],
        sponsored: true,
      }),
    )
    await ctx.step('messages', 'messages', () =>
      account.getTransactionMessages(prepared),
    )
    const signed = await ctx.step('sign', 'sign', () =>
      account.signTransaction(prepared),
    )
    // The refusal's context carries the per-quote nonce and simulation
    // traces; the step keeps the error's stable public surface.
    await ctx.step('submit', 'submit', async () => {
      try {
        return { submitted: await account.submitTransaction(signed) }
      } catch (error) {
        return { refused: refusal(error) }
      }
    })
  },
})

function refusal(error: unknown) {
  const value = error as Record<string, any>
  const context = (value?.context ?? {}) as Record<string, unknown>
  return {
    ctor: value?.constructor?.name,
    name: value?.name,
    message: value?.message,
    errorType: value?.errorType,
    statusCode: value?.statusCode,
    category: context.category,
    errorName: context.errorName,
    errorSelector: context.errorSelector,
    retryable: context.retryable,
  }
}

describe.sequential('parity: funded, tokenless', () => {
  for (const scenario of [
    undeployedNexus,
    eip7702FirstDelegation,
    safeSendTransaction,
    startale,
    sessionVerifyExecutions,
    invalidSignature,
  ]) {
    parityTest(scenario)
  }
})
