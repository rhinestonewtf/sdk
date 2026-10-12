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
const multicalls = vi.hoisted(() => vi.fn())

vi.mock('../clients/rpc/compatibility', () => ({
  materializeRpcReader: () => ({
    chain: { kind: 'evm', id: 8453, caip2: 'eip155:8453' },
    rpc: {
      getCode: vi.fn(),
      getTransactionCount: vi.fn(),
      readContract: reads,
      multicall: multicalls,
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
        message: expect.stringContaining('need options.settlement'),
        permitIndex: 0,
      },
    ])
    expect(() => toSession(definition)).toThrow(refusals[0].message)
    expect(validateSession(definition, { settlement: {} }).refusals).toEqual([
      expect.objectContaining({ code: 'LAYER_NOT_SERVED', layer: 'CCTP' }),
    ])
  })
})

describe('getSessionDetails with a lifetime budget', () => {
  beforeEach(() => {
    reads.mockReset()
    multicalls.mockReset()
  })

  const session = toSession({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account,
    crossChainPermits: [
      {
        from: {
          chain: base,
          token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
          maxAmount: 100n,
        },
        to: { chain: base, token: account },
        settlementLayers: ['ACROSS'],
      },
    ],
  })
  // The pinned read says enabled; a lagging node behind the plain reads does not.
  const chainState = (enabled: boolean) => {
    multicalls.mockResolvedValue([{ result: 7n }, { result: enabled }])
    reads.mockImplementation(async (...args: unknown[]) =>
      args.some(
        (arg) =>
          (arg as { functionName?: string } | undefined)?.functionName ===
          'isPermissionEnabled',
      )
        ? false
        : 6n,
    )
  }

  test('refuses an enabled one from one read at one block, unless the caller opts in', async () => {
    chainState(true)
    await expect(
      getSessionDetails(account, [session], undefined, false),
    ).rejects.toThrow('allowBudgetReset')
    expect(multicalls).toHaveBeenCalledWith(expect.anything(), [
      expect.objectContaining({
        functionName: 'getNonce',
        args: [account, '0x000000000000000000000000'],
      }),
      expect.objectContaining({
        functionName: 'isPermissionEnabled',
        args: [account, session.permissionId],
      }),
    ])
    expect(reads).not.toHaveBeenCalled()
    await expect(
      getSessionDetails(account, [session], undefined, false, {
        allowBudgetReset: true,
      }),
    ).resolves.toMatchObject({ nonces: [6n] })
  })

  test('signs one not yet enabled at the nonce of that read', async () => {
    chainState(false)
    await expect(
      getSessionDetails(account, [session], undefined, false),
    ).resolves.toMatchObject({ nonces: [7n] })
  })

  test('fails closed when the read fails', async () => {
    multicalls.mockResolvedValue([{ result: 7n }, { error: new Error('x') }])
    await expect(
      getSessionDetails(account, [session], undefined, false),
    ).rejects.toThrow('Could not read the session nonce and enabled state')
  })
})
