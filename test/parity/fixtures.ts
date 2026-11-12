import type { LocalAccount } from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { accountA, accountB, passkeyAccount } from '../consts'
import { recordingAccount } from './signers'

// Owner keys reused from the unit-test fixtures. Every fixture account derived
// from them (each account type, multi-owner, EOA, 7702, sessions and passkey)
// is never funded and never registered with the deposit service, which keeps
// its portfolio empty and the quote path deterministic.
const OWNERS = {
  ownerA: accountA as LocalAccount,
  ownerB: accountB as LocalAccount,
} as const

type SignerLabel = keyof typeof OWNERS

function signer(label: SignerLabel): LocalAccount {
  return recordingAccount(OWNERS[label], label)
}

function passkey(): WebAuthnAccount {
  return recordingAccount(passkeyAccount, 'passkey')
}

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const WETH_BASE_SEPOLIA = '0x4200000000000000000000000000000000000006'
const NATIVE_TOKEN = '0x0000000000000000000000000000000000000000'
const BURN_ADDRESS = '0x000000000000000000000000000000000000dEaD'
// No token contract here on any chain the orchestrator supports.
const UNSUPPORTED_TOKEN = '0x1111111111111111111111111111111111111111'

// Past testnet intents on prod in a terminal state; their status never changes.
const FIXED_INTENTS = {
  // Arbitrum Sepolia fill and one claim.
  completedCrossChain:
    419405903733774847000549735049099665436387374880885830640724572373541018n,
  // Base Sepolia, filled with no claims.
  completedSameChain:
    41506782001482633007225160255346769677401208027046050899384763376797918n,
  // Base Sepolia → Arbitrum Sepolia, claimed but never filled.
  failedCrossChain:
    4109734322649134165915266808227797040135362929957450305308521571507605438n,
  // OP Sepolia, no claims.
  failedSameChain:
    48961021748258018645452854903033653786369369947133809999642876755944166n,
} as const

const FIXED_INTENT_ID = FIXED_INTENTS.completedCrossChain

const MISSING_INTENT_ID = 123n

// An existing prod project account with testnet ETH on OP Sepolia and no
// activity since July 2026. Read only, never written to.
const DORMANT_ACCOUNT = '0x46f491c4aeec869784669823f5deb2142f9a1f95'

export type { SignerLabel }
export {
  BURN_ADDRESS,
  DORMANT_ACCOUNT,
  FIXED_INTENT_ID,
  FIXED_INTENTS,
  MISSING_INTENT_ID,
  NATIVE_TOKEN,
  passkey,
  signer,
  UNSUPPORTED_TOKEN,
  USDC_BASE_SEPOLIA,
  WETH_BASE_SEPOLIA,
}
