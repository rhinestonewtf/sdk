import { Account, Address, Chain, Hex } from 'viem';
import {
  WebAuthnAccount,
} from 'viem/account-abstraction'

interface OwnableValidatorConfig {
  type: 'ecdsa';
  account: Account;
}

interface WebauthnValidatorConfig {
  type: "passkey",
  account: WebAuthnAccount;
}

type ValidatorConfig = OwnableValidatorConfig | WebauthnValidatorConfig;
interface RhinestoneAccountConfig {
  account: {
    type: 'safe';
  };
  validators: ValidatorConfig[];
  rhinestoneApiKey: string;
  deployerAccount: Account;
  provider?: {
    type: 'alchemy',
    apiKey: string;
  };
  bundler?: {
    type: "pimlico",
    apiKey: string;
  };
}

interface Call {
  to: Address;
  data?: Hex;
  value?: bigint;
}

interface TokenRequest {
  address: Address;
  amount: bigint;
}

interface Transaction {
  sourceChain: Chain;
  targetChain: Chain;
  calls: Call[];
  tokenRequests: TokenRequest[];
}

export type { RhinestoneAccountConfig, Transaction, ValidatorConfig };