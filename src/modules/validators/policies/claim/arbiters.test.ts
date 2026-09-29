import { describe, expect, test } from 'vitest'
import { getArbitersForSettlementLayers } from './arbiters'

// source: shared-configs generated production / development address books
const PROD = {
  samechain: '0x000000000006e2569CaF8Ff021810790e0A0D740',
  eco: [
    '0x2e7627CCfAe4eDb336eEb5a70f08415B0F1a2b8C',
    '0xA212A6ACCC8db0e4cdf4394D0A851c70Fc27A8F0',
  ],
  across7579: '0x28a4D41776968c1201A807ec51fFB405362B8882',
  acrossMulticall: '0xA162fabb9a0EeF2736485A587aAAB3d015e14224',
}
const DEV = {
  samechain: '0x8fA7720Eee299223f25De8DC03C68A28541dCD10',
  eco: [
    '0x1BeBAfb3D05d84A5Bfd94800c88d1342f755d8AB',
    '0x8A061029AE4c5Cf69b5368119B3b0C80B31F55fE',
  ],
  across7579: '0x1b19973F7a29E950ad4FaF8872745B6378005517',
  acrossMulticall: '0x8343FBBA0526deC1c952A098057021027648bcf9',
}

describe('getArbitersForSettlementLayers', () => {
  test('undefined / empty layers keep the original allow-set, in order', () => {
    // A permit that omits settlementLayers must resolve to the same claim
    // policy (and digest) it always has, retired Standard ECO arbiter included.
    const expected = [
      PROD.samechain,
      ...PROD.eco,
      PROD.across7579,
      PROD.acrossMulticall,
    ]
    expect(getArbitersForSettlementLayers(undefined)).toEqual(expected)
    expect(getArbitersForSettlementLayers([])).toEqual(expected)
    expect(getArbitersForSettlementLayers(undefined, true)).toEqual([
      DEV.samechain,
      ...DEV.eco,
      DEV.across7579,
      DEV.acrossMulticall,
    ])
  })

  test('naming the Permit2 layers leaves out the retired ECO arbiter', () => {
    expect(getArbitersForSettlementLayers(['SAME_CHAIN', 'ACROSS'])).toEqual([
      PROD.samechain,
      PROD.across7579,
      PROD.acrossMulticall,
    ])
  })

  test('ACROSS resolves to BOTH the 7579 and multicall arbiter impls', () => {
    expect(getArbitersForSettlementLayers(['ACROSS'])).toEqual([
      PROD.across7579,
      PROD.acrossMulticall,
    ])
  })

  test('duplicate layers do not produce duplicate addresses', () => {
    expect(getArbitersForSettlementLayers(['ACROSS', 'ACROSS'])).toEqual(
      getArbitersForSettlementLayers(['ACROSS']),
    )
  })
})

describe('getArbitersForSettlementLayers fails closed', () => {
  test.each(['CCTP', 'OFT', 'ECO', 'RELAY'])(
    '%s has no Permit2 arbiter and throws instead of widening',
    (layer) => {
      expect(() => getArbitersForSettlementLayers([layer as never])).toThrow(
        `Settlement layer ${layer} has no Permit2 arbiter`,
      )
    },
  )
})
