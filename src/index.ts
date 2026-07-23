import { RhinestoneSDK } from './api/sdk'
import { hyperCoreMainnet, solanaMainnet, tronMainnet } from './chains/non-evm'
import { MULTI_FACTOR_VALIDATOR_ADDRESS } from './modules/validators/multi-factor'
import { OWNABLE_VALIDATOR_ADDRESS } from './modules/validators/ownable'
import { SMART_SESSION_EMISSARY_ADDRESS } from './modules/validators/smart-sessions/module'
import { WEBAUTHN_VALIDATOR_ADDRESS } from './modules/validators/webauthn'

export {
  RhinestoneSDK,
  // Non-viem destination chain descriptors (Solana, Tron, HyperCore)
  hyperCoreMainnet,
  solanaMainnet,
  tronMainnet,
  // Validator addresses
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_VALIDATOR_ADDRESS,
  MULTI_FACTOR_VALIDATOR_ADDRESS,
  SMART_SESSION_EMISSARY_ADDRESS,
}

export type { RhinestoneAccount, SignedIntentData } from './api/account'
export type {
  DestinationChain,
  NonEvmAddress,
  NonEvmChain,
} from './chains/non-evm'
export type {
  AppFeeBalances,
  AppFeeRate,
  ApprovalRequired,
  AuxiliaryFunds,
  BridgeFill,
  ChainOperation,
  FailureReason,
  IntentInput,
  IntentOpStatus,
  OperationStatus,
  OriginSignature,
  Portfolio,
  ProtocolFeeRate,
  Quote,
  SettlementLayer,
  SettlementLayerFilter,
  SignData,
  SplitIntentsInput,
  SplitIntentsResult,
  TokenRequirements,
  WrapRequired,
} from './clients/orchestrator/public'
export type {
  AccountProviderConfig,
  AccountType,
  BundlerConfig,
  Call,
  CallInput,
  ChainSessionConfig,
  CrossChainPermissionInput,
  CrossChainPermit,
  CrossChainSettlementLayer,
  FromLeg,
  MultiFactorValidatorConfig,
  NonEvmTokenRequest,
  NonEvmTokenRequests,
  OwnableValidatorConfig,
  OwnerSet,
  ParamConstraint,
  PaymasterConfig,
  Permission,
  PermissionFunctionConfig,
  Permit2ClaimPolicy,
  Policy,
  ProviderConfig,
  RhinestoneAccountConfig,
  Session,
  SessionDefinition,
  SignerSet,
  SourceCallInput,
  SourceCallProvidedFunds,
  TokenRequest,
  TokenSymbol,
  ToLeg,
  Transaction,
  UniversalActionPolicyParamCondition,
  WebauthnValidatorConfig,
} from './config/account'
export type {
  OwnerPasskeySignature,
  OwnerSignature,
  OwnerSignatureData,
  SignAsOwnerOptions,
} from './signing/types'
export type {
  PreparedQuotes,
  PreparedTransactionData,
  QuoteSelection,
  SignedTransactionData,
  TransactionResult,
} from './transactions/intents/types'
export type {
  PreparedUserOperationData,
  SignedUserOperationData,
  UserOperationResult,
} from './transactions/user-operations/types'
