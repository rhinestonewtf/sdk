import { type Address, type Hex, isAddressEqual, slice } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../test/consts'
import type { Session } from '../../types'
import {
  buildMockSignature,
  SMART_SESSION_EMISSARY_ADDRESS,
} from './smart-sessions'

// Minimal session with a single ecdsa owner, no custom actions
const baseSession: Session = {
  chain: base,
  owners: {
    type: 'ecdsa',
    accounts: [accountA],
  },
}

// Session with an explicit action + sudo policy
const sessionWithAction: Session = {
  chain: base,
  owners: {
    type: 'ecdsa',
    accounts: [accountA],
  },
  actions: [
    {
      target: '0x1111111111111111111111111111111111111111' as Address,
      selector: '0xa9059cbb' as Hex, // transfer(address,uint256)
      policies: [{ type: 'sudo' }],
    },
  ],
}

describe('buildMockSignature', () => {
  test('first 20 bytes are the emissary address', () => {
    const sig = buildMockSignature(baseSession)
    const validatorBytes = slice(sig, 0, 20)
    expect(
      isAddressEqual(validatorBytes as Address, SMART_SESSION_EMISSARY_ADDRESS),
    ).toBe(true)
  })

  test('byte 20 is SMART_SESSION_MODE_ENABLE (0x01)', () => {
    const sig = buildMockSignature(baseSession)
    // byte 21 in the sig = index 20 = the mode byte from packSignature
    const modeByte = slice(sig, 20, 21)
    expect(modeByte).toBe('0x01')
  })

  test('total length is larger than just emissary + mode byte (has compressed payload)', () => {
    const sig = buildMockSignature(baseSession)
    // 20 bytes emissary + 1 mode byte + at least some compressed data
    const byteLen = (sig.length - 2) / 2 // strip '0x', convert hex chars to bytes
    expect(byteLen).toBeGreaterThan(21)
  })

  test('sessions with different actions produce different sigData', () => {
    const sigBase = buildMockSignature(baseSession)
    const sigWithAction = buildMockSignature(sessionWithAction)
    // The session data (policies, targets) should differ → different compressed payloads
    expect(sigBase).not.toBe(sigWithAction)
  })

  test('useDevContracts=true produces different emissary prefix', () => {
    const sigProd = buildMockSignature(baseSession, false)
    const sigDev = buildMockSignature(baseSession, true)
    // First 20 bytes differ because prod vs dev emissary addresses differ
    expect(slice(sigProd, 0, 20)).not.toBe(slice(sigDev, 0, 20))
  })
})
