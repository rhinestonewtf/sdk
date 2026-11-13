import { describe, expect, test } from 'vitest'
import { FIXTURES, PERMIT2, TOKENS } from './fixtures'
import {
  checkSteady,
  readBalances,
  requiredBalances,
  shortfalls,
  topUpLine,
} from './preflight'

const nexus = FIXTURES['nexus-main'].address

describe('funding preflight', () => {
  test('requires the per-side spend for every side, summed per fixture, chain and token', () => {
    const required = requiredBalances(
      [
        { fixture: 'nexus-main', chainId: 84532, token: 'USDC', perSide: 100n },
        { fixture: 'nexus-main', chainId: 84532, token: 'USDC', perSide: 20n },
        { fixture: 'eoa', chainId: 84532, token: 'ETH', perSide: 5n },
      ],
      7,
    )
    expect(required).toEqual([
      {
        fixture: 'nexus-main',
        address: nexus,
        chainId: 84532,
        token: 'USDC',
        required: 840n,
      },
      {
        fixture: 'eoa',
        address: FIXTURES.eoa.address,
        chainId: 84532,
        token: 'ETH',
        required: 35n,
      },
    ])
  })

  test('rounds shortfalls up to faucet-sized steps and prints faucet lines', async () => {
    const balances = await readBalances(
      [
        {
          fixture: 'nexus-main',
          address: nexus,
          chainId: 84532,
          token: 'USDC',
          required: 840_000n,
        },
        {
          fixture: 'eoa',
          address: FIXTURES.eoa.address,
          chainId: 11155420,
          token: 'ETH',
          required: 10n ** 15n,
        },
        {
          fixture: 'safe-multisig',
          address: FIXTURES['safe-multisig'].address,
          chainId: 84532,
          token: 'USDC',
          required: 1n,
        },
      ],
      {
        async balance(_chainId, _owner, token) {
          return token === 'ETH' ? 10n ** 14n + 1n : 600_001n
        },
      },
    )
    expect(shortfalls(balances).map(topUpLine)).toEqual([
      `chain=base-sepolia token=USDC amount=0.24 recipient=${nexus}`,
      `chain=optimism-sepolia token=ETH amount=0.0009 recipient=${FIXTURES.eoa.address}`,
    ])
  })

  test('lists every steady-state check that fails', async () => {
    const failures = await checkSteady(
      [
        { kind: 'deployed', fixture: 'nexus-main', chainId: 84532 },
        { kind: 'deployed', fixture: 'nexus-main', chainId: 11155420 },
        { kind: 'session', fixture: 'nexus-main', session: 'plain' },
        {
          kind: 'permit2',
          fixture: 'nexus-main',
          chainId: 84532,
          token: 'USDC',
        },
      ],
      {
        hasCode: async (chainId) => chainId === 84532,
        sessionEnabled: async () => false,
        async allowance(_chainId, owner, token, spender) {
          expect([owner, token, spender]).toEqual([
            nexus,
            TOKENS[84532].USDC,
            PERMIT2,
          ])
          return 0n
        },
      },
    )
    expect(failures).toEqual([
      'nexus-main is not deployed on 11155420',
      'nexus-main session "plain" is not enabled',
      'nexus-main has no Permit2 allowance for USDC on 84532',
    ])
  })
})
