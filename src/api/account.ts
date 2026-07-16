import type { Address, Hex } from 'viem'

export interface RhinestoneAccount {
  readonly getInitData: () => {
    readonly address: Address
    readonly factory: Address
    readonly factoryData: Hex
    readonly intentExecutorInstalled: boolean
  }
}
