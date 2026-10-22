import { privateKeyToAccount } from 'viem/accounts'
import { mainnet } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { toEvmChainReference } from '../../chains/caip2'
import { toSession } from '../../modules/validators/smart-sessions/resolve'
import type {
  RoutedRhinestoneSwapVenue,
  Session,
} from '../../modules/validators/smart-sessions/types'
import { constrainSessionIntent } from './session-routing'
import type { IntentInput } from './types'

const token = '0x0000000000000000000000000000000000000001'
const other = '0x0000000000000000000000000000000000000002'
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const base = toSession({
  chain: mainnet,
  owners: { type: 'ecdsa', accounts: [account] },
})
const scoped: Session = {
  ...base,
  permit2Sources: [{ chain: mainnet, token, maxAmount: 10n }],
  settlementLayers: ['ACROSS'],
}
const intent = (
  session: Session,
  options?: IntentInput['options'],
): IntentInput => ({
  source: { chain: toEvmChainReference(1), token },
  destination: toEvmChainReference(42161),
  calls: [],
  signers: { kind: 'smart-session', byChain: { 1: { session } } },
  options,
})

const swapSession = (via: NonNullable<Session['swap']>['via']): Session => ({
  ...base,
  swap: { to: account.address, sell: { token }, buy: { token: other }, via },
})

// Only a destination running the account's own calls participates in routing.
const withDestinationSession = (
  input: IntentInput,
  session: Session,
): IntentInput => ({
  ...input,
  calls: [{ target: other, value: 0n, data: '0x' }],
  signers: {
    kind: 'smart-session',
    byChain: {
      ...(input.signers?.kind === 'smart-session' ? input.signers.byChain : {}),
      42161: { session },
    },
  },
})

