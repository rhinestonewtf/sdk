import { base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../test/consts'
import {
  getSessionDetails,
  isSessionEnabled,
  ONE_TIME_USE_ID_POLICY_ADDRESS,
  ONE_TIME_USE_ID_POLICY_ADDRESS_DEV,
  SMART_SESSION_EMISSARY_ADDRESS_DEV,
  toSession,
  validateSession,
} from './index'

const reads = vi.hoisted(() => vi.fn())

vi.mock('../clients/rpc/compatibility', () => ({
  materializeRpcReader: () => ({
    chain: { kind: 'evm', id: 8453, caip2: 'eip155:8453' },
    rpc: {
      getCode: vi.fn(),
      getTransactionCount: vi.fn(),
      readContract: reads,
      multicall: vi.fn(),
    },
  }),
}))

const account = '0x0000000000000000000000000000000000000001' as const

describe('Smart Sessions compatibility facade', () => {
  beforeEach(() => reads.mockReset())

  test('materializes nonce reads and preserves typed authorization data', async () => {
    reads.mockResolvedValue(7n)
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })

    const details = await getSessionDetails(account, [session], undefined, true)

    expect(details.nonces).toEqual([7n])
    expect(details.hashesAndChainIds).toHaveLength(1)
    expect(details.data.primaryType).toBe('MultiChainSession')
    expect(reads).toHaveBeenCalledWith(
      { chain: { kind: 'evm', id: 8453, caip2: 'eip155:8453' } },
      expect.objectContaining({
        address: SMART_SESSION_EMISSARY_ADDRESS_DEV,
        functionName: 'getNonce',
      }),
    )
  })

  test('delegates enabled-state reads with the session permission id', async () => {
    reads.mockResolvedValue(true)
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })

    await expect(
      isSessionEnabled(account, undefined, session, false),
    ).resolves.toBe(true)
    expect(reads).toHaveBeenCalledWith(
      { chain: { kind: 'evm', id: 8453, caip2: 'eip155:8453' } },
      expect.objectContaining({
        functionName: 'isPermissionEnabled',
        args: [account, session.permissionId],
      }),
    )
  })

  test.each([
    [false, ONE_TIME_USE_ID_POLICY_ADDRESS],
    [true, ONE_TIME_USE_ID_POLICY_ADDRESS_DEV],
  ] as const)(
    'the exported one-time-use address is the default (useDevContracts: %s)',
    (useDevContracts, address) => {
      const session = toSession(
        {
          chain: base,
          owners: { type: 'ecdsa', accounts: [accountA] },
          oneTimeUse: { id: 1n },
        },
        { useDevContracts },
      )
      expect(session.oneTimeUse?.policy).toBe(address)
    },
  )
})

describe('validateSession', () => {
  test('reports the refusal toSession throws, without throwing', () => {
    const definition = {
      chain: base,
      owners: { type: 'ecdsa' as const, accounts: [accountA] },
      account,
      crossChainPermits: [
        {
          from: { chain: base, token: account },
          to: { chain: base, token: account },
          settlementLayers: ['CCTP' as const],
        },
      ],
    }
    const { refusals } = validateSession(definition, {
      useDevContracts: true,
      wrappedNativeToken: account,
    })

    expect(refusals).toEqual([
      {
        code: 'SETTLEMENT_CATALOG_MISSING',
        message: expect.stringContaining('settlement addresses'),
        permitIndex: 0,
      },
    ])
    expect(() => toSession(definition)).toThrow(refusals[0].message)
    expect(validateSession(definition, { settlement: {} }).refusals).toEqual([
      expect.objectContaining({ code: 'LAYER_NOT_SERVED', layer: 'CCTP' }),
    ])
  })
})
