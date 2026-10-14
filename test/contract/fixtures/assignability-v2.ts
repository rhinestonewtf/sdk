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
import { tronMainnet as currentTronMainnet } from '@rhinestone/sdk'
import type {
  AccountProviderConfig as ReleaseAccountProviderConfig,
  CallInput as ReleaseCallInput,
  OwnerSignature as ReleaseOwnerSignature,
  PreparedTransactionData as ReleasePreparedTransactionData,
  RhinestoneAccount as ReleaseRhinestoneAccount,
  RhinestoneAccountConfig as ReleaseRhinestoneAccountConfig,
  SessionDefinition as ReleaseSessionDefinition,
  Transaction as ReleaseTransaction,
} from '@rhinestone/sdk-base'
import { tronMainnet as releaseTronMainnet } from '@rhinestone/sdk-base'
import { mainnet } from 'viem/chains'

type Assignable<To, From extends To> = From

type ReleaseToCurrent = [
  Assignable<CurrentAccountProviderConfig, ReleaseAccountProviderConfig>,
  Assignable<CurrentCallInput, ReleaseCallInput>,
  Assignable<CurrentOwnerSignature, ReleaseOwnerSignature>,
  Assignable<CurrentPreparedTransactionData, ReleasePreparedTransactionData>,
  Assignable<CurrentRhinestoneAccount, ReleaseRhinestoneAccount>,
  Assignable<CurrentRhinestoneAccountConfig, ReleaseRhinestoneAccountConfig>,
  Assignable<CurrentSessionDefinition, ReleaseSessionDefinition>,
  Assignable<CurrentTransaction, ReleaseTransaction>,
]

type CurrentToRelease = [
  Assignable<ReleaseAccountProviderConfig, CurrentAccountProviderConfig>,
  Assignable<ReleaseCallInput, CurrentCallInput>,
  Assignable<ReleaseOwnerSignature, CurrentOwnerSignature>,
  Assignable<ReleasePreparedTransactionData, CurrentPreparedTransactionData>,
  Assignable<ReleaseRhinestoneAccount, CurrentRhinestoneAccount>,
  Assignable<ReleaseRhinestoneAccountConfig, CurrentRhinestoneAccountConfig>,
  Assignable<ReleaseSessionDefinition, CurrentSessionDefinition>,
  Assignable<ReleaseTransaction, CurrentTransaction>,
]

const releaseAcceptedCrossChainLiteral = {
  sourceChains: [mainnet],
  targetChain: mainnet,
  customDeadline: 9_999_999_999,
} as const satisfies ReleaseTransaction

const currentAcceptedCrossChainLiteral = {
  sourceChains: [mainnet],
  targetChain: mainnet,
  customDeadline: 9_999_999_999,
} as const satisfies CurrentTransaction

const releaseAcceptedNonEvmLiteral = {
  sourceChains: [mainnet],
  targetChain: releaseTronMainnet,
  customDeadline: 9_999_999_999,
} as const satisfies ReleaseTransaction

const currentAcceptedNonEvmLiteral = {
  sourceChains: [mainnet],
  targetChain: currentTronMainnet,
  customDeadline: 9_999_999_999,
} as const satisfies CurrentTransaction

declare const releaseToCurrent: ReleaseToCurrent
declare const currentToRelease: CurrentToRelease
void releaseToCurrent
void currentToRelease
void releaseAcceptedCrossChainLiteral
void currentAcceptedCrossChainLiteral
void releaseAcceptedNonEvmLiteral
void currentAcceptedNonEvmLiteral
