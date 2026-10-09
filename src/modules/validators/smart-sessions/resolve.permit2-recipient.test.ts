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
  // A permit naming only a retired arbiter needs a fallback to resolve.
  ...(Array.isArray(crossChainPermit.settlementLayers) &&
  !crossChainPermit.settlementLayers.includes('ACROSS')
    ? { fallback: 'intentExecution' as const }
    : {}),
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
  ['ECO', ['ECO']],
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
    account: session(permit(ACCOUNT, ['ECO'])),
    noRecipient: session({
      from: { chain: base, token: USDC },
      to: { chain: arbitrum, token: USDC_ARB },
    }),
    otherWithoutAccount: session(permit(OTHER, ['ACROSS']), null),
  }

  // Moved when Permit2-route sessions became scoped and gained their Permit2
  // approve (RHI-8045); `account` names ECO, so it now sets a fallback.
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
        '0x82d90c1b72d8bc0bb107f114c9b073bb00ee311c77ea3e7fd3aec65e2fc96eae',
      anyWithOptOut:
        '0xb797190ae90ba3f2830a8dd0a9e8f9b95c66f9c45745d57e6656caad595241c2',
      account:
        '0x0f91b0e3ebf33773cc2e05a4a97532236db6699da4ffaf1bc0f7ac98cb5e0c3a',
      noRecipient:
        '0x296f4d30d6cf2c2c279feab6956e938820fa88fecca74bfb744ecb48ad55f8e2',
      otherWithoutAccount:
        '0xcc2941a50c0615251f3c209b21d646b1c7c953268f2e377079c10a4e87f14ae0',
    })
  })
})
