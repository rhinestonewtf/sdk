import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  parseUnits,
  toFunctionSelector,
} from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import type { Chain } from 'viem/chains'
import type { Session } from '../../../src/index'
import { toSession } from '../../../src/modules/validators/smart-sessions'
import { getTokenAddress } from './tokens'

export const noopTarget: Address = '0xd8da6bf26964af9d7eed9e03e53415d37aa96045'

const noopAbi = [
  {
    type: 'function',
    name: 'noop',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

export const noopSelector = toFunctionSelector(noopAbi[0])

export function createOwner() {
  return privateKeyToAccount(generatePrivateKey())
}

export function createNoopCall() {
  return {
    to: noopTarget,
    value: 0n,
    data: noopSelector,
  }
}

export function createUsdcRequestWithoutFunds(chainId: number) {
  return {
    tokenRequests: [
      {
        address: getTokenAddress('USDC', chainId),
        amount: 1_000_000n,
      },
    ],
  }
}

export function createUnfundedUsdcTransferCall(chain: Chain) {
  const usdcAddress = getTokenAddress('USDC', chain.id)

  return {
    to: usdcAddress,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [noopTarget, parseUnits('1000', 6)],
    }),
  }
}

export function createScopedSession({
  chain,
  owner,
}: {
  chain: Chain
  owner: ReturnType<typeof privateKeyToAccount>
}): Session {
  return toSession({
    chain,
    owners: { type: 'ecdsa', accounts: [owner] },
    permissions: [
      {
        abi: noopAbi,
        address: noopTarget,
        functions: { noop: {} },
      },
    ],
  })
}

export function createUnscopedSession({
  chain,
  owner,
}: {
  chain: Chain
  owner: ReturnType<typeof privateKeyToAccount>
}): Session {
  return toSession({
    chain,
    owners: { type: 'ecdsa', accounts: [owner] },
  })
}

export function createMultiScopedSession({
  chain,
  owner,
}: {
  chain: Chain
  owner: ReturnType<typeof privateKeyToAccount>
}): Session {
  return toSession({
    chain,
    owners: { type: 'ecdsa', accounts: [owner] },
    permissions: [
      {
        abi: noopAbi,
        address: noopTarget,
        functions: { noop: {} },
      },
      {
        abi: erc20Abi,
        address: noopTarget,
        functions: { balanceOf: {} },
      },
    ],
  })
}

export function createOutOfScopeCall(): {
  to: Address
  value: bigint
  data: Hex
} {
  return {
    to: noopTarget,
    value: 0n,
    data: '0xdeadbeef',
  }
}

export function createWrongTargetCall(): {
  to: Address
  value: bigint
  data: Hex
} {
  return {
    to: '0x0000000000000000000000000000000000000001',
    value: 0n,
    data: noopSelector,
  }
}
