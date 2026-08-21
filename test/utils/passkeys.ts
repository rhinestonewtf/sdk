import { keccak256, toHex } from 'viem'
import {
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'

// Deterministic passkey credentials: the same tag always yields the same public
// key, so derived addresses stay stable across runs and machines.
function passkey(tag: string): WebAuthnAccount {
  return toWebAuthnAccount({
    credential: {
      id: tag,
      publicKey: `0x${keccak256(toHex(`x:${tag}`)).slice(2)}${keccak256(toHex(`y:${tag}`)).slice(2)}`,
    },
  })
}

export { passkey }