describe('singular session source and routing constraints', () => {
  test('leaves non-session intents untouched', () => {
    const input = { ...intent(base), signers: undefined }
    expect(constrainSessionIntent(input, account.address)).toBe(input)
  })

  test('preserves explicit filters when sessions have no route pins', () => {
    const options: IntentInput['options'] = {
      settlementLayers: { include: ['CCTP', 'OFT'] },
      quoters: { exclude: ['0x'] },
    }
    const result = constrainSessionIntent(
      intent(base, options),
      account.address,
    )
    expect(result.options).toEqual(options)
    expect(
      constrainSessionIntent(intent(base), account.address).options,
    ).toEqual({})
  })

  test('caps the named source and preserves a tighter caller cap', () => {
    const input = intent(scoped)
    expect(
      constrainSessionIntent(input, account.address).source?.maxAmount,
    ).toBe(10n)
    expect(
      constrainSessionIntent(
        { ...input, source: { ...input.source!, maxAmount: 3n } },
        account.address,
      ).source?.maxAmount,
    ).toBe(3n)
    expect(input.source?.maxAmount).toBeUndefined()
  })
  test('refuses incompatible token or chain instead of discovering another source', () => {
    const input = intent(scoped)
    expect(() =>
      constrainSessionIntent(
        { ...input, source: { ...input.source!, token: other } },
        account.address,
      ),
    ).toThrow('funding scope')
    expect(() =>
      constrainSessionIntent(
        intent({
          ...scoped,
          permit2Sources: [{ chain: { ...mainnet, id: 10 }, token }],
        }),
        account.address,
      ),
    ).toThrow('funding scope')
  })
  test('same-chain ACROSS requires the swap scope and spends only its sell tokens/cap', () => {
    const input = { ...intent(scoped), destination: toEvmChainReference(1) }
    expect(() => constrainSessionIntent(input, account.address)).toThrow(
      'swap scope',
    )
    const session: Session = {
      ...scoped,
      swap: {
        to: account.address,
        sell: { token: other, maxTotal: 4n },
        buy: { token },
        via: [{ id: 'fynd' as const }],
      },
    }
    const withSwap = {
      ...input,
      signers: { kind: 'smart-session' as const, byChain: { 1: { session } } },
    }
    expect(() => constrainSessionIntent(withSwap, account.address)).toThrow(
      'funding scope',
    )
    const adapted = constrainSessionIntent(
      { ...withSwap, source: { ...withSwap.source!, token: other } },
      account.address,
    )
    expect(adapted.source).toMatchObject({ token: other, maxAmount: 4n })
    expect(adapted.options?.quoters).toEqual({ include: ['fynd'] })
  })
  test('intersects scoped layers and refuses an incompatible explicit filter', () => {
    const session = {
      ...scoped,
      access: { kind: 'scoped' as const, reason: 'scoped' },
      settlementLayers: ['ACROSS', 'CCTP'] as const,
    }
    expect(
      constrainSessionIntent(
        intent(session, { settlementLayers: { include: ['CCTP', 'OFT'] } }),
        account.address,
      ).options?.settlementLayers,
    ).toEqual({ include: ['CCTP'] })
    expect(() =>
      constrainSessionIntent(
        intent(session, { settlementLayers: { exclude: ['ACROSS', 'CCTP'] } }),
        account.address,
      ),
    ).toThrow('no settlement layer')
  })
  test('open fallback excludes only unnamed Permit2 arbiters', () => {
    const session = { ...scoped, settlementLayers: ['SAME_CHAIN'] as const }
    expect(
      constrainSessionIntent(intent(session), account.address).options
        ?.settlementLayers,
    ).toEqual({ exclude: ['ACROSS'] })
  })
  test('preserves uncapped funding legs and caps an excessive caller amount', () => {
    const input = intent({
      ...scoped,
      permit2Sources: [{ chain: mainnet, token }],
    })
    expect(constrainSessionIntent(input, account.address).source).toBe(
      input.source,
    )
    const capped = intent(scoped)
    expect(
      constrainSessionIntent(
        { ...capped, source: { ...capped.source!, maxAmount: 20n } },
        account.address,
      ).source?.maxAmount,
    ).toBe(10n)
  })

  test('same-chain plural sell scope admits each token, not just the funding leg', () => {
    const session: Session = {
      ...scoped,
      swap: {
        to: account.address,
        sell: { tokens: [token, other], maxTotal: 7n },
        buy: { token },
      },
    }
    for (const sellToken of [token, other] as const) {
      const input = intent(session)
      expect(
        constrainSessionIntent(
          {
            ...input,
            destination: toEvmChainReference(1),
            source: { ...input.source!, token: sellToken },
          },
          account.address,
        ).source,
      ).toMatchObject({ token: sellToken, maxAmount: 7n })
    }
  })

  test('default open layers preserve ACROSS when named and merge fallback exclusions', () => {
    expect(
      constrainSessionIntent(intent(scoped), account.address).options,
    ).toEqual({})
    const session: Session = { ...base, settlementLayers: ['ECO'] }
    expect(
      constrainSessionIntent(
        intent(session, { settlementLayers: { exclude: ['OFT', 'ACROSS'] } }),
        account.address,
      ).options?.settlementLayers,
    ).toEqual({ exclude: ['OFT', 'ACROSS'] })
    expect(
      constrainSessionIntent(
        intent(session, { settlementLayers: { include: ['ACROSS', 'CCTP'] } }),
        account.address,
      ).options?.settlementLayers,
    ).toEqual({ include: ['CCTP'] })
    expect(() =>
      constrainSessionIntent(
        intent(session, { settlementLayers: { include: ['ACROSS'] } }),
        account.address,
      ),
    ).toThrow('no settlement layer')
  })

  test('maps legacy layers and intersects source and self-recipient destination pins', () => {
    const source: Session = {
      ...base,
      settlementLayers: ['SAME_CHAIN_IE', 'ECO_IE', 'CCTP'],
    }
    const destination: Session = {
      ...base,
      settlementLayers: ['CCTP', 'OFT'],
    }
    expect(
      constrainSessionIntent(intent(source), account.address).options
        ?.settlementLayers,
    ).toEqual({ include: ['ECO', 'CCTP'] })
    const input = withDestinationSession(intent(source), destination)
    expect(
      constrainSessionIntent(
        {
          ...input,
          recipient: { kind: 'bare', address: account.address.toLowerCase() },
        },
        account.address.toUpperCase(),
      ).options?.settlementLayers,
    ).toEqual({ include: ['CCTP'] })
    expect(
      constrainSessionIntent(
        { ...input, recipient: { kind: 'bare', address: other } },
        account.address,
      ).options?.settlementLayers,
    ).toEqual({ include: ['ECO', 'CCTP'] })
    expect(
      constrainSessionIntent({ ...input, source: undefined }, account.address)
        .options?.settlementLayers,
    ).toEqual({ include: ['CCTP', 'OFT'] })
    expect(() =>
      constrainSessionIntent(
        withDestinationSession(intent(source), {
          ...destination,
          settlementLayers: ['OFT'],
        }),
        account.address,
      ),
    ).toThrow('no settlement layer')
    expect(
      constrainSessionIntent({ ...input, calls: [] }, account.address).options
        ?.settlementLayers,
    ).toEqual({ include: ['ECO', 'CCTP'] })
  })

  test('open destination exclusions narrow scoped source pins', () => {
    const input = withDestinationSession(
      intent({
        ...scoped,
        access: { kind: 'scoped', reason: 'scoped' },
        settlementLayers: ['ACROSS', 'CCTP'],
      }),
      { ...base, settlementLayers: ['SAME_CHAIN'] },
    )
    expect(
      constrainSessionIntent(input, account.address).options?.settlementLayers,
    ).toEqual({ include: ['CCTP'] })
  })

  test.each([
    ['zeroEx', '0x'],
    ['fynd', 'fynd'],
  ] as const)('pins rhinestone %s routes to %s', (route, quoter) => {
    const venue: RoutedRhinestoneSwapVenue = { id: 'rhinestone', route }
    expect(
      constrainSessionIntent(intent(swapSession([venue])), account.address)
        .options?.quoters,
    ).toEqual({ include: [quoter] })
  })

  test('unconstrained rhinestone venues do not restrict explicit or other session pins', () => {
    const session = swapSession([{ id: '0x' }, { id: 'rhinestone' }])
    const options: IntentInput['options'] = { quoters: { include: ['fynd'] } }
    expect(
      constrainSessionIntent(intent(session, options), account.address).options,
    ).toEqual(options)
    expect(
      constrainSessionIntent(
        withDestinationSession(intent(session), swapSession([{ id: 'fynd' }])),
        account.address,
      ).options?.quoters,
    ).toEqual({ include: ['fynd'] })
  })

  test('intersects multiple session venues and preserves an empty intersection', () => {
    const source = swapSession([{ id: '0x' }, { id: 'fynd' }])
    const input = withDestinationSession(
      intent(source),
      swapSession([{ id: '0x' }]),
    )
    expect(
      constrainSessionIntent(input, account.address).options?.quoters,
    ).toEqual({ include: ['0x'] })
    expect(
      constrainSessionIntent(
        withDestinationSession(
          intent(swapSession([{ id: 'fynd' }])),
          swapSession([{ id: '0x' }]),
        ),
        account.address,
      ).options?.quoters,
    ).toEqual({ include: [] })
  })

  test('irrelevant sessions cannot veto global quoters; caller cannot widen pins', () => {
    const session: Session = {
      ...base,
      swap: {
        to: account.address,
        sell: { token },
        buy: { token: other },
        via: [{ id: 'fynd' }],
      },
    }
    const input: IntentInput = {
      ...intent(session, { quoters: { include: ['0x', 'fynd'] } }),
      signers: {
        kind: 'smart-session',
        byChain: {
          1: { session },
          10: {
            session: {
              ...session,
              swap: { ...session.swap!, via: [{ id: '0x' }] },
            },
          },
        },
      },
    }
    expect(
      constrainSessionIntent(input, account.address).options?.quoters,
    ).toEqual({ include: ['fynd'] })
    expect(
      constrainSessionIntent(
        intent(session, { quoters: { exclude: ['fynd'] } }),
        account.address,
      ).options?.quoters,
    ).toEqual({ include: [] })
  })
})
