import { Account, Address, Chain, Hex } from 'viem'
import { WebAuthnAccount } from 'viem/account-abstraction'

interface OwnableValidatorConfig {
  type: 'ecdsa'
  accounts: Account[]
  threshold?: number
}

interface WebauthnValidatorConfig {
  type: 'passkey'
  account: WebAuthnAccount
}

interface BundlerConfig {
  type: 'pimlico'
  apiKey: string
}

type OwnerSet = OwnableValidatorConfig | WebauthnValidatorConfig
interface RhinestoneAccountConfig {
  account: {
    type: 'safe' | 'nexus'
  }
  owners: OwnerSet
  rhinestoneApiKey: string
  deployerAccount: Account
  eoaAccount?: Account
  provider?: {
    type: 'alchemy'
    apiKey: string
  }
  bundler?: BundlerConfig
}

interface Call {
  to: Address
  data?: Hex
  value?: bigint
}

interface TokenRequest {
  address: Address
  amount: bigint
}

interface Transaction {
  sourceChain: Chain
  targetChain: Chain
  calls: Call[]
  tokenRequests: TokenRequest[]
}

export type { RhinestoneAccountConfig, BundlerConfig, Transaction, OwnerSet }
