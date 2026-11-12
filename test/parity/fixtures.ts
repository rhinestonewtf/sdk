import type { LocalAccount } from 'viem'
import { accountA, accountB } from '../consts'
import { recordingAccount } from './signers'

// Owner keys reused from the unit-test fixtures. Their default v1 accounts are
// never funded or registered with the deposit service, which keeps their
// portfolios empty and the quote path deterministic.
const OWNERS = {
  ownerA: accountA as LocalAccount,
  ownerB: accountB as LocalAccount,
} as const

type SignerLabel = keyof typeof OWNERS

function signer(label: SignerLabel): LocalAccount {
  return recordingAccount(OWNERS[label], label)
}

const USDC_BASE_SEPOLIA = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'

// A COMPLETED testnet intent (Arbitrum Sepolia) on prod; its status never changes.
const FIXED_INTENT_ID =
  419405903733774847000549735049099665436387374880885830640724572373541018n

const MISSING_INTENT_ID = 123n

export type { SignerLabel }
export { FIXED_INTENT_ID, MISSING_INTENT_ID, OWNERS, signer, USDC_BASE_SEPOLIA }
