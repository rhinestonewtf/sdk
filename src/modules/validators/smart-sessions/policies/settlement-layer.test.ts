import { type Address, type Hex, size, slice } from 'viem'
import { describe, expect, test } from 'vitest'
import {
  addressToBytes32,
  CCTP_LAYER_ID,
  type CctpLayerConfig,
  encodeCctpAdapterConfig,
  encodeIntentExecutorBaseHeader,
  encodeIntentExecutorPolicyInitData,
  encodeRelayAdapterConfig,
  encodeRhinoAdapterConfig,
  encodeStaticIntentExecutorPolicyInitData,
  FLAG_LOCK_ACCOUNT,
  FLAG_REQUIRE_GAS_REFUND,
  type IntentExecutorBaseConfig,
  intentExecutorPolicyEntry,
  RELAY_LAYER_ID,
  RHINO_LAYER_ID,
} from './settlement-layer'

const IE: Address = '0x00000000005aD9ce1f5035FD62CA96CEf16AdAAF'
const TOKEN_MESSENGER: Address = '0xBd3fa81B58Ba92a82136038B25aDec7066af3155'
const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const RELAY_ROUTER: Address = '0xb92fe925DC43a0EcDe6C8B1A2709c170eC4ffF4f'
const RHINO_BRIDGE: Address = '0x4cd00E387622C35BdDB9b4c962c136462338bc31'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'
const GAS_TOKEN: Address = '0x4200000000000000000000000000000000000006'

describe('settlement-layer encoders — layer ids', () => {
  // Pinned to fixed hashes (not keccak256(toBytes(name)), which would be a
  // tautology) so an accidental rename of the id source is caught. These must
  // equal each adapter's on-chain LAYER_ID = keccak256("<NAME>").
  test('layer ids match the on-chain adapter LAYER_ID hashes', () => {
    expect(CCTP_LAYER_ID).toBe(
      '0xb15c6f4cb2704b59886404596581f035599143a4de893556943a4865c51863a5',
    )
    expect(RELAY_LAYER_ID).toBe(
      '0x7f7b7e37c1c73a7fe521e350bfc44f06aa9ebbc4658ac6261b21c1e6f7b97f58',
    )
    expect(RHINO_LAYER_ID).toBe(
      '0x5c01ead7ebf445ae993202284f0d6b2304b4adfcf34ea7abdee7f15587009db9',
    )
  })
})

describe('settlement-layer encoders — base header', () => {
  test('layout is intentExecutor(20)·flags(1)·maxExchangeRate(32)·count(1)·tokens', () => {
    const base: IntentExecutorBaseConfig = {
      intentExecutor: IE,
      flags: FLAG_REQUIRE_GAS_REFUND | FLAG_LOCK_ACCOUNT,
      maxExchangeRate: 123n,
      gasTokens: [GAS_TOKEN],
    }
    const header = encodeIntentExecutorBaseHeader(base)
    // 54 + 20*gasTokens.length
    expect(size(header)).toBe(54 + 20)
    expect(slice(header, 0, 20).toLowerCase()).toBe(IE.toLowerCase())
    expect(slice(header, 20, 21)).toBe('0x03') // 0x01 | 0x02
    expect(BigInt(slice(header, 21, 53))).toBe(123n)
    expect(slice(header, 53, 54)).toBe('0x01') // one gas token
    expect(slice(header, 54, 74).toLowerCase()).toBe(GAS_TOKEN.toLowerCase())
  })

  test('empty gas tokens → 54 bytes, count 0', () => {
    const header = encodeIntentExecutorBaseHeader({ intentExecutor: IE })
    expect(size(header)).toBe(54)
    expect(slice(header, 53, 54)).toBe('0x00')
    expect(slice(header, 20, 21)).toBe('0x00') // default flags 0
  })
})

describe('settlement-layer encoders — CCTP adapter config', () => {
  const cfg: CctpLayerConfig = {
    tokenMessenger: TOKEN_MESSENGER,
    maxFeeCap: 500n,
    minFinalityFloor: 1000,
    mintRecipients: [addressToBytes32(RECIPIENT)],
    burnTokens: [USDC],
    destDomains: [3, 6],
  }

  test('byte-count matches 56 + 1 + 32*mint + 1 + 20*burn + 1 + 4*dom', () => {
    const blob = encodeCctpAdapterConfig(cfg)
    expect(size(blob)).toBe(56 + 1 + 32 * 1 + 1 + 20 * 1 + 1 + 4 * 2)
  })

  test('field placement', () => {
    const blob = encodeCctpAdapterConfig(cfg)
    expect(slice(blob, 0, 20).toLowerCase()).toBe(TOKEN_MESSENGER.toLowerCase())
    expect(BigInt(slice(blob, 20, 52))).toBe(500n)
    expect(Number(BigInt(slice(blob, 52, 56)))).toBe(1000)
    expect(slice(blob, 56, 57)).toBe('0x01') // mint count
    expect(slice(blob, 57, 89).toLowerCase()).toBe(
      addressToBytes32(RECIPIENT).toLowerCase(),
    )
    // burn count then token
    expect(slice(blob, 89, 90)).toBe('0x01')
    expect(slice(blob, 90, 110).toLowerCase()).toBe(USDC.toLowerCase())
    // dest domain count then two uint32s
    expect(slice(blob, 110, 111)).toBe('0x02')
    expect(Number(BigInt(slice(blob, 111, 115)))).toBe(3)
    expect(Number(BigInt(slice(blob, 115, 119)))).toBe(6)
  })

  test('empty destDomains → count 0, no domain bytes', () => {
    const blob = encodeCctpAdapterConfig({ ...cfg, destDomains: [] })
    expect(size(blob)).toBe(56 + 1 + 32 + 1 + 20 + 1)
  })
})

