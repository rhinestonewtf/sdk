import { describe, expect, test } from 'vitest'
import { encodeSettlementLayers } from './client'

describe('encodeSettlementLayers', () => {
  test('include passes through unchanged', () => {
    expect(encodeSettlementLayers({ include: ['ACROSS', 'ECO'] })).toEqual([
      'ACROSS',
      'ECO',
    ])
  })

  test('exclude inverts against the known-layers universe', () => {
    expect(encodeSettlementLayers({ exclude: ['RELAY'] })).toEqual([
      'ACROSS',
      'ECO',
      'OFT',
      'NEAR',
      'RHINO',
      'CCTP',
    ])
  })

  test('exclude with unknown layer is a no-op against the universe', () => {
    // SAME_CHAIN isn't user-selectable on the orchestrator. Excluding it
    // should leave the universe intact rather than narrowing further.
    expect(encodeSettlementLayers({ exclude: ['SAME_CHAIN'] })).toEqual([
      'ACROSS',
      'ECO',
      'RELAY',
      'OFT',
      'NEAR',
      'RHINO',
      'CCTP',
    ])
  })
})
