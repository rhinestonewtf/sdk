import { describe, expect, it } from 'vitest'
import {
  ACCOUNT,
  BACKEND_DIGEST,
  BACKEND_WIRE,
  EXPECTED_PROJECTED,
  EXPECTED_WIRE,
  FACTORY,
  LEGACY_DIGEST,
  LEGACY_INPUT,
  USDC,
} from '../../test/fixtures/sponsorship-input'
import {
  computeBlancIntentInputDigest,
  computeIntentInputDigest,
} from '../jwt-server/digest'
import {
  normalizeBlancSponsorshipInput,
  projectBlancSponsorshipInput,
} from './sponsorship-input'
import type { IntentInput } from './types'
import { blancQuoteRequest } from './wire-quote-request'

describe('Blanc sponsorship projection', () => {
  it('matches the independent backend wire/digest fixture without defaults', async () => {
    const projected = projectBlancSponsorshipInput(BACKEND_WIRE)
    expect(projected).toEqual({
      account: BACKEND_WIRE.account,
      destinationChainId: 8453,
      destinationExecutions: BACKEND_WIRE.destinationExecutions,
      destinationGasUnits: '250000',
      tokenRequests: BACKEND_WIRE.tokenRequests,
      accountAccessList: {
        chainIds: [8453],
        chainTokenAmounts: { 1: { [USDC]: '5' } },
      },
      options: {
        sponsorSettings: { gas: true, bridgeFees: true, swapFees: false },
        signatureMode: 1,
        auxiliaryFunds: {
          42161: { '0xaf88d065e77c8cc2239327c5edb3a432268e5831': '500000000' },
        },
      },
      preClaimExecutions: { 1: [{ to: FACTORY, value: '0', data: '0xbeef' }] },
    })
    expect(await computeIntentInputDigest(projected)).toBe(BACKEND_DIGEST)
  })

  it('matches fixed legacy -> wire -> projection -> digest including session fallback and exact inputs', async () => {
    const before = structuredClone(LEGACY_INPUT)
    expect(blancQuoteRequest(LEGACY_INPUT as unknown as IntentInput)).toEqual(
      EXPECTED_WIRE,
    )
    expect(normalizeBlancSponsorshipInput(LEGACY_INPUT)).toEqual(
      EXPECTED_PROJECTED,
    )
    expect(await computeBlancIntentInputDigest(LEGACY_INPUT)).toBe(
      LEGACY_DIGEST,
    )
    expect(LEGACY_INPUT).toEqual(before)
    const bigints = {
      ...LEGACY_INPUT,
      destinationGasUnits: 250000n,
      tokenRequests: [
        { tokenAddress: USDC, amount: 900719925474099312346n },
        { tokenAddress: FACTORY },
      ],
    }
    expect(await computeBlancIntentInputDigest(bigints)).toBe(LEGACY_DIGEST)
  })

  it('lowers supported object access lists without introducing amounts or changing order', () => {
    const input = {
      ...LEGACY_INPUT,
      accountAccessList: {
        chainIds: [8453, 1],
        tokens: [FACTORY, USDC],
        chainTokens: { 1: [USDC, FACTORY] },
      },
    }
    expect(normalizeBlancSponsorshipInput(input).accountAccessList).toEqual(
      input.accountAccessList,
    )
    expect(
      normalizeBlancSponsorshipInput({ ...input, accountAccessList: [] })
        .accountAccessList,
    ).toEqual({ chainTokens: {} })
  })

  it('projects nested wire exclusions, not account delegation or mock-signature keys', () => {
    // Wire-only form: this does not assert new public legacy exclusion support.
    const raw = {
      ...EXPECTED_WIRE,
      accountAccessList: {
        chainIds: ['eip155:1'],
        exclude: {
          chainTokens: { 'eip155:8453': [USDC] },
          exclude: { chainTokenAmounts: { 'eip155:1': { [USDC]: '5' } } },
        },
      },
    }
    const projected = projectBlancSponsorshipInput(raw)
    expect(projected.accountAccessList).toEqual({
      chainIds: [1],
      exclude: {
        chainTokens: { 8453: [USDC] },
        exclude: { chainTokenAmounts: { 1: { [USDC]: '5' } } },
      },
    })
    expect(projected.account).toEqual(EXPECTED_PROJECTED.account)
  })

  it('binds omission, explicit false, empty containers, case and array order distinctly', async () => {
    const base = {
      account: { address: ACCOUNT },
      destinationChainId: 8453,
      destinationExecutions: [],
      tokenRequests: [],
      options: {},
    }
    const variants = [
      base,
      { ...base, options: { sponsorSettings: { gasSponsored: false } } },
      { ...base, options: { sponsorSettings: {} } },
      { ...base, options: { auxiliaryFunds: {} } },
      { ...base, accountAccessList: [] },
      { ...base, accountAccessList: {} },
      { ...base, destinationGasUnits: '0' },
    ]
    const hashes = await Promise.all(
      variants.map(computeBlancIntentInputDigest),
    )
    expect(new Set(hashes).size).toBe(variants.length)
    const tokens = [{ tokenAddress: USDC }, { tokenAddress: FACTORY }]
    expect(
      await computeBlancIntentInputDigest({ ...base, tokenRequests: tokens }),
    ).not.toBe(
      await computeBlancIntentInputDigest({
        ...base,
        tokenRequests: [...tokens].reverse(),
      }),
    )
    expect(
      await computeBlancIntentInputDigest({ ...base, tokenRequests: tokens }),
    ).not.toBe(
      await computeBlancIntentInputDigest({
        ...base,
        tokenRequests: [{ tokenAddress: USDC.toUpperCase() }, tokens[1]],
      }),
    )
  })

  it('binds meaningful field mutations and retains unknown metadata', async () => {
    const variants = [
      { ...LEGACY_INPUT, destinationChainId: 1 },
      { ...LEGACY_INPUT, destinationGasUnits: '250001' },
      {
        ...LEGACY_INPUT,
        recipient: { ...LEGACY_INPUT.recipient, address: ACCOUNT },
      },
      {
        ...LEGACY_INPUT,
        account: { ...LEGACY_INPUT.account, mockSignatures: { 0: '0xffff' } },
      },
      {
        ...LEGACY_INPUT,
        options: {
          ...LEGACY_INPUT.options,
          futureMetadata: { meaningful: true },
        },
      },
      { ...LEGACY_INPUT, futureMetadata: { meaningful: true } },
    ]
    for (const input of variants)
      expect(await computeBlancIntentInputDigest(input)).not.toBe(LEGACY_DIGEST)
    const metadata = { futureMetadata: { meaningful: true } }
    expect(
      normalizeBlancSponsorshipInput({ ...LEGACY_INPUT, ...metadata }),
    ).toMatchObject(metadata)
  })

  it('ignores only nonfunctional dropped legacy options and JSON-omitted members', async () => {
    expect(
      await computeBlancIntentInputDigest({
        ...LEGACY_INPUT,
        missing: undefined,
        options: {
          ...LEGACY_INPUT.options,
          topupCompact: false,
          feeToken: FACTORY,
        },
      }),
    ).toBe(LEGACY_DIGEST)
    expect(
      await computeBlancIntentInputDigest({
        ...LEGACY_INPUT,
        account: { ...LEGACY_INPUT.account, mockSignature: '0xffff' },
      }),
    ).toBe(LEGACY_DIGEST)
  })

  it.each([NaN, Infinity, -Infinity])(
    'rejects recursive non-finite %s before serialization or dropping fields',
    async (value) => {
      for (const input of [
        {
          ...LEGACY_INPUT,
          options: { ...LEGACY_INPUT.options, feeToken: { nested: [value] } },
        },
        {
          ...LEGACY_INPUT,
          tokenRequests: [{ tokenAddress: USDC, amount: value }],
        },
        { ...LEGACY_INPUT, ignored: [{ nested: value }] },
      ]) {
        await expect(computeBlancIntentInputDigest(input)).rejects.toThrow(
          /non-finite/,
        )
      }
    },
  )
})
