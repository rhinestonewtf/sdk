import { describe, expect, test, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import {
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'
import { getValidator } from '../../src/modules/validators/core'

// Test accounts (matching test/consts.ts)
const accountA = privateKeyToAccount(
  '0x2be89d993f98bbaab8b83f1a2830cb9414e19662967c7ba2a0f43d2a9125bd6d',
)
const accountB = privateKeyToAccount(
  '0x39e2fec1a04c088f939d81de8f1abebdebf899a6cfb9968f9b663a7afba8301b',
)
const accountC = privateKeyToAccount(
  '0xb63c74af219a3949cf95f5e3a3d20b0137425de053bb03e5cc0f46fe0d19f22f',
)
const passkeyAccount: WebAuthnAccount = toWebAuthnAccount({
  credential: {
    id: '9IwX9n6cn-l9SzqFzfQXvDHRuTM',
    publicKey:
      '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1',
  },
})

// WASM module - loaded once
let wasm: typeof import('../../crates/encoding-wasm/pkg/rhinestone_encoding_wasm')

beforeAll(async () => {
  // Import the wasm-pack generated JS glue
  wasm = await import(
    '../../crates/encoding-wasm/pkg/rhinestone_encoding_wasm'
  )
  // Load WASM binary directly from file (fetch doesn't support file:// in Bun)
  const wasmPath = resolve(
    __dirname,
    '../../crates/encoding-wasm/pkg/rhinestone_encoding_wasm_bg.wasm',
  )
  const wasmBytes = readFileSync(wasmPath)
  await wasm.default(wasmBytes.buffer)
})

describe('WASM Golden Tests - Validators', () => {
  describe('Ownable Validator', () => {
    test('single owner matches TS output', () => {
      const tsResult = getValidator({
        type: 'ecdsa',
        accounts: [accountA],
      })

      const wasmResult = wasm.get_ownable_validator({
        threshold: 1,
        owners: [accountA.address],
      })

      expect(wasmResult.address).toEqual(tsResult.address)
      expect(wasmResult.initData).toEqual(tsResult.initData)
    })

    test('two owners matches TS output', () => {
      const tsResult = getValidator({
        type: 'ecdsa',
        accounts: [accountA, accountB],
      })

      const wasmResult = wasm.get_ownable_validator({
        threshold: 1,
        owners: [accountA.address, accountB.address],
      })

      expect(wasmResult.address).toEqual(tsResult.address)
      expect(wasmResult.initData).toEqual(tsResult.initData)
    })

    test('three owners with custom threshold matches TS output', () => {
      const tsResult = getValidator({
        type: 'ecdsa',
        accounts: [accountA, accountB, accountC],
        threshold: 2,
      })

      const wasmResult = wasm.get_ownable_validator({
        threshold: 2,
        owners: [accountA.address, accountB.address, accountC.address],
      })

      expect(wasmResult.address).toEqual(tsResult.address)
      expect(wasmResult.initData).toEqual(tsResult.initData)
    })

    test('matches known expected output', () => {
      const wasmResult = wasm.get_ownable_validator({
        threshold: 1,
        owners: [accountA.address],
      })

      expect(wasmResult.initData).toEqual(
        '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000001000000000000000000000000f6c02c78ded62973b43bfa523b247da099486936',
      )
    })
  })

  describe('WebAuthn Validator', () => {
    test('single passkey matches TS output', () => {
      const tsResult = getValidator({
        type: 'passkey',
        accounts: [passkeyAccount],
      })

      const wasmResult = wasm.get_webauthn_validator({
        threshold: 1,
        credentials: [
          {
            pubKeyX:
              '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d373763',
            pubKeyY:
              '0x7d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1',
          },
        ],
      })

      expect(wasmResult.address).toEqual(tsResult.address)
      expect(wasmResult.initData).toEqual(tsResult.initData)
    })
  })
})
