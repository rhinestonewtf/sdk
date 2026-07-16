import fc from 'fast-check'
import { size } from 'viem'
import { base } from 'viem/chains'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../../../test/consts'
import { sharedChainCatalog } from '../../../chains/catalog'
import { encodeDisableSessionCall, encodeEnableSessionCall } from './calls'
import {
  resolveCrossChainPermission,
  toCrossChainPermissionInput,
} from './cross-chain-permits'
import { buildSmartSessionMockSignature } from './mock-signature'
import { toSession } from './resolve'

describe('Smart Sessions core', () => {
  test('matches the exact sudo session vector', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    expect(session).toMatchObject({
      permissionId:
        '0xb45b15b276c19135237bb960e9fc0b5226a65d673ffdb7a31717a713faf4e1b4',
      sessionValidator: '0x000000000013fdb5234e4e3162a810f54d9f7e98',
      sessionValidatorInitData:
        '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
      actions: [
        {
          actionTargetSelector: '0x00000001',
          actionTarget: '0x0000000000000000000000000000000000000001',
          actionPolicies: [
            {
              policy: '0x0000000000FEEc8D74e3143fBaBbca515358d869',
              initData: '0x',
            },
          ],
        },
      ],
    })
  })

  test('encodes all three mock signature paths consistently', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    const enable = buildSmartSessionMockSignature({
      session,
      environment: 'production',
      shape: 'enable',
    })
    const use = buildSmartSessionMockSignature({
      session,
      environment: 'production',
      shape: 'use',
    })
    const erc1271 = buildSmartSessionMockSignature({
      session,
      environment: 'production',
      shape: 'erc1271',
    })
    expect(enable.slice(42, 44)).toBe('01')
    expect(use.slice(42, 44)).toBe('00')
    expect(erc1271.slice(42, 44)).toBe('00')
    expect(size(enable)).toBeGreaterThan(size(use))
    expect(size(erc1271)).toBeGreaterThan(size(use))
  })

  test('encodes the no-allocator disable call vector deterministically', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    const first = encodeDisableSessionCall({
      account: accountA.address,
      session,
      expires: 123n,
      nonce: 4n,
      environment: 'production',
    })
    const second = encodeDisableSessionCall({
      account: accountA.address,
      session,
      expires: 123n,
      nonce: 4n,
      environment: 'production',
    })
    expect(first).toEqual(second)
    expect(first.target).toBe('0xad568b3f825a8d5ffc06dd3253526b64d810ae89')
    expect(first.data.slice(0, 10)).toBe('0x60e637cc')
  })

  test('encodes session enable calls and default mock inputs', () => {
    const session = toSession({
      chain: base,
      owners: { type: 'ecdsa', accounts: [accountA] },
    })
    const call = encodeEnableSessionCall({
      account: accountA.address,
      session,
      userSignature: '0x1234',
      hashesAndChainIds: [
        { chainId: BigInt(base.id), sessionDigest: session.permissionId },
      ],
      sessionToEnableIndex: 0,
      environment: 'development',
    })
    expect(call.data.slice(0, 10)).toBe('0xa45edb84')
    expect(
      buildSmartSessionMockSignature({
        session,
        environment: 'development',
      }),
    ).toMatch(/^0x[\da-f]+$/i)
  })

  test('cross-chain input round-trips at whole-second precision', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_700_000_000, max: 2_000_000_000 }),
        (timestamp) => {
          const input = {
            from: { chain: base, token: 'USDC' as const, maxAmount: 1n },
            validUntil: new Date(timestamp * 1000),
          }
          const resolved = resolveCrossChainPermission(
            input,
            sharedChainCatalog,
          )
          const roundTrip = toCrossChainPermissionInput(resolved)
          expect(roundTrip.validUntil).toEqual(input.validUntil)
          expect(roundTrip.allowRecipientNotAccount).toBe(false)
        },
      ),
    )
  })
})
