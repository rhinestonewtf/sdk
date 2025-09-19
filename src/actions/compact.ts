import {
  type Address,
  concat,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  zeroAddress,
} from 'viem'
import { COMPACT_ADDRESS } from '../execution/compact'
import type { Call } from '../types'

type ResetPeriod =
  | 0 // OneSecond
  | 1 // FifteenSeconds
  | 2 // OneMinute
  | 3 // TenMinutes
  | 4 // OneHourAndFiveMinutes
  | 5 // OneDay
  | 6 // SevenDaysAndOneHour
  | 7 // ThirtyDays

type Scope = 0 | 1 // Multichain | ChainSpecific

const ALLOCATOR_ADDRESS = '0xd93ed1dd9f1f0b523e4d77233809dc2ee22928c6'
const DEFAULT_RESET_PERIOD: ResetPeriod = 6
const DEFAULT_SCOPE: Scope = 0

function depositEther(account: Address, value: bigint): Call {
  return {
    to: COMPACT_ADDRESS,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'depositNative',
          inputs: [
            { name: 'lockTag', type: 'bytes12', internalType: 'bytes12' },
            { name: 'recipient', type: 'address', internalType: 'address' },
          ],
          outputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
          stateMutability: 'payable',
        },
      ],
      functionName: 'depositNative',
      args: [lockTag(), account],
    }),
    value,
  }
}

function enableEtherWithdrawal(): Call {
  const id = concat([lockTag(), zeroAddress])
  return enableForcedWithdrawal(BigInt(id))
}

function disableEtherWithdrawal(): Call {
  const id = concat([lockTag(), zeroAddress])
  return disableForcedWithdrawal(BigInt(id))
}

function withdrawEther(account: Address, value: bigint): Call {
  const id = concat([lockTag(), zeroAddress])
  return forcedWithdrawal(BigInt(id), account, value)
}

function depositErc20(
  account: Address,
  tokenAddress: Address,
  amount: bigint,
): Call {
  return {
    to: COMPACT_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'depositERC20',
          inputs: [
            {
              name: 'token',
              type: 'address',
              internalType: 'address',
            },
            { name: 'lockTag', type: 'bytes12', internalType: 'bytes12' },
            { name: 'amount', type: 'uint256', internalType: 'uint256' },
            { name: 'recipient', type: 'address', internalType: 'address' },
          ],
          outputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
          stateMutability: 'nonpayable',
        },
      ],
      functionName: 'depositERC20',
      args: [tokenAddress, lockTag(), amount, account],
    }),
  }
}

function enableErc20Withdrawal(tokenAddress: Address): Call {
  const id = concat([lockTag(), tokenAddress])
  return enableForcedWithdrawal(BigInt(id))
}

function disableErc20Withdrawal(tokenAddress: Address): Call {
  const id = concat([lockTag(), tokenAddress])
  return disableForcedWithdrawal(BigInt(id))
}

function withdrawErc20(
  account: Address,
  tokenAddress: Address,
  amount: bigint,
): Call {
  const id = concat([lockTag(), tokenAddress])
  return forcedWithdrawal(BigInt(id), account, amount)
}

function enableForcedWithdrawal(id: bigint): Call {
  return {
    to: COMPACT_ADDRESS,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'enableForcedWithdrawal',
          inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
          outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
          stateMutability: 'nonpayable',
        },
      ],
      functionName: 'enableForcedWithdrawal',
      args: [id],
    }),
    value: 0n,
  }
}

function disableForcedWithdrawal(id: bigint): Call {
  return {
    to: COMPACT_ADDRESS,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'disableForcedWithdrawal',
          inputs: [{ name: 'id', type: 'uint256', internalType: 'uint256' }],
          outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
          stateMutability: 'nonpayable',
        },
      ],
      functionName: 'disableForcedWithdrawal',
      args: [id],
    }),
    value: 0n,
  }
}

function forcedWithdrawal(
  id: bigint,
  recipient: Address,
  amount: bigint,
): Call {
  return {
    to: COMPACT_ADDRESS,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'forcedWithdrawal',
          inputs: [
            { name: 'id', type: 'uint256', internalType: 'uint256' },
            { name: 'recipient', type: 'address', internalType: 'address' },
            { name: 'amount', type: 'uint256', internalType: 'uint256' },
          ],
          outputs: [{ name: '', type: 'bool', internalType: 'bool' }],
          stateMutability: 'nonpayable',
        },
      ],
      functionName: 'forcedWithdrawal',
      args: [id, recipient, amount],
    }),
    value: 0n,
  }
}

function approveErc20(tokenAddress: Address, amount: bigint): Call {
  return {
    to: tokenAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: 'approve',
      args: [COMPACT_ADDRESS, amount],
    }),
  }
}

function toCompactFlag(allocator: Address): number {
  const addrBytes = Buffer.from(allocator.slice(2), 'hex')
  let leadingZeroNibbles = 0

  for (const byte of addrBytes) {
    if (byte === 0) {
      leadingZeroNibbles += 2
    } else {
      if (byte >> 4 === 0) leadingZeroNibbles += 1
      break
    }
  }

  if (leadingZeroNibbles >= 18) return 15
  if (leadingZeroNibbles >= 4) return leadingZeroNibbles - 3
  return 0
}

function usingAllocatorId(allocator: Address = ALLOCATOR_ADDRESS): bigint {
  const compactFlag = BigInt(toCompactFlag(allocator))
  const last88Bits = BigInt(`0x${allocator.slice(-22)}`) // Extract last 88 bits (11 bytes * 2 hex chars per byte)
  return (compactFlag << 88n) | last88Bits
}

function lockTag(): Hex {
  const allocatorId = usingAllocatorId(ALLOCATOR_ADDRESS)
  const tagBig =
    (BigInt(DEFAULT_SCOPE) << 255n) |
    (BigInt(DEFAULT_RESET_PERIOD) << 252n) |
    (allocatorId << 160n)
  const hex = tagBig.toString(16).slice(0, 24)
  return `0x${hex}` as const
}

export {
  depositEther,
  enableEtherWithdrawal,
  disableEtherWithdrawal,
  withdrawEther,
  depositErc20,
  enableErc20Withdrawal,
  disableErc20Withdrawal,
  withdrawErc20,
  approveErc20,
}
