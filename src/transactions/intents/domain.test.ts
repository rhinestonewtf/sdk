import type { TypedDataDefinition } from 'viem'
import { describe, expect, test, vi } from 'vitest'
import { eip712Request, quote } from '../../../test/utils/caucasus'
import type { AccountRuntime } from '../../accounts/adapter'
import { toEvmChainReference } from '../../chains/caip2'
import { RateLimitedError } from '../../clients/orchestrator/errors'
import type {
  IntentOperationGroup,
  IntentRefund,
} from '../../clients/orchestrator/public'
import type { OrchestratorIntentStatus } from '../../clients/orchestrator/types'
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

// The fields every status shares; `purpose` is the only intent kind there is.
const failed = {
  traceId: '',
  intentId: 'intent',
  purpose: 'execution',
  status: 'FAILED',
  operations: [],
} as const satisfies OrchestratorIntentStatus

const refund: IntentRefund = {
  transaction: {
    vm: 'evm',
    chainId: 'eip155:8453',
    txHash:
      '0x8e483d74ff15e79f86e0c23e81444a5db5b2ce31c9ec28f84259dfc83f0bbc28',
  },
}

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

  test('normalizes every EIP-712 signing request before signing', () => {
    const typedData = {
      domain: {},
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test',
      message: { value: '7' },
    } as unknown as TypedDataDefinition
    // Every slot is normalized, not just the first: the requests are ordered
    // authorisations and each one is hashed on its own.
    const normalized = normalizeIntentQuote(
      quote({
        signingRequests: [
          eip712Request({ chainId: 1, typedData }),
          eip712Request({
            chainId: 1,
            purpose: 'destinationAuthorization',
            typedData,
          }),
          eip712Request({
            chainId: 1,
            purpose: 'targetExecutionAuthorization',
            typedData,
          }),
        ],
      }),
    )

    expect(
      normalized.signingRequests.map((request) =>
        request.payload.kind === 'eip712'
          ? request.payload.typedData.message
          : undefined,
      ),
    ).toEqual([{ value: 7n }, { value: 7n }, { value: 7n }])
  })

  test('projects deployed, undeployed, override, EOA accounts and bare recipients', () => {
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
      kind: 'erc7579',
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
    expect(projectIntentAccount({ runtime: runtime(true, 'eoa') }).kind).toBe(
      'eoa',
    )
    expect(
      projectIntentAccount({ runtime: runtime(false, 'nexus') })
        .delegationContract,
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
    // An adopted 7702 account stays ERC-7579 and names the contract it
    // delegates to on every chain the intent touches.
    expect(projected7702.kind).toBe('erc7579')
    expect(projected7702.delegationContract).toBe(address)
    // 7702 accounts are routed by the signed `initializeAccount` setup op,
    // targeted at the account itself — not the factory deployment op.
    expect(projected7702.setupOps).toEqual([
      { to: address, data: '0xinitabcd' },
    ])
    // The init signature is mandatory for 7702 preparation.
    expect(() =>
      projectIntentAccount({ runtime: eip7702Runtime }),
    ).toThrowError(Eip7702InitSignatureRequiredError)
    // A recipient is a payee and nothing more, on every chain namespace:
    // labelling it as an account would read as "this recipient can execute".
    expect(projectIntentRecipient(address)).toEqual({
      kind: 'bare',
      address,
    })
    expect(projectIntentRecipient('solana-address')).toEqual({
      kind: 'bare',
      address: 'solana-address',
    })
    expect(projectIntentRecipient(undefined)).toBeUndefined()
  })

  test('builds token, recipient, gas, access-list, and source-call request data', () => {
    const { request, normalized } = buildIntentRequest({
      transaction: {
        destination: chain,
        calls: [],
        tokenRequests: [{ token: address, amount: 2n }],
        recipient: projectIntentRecipient(address),
        gasLimit: 3n,
        accountAccessList: { chainIds: [1] },
        options: { auxiliaryFunds: { 1: { [address]: 4n } } },
        signatureMode: 5,
      },
      account: { kind: 'erc7579', address, setupOps: [] },
      calls: [{ target: address, value: 1n, data: '0x' }],
      sourceCalls: { 1: [{ target: address, value: 5n, data: '0x12' }] },
      providedFunds: { 1: { [address]: 6n } },
    })
    expect(request).toMatchObject({
      account: { evm: { signatureMode: 5 } },
      destination: {
        chainId: 'eip155:1',
        recipient: { address },
        tokenRequests: [{ tokenAddress: address, amount: 2n }],
        execution: { gasLimit: 3n },
      },
      // Configured and call-provided funds add up rather than shadow one
      // another; Caucasus addresses the chain natively.
      source: {
        selection: { chains: { only: ['eip155:1'] } },
        auxiliaryFunds: { 'eip155:1': { [address]: 10n } },
      },
    })
    // The sponsorship projection keeps the numeric chain ids and the field
    // names an issued grant's digest was built with.
    expect(normalized).toMatchObject({
      destinationChainId: 1,
      destinationGasUnits: 3n,
      tokenRequests: [{ tokenAddress: address, amount: 2n }],
      accountAccessList: { chainIds: [1] },
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
      .mockResolvedValueOnce({ ...failed, status: 'COMPLETED' })

    await expect(
      waitForIntentStatus(
        { statusClient: { getIntentStatus }, clock: { now, sleep } },
        'intent',
      ),
    ).resolves.toMatchObject({ status: 'COMPLETED', terminal: true })
    expect(sleep).toHaveBeenNthCalledWith(1, 2_000)
    expect(sleep).toHaveBeenNthCalledWith(2, 500)
    expect(
      classifyIntentStatus({ ...failed, status: 'PENDING' }).terminal,
    ).toBe(false)
  })

  test('classifies a bridge refund through, and leaves it absent when unknown', () => {
    expect(
      classifyIntentStatus({ ...failed, refunds: [refund] }).refunds,
    ).toEqual([refund])
    // Absent, not `[]` — the distinction the field rests on: presence is a
    // fact, absence is not a claim that the funds were kept.
    expect('refunds' in classifyIntentStatus(failed)).toBe(false)
  })

  test('classifies a HyperCore outcome through as an operation item', () => {
    // HyperCore is no longer a top-level field: nothing was broadcast, so it
    // travels as an EXECUTION item carrying a result rather than a transaction,
    // grouped on the venue next to the transaction that settles it.
    const execution = {
      type: 'EXECUTION',
      status: 'FAILED',
      result: { outcome: 'refused', reason: 'Insufficient margin.' },
    } as const
    const onchain = {
      chainId: 'eip155:8453',
      items: [{ type: 'FILL', status: 'COMPLETED' }],
    } as const satisfies IntentOperationGroup

    expect(
      classifyIntentStatus({
        ...failed,
        operations: [
          onchain,
          { chainId: 'hypercore:perp', items: [execution] },
        ],
      }).operations[1]?.items[0],
    ).toEqual(execution)
    // Absent, not a placeholder outcome: an intent that carried no HyperCore
    // action makes no claim about one.
    expect(
      classifyIntentStatus({ ...failed, operations: [onchain] })
        .operations.flatMap(({ items }) => items)
        .filter(({ type }) => type === 'EXECUTION'),
    ).toEqual([])
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
              ...failed,
              operations: [
                {
                  chainId: 'eip155:1',
                  items: [
                    {
                      type: 'CLAIM' as const,
                      status: 'FAILED' as const,
                      failureReason: 'REVERTED' as const,
                    },
                  ],
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

  test('accepts every failure reason the orchestrator serialises', () => {
    // Not a runtime assertion so much as a compile-time one: each literal has
    // to be assignable to the public `FailureReason`, so a union narrower than
    // the wire fails the build here rather than forcing consumers to cast.
    // Mirrors the orchestrator's enum minus `NONE`, which it filters out before
    // serialising. `BRIDGE_REFUNDED` is the one consumers want: it is the
    // per-operation half of `refunds`.
    const reasons = [
      'EXPIRED',
      'REVERTED',
      'RELAYER_FAILURE',
      'DISPATCH_FAILED',
      'BRIDGE_TIMEOUT',
      'BRIDGE_REFUNDED',
    ] as const

    const classified = classifyIntentStatus({
      ...failed,
      operations: reasons.map((failureReason, index) => ({
        chainId: `eip155:${index + 1}`,
        items: [
          { type: 'CLAIM' as const, status: 'FAILED' as const, failureReason },
        ],
      })),
    })
    // Narrowed rather than indexed: `IntentOperationItem` is discriminated on
    // `type`, and `failureReason` exists only on the onchain member — which is
    // itself part of what this pins.
    expect(
      classified.operations.flatMap(({ items }) =>
        items.map((item) =>
          item.type === 'EXECUTION' ? undefined : item.failureReason,
        ),
      ),
    ).toEqual([...reasons])
  })

  test('carries the refund on the failed-intent error, the only path it has', () => {
    // A refunded intent is still FAILED, so `waitForIntentStatus` throws and no
    // status is ever returned — the error context is the only place a
    // `waitForExecution` caller can read the refund from.
    const failing = (refunds?: readonly IntentRefund[]) => ({
      statusClient: {
        getIntentStatus: vi.fn(async () => ({
          ...failed,
          ...(refunds ? { refunds } : {}),
        })),
      },
      clock: {
        now: vi.fn().mockReturnValueOnce(0).mockReturnValue(20_000),
        sleep: vi.fn(async () => undefined),
      },
    })

    return Promise.all([
      waitForIntentStatus(failing([refund]), 'intent').catch((error) => {
        expect(error.context.refunds).toEqual([refund])
      }),
      waitForIntentStatus(failing(), 'intent').catch((error) => {
        // Absent, not `[]` — a failed intent we know of no refund for must not
        // claim one came back.
        expect('refunds' in error.context).toBe(false)
      }),
    ])
  })

  test('keeps native Solana and EVM references on the failed-intent error', async () => {
    // A Solana-destination delivery that is refunded: the fill reference is a
    // base58 signature on a Solana chain id and the refund is an EVM hash, and
    // neither may be coerced to the other's shape on the way out.
    const signature =
      '5KtPn1LGuxhFiKZ9xVLYBu9A2yBqX6gB4XzYGVxV9Dszgvn6YxrY3JQSMNJ4e6d7S5kJqY2LxA2nCE4BrVQCLH5m'
    const solana = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
    const operations = [
      {
        chainId: solana,
        items: [
          {
            type: 'FILL' as const,
            status: 'FAILED' as const,
            failureReason: 'BRIDGE_REFUNDED' as const,
            transaction: { vm: 'svm' as const, chainId: solana, signature },
          },
        ],
      },
    ]

    const error = await waitForIntentStatus(
      {
        statusClient: {
          getIntentStatus: vi.fn(async () => ({
            ...failed,
            operations,
            refunds: [refund],
          })),
        },
        clock: {
          now: vi.fn().mockReturnValueOnce(0).mockReturnValue(20_000),
          sleep: vi.fn(async () => undefined),
        },
      },
      'intent',
    ).catch((caught) => caught)

    expect(error).toBeInstanceOf(IntentFailedError)
    expect(error.context.operations).toEqual(operations)
    expect(error.context.refunds).toEqual([refund])
  })

  test('carries the HyperCore outcome on the failed-intent error while every operation completed', async () => {
    // The onchain half succeeded, so the transactions cannot say whether a
    // re-send is safe: only the EXECUTION item tells a partial from a refusal.
    const settlement = {
      chainId: 'eip155:8453',
      items: [
        { type: 'FILL' as const, status: 'COMPLETED' as const, timestamp: 1 },
      ],
    }
    const failing = (result?: {
      readonly outcome: 'partial' | 'refused'
      readonly reason: string
    }) => ({
      statusClient: {
        getIntentStatus: vi.fn(async () => ({
          ...failed,
          operations: [
            settlement,
            ...(result
              ? [
                  {
                    chainId: 'hypercore:perp',
                    items: [
                      {
                        type: 'EXECUTION' as const,
                        status: 'FAILED' as const,
                        result,
                      },
                    ],
                  },
                ]
              : []),
          ],
        })),
      },
      clock: {
        now: vi.fn().mockReturnValueOnce(0).mockReturnValue(20_000),
        sleep: vi.fn(async () => undefined),
      },
    })
    const partial = {
      outcome: 'partial',
      reason: 'action 0 accepted; action 1 refused: Insufficient margin.',
    } as const
    const refused = {
      outcome: 'refused',
      reason: 'Insufficient margin.',
    } as const

    for (const result of [partial, refused]) {
      await expect(
        waitForIntentStatus(failing(result), 'intent'),
      ).rejects.toMatchObject({
        context: {
          operations: [
            { items: [{ status: 'COMPLETED' }] },
            { items: [{ type: 'EXECUTION', result }] },
          ],
        },
      })
    }

    const error = await waitForIntentStatus(failing(), 'intent').catch(
      (caught) => caught,
    )
    expect(error).toBeInstanceOf(IntentFailedError)
    expect(error.context.operations).toEqual([settlement])
  })
})
