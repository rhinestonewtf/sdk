import type { Account, Chain } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { EvmChainReference } from '../../chains/types'

export type ExternalSigner =
  | { readonly kind: 'ecdsa'; readonly account: Account }
  | { readonly kind: 'webauthn'; readonly account: WebAuthnAccount }
  | { readonly kind: 'wallet-authorization'; readonly account: Account }

export type ExternalSignerRegistry = Readonly<Record<string, ExternalSigner>>

export type ChainResolver = (chain: EvmChainReference) => Chain
