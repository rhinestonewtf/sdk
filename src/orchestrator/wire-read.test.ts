import { describe, expect, test } from 'vitest'
import recorded from './__fixtures__/read-responses.json'
import {
  type BlancIntentStatus,
  blancPortfolioQuery,
  intentOpStatusFromBlanc,
  portfolioFromBlanc,
} from './wire-read'

const ACCOUNT = '0xf2ef721498c691a5fcc84adf03e8676f7fe594c3'
const HASH_A = `0x${'a'.repeat(64)}`
const HASH_B = `0x${'b'.repeat(64)}`
const HASH_C = `0x${'c'.repeat(64)}`

// Each derived case is one branch of the orchestrator's alps lowering; its
// alps body is the expected result.
const DERIVED = (recorded as { id: string; alps: any; blanc: any }[]).filter(
  (c) => c.id.startsWith('synthetic.'),
)

function status(
  operations: BlancIntentStatus['operations'],
  extra: Partial<BlancIntentStatus> = {},
): BlancIntentStatus {
  return { status: 'PENDING', accountAddress: ACCOUNT, operations, ...extra }
}

describe('intentOpStatusFromBlanc', () => {
  test.each(DERIVED.map((c) => [c.id, c] as const))(
    '%s',
    (_id, { alps, blanc }) => {
      const result = intentOpStatusFromBlanc(blanc.body)
      expect(result).toStrictEqual(alps.body)
      expect(Object.keys(result)).toStrictEqual(Object.keys(alps.body))
    },
  )

  test('a single group of only claims has no destination', () => {
    const result = intentOpStatusFromBlanc(
      status([
        {
          chain: 84532,
          items: [
            {
              type: 'CLAIM',
              status: 'COMPLETED',
              txHash: HASH_A,
              timestamp: 1,
            },
          ],
        },
      ]),
    )
    expect(result).toStrictEqual({
      status: 'PENDING',
      claims: [
        {
          chainId: 84532,
          status: 'COMPLETED',
          claimTimestamp: 1,
          claimTransactionHash: HASH_A,
        },
      ],
      userAddress: ACCOUNT,
    })
  })

  test('a single group is the fill, read from its first item', () => {
    const result = intentOpStatusFromBlanc(
      status([
        {
          chain: 84532,
          items: [
            { type: 'CLAIM', status: 'PENDING' },
            { type: 'FILL', status: 'COMPLETED', txHash: HASH_A, timestamp: 2 },
          ],
        },
      ]),
    )
    expect(result).toStrictEqual({
      status: 'PENDING',
      claims: [],
      destinationChainId: 84532,
      userAddress: ACCOUNT,
    })
  })

  test('the last of several typed fills wins', () => {
    const result = intentOpStatusFromBlanc(
      status([
        {
          chain: 10,
          items: [
            { type: 'FILL', status: 'COMPLETED', txHash: HASH_A, timestamp: 1 },
          ],
        },
        { chain: 84532, items: [{ type: 'CLAIM', status: 'PENDING' }] },
        {
          chain: 421614,
          items: [
            { type: 'CLAIM', status: 'COMPLETED', txHash: HASH_C },
            {
              type: 'BRIDGE_FILL',
              status: 'COMPLETED',
              txHash: HASH_B,
              timestamp: 3,
            },
          ],
        },
      ]),
    )
    expect(result).toStrictEqual({
      status: 'PENDING',
      claims: [{ chainId: 84532, status: 'PENDING' }],
      destinationChainId: 421614,
      fillTimestamp: 3,
      fillTransactionHash: HASH_B,
      userAddress: ACCOUNT,
    })
  })

  test('absent fields are absent keys, not undefined', () => {
    const result = intentOpStatusFromBlanc(
      status([
        { chain: 84532, items: [{ type: 'CLAIM', status: 'PENDING' }] },
        { chain: 421614, items: [{ type: 'FILL', status: 'PENDING' }] },
      ]),
    )
    expect(Object.keys(result)).toStrictEqual([
      'status',
      'claims',
      'destinationChainId',
      'userAddress',
    ])
    expect(Object.keys(result.claims[0])).toStrictEqual(['chainId', 'status'])
  })

  test('refunds pass through verbatim', () => {
    const refunds = [{ chain: 10, txHash: HASH_A as `0x${string}` }]
    const result = intentOpStatusFromBlanc(status([], { refunds }))
    expect(result).toStrictEqual({
      status: 'PENDING',
      claims: [],
      userAddress: ACCOUNT,
      refunds,
    })
  })

  test('a missing operations list reads as none', () => {
    const result = intentOpStatusFromBlanc({
      status: 'FAILED',
      accountAddress: ACCOUNT,
    })
    expect(result).toStrictEqual({
      status: 'FAILED',
      claims: [],
      userAddress: ACCOUNT,
    })
  })

  test('CAIP-2 chains read as numbers', () => {
    const numeric = intentOpStatusFromBlanc(
      status([
        { chain: 84532, items: [{ type: 'CLAIM', status: 'PENDING' }] },
        { chain: 421614, items: [{ type: 'FILL', status: 'PENDING' }] },
      ]),
    )
    const caip = intentOpStatusFromBlanc(
      status([
        {
          chain: 'eip155:84532',
          items: [{ type: 'CLAIM', status: 'PENDING' }],
        },
        {
          chain: 'eip155:421614',
          items: [{ type: 'FILL', status: 'PENDING' }],
        },
      ]),
    )
    expect(caip).toStrictEqual(numeric)
  })
})