describe('settlement-layer encoders — Relay adapter config', () => {
  test('byte-count 40 + 1 + 20*recip + 1 + 20*tok, zero ieAdapter default', () => {
    const blob = encodeRelayAdapterConfig({
      relayRouter: RELAY_ROUTER,
      recipients: [RECIPIENT],
      tokens: [USDC],
    })
    expect(size(blob)).toBe(40 + 1 + 20 + 1 + 20)
    expect(slice(blob, 0, 20).toLowerCase()).toBe(RELAY_ROUTER.toLowerCase())
    expect(slice(blob, 20, 40)).toBe(
      '0x0000000000000000000000000000000000000000',
    )
  })
})

describe('settlement-layer encoders — Rhino adapter config', () => {
  test('byte-count 20 + 1 + 20*tok', () => {
    const blob = encodeRhinoAdapterConfig({
      bridgeContract: RHINO_BRIDGE,
      tokens: [USDC, GAS_TOKEN],
    })
    expect(size(blob)).toBe(20 + 1 + 20 * 2)
    expect(slice(blob, 20, 21)).toBe('0x02')
  })
})

describe('settlement-layer encoders — policy initData', () => {
  const base: IntentExecutorBaseConfig = { intentExecutor: IE }
  const cctp = encodeCctpAdapterConfig({
    tokenMessenger: TOKEN_MESSENGER,
    mintRecipients: [addressToBytes32(RECIPIENT)],
    burnTokens: [USDC],
  })
  const rhino = encodeRhinoAdapterConfig({
    bridgeContract: RHINO_BRIDGE,
    tokens: [USDC],
  })

  test('ownable initData = header · layerCount · [layerId·len·config]…', () => {
    const initData = encodeIntentExecutorPolicyInitData({
      base,
      layers: [
        { layerId: CCTP_LAYER_ID, config: cctp },
        { layerId: RHINO_LAYER_ID, config: rhino },
      ],
    })
    const header = 54
    // header · count(1) · [32 + 2 + len]·2
    const expected = header + 1 + (32 + 2 + size(cctp)) + (32 + 2 + size(rhino))
    expect(size(initData)).toBe(expected)
    // layer count byte right after the header
    expect(slice(initData, header, header + 1)).toBe('0x02')
    // first layerId
    expect(slice(initData, header + 1, header + 33)).toBe(CCTP_LAYER_ID)
    // first configLen (uint16)
    expect(Number(BigInt(slice(initData, header + 33, header + 35)))).toBe(
      size(cctp),
    )
  })

  test('static initData = header · config (no wrapper)', () => {
    const initData = encodeStaticIntentExecutorPolicyInitData({
      base,
      config: cctp,
    })
    expect(size(initData)).toBe(54 + size(cctp))
    expect(slice(initData, 54)).toBe(cctp)
  })

  test('intentExecutorPolicyEntry wraps into a {policy, initData} entry', () => {
    const POLICY: Address = '0x00000000000000000000000000000000000000AA'
    const entry = intentExecutorPolicyEntry({
      policy: POLICY,
      base,
      layers: [{ layerId: CCTP_LAYER_ID, config: cctp }],
    })
    expect(entry.policy).toBe(POLICY)
    expect(size(entry.initData as Hex)).toBeGreaterThan(54)
  })

  test('intentExecutorPolicyEntry throws with no layers', () => {
    expect(() =>
      intentExecutorPolicyEntry({
        policy: '0x00000000000000000000000000000000000000AA',
        base: { intentExecutor: IE },
        layers: [],
      }),
    ).toThrow(/at least one layer/)
  })
})

test('addressToBytes32 left-pads to 32 bytes', () => {
  const b32 = addressToBytes32(RECIPIENT)
  expect(size(b32)).toBe(32)
  expect(slice(b32, 12, 32).toLowerCase()).toBe(RECIPIENT.toLowerCase())
  expect(slice(b32, 0, 12)).toBe('0x000000000000000000000000')
})
