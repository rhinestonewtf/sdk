import type {
  Abi,
  AbiFunction,
  Address,
  Chain,
  Hex,
  TypedDataDefinition,
} from 'viem'
import type { OwnerSet } from '../types'

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
  // Required when a session sets `oneTimeUse`; no default until the policy has a
  // canonical deployment.
  readonly oneTimeUseId?: Address
}

export type CrossChainSettlementLayer = 'SAME_CHAIN' | 'ECO' | 'ACROSS'

export interface CrossChainPermit {
  from?: { chain: Chain; token: Address; maxAmount?: bigint }[]
  to?: { chain: Chain; token: Address; recipient?: Address | 'any' }[]
  validUntil?: bigint
  validAfter?: bigint
  fillDeadline?: { chain: Chain; min?: bigint; max?: bigint }[]
  recipientIsAccount?: boolean
  settlementLayers?: CrossChainSettlementLayer[]
}

export interface FromLeg {
  chain: Chain
  token: Address
  maxAmount?: bigint
}

export interface ToLeg {
  chain: Chain
  token: Address
  recipient?: Address | 'any'
}

export interface CrossChainPermissionInput {
  from?: FromLeg | FromLeg[]
  to?: ToLeg | ToLeg[]
  validUntil?: Date
  validAfter?: Date
  fillDeadline?: { chain: Chain; min?: Date; max?: Date }[]
  allowRecipientNotAccount?: boolean
  settlementLayers?: CrossChainSettlementLayer[]
}

export interface Permit2ClaimPolicy {
  type: 'permit2'
  spenders?: Address[]
  sourceTokens?: { chain: Chain; address: Address }[]
  destinationTokens?: { chain: Chain; address: Address }[]
  recipients?: { chain: Chain; address: Address | 'any' }[]
  recipientIsAccount?: boolean
  permitDeadline?: { min?: bigint; max?: bigint }
  fillDeadline?: { chain: Chain; min?: bigint; max?: bigint }[]
}

export interface SessionDefinition {
  chain: Chain
  owners: OwnerSet
  permissions?: Permission[]
  claimPolicies?: Permit2ClaimPolicy[]
  crossChainPermits?: CrossChainPermissionInput[]
  policyAddresses?: SessionPolicyAddresses
  // Pins a one-time-use id on the session (RHI-5798): the session settles at most
  // once per chain. Requires `policyAddresses.oneTimeUseId`, and each settlement
  // must carry the matching burn op (see buildOneTimeUseBurnOp) in its
  // `preClaimExecutions`.
  oneTimeUse?: OneTimeUseSessionConfig
  // Pre-encoded ERC-1271 policy entries to install on the session's 1271 surface
  // (e.g. an IntentExecutor settlement-layer policy). Enforcing 1271 policies drop
  // the default sudo entry, so the 1271 list stays a strict AND.
  erc1271Policies?: ResolvedPolicy[]
}

export interface OneTimeUseSessionConfig {
  readonly id: bigint
}

export interface ResolvedPolicy {
  policy: Address
  initData: Hex
}

export interface ResolvedAction {
  actionTargetSelector: Hex
  actionTarget: Address
  actionPolicies: readonly ResolvedPolicy[]
}

export interface ResolvedERC7739Content {
  appDomainSeparator: Hex
  contentNames: readonly string[]
}

export interface ResolvedERC7739Policies {
  allowedERC7739Content: readonly ResolvedERC7739Content[]
  erc1271Policies: readonly ResolvedPolicy[]
}

export interface Session {
  chain: Chain
  owners: OwnerSet
  hasExplicitPermissions: boolean
  permissionId: Hex
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  erc7739Policies: ResolvedERC7739Policies
  actions: readonly ResolvedAction[]
  claimPolicies: readonly Permit2ClaimPolicy[]
  // When true, `claimPolicies` are enforced via the ERC-1271 surface (already
  // encoded into `erc7739Policies.erc1271Policies`) and must NOT be re-encoded
  // onto the on-chain claim (lockTag) surface. They stay on the high-level
  // session so the permit2 settlement signature can still build their calldata.
  claimPoliciesEnforcedVia1271?: boolean
  // A one-time-use session (RHI-5798). The executor route's on-chain guard runs
  // via checkAction, which only fires in verify-execution mode, so this forces
  // that mode in prepareIntentSessions even for an already-enabled session — see
  // there for why dropping to plain ERC-1271 would make the guard inert.
  oneTimeUse?: boolean
}

export interface SessionData {
  sessionValidator: Address
  sessionValidatorInitData: Hex
  salt: Hex
  erc7739Policies: ResolvedERC7739Policies
  actions: readonly ResolvedAction[]
  claimPolicies: readonly ResolvedPolicy[]
}

export interface SessionEnableData {
  readonly userSignature: Hex
  readonly hashesAndChainIds: readonly ChainDigest[]
  readonly sessionToEnableIndex: number
}

export interface ChainDigest {
  chainId: bigint
  sessionDigest: Hex
}

export interface SessionDetails {
  nonces: bigint[]
  hashesAndChainIds: ChainDigest[]
  data: TypedDataDefinition<
    typeof import('./authorization').types,
    'MultiChainSession'
  >
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
