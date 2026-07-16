import type {
  Abi,
  AbiFunction,
  Address,
  Chain,
  Hex,
  TypedDataDefinition,
} from 'viem'
import type { CanonicalTokenSymbol } from '../../../chains/tokens'
import type { ValidatorInput } from '../types'

export type UniversalActionPolicyParamCondition =
  | 'equal'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'
  | 'notEqual'
  | 'inRange'

export interface UniversalActionPolicyParamRule {
  readonly condition: UniversalActionPolicyParamCondition
  readonly calldataOffset: bigint
  readonly usageLimit?: bigint
  readonly referenceValue: Hex | bigint
}

export type ArgPolicyExpression =
  | { readonly type: 'rule'; readonly rule: UniversalActionPolicyParamRule }
  | { readonly type: 'not'; readonly child: ArgPolicyExpression }
  | {
      readonly type: 'and' | 'or'
      readonly left: ArgPolicyExpression
      readonly right: ArgPolicyExpression
    }

export type SessionPolicy =
  | { readonly type: 'sudo' }
  | {
      readonly type: 'universal-action'
      readonly valueLimitPerUse?: bigint
      readonly rules: [
        UniversalActionPolicyParamRule,
        ...UniversalActionPolicyParamRule[],
      ]
    }
  | {
      readonly type: 'arg-policy'
      readonly valueLimitPerUse?: bigint
      readonly expression: ArgPolicyExpression
    }
  | {
      readonly type: 'spending-limits'
      readonly limits: {
        readonly token: Address
        readonly amount: bigint
      }[]
    }
  | {
      readonly type: 'time-frame'
      readonly validUntil: number
      readonly validAfter: number
    }
  | { readonly type: 'usage-limit'; readonly limit: bigint }
  | { readonly type: 'value-limit'; readonly limit: bigint }
  | { readonly type: 'intent-execution' }

export interface FallbackAction {
  readonly policies?: SessionPolicy[]
}

export interface ScopedAction {
  readonly target: Address
  readonly selector: Hex
  readonly policies?: SessionPolicy[]
}

export type SessionAction = FallbackAction | ScopedAction

export interface Permission {
  readonly abi: Abi
  readonly address: Address
  readonly functions: Readonly<
    Record<
      string,
      | {
          readonly valueLimitPerUse?: bigint
          readonly params?: Readonly<Record<string, unknown>>
          readonly maxUses?: bigint
          readonly validUntil?: Date
          readonly validAfter?: Date
          readonly valueLimit?: bigint
          readonly spendingLimit?: {
            readonly token: Address
            readonly amount: bigint
          }
        }
      | undefined
    >
  >
}

export interface SessionPolicyAddresses {
  readonly sudo?: Address
  readonly universalAction?: Address
  readonly argPolicy?: Address
  readonly spendingLimits?: Address
  readonly timeFrame?: Address
  readonly usageLimit?: Address
  readonly valueLimit?: Address
}

export type CrossChainSettlementLayer = 'SAME_CHAIN' | 'ECO' | 'ACROSS'

export interface CrossChainPermit {
  readonly from?: readonly {
    readonly chain: Chain
    readonly token: Address
    readonly maxAmount?: bigint
  }[]
  readonly to?: readonly {
    readonly chain: Chain
    readonly token: Address
    readonly recipient?: Address | 'any'
  }[]
  readonly validUntil?: bigint
  readonly validAfter?: bigint
  readonly fillDeadline?: readonly {
    readonly chain: Chain
    readonly min?: bigint
    readonly max?: bigint
  }[]
  readonly recipientIsAccount?: boolean
  readonly settlementLayers?: readonly CrossChainSettlementLayer[]
}

