import { ed25519 } from '@noble/curves/ed25519'
import { base58 } from '@scure/base'
import { type Address, bytesToHex, type Hex, isAddress, sha256 } from 'viem'
import { type SolanaAddress, solanaAddress } from '../../chains/non-evm'

const textEncoder = new TextEncoder()
const PROGRAM_DERIVED_ADDRESS_MARKER = textEncoder.encode(
  'ProgramDerivedAddress',
)
const SWIG_SEED = textEncoder.encode('swig')
const SWIG_WALLET_SEED = textEncoder.encode('swig-wallet-address')
const MAX_SEEDS = 16
const MAX_SEED_LENGTH = 32

/** Program used by classic Swig accounts on Solana. */
const SWIG_PROGRAM_ADDRESS = solanaAddress(
  'swigypWHEksbC64pWKwah1WTeh9JXwx8H1rJHLdbQMB',
)

declare const swigNamespaceBrand: unique symbol

type SwigNamespace = string & { readonly [swigNamespaceBrand]: true }

type ProgramAddress = {
  readonly address: SolanaAddress
  readonly bump: number
}

type SwigLocation = {
  readonly namespace: SwigNamespace
  readonly evmAccount: Address
  readonly id: Uint8Array
  readonly swig: SolanaAddress
  readonly swigBump: number
  readonly wallet: SolanaAddress
  readonly walletBump: number
}

class OnCurveAddressError extends Error {}

function concatBytes(values: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    values.reduce((length, value) => length + value.length, 0),
  )
  let offset = 0
  for (const value of values) {
    result.set(value, offset)
    offset += value.length
  }
  return result
}

function decodeAddress(value: SolanaAddress): Uint8Array {
  const bytes = base58.decode(value)
  if (bytes.length !== 32) {
    throw new TypeError('Invalid Solana address: expected 32 bytes')
  }
  return bytes
}

function isOnCurve(bytes: Uint8Array): boolean {
  try {
    ed25519.ExtendedPoint.fromHex(bytes)
    return true
  } catch {
    return false
  }
}

function createProgramAddress(
  seeds: readonly Uint8Array[],
  programAddress: SolanaAddress,
): SolanaAddress {
  if (seeds.length > MAX_SEEDS) {
    throw new TypeError(`Too many PDA seeds: expected at most ${MAX_SEEDS}`)
  }
  for (const seed of seeds) {
    if (seed.length > MAX_SEED_LENGTH) {
      throw new TypeError(
        `Invalid PDA seed: expected at most ${MAX_SEED_LENGTH} bytes`,
      )
    }
  }

  const bytes = sha256(
    concatBytes([
      ...seeds,
      decodeAddress(programAddress),
      PROGRAM_DERIVED_ADDRESS_MARKER,
    ]),
    'bytes',
  )
  if (isOnCurve(bytes)) {
    throw new OnCurveAddressError(
      'Invalid PDA seeds: address must fall off the curve',
    )
  }
  return solanaAddress(base58.encode(bytes))
}

function findProgramAddress(
  seeds: readonly Uint8Array[],
  programAddress: SolanaAddress,
): ProgramAddress {
  if (seeds.length >= MAX_SEEDS) {
    throw new TypeError(
      `Too many PDA seeds: expected at most ${MAX_SEEDS - 1} before the bump`,
    )
  }
  for (let bump = 255; bump >= 0; bump--) {
    try {
      return {
        address: createProgramAddress(
          [...seeds, Uint8Array.of(bump)],
          programAddress,
        ),
        bump,
      }
    } catch (error) {
      if (!(error instanceof OnCurveAddressError)) throw error
    }
  }
  /* v8 ignore next -- exhausting every SHA-256 bump is not constructible */
  throw new Error('Unable to find a viable program address bump')
}

function asSwigNamespace(value: string): SwigNamespace {
  if (!/^[a-z0-9-]{1,32}$/.test(value)) {
    throw new TypeError(
      `Invalid Swig namespace "${value}": expected 1-32 chars of [a-z0-9-]`,
    )
  }
  return value as SwigNamespace
}

function swigId(namespace: SwigNamespace, evmAccount: Address): Uint8Array {
  if (!isAddress(evmAccount, { strict: false })) {
    throw new TypeError(`Invalid EVM account address: ${evmAccount}`)
  }
  return sha256(
    textEncoder.encode(
      `rhinestone:swig:v1:${namespace}:${evmAccount.toLowerCase()}`,
    ),
    'bytes',
  )
}

/** The asset-holding wallet PDA of a Swig state account. */
function locateSwigWallet(swig: SolanaAddress): ProgramAddress {
  return findProgramAddress(
    [SWIG_WALLET_SEED, decodeAddress(swig)],
    SWIG_PROGRAM_ADDRESS,
  )
}

type SwigIdLocation = {
  readonly id: Uint8Array
  readonly swig: SolanaAddress
  readonly swigBump: number
  readonly wallet: SolanaAddress
  readonly walletBump: number
}

/** The Swig state account and wallet a 32-byte Swig id derives. */
function locateSwigById(id: Uint8Array): SwigIdLocation {
  if (id.length !== 32) {
    throw new TypeError('Invalid Swig id: expected 32 bytes')
  }
  const swig = findProgramAddress([SWIG_SEED, id], SWIG_PROGRAM_ADDRESS)
  const wallet = locateSwigWallet(swig.address)
  return {
    id,
    swig: swig.address,
    swigBump: swig.bump,
    wallet: wallet.address,
    walletBump: wallet.bump,
  }
}

function locateSwig(
  namespace: SwigNamespace,
  evmAccount: Address,
): SwigLocation {
  const normalizedAccount = evmAccount.toLowerCase() as Address
  return {
    namespace,
    evmAccount: normalizedAccount,
    ...locateSwigById(swigId(namespace, normalizedAccount)),
  }
}

/**
 * Mints a fresh, random Swig id and the addresses it derives, for a Solana
 * account that is not tied to a managed EVM account.
 *
 * Persist `id` together with `swig`: configure the account with
 * `solana: { swig, owner }`, and pass the id to
 * `account.deploy('solana', solanaChain, { swigId: id })`
 * to create it. The id cannot be recovered from the addresses, so a lost id
 * leaves the Swig uncreatable; mint a new one instead.
 *
 * @returns The 32-byte Swig `id` as hex, the Swig state account `swig`, and
 * the asset-holding `wallet` that receives funds.
 * @example
 * ```ts
 * import { createSolanaSwigId } from '@rhinestone/sdk'
 *
 * const { id, swig, wallet } = createSolanaSwigId()
 * // Save `id` and `swig`; fund `wallet` only after the Swig is created.
 * ```
 */
function createSolanaSwigId(): {
  readonly id: Hex
  readonly swig: SolanaAddress
  readonly wallet: SolanaAddress
} {
  const id = crypto.getRandomValues(new Uint8Array(32))
  const location = locateSwigById(id)
  return { id: bytesToHex(id), swig: location.swig, wallet: location.wallet }
}

export type { ProgramAddress, SwigIdLocation, SwigLocation, SwigNamespace }
export {
  SWIG_PROGRAM_ADDRESS,
  asSwigNamespace,
  createProgramAddress,
  createSolanaSwigId,
  findProgramAddress,
  locateSwig,
  locateSwigById,
  locateSwigWallet,
}
