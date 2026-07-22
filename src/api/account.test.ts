import { privateKeyToAccount } from 'viem/accounts'
import { mainnet, optimism } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { toEvmChainReference } from '../chains/caip2'
import type { LegacyAccountConfig } from '../config/legacy'
import { resolveAccountConfig, resolveSdkConfig } from '../config/resolve'
import type { AccountInvocationContext } from '../config/resolved'
import { QuoteNotInPreparedTransactionError } from '../errors/execution'
import type { RhinestoneAccountConfig } from '../index'
import { RhinestoneSDK } from '../index'
import type { PreparedTransactionData } from '../transactions/intents/types'
import { adaptTransaction, authorizationChains } from './account'

const owner = privateKeyToAccount(`0x${'02'.repeat(32)}`)
const recipientAddress = '0x0000000000000000000000000000000000000010' as const

function invocationContext(): AccountInvocationContext<
  LegacyAccountConfig<unknown>
> {
  const sdk = resolveSdkConfig({ apiKey: 'offline' })
  return {
    method: 'prepare-intent',
    sdk,
    account: resolveAccountConfig(sdk, {
      owners: { type: 'ecdsa', accounts: [owner] },
    }),
    compatibilityConfig: {} as LegacyAccountConfig<unknown>,
  }
}

describe('account instance surface', () => {
  test('exposes sendUserOperation and no sendTransaction convenience method', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      owners: {
        type: 'ecdsa',
        accounts: [owner],
      },
    })

    expect(Reflect.has(account, 'sendUserOperation')).toBe(true)
    expect(Reflect.has(account, 'sendTransaction')).toBe(false)
  })
})

describe('account config compatibility snapshot', () => {
  test('retains account-config keys, nested aliasing, and auth exposure', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const owners: RhinestoneAccountConfig['owners'] = {
      type: 'ecdsa',
      accounts: [owner],
    }
    const provider: RhinestoneAccountConfig['account'] = {
      type: 'nexus',
      version: '1.2.0',
    }
    const input: RhinestoneAccountConfig = { account: provider, owners }
    const account = await sdk.createAccount(input)

    // Account-config keys survive by value.
    expect(account.config.account).toEqual(provider)
    expect(account.config.owners).toEqual(owners)

    // Shallow copy: nested references are aliased, so later method calls (which
    // re-read the live config) observe post-construction mutations to them.
    expect(account.config.owners).toBe(owners)
    expect(account.config.account).toBe(provider)

    // SDK-scoped auth is exposed on the account config snapshot.
    expect('_authProvider' in account.config).toBe(true)
  })
})

describe('account boundary adapters', () => {
  test('rejects an intent id that is not in the prepared transaction', async () => {
    const sdk = new RhinestoneSDK({ apiKey: 'offline' })
    const account = await sdk.createAccount({
      owners: { type: 'ecdsa', accounts: [owner] },
    })
    const quote = {
      intentId: 'best',
      expiresAt: 1,
      estimatedFillTime: { seconds: 1 },
      settlementLayer: 'SAME_CHAIN' as const,
      signData: {
        origin: [],
        destination: {
          domain: {},
          types: {},
          primaryType: 'Test',
          message: {},
        },
      },
      cost: {
        input: [],
        output: [],
        fees: {
          total: { usd: 0 },
          breakdown: {
            gas: { usd: 0 },
            bridge: { usd: 0 },
            swap: { usd: 0 },
            app: { usd: 0 },
          },
        },
      },
    }
    const prepared = {
      quotes: { traceId: 'trace', best: quote, all: [quote] },
      intentInput: {},
      transaction: { chain: mainnet, calls: [] },
    } satisfies PreparedTransactionData

    expect(() =>
      account.getTransactionMessages(prepared, { intentId: 'missing' }),
    ).toThrowError(QuoteNotInPreparedTransactionError)
  })

  test('projects smart-account recipients instead of dropping them', () => {
    const transaction = adaptTransaction(invocationContext(), {
      chain: mainnet,
      calls: [],
      recipient: {
        account: { type: 'nexus', version: '1.2.0' },
        owners: { type: 'ecdsa', accounts: [owner] },
      },
    })

    expect(transaction.recipient).toMatchObject({
      accountType: 'ERC7579',
      setupOps: [expect.objectContaining({ to: expect.any(String) })],
    })
    expect(transaction.recipient?.address).not.toBe(recipientAddress)

    expect(
      adaptTransaction(invocationContext(), {
        chain: mainnet,
        calls: [],
        recipient: recipientAddress,
      }).recipient,
    ).toEqual({
      address: recipientAddress,
      accountType: 'EOA',
      setupOps: [],
    })
  })

  test('includes source and destination authorization chains once', () => {
    const transaction = adaptTransaction(invocationContext(), {
      sourceChains: [mainnet, optimism],
      targetChain: optimism,
      calls: [],
    })

    expect(authorizationChains(transaction)).toEqual([
      toEvmChainReference(mainnet.id),
      toEvmChainReference(optimism.id),
    ])
  })
})
