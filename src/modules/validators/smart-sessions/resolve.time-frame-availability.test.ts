import {
  type Address,
  erc20Abi,
  isAddressEqual,
  keccak256,
  stringToHex,
} from 'viem'
import { arbitrum, base } from 'viem/chains'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { accountA } from '../../../../test/consts'
import { getSessionData } from './digest'
import {
  PREVIOUS_TIME_FRAME_POLICY_ADDRESS,
  TIME_FRAME_POLICY_ADDRESS,
} from './policies/addresses'
import { toSession, validateSessionDefinition } from './resolve'
import type { SessionDefinition } from './types'

const deployed = vi.hoisted(() => ({ chains: [] as number[] }))
vi.mock('./policies/addresses', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./policies/addresses')>()),
  timeFramePolicyDeployed: (chainId: number) =>
    deployed.chains.includes(chainId),
}))

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const OVERRIDE = '0x00000000000000000000000000000000000000d3' as Address
const UNTIL = new Date(2_000_000_000_000)
const owners = { type: 'ecdsa' as const, accounts: [accountA] }

const windowed = (extra: Partial<SessionDefinition> = {}): SessionDefinition =>
  ({
    chain: base,
    owners,
    restrictToActions: true,
    permissions: [
      {
        abi: erc20Abi,
        address: USDC,
        functions: { approve: { validUntil: UNTIL } },
      },
    ],
    ...extra,
  }) as SessionDefinition

const policiesOf = (definition: SessionDefinition) => {
  const data = getSessionData(toSession(definition))
  return [
    ...data.actions.flatMap((a) => a.actionPolicies),
    ...data.erc7739Policies.erc1271Policies,
  ].map((p) => p.policy)
}

beforeEach(() => {
  deployed.chains = []
})

describe('on a chain without the TimeFramePolicy', () => {
  test('an action window is refused', () => {
    expect(() => toSession(windowed())).toThrow(
      'chain 8453: an action window on a chain without the TimeFramePolicy; set policyAddresses.timeFrame',
    )
    expect(
      validateSessionDefinition(windowed()).refusals.map(({ code }) => code),
    ).toEqual(['TIME_FRAME_POLICY_UNAVAILABLE'])
  })

  test("a permit's window is refused", () => {
    const definition: SessionDefinition = {
      chain: base,
      owners,
      crossChainPermits: [
        {
          from: { chain: base, token: USDC },
          to: { chain: arbitrum, token: USDC_ARB },
          settlementLayers: ['ACROSS'],
          validUntil: UNTIL,
        },
      ],
    }
    expect(
      validateSessionDefinition(definition).refusals.map(({ code }) => code),
    ).toEqual(['TIME_FRAME_POLICY_UNAVAILABLE'])
  })

  test('policyAddresses.timeFrame resolves it with that address', () => {
    const policies = policiesOf(
      windowed({ policyAddresses: { timeFrame: OVERRIDE } }),
    )
    expect(policies).toContain(OVERRIDE)
    expect(policies).not.toContain(TIME_FRAME_POLICY_ADDRESS)
  })

  // As on main: the previous deployment holds a window on ERC-1271 checks.
  test('a signing window keeps the previous TimeFramePolicy', () => {
    const definition: SessionDefinition = {
      chain: base,
      owners,
      signing: { mode: 'unrestricted', validUntil: UNTIL },
    }
    expect(policiesOf(definition)).toContain(PREVIOUS_TIME_FRAME_POLICY_ADDRESS)
    const session = toSession(definition)
    expect({
      permissionId: session.permissionId,
      data: keccak256(stringToHex(JSON.stringify(getSessionData(session)))),
    }).toEqual({
      permissionId:
        '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
      data: '0xe85a96179c54656557825227400e1a5099b36ccddb54271b34ef24cb08e0820a',
    })
  })
})

test('on a chain with it, an action window uses it', () => {
  deployed.chains = [base.id]
  const policies = policiesOf(windowed())
  expect(
    policies.some((p) => isAddressEqual(p, TIME_FRAME_POLICY_ADDRESS)),
  ).toBe(true)
  expect(policies).not.toContain(PREVIOUS_TIME_FRAME_POLICY_ADDRESS)
})
