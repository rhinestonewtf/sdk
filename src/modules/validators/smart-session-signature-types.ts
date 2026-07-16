import type { Address, Hex } from 'viem'

interface SmartSessionPolicyData {
  readonly policy: Address
  readonly initData: Hex
}

interface SmartSessionActionData {
  readonly actionTargetSelector: Hex
  readonly actionTarget: Address
  readonly actionPolicies: readonly SmartSessionPolicyData[]
}

interface SmartSessionErc7739PolicyData {
  readonly allowedERC7739Content: readonly {
    readonly appDomainSeparator: Hex
    readonly contentNames: readonly string[]
  }[]
  readonly erc1271Policies: readonly SmartSessionPolicyData[]
}

export interface SmartSessionEnableContributionData {
  readonly userSignature: Hex
  readonly hashesAndChainIds: readonly {
    readonly chainId: bigint
    readonly sessionDigest: Hex
  }[]
  readonly sessionToEnableIndex: number
  readonly session: {
    readonly sessionValidator: Address
    readonly sessionValidatorInitData: Hex
    readonly salt: Hex
    readonly erc7739Policies: SmartSessionErc7739PolicyData
    readonly actions: readonly SmartSessionActionData[]
    readonly claimPolicies: readonly SmartSessionPolicyData[]
  }
}
