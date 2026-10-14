import type { Address } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  quote as buildQuote,
  eip712Request,
} from '../../../test/utils/caucasus'
import type { OrchestratorExecutionQuote } from '../../clients/orchestrator/types'
import { InvalidPreparedTransactionError } from '../../errors/execution'
import {
  PREPARED_REQUEST_VERSION,
  projectCompatibleQuote,
  projectPreparedBinding,
  restorePreparedBinding,
} from './compatibility'

const address = '0x0000000000000000000000000000000000000001' as Address

describe('projectCompatibleQuote', () => {
  const typedData = {
    domain: { chainId: 1, verifyingContract: address },
    types: {
      Root: [
        { name: 'count', type: 'uint256' },
        { name: 'items', type: 'Item[]' },
      ],
      Item: [{ name: 'delta', type: 'int32' }],
    },
    primaryType: 'Root',
    message: { count: 2n, items: [{ delta: -1n }] },
  } as never

  const quote: OrchestratorExecutionQuote = {
    ...buildQuote({
      signingRequests: [eip712Request({ chainId: 1, typedData })],
    }),
    cost: {
      input: [
        {
          chainId: 'eip155:1',
          tokenAddress: address,
          symbol: 'ETH',
          decimals: 18,
          amount: 7n,
          price: { usd: 1 },
        },
      ],
      output: [],
      fees: {
        total: { usd: 0 },
        breakdown: {
          gas: { usd: 0, sponsored: false },
          bridge: { usd: 0, sponsored: false },
          swap: { usd: 0, sponsored: false },
          app: { usd: 0, sponsored: false },
          protocol: { usd: 0, sponsored: false },
          sponsorSurcharge: { usd: 0, sponsored: false },
        },
      },
    },
  }

  // Signing payloads have to survive `JSON.stringify`, so their normalized
  // bigints go back to strings. Cost amounts stay bigint — that is their type.
  test('serializes signing payloads but leaves cost amounts as bigint', () => {
    const projected = projectCompatibleQuote(quote)
    const payload = projected.signingRequests[0]?.payload as unknown as {
      typedData: { message: unknown }
    }

    expect(payload.typedData.message).toEqual({
      count: '2',
      items: [{ delta: '-1' }],
    })
    expect(projected.cost.input[0]?.amount).toBe(7n)
  })

  test('does not mutate the source quote', () => {
    projectCompatibleQuote(quote)
    const payload = quote.signingRequests[0]?.payload as unknown as {
      typedData: { message: { count: bigint } }
    }
    expect(payload.typedData.message.count).toBe(2n)
  })
})

describe('prepared request binding', () => {
  const request = {
    account: { evm: { type: 'erc7579' as const, address } },
    destination: {
      vm: 'evm' as const,
      chainId: 'eip155:1',
      token: address,
      amount: 9n,
    },
  }

  test('binds the singular wire generation', () => {
    expect(PREPARED_REQUEST_VERSION).toBe('caucasus-singular-1')
  })

  test('round-trips the request through JSON with a version tag', () => {
    const binding = projectPreparedBinding(request)
    expect(binding.version).toBe(PREPARED_REQUEST_VERSION)
    const restored = restorePreparedBinding(JSON.parse(JSON.stringify(binding)))
    expect(restored.destination.amount).toBe('9')
  })

  // A payload prepared under an earlier wire generation must fail explicitly.
  // Reinterpreting it would sign against a contract it was never quoted under.
  test.each([
    ['absent', undefined],
    ['from an older generation', { version: 'blanc-1', request: {} }],
    // The pre-singular wire generation, refused by name.
    [
      'the legacy dual-shape generation',
      { version: 'caucasus-1', request: {} },
    ],
  ])('refuses a binding that is %s', (_name, binding) => {
    expect(() => restorePreparedBinding(binding as never)).toThrow(
      /earlier SDK generation or orchestrator wire version/,
    )
  })

  test('refuses the legacy dual-shape binding with InvalidPreparedTransactionError', () => {
    expect(() =>
      restorePreparedBinding({ version: 'caucasus-1', request: {} } as never),
    ).toThrow(InvalidPreparedTransactionError)
  })
})
