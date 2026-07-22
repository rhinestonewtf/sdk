import type { Account, Address, Hex } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'

export function ecdsaSignerId(account: Account | Address): string {
  const address = typeof account === 'string' ? account : account.address
  return `ecdsa:${address.toLowerCase()}`
}

export function webauthnSignerId(account: WebAuthnAccount | Hex): string {
  const publicKey = typeof account === 'string' ? account : account.publicKey
  return `webauthn:${publicKey.toLowerCase()}`
}
