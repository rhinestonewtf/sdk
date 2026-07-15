import type {
  AccountProviderConfig as CurrentAccountProviderConfig,
  CallInput as CurrentCallInput,
  OwnerSignature as CurrentOwnerSignature,
  PreparedTransactionData as CurrentPreparedTransactionData,
  RhinestoneAccount as CurrentRhinestoneAccount,
  RhinestoneAccountConfig as CurrentRhinestoneAccountConfig,
  SessionDefinition as CurrentSessionDefinition,
  Transaction as CurrentTransaction,
} from '@rhinestone/sdk'
import type {
  AccountProviderConfig as LegacyAccountProviderConfig,
  CallInput as LegacyCallInput,
  OwnerSignature as LegacyOwnerSignature,
  PreparedTransactionData as LegacyPreparedTransactionData,
  RhinestoneAccount as LegacyRhinestoneAccount,
  RhinestoneAccountConfig as LegacyRhinestoneAccountConfig,
  SessionDefinition as LegacySessionDefinition,
  Transaction as LegacyTransaction,
} from '@rhinestone/sdk-base'

type Assignable<To, From extends To> = From

type LegacyToCurrent = [
  Assignable<CurrentAccountProviderConfig, LegacyAccountProviderConfig>,
  Assignable<CurrentCallInput, LegacyCallInput>,
  Assignable<CurrentOwnerSignature, LegacyOwnerSignature>,
  Assignable<CurrentPreparedTransactionData, LegacyPreparedTransactionData>,
  Assignable<CurrentRhinestoneAccount, LegacyRhinestoneAccount>,
  Assignable<CurrentRhinestoneAccountConfig, LegacyRhinestoneAccountConfig>,
  Assignable<CurrentSessionDefinition, LegacySessionDefinition>,
  Assignable<CurrentTransaction, LegacyTransaction>,
]

type CurrentToLegacy = [
  Assignable<LegacyAccountProviderConfig, CurrentAccountProviderConfig>,
  Assignable<LegacyCallInput, CurrentCallInput>,
  Assignable<LegacyOwnerSignature, CurrentOwnerSignature>,
  Assignable<LegacyPreparedTransactionData, CurrentPreparedTransactionData>,
  Assignable<LegacyRhinestoneAccount, CurrentRhinestoneAccount>,
  Assignable<LegacyRhinestoneAccountConfig, CurrentRhinestoneAccountConfig>,
  Assignable<LegacySessionDefinition, CurrentSessionDefinition>,
  Assignable<LegacyTransaction, CurrentTransaction>,
]

declare const legacyToCurrent: LegacyToCurrent
declare const currentToLegacy: CurrentToLegacy
void legacyToCurrent
void currentToLegacy