describe('portfolioFromBlanc', () => {
  const USDC_BASE = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
  const USDC_OP = '0x5fd84259d66cd46123540766be93dfe6d43130d7'

  test('takes decimals from the first chain and sums the amounts', () => {
    const result = portfolioFromBlanc({
      portfolio: [
        {
          symbol: 'USDC',
          chains: [
            {
              chainId: 'eip155:84532',
              address: USDC_BASE,
              decimals: 6,
              amount: '1000',
            },
            {
              chainId: 'eip155:11155420',
              address: USDC_OP,
              decimals: 18,
              amount: '25',
            },
          ],
        },
      ],
    })
    expect(result).toStrictEqual([
      {
        symbol: 'USDC',
        decimals: 6,
        balances: { locked: 0n, unlocked: 1025n },
        chains: [
          { chain: 84532, address: USDC_BASE, locked: 0n, unlocked: 1000n },
          { chain: 11155420, address: USDC_OP, locked: 0n, unlocked: 25n },
        ],
      },
    ])
  })

  test('a token without chains has zero decimals and balance', () => {
    expect(
      portfolioFromBlanc({ portfolio: [{ symbol: 'ETH', chains: [] }] }),
    ).toStrictEqual([
      {
        symbol: 'ETH',
        decimals: 0,
        balances: { locked: 0n, unlocked: 0n },
        chains: [],
      },
    ])
  })
})

describe('blancPortfolioQuery', () => {
  test('repeats CAIP-2 params and keeps token addresses as given', () => {
    const query = blancPortfolioQuery({
      chainIds: [84532, 11155420],
      tokens: {
        84532: ['0x036CbD53842c5426634e7929541eC2318f3dCF7e'],
        11155420: ['0x5fd84259d66Cd46123540766Be93DFE6D43130D7'],
      },
    })
    expect([...query]).toStrictEqual([
      ['chainIds', 'eip155:84532'],
      ['chainIds', 'eip155:11155420'],
      ['tokens', 'eip155:84532:0x036CbD53842c5426634e7929541eC2318f3dCF7e'],
      ['tokens', 'eip155:11155420:0x5fd84259d66Cd46123540766Be93DFE6D43130D7'],
    ])
  })

  test.each([
    ['no filter', undefined],
    ['an empty filter', {}],
    ['empty lists', { chainIds: [], tokens: {} }],
    ['a chain without tokens', { tokens: { 84532: [] } }],
  ])('emits nothing for %s', (_name, filter) => {
    expect(blancPortfolioQuery(filter).toString()).toBe('')
  })
})
