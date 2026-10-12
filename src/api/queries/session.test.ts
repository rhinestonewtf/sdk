import type { Address, Hex } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../test/utils/settlement-catalog'
import { ChainCatalog } from '../../clients/orchestrator/chain-catalog'
import type { ChainCatalogPort } from '../../clients/orchestrator/port'
import type { RpcPort } from '../../clients/rpc/port'
import type { SessionDefinition } from '../../modules/validators/smart-sessions/types'
import { toSession } from '../../smart-sessions'
import { createSession } from './session'

// These tests assume the TimeFramePolicy is deployed on their chains.
vi.mock(
  '../../modules/validators/smart-sessions/policies/addresses',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../../modules/validators/smart-sessions/policies/addresses')
    >()),
    timeFramePolicyDeployed: () => true,
  }),
)

const USDC = SETTLEMENT_CATALOG[base.id].cctp!.usdc
const USDC_ARB = SETTLEMENT_CATALOG[arbitrum.id].cctp!.usdc
const WETH = '0x4200000000000000000000000000000000000006' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address

const definition = (layers: object = {}) =>
  ({
    chain: base,
    owners: { type: 'ecdsa', accounts: [accountA] },
    account: ACCOUNT,
    oneTimeUse: { id: 7n },
    policyAddresses: {
      oneTimeUseId: '0x3333333333333333333333333333333333333333',
    },
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        ...layers,
      },
    ],
  }) as SessionDefinition

const served = (id: number) => ({
  name: String(id),
  testnet: false,
  supportedTokens: 'all' as const,
  settlement: SETTLEMENT_CATALOG[id],
})

const created = (definition: SessionDefinition) =>
  createSession({
    environment: 'production',
    definition,
    orchestrator: {
      getChainCatalog: async () =>
        new ChainCatalog({
          [base.id]: {
            ...served(base.id),
            wrappedNativeToken: { symbol: 'WETH', address: WETH, decimals: 18 },
          },
          [arbitrum.id]: served(arbitrum.id),
        }),
    } as unknown as ChainCatalogPort,
    rpc: {
      forChain: () => ({
        getCode: async () => ({ code: '0x6080604052' as Hex }),
      }),
    } as unknown as RpcPort,
  })

describe('settlementLayers omitted', () => {
  test('toSession with the settlement catalog builds what createSession builds', async () => {
    const online = await created(definition())
    const offline = toSession(definition() as never, {
      settlement: SETTLEMENT_CATALOG,
      wrappedNativeToken: WETH,
    })
    expect(offline).toEqual(online)
    expect(offline.settlementLayers).toEqual(['ACROSS', 'CCTP', 'LZ'])
    expect(online).toEqual(
      await created(definition({ settlementLayers: 'all' })),
    )
  })

  test('toSession without the settlement catalog names both fixes', () => {
    const message =
      "crossChainPermits: IntentExecutor layers and 'all' (the default) need options.settlement from GET /chains; pass it or name settlementLayers, e.g. ['ACROSS']"
    expect(() => toSession(definition() as never)).toThrow(message)
    expect(() =>
      toSession(definition({ settlementLayers: 'all' }) as never),
    ).toThrow(message)
  })

  test("toSession with ['ACROSS'] still builds without the catalog", async () => {
    const across = definition({ settlementLayers: ['ACROSS'] })
    const offline = toSession(across as never)
    expect(offline.settlementLayers).toEqual(['ACROSS'])
    expect(offline.permissionId).toEqual((await created(across)).permissionId)
  })
})
