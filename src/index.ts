import { RhinestoneSDK } from './api/sdk'
import { MULTI_FACTOR_VALIDATOR_ADDRESS } from './modules/validators/multi-factor'
import { OWNABLE_VALIDATOR_ADDRESS } from './modules/validators/ownable'
import { SMART_SESSION_EMISSARY_ADDRESS } from './modules/validators/smart-sessions/module'
import { WEBAUTHN_VALIDATOR_ADDRESS } from './modules/validators/webauthn'
import { hyperCoreMainnet, solanaMainnet, tronMainnet } from './orchestrator'

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
  TransactionResult,
  UserOperationResult,
} from './execution'
export type {
  OwnerPasskeySignature,
  OwnerSignature,
  OwnerSignatureData,
  PreparedQuotes,
  PreparedTransactionData,
  PreparedUserOperationData,
  QuoteSelection,
  SignAsOwnerOptions,
  SignedTransactionData,
  SignedUserOperationData,
} from './execution/utils'
export type {
  AppFeeBalances,
  AppFeeRate,
  ApprovalRequired,
  AuxiliaryFunds,
  BridgeFill,
  ChainOperation,
  DestinationChain,
  FailureReason,
  IntentInput,
  IntentOpStatus,
  NonEvmAddress,
  NonEvmChain,
  OperationStatus,
  OriginSignature,
  Portfolio,
  Quote,
  SettlementLayer,
  SettlementLayerFilter,
  SignData,
  SplitIntentsInput,
  SplitIntentsResult,
  TokenRequirements,
  WrapRequired,
} from './orchestrator'
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
} from './types'
