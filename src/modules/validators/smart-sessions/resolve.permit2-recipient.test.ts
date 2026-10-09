import type { Address } from 'viem'
import { arbitrum, base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { sessionFingerprint } from '../../../../test/utils/session-fingerprint'
import { toSession, validateSessionDefinition } from './resolve'
import type {
  CrossChainPermissionInput,
  CrossChainSettlementLayer,
  SessionDefinition,
} from './types'

const ACCOUNT = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' as Address
const OTHER = '0x2222222222222222222222222222222222222222' as Address
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address
const USDC_ARB = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address

const permit = (
  recipient: Address | 'any',
  settlementLayers: CrossChainSettlementLayer[] | undefined,
  extra: Partial<CrossChainPermissionInput> = {},
): CrossChainPermissionInput => ({
  from: { chain: base, token: USDC },
  to: { chain: arbitrum, token: USDC_ARB, recipient },
  ...(settlementLayers ? { settlementLayers } : {}),
  ...extra,
})

const session = (
  crossChainPermit: CrossChainPermissionInput,
  account: Address | null = ACCOUNT,
): SessionDefinition => ({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  ...(account ? { account } : {}),
  crossChainPermits: [crossChainPermit],
  // The recipient guard holds on every Permit2 session; a fallback lets every
  // layer list here resolve.
  fallback: 'intentExecution',
})

function thrown(definition: SessionDefinition): unknown {
  try {
    toSession(definition)
    return undefined
  } catch (error) {
    return error
  }
}

const LAYERS: [string, CrossChainSettlementLayer[] | undefined][] = [
  ['ACROSS', ['ACROSS']],
  ['SAME_CHAIN', ['SAME_CHAIN']],
  ['omitted layers', undefined],
]

describe('a Permit2-route recipient without allowRecipientNotAccount', () => {
  test.each(LAYERS)(
    '%s refuses a recipient other than the account',
    (_, layers) => {
      const definition = session(permit(OTHER, layers))
      const message =
        'crossChainPermits: a recipient other than the account requires allowRecipientNotAccount'
      expect(validateSessionDefinition(definition).refusals).toEqual([
        { code: 'RECIPIENT_NOT_ACCOUNT', message, permitIndex: 0 },
      ])
      expect(thrown(definition)).toMatchObject({
        code: 'RECIPIENT_NOT_ACCOUNT',
        message,
      })
    },
  )

  test.each(LAYERS)("%s refuses recipient 'any'", (_, layers) => {
    for (const account of [ACCOUNT, null]) {
      const definition = session(permit('any', layers), account)
      const message =
        "crossChainPermits: recipient 'any' requires allowRecipientNotAccount"
      expect(validateSessionDefinition(definition).refusals).toEqual([
        { code: 'RECIPIENT_ANY_NOT_ALLOWED', message, permitIndex: 0 },
      ])
      expect(thrown(definition)).toMatchObject({
        code: 'RECIPIENT_ANY_NOT_ALLOWED',
        message,
      })
    }
  })

  test('accepts the account itself in any casing', () => {
    for (const recipient of [ACCOUNT, ACCOUNT.toLowerCase() as Address]) {
      const definition = session(permit(recipient, ['ACROSS']))
      expect(validateSessionDefinition(definition).refusals).toEqual([])
      expect(thrown(definition)).toBeUndefined()
    }
  })
})

describe('Permit2-route session data is unchanged where it was valid', () => {
  const optOut = { allowRecipientNotAccount: true }
  const sessions: Record<string, SessionDefinition> = {
    otherWithOptOut: session(permit(OTHER, ['ACROSS'], optOut)),
    anyWithOptOut: session(permit('any', undefined, optOut)),
    account: session(permit(ACCOUNT, ['SAME_CHAIN'])),
    noRecipient: session({
      from: { chain: base, token: USDC },
      to: { chain: arbitrum, token: USDC_ARB },
    }),
    otherWithoutAccount: session(permit(OTHER, ['ACROSS']), null),
  }

  // Moved when Permit2-route sessions became scoped and gained their Permit2
  // approve (RHI-8045); `account` named the now-refused ECO, so it names
  // SAME_CHAIN, and the omitted-layer claims admit only ACROSS. Every row now
  // sets fallback: 'intentExecution', which a reusable session without
  // preClaimOps: 'none' needs. They moved again when a fallback session
  // stopped carrying the Permit2 approve, which the wildcard admits; the two
  // rows naming ACROSS are back to their pre-RHI-8045 values.
  test('fingerprints match the ones taken before the guard', () => {
    expect(
      Object.fromEntries(
        Object.entries(sessions).map(([name, definition]) => [
          name,
          sessionFingerprint(toSession(definition)),
        ]),
      ),
    ).toEqual({
      otherWithOptOut:
        '0x5c14b1be114bc8fd2e6fc2e8f3bbda18295318cb6c9312f50d69d2b0b7ce439a',
      anyWithOptOut:
        '0xaffd40a19c56633c09f299b24d8d6326e837f2857c8d3cb5a69fa19e5c65a38f',
      account:
        '0xd211a58d5b9604cdd498386987d19089c518ca24c538bb2727e1062955c08185',
      noRecipient:
        '0x96bd6382888ab3db8290dfe1f55e47dc829788f9c4bd693aefe48223741ca139',
      otherWithoutAccount:
        '0x04779655315c89122ded6a9327f176053fb94a07a0e0f83f40d737e8eb66a6d2',
    })
  })
})