export interface CrossChainPermissionInput {
  readonly from?:
    | {
        readonly chain: Chain
        readonly token: Address | CanonicalTokenSymbol
        readonly maxAmount?: bigint
      }
    | readonly {
        readonly chain: Chain
        readonly token: Address | CanonicalTokenSymbol
        readonly maxAmount?: bigint
      }[]
  readonly to?:
    | {
        readonly chain: Chain
        readonly token: Address | CanonicalTokenSymbol
        readonly recipient?: Address | 'any'
      }
    | readonly {
        readonly chain: Chain
        readonly token: Address | CanonicalTokenSymbol
        readonly recipient?: Address | 'any'
      }[]
  readonly validUntil?: Date
  readonly validAfter?: Date
  readonly fillDeadline?: readonly {
    readonly chain: Chain
    readonly min?: Date
    readonly max?: Date
  }[]
  readonly allowRecipientNotAccount?: boolean
  readonly settlementLayers?: readonly CrossChainSettlementLayer[]
}

export interface Permit2ClaimPolicy {
  readonly type: 'permit2'
  readonly spenders?: readonly Address[]
  readonly sourceTokens?: readonly {
    readonly chain: Chain
    readonly address: Address
  }[]
  readonly destinationTokens?: readonly {
    readonly chain: Chain
    readonly address: Address
  }[]
  readonly recipients?: readonly {
    readonly chain: Chain
    readonly address: Address | 'any'
  }[]
  readonly recipientIsAccount?: boolean
  readonly permitDeadline?: { readonly min?: bigint; readonly max?: bigint }
  readonly fillDeadline?: readonly {
    readonly chain: Chain
    readonly min?: bigint
    readonly max?: bigint
  }[]
}

export interface SessionDefinition {
  readonly chain: Chain
  readonly owners: ValidatorInput
  readonly permissions?: readonly Permission[]
  readonly claimPolicies?: readonly Permit2ClaimPolicy[]
  readonly crossChainPermits?: readonly CrossChainPermissionInput[]
  readonly policyAddresses?: SessionPolicyAddresses
}

export interface ResolvedPolicy {
  readonly policy: Address
  readonly initData: Hex
}

export interface ResolvedAction {
  readonly actionTargetSelector: Hex
  readonly actionTarget: Address
  readonly actionPolicies: readonly ResolvedPolicy[]
}

export interface ResolvedERC7739Policies {
  readonly allowedERC7739Content: readonly {
    readonly appDomainSeparator: Hex
    readonly contentNames: readonly string[]
  }[]
  readonly erc1271Policies: readonly ResolvedPolicy[]
}

export interface Session {
  readonly chain: Chain
  readonly owners: ValidatorInput
  readonly hasExplicitPermissions: boolean
  readonly permissionId: Hex
  readonly sessionValidator: Address
  readonly sessionValidatorInitData: Hex
  readonly salt: Hex
  readonly erc7739Policies: ResolvedERC7739Policies
  readonly actions: readonly ResolvedAction[]
  readonly claimPolicies: readonly Permit2ClaimPolicy[]
}

export interface SessionData {
  readonly sessionValidator: Address
  readonly sessionValidatorInitData: Hex
  readonly salt: Hex
  readonly erc7739Policies: ResolvedERC7739Policies
  readonly actions: readonly ResolvedAction[]
  readonly claimPolicies: readonly ResolvedPolicy[]
}

export interface SessionEnableData {
  readonly userSignature: Hex
  readonly hashesAndChainIds: readonly ChainDigest[]
  readonly sessionToEnableIndex: number
}

export interface ChainDigest {
  readonly chainId: bigint
  readonly sessionDigest: Hex
}

export interface SessionDetails {
  readonly nonces: readonly bigint[]
  readonly hashesAndChainIds: readonly ChainDigest[]
  readonly data: TypedDataDefinition
}

export interface ResolvedSessionSignerSet {
  readonly kind: 'smart-session'
  readonly session: Session
  readonly enableData?: SessionEnableData
  readonly verifyExecutions: boolean
  readonly claimPolicyData?: Hex
}

export type SmartSessionMockShape = 'enable' | 'use' | 'erc1271'

export type RawFunctionConfig = NonNullable<Permission['functions'][string]>
export type RawAbiFunction = AbiFunction
