import { type Address, erc20Abi, keccak256, stringToHex } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { SETTLEMENT_CATALOG } from '../../../../test/utils/settlement-catalog'
import { getSessionData } from './digest'
import { toSession } from './resolve'
import type { SessionDefinition } from './types'

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address
const TARGET = '0x4444444444444444444444444444444444444444' as Address
const ACCOUNT = '0x1111111111111111111111111111111111111111' as Address
const ARBITER = '0x00000000000000000000000000000000000000ab' as Address
const ONE_TIME_USE = '0x3333333333333333333333333333333333333333' as Address
// source: 2_000_000_000 s = 2033-05-18T03:33:20Z (date -u -r 2000000000)
const UNTIL = new Date(2_000_000_000_000)
const owners = { type: 'ecdsa' as const, accounts: [accountA] }

function fingerprint(definition: SessionDefinition) {
  const session = toSession(definition, { settlement: SETTLEMENT_CATALOG })
  return {
    permissionId: session.permissionId,
    data: keccak256(stringToHex(JSON.stringify(getSessionData(session)))),
  }
}

// Sessions that set no time window on an action must not move.
const WINDOWLESS: Record<string, SessionDefinition> = {
  sudo: { chain: base, owners },
  'permissions, strict salt': {
    chain: base,
    owners,
    restrictToActions: true,
    saltMode: 'strict',
    permissions: [
      {
        abi: erc20Abi,
        address: USDC,
        functions: {
          transfer: {
            maxUses: 3n,
            params: { recipient: { condition: 'equal', value: ACCOUNT } },
            spendingLimit: { token: USDC, amount: 100n },
          },
        },
      },
    ],
  },
  'raw actions, strict salt': {
    chain: base,
    owners,
    restrictToActions: true,
    saltMode: 'strict',
    actions: [
      {
        target: TARGET,
        selector: '0x12345678',
        policies: [{ type: 'usage-limit', limit: 2n }],
      },
    ],
  },
  'Permit2 crossChainPermit': {
    chain: base,
    owners,
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['ACROSS'],
      },
    ],
  },
  'oneTimeUse with permissions and claim policies': {
    chain: base,
    owners,
    claimPolicies: [{ type: 'permit2', spenders: [ARBITER] }],
    oneTimeUse: { id: 42n, validUntil: UNTIL },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    permissions: [
      {
        abi: erc20Abi,
        address: USDC,
        functions: { approve: { maxUses: 1n } },
      },
    ],
  },
  'oneTimeUse with raw actions': {
    chain: base,
    owners,
    oneTimeUse: { id: 42n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    actions: [{ target: TARGET, selector: '0x12345678' }],
  },
  'signing window': {
    chain: base,
    owners,
    signing: { mode: 'unrestricted', validUntil: UNTIL },
  },
  'CCTP permit with oneTimeUse and validUntil': {
    chain: base,
    owners,
    account: ACCOUNT,
    oneTimeUse: { id: 7n },
    policyAddresses: { oneTimeUseId: ONE_TIME_USE },
    crossChainPermits: [
      {
        from: { chain: base, token: USDC, maxAmount: 100n },
        to: { chain: arbitrum, token: USDC_ARB },
        settlementLayers: ['CCTP'],
        validUntil: UNTIL,
      },
    ],
  },
}

const PINS: Record<string, ReturnType<typeof fingerprint>> = {
  sudo: {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0x1b791b38b956d1668774edc6271033a527587365f14887f25d595f6f59f8ecd2',
  },
  'permissions, strict salt': {
    permissionId:
      '0x808c065224a8fb39921a8877d47144e2d016c553c252f52ec8eb888f3ad4b5e6',
    data: '0x4296fb45e854548ad4c61a8c54c2051a5299a2f94b0ad6dddbd1467ae9ae1d7c',
  },
  'raw actions, strict salt': {
    permissionId:
      '0x5e76b37831e3aba8f394e9fe12df02a8fdec55174e1b27c29adc810b8a5cc844',
    data: '0x4538d4956dfb324c2488d867a58f9388bd835707cd03ec2b271b5b59c68f1505',
  },
  'Permit2 crossChainPermit': {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0x77b9b5fedc7034a7a3697fc457eddba419fe6cfed294fb6dd4f21140c9791673',
  },
  'oneTimeUse with permissions and claim policies': {
    permissionId:
      '0x95b67478505169c7c2909d90a7c4593323e395cec895891644ecdc997ef47be3',
    data: '0x7a9eae27a5ca0b41756261702d0963e01d1e5bb82c5500e866dbe55efb77a995',
  },
  'oneTimeUse with raw actions': {
    permissionId:
      '0xa3f51489e58d860da4f7c9a62d6ad59399b71818f2024a63918449a3a43e2dbb',
    data: '0x9e1812c4bf425f47bafcc98313c9f3a62fd230e9b442ada45828beb3063b7a7c',
  },
  'signing window': {
    permissionId:
      '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
    data: '0xe85a96179c54656557825227400e1a5099b36ccddb54271b34ef24cb08e0820a',
  },
  'CCTP permit with oneTimeUse and validUntil': {
    permissionId:
      '0xe67ea3240512c8162f9d8f2f5f8e56e5941c11b4737924687c7afc8c33fa7de9',
    data: '0x4a549b527124f0c37bec4952f2cd5f53f310c0413d0ad25b553347981e37100a',
  },
}

describe('a session with no action time window keeps its permissionId and data', () => {
  test.each(Object.entries(WINDOWLESS))('%s', (name, definition) => {
    expect(fingerprint(definition)).toEqual(PINS[name])
  })
})
