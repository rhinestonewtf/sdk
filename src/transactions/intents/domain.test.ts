import { describe, expect, test, vi } from 'vitest'
import type { AccountRuntime } from '../../accounts/adapter'
import { toEvmChainReference } from '../../chains/caip2'
import { RateLimitedError } from '../../clients/orchestrator/errors'
import {
  Eip7702InitSignatureRequiredError,
  IntentFailedError,
} from '../../errors/execution'
import { projectIntentAccount, projectIntentRecipient } from './account'
import { normalizeIntentQuote, normalizeIntentTypedData } from './normalize'
import { selectIntentQuote } from './quotes'
import { buildIntentRequest } from './request'
import { waitForIntentStatus } from './status'
import { classifyIntentStatus, getIntentRetryDelay } from './status-policy'

const address = '0x0000000000000000000000000000000000000001' as const
const chain = toEvmChainReference(1)

describe('intent domain', () => {
  test('normalizes nested numeric typed-data values', () => {
    const normalized = normalizeIntentTypedData({
      domain: {},
      primaryType: 'Root',
      types: {
        Root: [
          { name: 'count', type: 'uint256' },
          { name: 'items', type: 'Item[]' },
          { name: 'enabled', type: 'bool' },
        ],
        Item: [{ name: 'delta', type: 'int32' }],
      },
      message: { count: '2', items: [{ delta: -1 }], enabled: true },
    })
    expect(normalized.message).toEqual({
      count: 2n,
      items: [{ delta: -1n }],
      enabled: true,
    })
    expect(
      normalizeIntentTypedData({
        domain: {},
        primaryType: 'Root',
        types: {
          Root: [
            { name: 'fixed', type: 'uint256[2]' },
            { name: 'child', type: 'Child' },
            { name: 'missing', type: 'uint256' },
          ],
          Child: [
            { name: 'nullable', type: 'uint256' },
            { name: 'alreadyBig', type: 'uint256' },
          ],
        },
        message: {
          fixed: [1, '2'],
          child: { nullable: null, alreadyBig: 3n, untouched: true },
          unknown: 'value',
        },
      }).message,
    ).toEqual({
      fixed: [1n, 2n],
      child: { nullable: null, alreadyBig: 3n, untouched: true },
      unknown: 'value',
    })
    const unchanged = { value: 1 }
    expect(
      normalizeIntentTypedData({
        domain: {},
        primaryType: 'Unknown',
        types: {},
        message: unchanged,
      }).message,
    ).toBe(unchanged)
    expect(
      normalizeIntentTypedData({
        domain: {},
        primaryType: 'Root',
        types: { Root: [{ name: 'items', type: 'uint256[]' }] },
        message: { items: 'not-an-array' },
      }).message,
    ).toEqual({ items: 'not-an-array' })
  })

  test('normalizes compatible quote typed data before signing', () => {
    const typedData = {
      domain: {},
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test',
      message: { value: '7' },
    } as const
    const normalized = normalizeIntentQuote({
      intentId: 'intent',
      expiresAt: 1,
      estimatedFillTime: { seconds: 1 },
      settlementLayer: 'SAME_CHAIN',
      signData: {
        origin: [typedData],
        destination: typedData,
        targetExecution: typedData,
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
    })

    expect(normalized.signData.origin[0]?.message).toEqual({ value: 7n })
    expect(normalized.signData.destination.message).toEqual({ value: 7n })
    expect(normalized.signData.targetExecution?.message).toEqual({ value: 7n })
  })

  test('projects deployed, undeployed, override, EOA, and non-EVM accounts', () => {
    const runtime = (
      deployed: boolean,
      kind: 'nexus' | 'eoa',
    ): AccountRuntime =>
      ({
        construction: { account: { kind }, deployed },
        identity: { address },
        adapter: {
          getDeploymentPlan: () => ({
            deployed,
            factory: address,
            factoryData: '0x12',
          }),
        },
      }) as unknown as AccountRuntime
    expect(
      projectIntentAccount({ runtime: runtime(false, 'nexus') }),
    ).toMatchObject({
      accountType: 'ERC7579',
      setupOps: [{ to: address, data: '0x12' }],
    })
    expect(
      projectIntentAccount({ runtime: runtime(true, 'nexus') }).setupOps,
    ).toEqual([{ to: address, data: '0x12' }])
    expect(
      projectIntentAccount({
        runtime: runtime(false, 'nexus'),
        setupOverride: [{ to: address, data: '0x34' }],
      }).setupOps,
    ).toEqual([{ to: address, data: '0x34' }])
    expect(
      projectIntentAccount({ runtime: runtime(true, 'eoa') }).accountType,
    ).toBe('EOA')
    expect(
      projectIntentAccount({ runtime: runtime(false, 'nexus') }).delegations,
    ).toBeUndefined()
    const eip7702Runtime = {
      construction: { account: { kind: 'nexus' }, deployed: false, eoa: {} },
      identity: { address },
      adapter: {
        getDeploymentPlan: () => ({
          deployed: false,
          factory: address,
          factoryData: '0x12',
        }),
        getEip7702AdoptionPlan: () => ({ contract: address, initData: '0x' }),
        getEip7702InitCall: (
          _construction: unknown,
          signature: `0x${string}`,
        ) => `0xinit${signature.slice(2)}` as `0x${string}`,
      },
    } as unknown as AccountRuntime
    const projected7702 = projectIntentAccount({
      runtime: eip7702Runtime,
      eip7702InitSignature: '0xabcd',
    })
    expect(projected7702.delegations).toEqual({ 0: { contract: address } })
    // 7702 accounts are routed by the signed `initializeAccount` setup op,
    // targeted at the account itself — not the factory deployment op.
    expect(projected7702.setupOps).toEqual([
      { to: address, data: '0xinitabcd' },
    ])
    // The init signature is mandatory for 7702 preparation.
    expect(() =>
      projectIntentAccount({ runtime: eip7702Runtime }),
    ).toThrowError(Eip7702InitSignatureRequiredError)
    expect(projectIntentRecipient(address, chain)).toMatchObject({
      accountType: 'EOA',
    })
    expect(
      projectIntentRecipient('solana-address', {
        kind: 'non-evm',
        namespace: 'solana',
        reference: 'mainnet',
        caip2: 'solana:mainnet',
      }),
    ).toEqual({ address: 'solana-address' })
    expect(projectIntentRecipient(undefined, chain)).toBeUndefined()
  })

  test('builds token, recipient, gas, access-list, and source-call request data', () => {
    const request = buildIntentRequest({
      transaction: {
        destination: chain,
        calls: [],
        tokenRequests: [{ token: address, amount: 2n }],
        recipient: projectIntentRecipient(address, chain),
        gasLimit: 3n,
        accountAccessList: { chainIds: [1] },
        options: { auxiliaryFunds: { 1: { [address]: 4n } } },
        signatureMode: 5,
      },
      account: { address },
      calls: [{ target: address, value: 1n, data: '0x' }],
      sourceCalls: { 1: [{ target: address, value: 5n, data: '0x12' }] },
      providedFunds: { 1: { [address]: 6n } },
    })
    expect(request).toMatchObject({
      destinationChainId: 1,
      destinationGasUnits: 3n,
      tokenRequests: [{ tokenAddress: address, amount: 2n }],
      options: { signatureMode: 5, auxiliaryFunds: { 1: { [address]: 10n } } },
    })
  })

  test('selects the best or requested quote and rejects missing quotes', () => {
    const quotes = [
      { intentId: 'a' },
      { intentId: 'b' },
    ] as unknown as Parameters<typeof selectIntentQuote>[0]
    expect(selectIntentQuote(quotes).intentId).toBe('a')
    expect(selectIntentQuote(quotes, 'b').intentId).toBe('b')
    expect(() => selectIntentQuote([], 'missing')).toThrow(
      'Quote missing is not in the prepared transaction',
    )
    expect(() => selectIntentQuote([])).toThrow(
      'Orchestrator returned no quote',
    )
  })

  test('classifies statuses and retries rate limits with an injected clock', async () => {
    const sleep = vi.fn(async () => undefined)
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(1)
    const getIntentStatus = vi
      .fn()
      .mockRejectedValueOnce(
        new RateLimitedError({
          message: 'slow',
          statusCode: 429,
          retryAfter: '2',
        }),
      )
      .mockResolvedValueOnce({
        traceId: 'trace',
        intentId: 'intent',
        status: 'COMPLETED',
        account: address,
        operations: [],
      })

    await expect(
      waitForIntentStatus(
        { statusClient: { getIntentStatus }, clock: { now, sleep } },
        'intent',
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED', terminal: true })
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000)
    expect(sleep).toHaveBeenNthCalledWith(2, 500)
    expect(
      classifyIntentStatus({
        traceId: '',
        intentId: 'intent',
        status: 'PENDING',
        account: address,
        operations: [],
      }).terminal,
    ).toBe(false)
  })

  test('classifies retry delays and terminal failures', async () => {
    const rateLimit = (retryAfter?: string) =>
      new RateLimitedError({
        message: 'slow',
        statusCode: 429,
        ...(retryAfter ? { retryAfter } : {}),
      })
    const decide = (error: unknown) =>
      getIntentRetryDelay({ error, now: 1_000, minimum: 500, fallback: 1_000 })
    expect(decide(rateLimit())).toEqual({ delay: 2_000, backoff: false })
    expect(decide(rateLimit('1'))).toEqual({ delay: 1_000, backoff: false })
    expect(decide(rateLimit('Thu, 01 Jan 1970 00:00:03 GMT'))).toEqual({
      delay: 2_000,
      backoff: false,
    })
    expect(decide(rateLimit('invalid'))).toEqual({
      delay: 500,
      backoff: false,
    })
    expect(decide(new Error('fetch failed'))).toEqual({
      delay: 1_000,
      backoff: true,
    })
    expect(decide(new Error('permanent'))).toBeUndefined()

    const sleep = vi.fn(async () => undefined)
    await expect(
      waitForIntentStatus(
        {
          statusClient: {
            getIntentStatus: vi.fn(async () => ({
              traceId: 'trace',
              intentId: 'intent',
              status: 'FAILED' as const,
              account: address,
              operations: [
                {
                  chain: 1,
                  status: 'FAILED' as const,
                  failureReason: 'REVERTED' as const,
                },
              ],
            })),
          },
          clock: {
            now: vi.fn().mockReturnValueOnce(0).mockReturnValue(20_000),
            sleep,
          },
        },
        'intent',
      ),
    ).rejects.toBeInstanceOf(IntentFailedError)
    expect(sleep).toHaveBeenCalledWith(2_000)
  })
})
