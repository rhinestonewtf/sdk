import { describe, expect, test } from 'vitest'
import {
  caipChainIdsToNumbers,
  isUnknownChainOnQuote,
  normalizeErrorResponse,
} from './wire-error'

function normalize(body: unknown, traceIdHeader: string | null = null) {
  return normalizeErrorResponse({ body, traceIdHeader })
}

describe('normalizeErrorResponse', () => {
  test('a blanc issue list becomes the alps error list', () => {
    const issues = [
      { message: 'No balances available', context: { code: 'ZERO_BALANCE' } },
    ]
    expect(
      normalize({
        code: 'UNPROCESSABLE_CONTENT',
        message: 'No balances available',
        details: issues,
      }),
    ).toEqual({ body: { errors: issues }, traceId: undefined, blanc: true })
  })

  test('blanc object details become the context of a single error', () => {
    const details = { category: 'INVALID_SIGNATURE', retryable: false }
    expect(
      normalize({
        code: 'SIMULATION_FAILED',
        message: 'Simulation failed: InvalidSignature()',
        details,
      }).body,
    ).toEqual({
      errors: [
        { message: 'Simulation failed: InvalidSignature()', context: details },
      ],
    })
  })

  test('a blanc envelope without details keeps its top-level message', () => {
    for (const details of [undefined, []]) {
      expect(
        normalize({
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong',
          details,
        }).body,
      ).toEqual({ code: 'INTERNAL_ERROR', message: 'Something went wrong' })
    }
  })

  test('blanc insufficient liquidity becomes the alps flat body', () => {
    expect(
      normalize({
        code: 'INSUFFICIENT_LIQUIDITY',
        message: 'Insufficient liquidity',
        details: { availableIntents: [{ '0xa': '1' }], unfillable: {} },
      }).body,
    ).toEqual({
      error: 'INSUFFICIENT_LIQUIDITY',
      message: 'Insufficient liquidity',
      availableIntents: [{ '0xa': '1' }],
      unfillable: {},
    })
    expect(
      normalize({
        code: 'INSUFFICIENT_LIQUIDITY',
        message: 'Insufficient liquidity',
        details: {},
      }).body,
    ).toEqual({
      error: 'INSUFFICIENT_LIQUIDITY',
      message: 'Insufficient liquidity',
      availableIntents: [],
      unfillable: {},
    })
  })

  test('the gateway auth body classifies as before', () => {
    const body = {
      message: 'Invalid API key',
      code: 'UNAUTHORIZED',
      traceId: 'abc',
    }
    expect(normalize(body)).toEqual({
      body: { code: 'UNAUTHORIZED', message: 'Invalid API key' },
      traceId: 'abc',
      blanc: true,
    })
  })

  test('alps bodies pass through untouched, CAIP-looking strings included', () => {
    const list = {
      errors: [{ message: 'x', context: { chainId: 'eip155:1' } }],
      traceId: 'abc',
    }
    const liquidity = {
      error: 'INSUFFICIENT_LIQUIDITY',
      message: 'x',
      availableIntents: [],
      unfillable: {},
    }
    expect(normalize(list)).toEqual({
      body: list,
      traceId: 'abc',
      blanc: false,
    })
    expect(normalize(list).body).toBe(list)
    expect(normalize(liquidity).body).toBe(liquidity)
    expect(normalize({}).body).toEqual({})
    expect(normalize({ message: 'Too Many Requests' }).blanc).toBe(false)
  })

  test('chain ids in blanc details become numbers', () => {
    const { body } = normalize({
      code: 'UNPROCESSABLE_CONTENT',
      message: 'x',
      details: [
        {
          message: 'x',
          context: {
            destinationChainId: 'eip155:84532',
            candidateErrors: [{ chainId: 'eip155:421614', code: 'NO_QUOTE' }],
          },
        },
      ],
    })
    expect(body.errors[0].context).toEqual({
      destinationChainId: 84532,
      candidateErrors: [{ chainId: 421614, code: 'NO_QUOTE' }],
    })
  })

  test('the header trace id wins over the body', () => {
    expect(normalize({ errors: [], traceId: 'body' }, 'header').traceId).toBe(
      'header',
    )
    expect(normalize({ errors: [], traceId: 'body' }, null).traceId).toBe(
      'body',
    )
    expect(normalize({ errors: [] }, '').traceId).toBeUndefined()
  })
})

describe('caipChainIdsToNumbers', () => {
  test('converts nested eip155 ids and leaves everything else', () => {
    expect(
      caipChainIdsToNumbers({
        simulations: [{ call: { chainId: 'eip155:84532', value: '0' } }],
        chainId: 'eip155:abc',
        namespace: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
        message: 'on chain eip155:421614',
        count: 3,
        flag: null,
      }),
    ).toEqual({
      simulations: [{ call: { chainId: 84532, value: '0' } }],
      chainId: 'eip155:abc',
      namespace: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
      message: 'on chain eip155:421614',
      count: 3,
      flag: null,
    })
  })
})

describe('isUnknownChainOnQuote', () => {
  const caip = 'Invalid CAIP-2 chain id (unknown eip155 reference): "eip155:1"'
  const blanc = normalize({
    code: 'VALIDATION_ERROR',
    message: caip,
    details: [{ message: caip }],
  })

  test('matches a blanc chain-id rejection on a quote', () => {
    expect(isUnknownChainOnQuote(blanc, 'quote', 400)).toBe(true)
    expect(
      isUnknownChainOnQuote(
        normalize({ code: 'VALIDATION_ERROR', message: caip }),
        'quote',
        400,
      ),
    ).toBe(true)
  })

  test('ignores other operations, statuses, messages and alps bodies', () => {
    expect(isUnknownChainOnQuote(blanc, 'splits', 400)).toBe(false)
    expect(isUnknownChainOnQuote(blanc, 'quote', 422)).toBe(false)
    expect(
      isUnknownChainOnQuote(
        normalize({ errors: [{ message: caip }] }),
        'quote',
        400,
      ),
    ).toBe(false)
    expect(
      isUnknownChainOnQuote(
        normalize({
          code: 'VALIDATION_ERROR',
          message: 'Invalid input',
          details: [{ message: 'Invalid input' }],
        }),
        'quote',
        400,
      ),
    ).toBe(false)
  })
})
