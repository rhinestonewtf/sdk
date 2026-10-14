import { base58 } from '@scure/base'
import { type Address, hexToBytes, toHex } from 'viem'
import { describe, expect, test } from 'vitest'
import { type SolanaAddress, solanaAddress } from '../../chains/non-evm'
import {
  asSwigNamespace,
  createProgramAddress,
  createSolanaSwigId,
  findProgramAddress,
  locateSwig,
  locateSwigById,
  locateSwigWallet,
  SWIG_PROGRAM_ADDRESS,
} from './address'

const EVM_ACCOUNT = '0x29b406a587dd2a8ba87b9431262ee4fe732f5f0b' as Address
const textEncoder = new TextEncoder()

describe('offline Swig address derivation', () => {
  test.each([
    {
      namespace: 'dev-v1',
      id: '2d2272e0d48e718331c2150afd880b1ae7d182d3f014e04c3ef01b50c88c80ea',
      swig: '9fTE4gQnweN345EGzy6jnXNFW8VryvZ8QwLZqgBubmMs',
      swigBump: 255,
      wallet: 'DfBX7Po1bmnXt4GuEF3Eg5UYUHAjs9m5n8nbb9WUqgw2',
      walletBump: 255,
    },
    {
      namespace: 'local-v1',
      id: 'd2d7d1f400a5e596e8a4e65b1ab1bea613b4188a1244ae135203562e70da498c',
      swig: '9oAV7sm3p9SXEspYzXkA9MU2ZGZLgPwNNbgRv94BieJN',
      swigBump: 250,
      wallet: '2sZHynS4fMPrPMrforDXTKH8ukoipYgzdtPXPrpPJQvs',
      walletBump: 255,
    },
  ])('matches the backend $namespace golden vector', (expected) => {
    const location = locateSwig(
      asSwigNamespace(expected.namespace),
      EVM_ACCOUNT,
    )

    expect(toHex(location.id).slice(2)).toBe(expected.id)
    expect(location).toMatchObject({
      evmAccount: EVM_ACCOUNT,
      swig: expected.swig,
      swigBump: expected.swigBump,
      wallet: expected.wallet,
      walletBump: expected.walletBump,
    })
    expect(base58.decode(location.swig)).toHaveLength(32)
    expect(base58.decode(location.wallet)).toHaveLength(32)
    expect(locateSwigWallet(solanaAddress(expected.swig))).toEqual({
      address: expected.wallet,
      bump: expected.walletBump,
    })
  })

  test('normalizes EVM address case before hashing', () => {
    const checksummed = '0x29B406A587dd2A8bA87b9431262eE4fe732f5f0B' as Address
    expect(locateSwig(asSwigNamespace('dev-v1'), checksummed)).toEqual(
      locateSwig(asSwigNamespace('dev-v1'), EVM_ACCOUNT),
    )
  })

  test('separates namespaces and EVM identities', () => {
    const dev = locateSwig(asSwigNamespace('dev-v1'), EVM_ACCOUNT)
    const local = locateSwig(asSwigNamespace('local-v1'), EVM_ACCOUNT)
    const other = locateSwig(
      asSwigNamespace('dev-v1'),
      '0x0000000000000000000000000000000000000001',
    )

    expect(dev.swig).not.toBe(local.swig)
    expect(dev.wallet).not.toBe(local.wallet)
    expect(dev.swig).not.toBe(other.swig)
    expect(dev.wallet).not.toBe(other.wallet)
  })

  test.each(['', 'DEV-V1', 'dev v1', 'a'.repeat(33)])(
    'rejects invalid namespace %j',
    (namespace) => {
      expect(() => asSwigNamespace(namespace)).toThrow(TypeError)
    },
  )

  test('rejects malformed EVM identities before derivation', () => {
    expect(() =>
      locateSwig(asSwigNamespace('dev-v1'), '0x1234' as Address),
    ).toThrow('Invalid EVM account address')
  })

  test('searches bumps downward until the hash is off curve', () => {
    const location = locateSwig(asSwigNamespace('local-v1'), EVM_ACCOUNT)
    const seeds = [textEncoder.encode('swig'), location.id]

    expect(location.swigBump).toBe(250)
    for (const bump of [255, 254, 253, 252, 251]) {
      expect(() =>
        createProgramAddress(
          [...seeds, Uint8Array.of(bump)],
          SWIG_PROGRAM_ADDRESS,
        ),
      ).toThrow('address must fall off the curve')
    }
    expect(
      createProgramAddress(
        [...seeds, Uint8Array.of(location.swigBump)],
        SWIG_PROGRAM_ADDRESS,
      ),
    ).toBe(location.swig)
  })

  test('preserves leading zero bytes in base58 output', () => {
    const result = findProgramAddress(
      [textEncoder.encode('leading-zero-136')],
      SWIG_PROGRAM_ADDRESS,
    )

    expect(result).toEqual({
      address: '14WbM1xzNei54pRHvcVH8gTkPvJx2gLLujim16xiYELX',
      bump: 255,
    })
    expect(base58.decode(result.address)).toHaveLength(32)
    expect(base58.decode(result.address)[0]).toBe(0)
  })

  test('enforces Solana PDA address and seed limits', () => {
    expect(() => createProgramAddress([], '1' as SolanaAddress)).toThrow(
      'expected 32 bytes',
    )
    expect(() =>
      createProgramAddress(
        Array.from({ length: 17 }, () => new Uint8Array()),
        SWIG_PROGRAM_ADDRESS,
      ),
    ).toThrow('expected at most 16')
    expect(() =>
      createProgramAddress([new Uint8Array(33)], SWIG_PROGRAM_ADDRESS),
    ).toThrow('at most 32 bytes')
    expect(() =>
      findProgramAddress(
        Array.from({ length: 16 }, () => new Uint8Array()),
        SWIG_PROGRAM_ADDRESS,
      ),
    ).toThrow('at most 15 before the bump')
    expect(() =>
      createProgramAddress(
        [],
        solanaAddress('11111111111111111111111111111111'),
      ),
    ).not.toThrow()
  })
})

describe('Swig id derivation', () => {
  // Derived independently with @swig-wallet/classic `findSwigPda`.
  test('matches the Swig program derivation for an arbitrary id', () => {
    expect(locateSwigById(new Uint8Array(32).fill(7))).toMatchObject({
      swig: '3wm644fHe3ekULLCPov4vkDeVCJEaQmnCfn5k2HhMS4B',
      wallet: 'C4PvoicLfj71bcjnvSWFKo3QeDP8AXJbUzZFQPvRf3xm',
    })
  })

  test('derives the EVM-derived Swig from its id', () => {
    const derived = locateSwig(asSwigNamespace('dev-v1'), EVM_ACCOUNT)
    expect(locateSwigById(derived.id)).toEqual({
      id: derived.id,
      swig: derived.swig,
      swigBump: derived.swigBump,
      wallet: derived.wallet,
      walletBump: derived.walletBump,
    })
  })

  test.each([0, 31, 33])('rejects a %i-byte id', (length) => {
    expect(() => locateSwigById(new Uint8Array(length))).toThrow(
      'expected 32 bytes',
    )
  })

  test('mints a random 32-byte id with the addresses it derives', () => {
    const minted = createSolanaSwigId()
    const id = hexToBytes(minted.id)
    expect(id).toHaveLength(32)
    expect(locateSwigById(id)).toMatchObject({
      swig: minted.swig,
      wallet: minted.wallet,
    })
    expect(createSolanaSwigId().id).not.toBe(minted.id)
  })
})
