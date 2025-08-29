import {
  type Address,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  keccak256,
  slice,
  toHex,
} from 'viem'
import type { IntentOp } from '../orchestrator/types'
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

const COMPACT_ADDRESS = '0xa2E6C7Ba8613E1534dCB990e7e4962216C0a5d58'
const ALLOCATOR_ADDRESS = '0x9Ef7519F90C9B6828650Ff4913d663BB1f688507'
const DEFAULT_RESET_PERIOD: ResetPeriod = 3
const DEFAULT_SCOPE: Scope = 0

function getDepositEtherCall(account: Address, value: bigint): Call {
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
          outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
          stateMutability: 'payable',
        },
      ],
      functionName: 'depositNative',
      args: [lockTag(), account],
    }),
    value,
  }
}

function getDepositErc20Call(
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

function getDepositErc20CallWithLockTag(
  account: Address,
  tokenAddress: Address,
  amount: bigint,
  tag: Hex,
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
      args: [tokenAddress, tag, amount, account],
    }),
  }
}

function getApproveErc20Call(tokenAddress: Address, amount: bigint): Call {
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

function computeLockTag(
  allocator: Address,
  scope: Scope,
  resetPeriod: ResetPeriod,
): Hex {
  const allocatorId = usingAllocatorId(allocator)
  const tagBig =
    (BigInt(scope) << 255n) | (BigInt(resetPeriod) << 252n) | (allocatorId << 160n)
  // Build full 32-byte value, then take the first 12 bytes (big-endian)
  const hex32 = toHex(tagBig, { size: 32 })
  return (`0x${hex32.slice(2, 2 + 24)}`) as Hex
}

function computeLockTagFromAllocatorId(
  allocatorId: bigint,
  scope: Scope,
  resetPeriod: ResetPeriod,
): Hex {
  const tagBig =
    (BigInt(scope) << 255n) | (BigInt(resetPeriod) << 252n) | (allocatorId << 160n)
  const hex32 = toHex(tagBig, { size: 32 })
  return (`0x${hex32.slice(2, 2 + 24)}`) as Hex
}

function lockTag(): Hex {
  return computeLockTag(ALLOCATOR_ADDRESS, DEFAULT_SCOPE, DEFAULT_RESET_PERIOD)
}

function getAssignEmissaryCall(lockTag: Hex, emissary: Address): Call {
  return {
    to: COMPACT_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'assignEmissary',
          inputs: [
            { name: 'lockTag', type: 'bytes12', internalType: 'bytes12' },
            { name: 'emissary', type: 'address', internalType: 'address' },
          ],
          outputs: [],
          stateMutability: 'nonpayable',
        },
      ],
      functionName: 'assignEmissary',
      args: [lockTag, emissary],
    }),
  }
}

// Define the typed data structure as const to preserve type safety
const COMPACT_TYPED_DATA_TYPES = {
  MultichainCompact: [
    { name: 'sponsor', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expires', type: 'uint256' },
    { name: 'elements', type: 'Element[]' },
  ],
  Element: [
    { name: 'arbiter', type: 'address' },
    { name: 'chainId', type: 'uint256' },
    { name: 'commitments', type: 'Lock[]' },
    { name: 'mandate', type: 'Mandate' },
  ],
  Lock: [
    { name: 'lockTag', type: 'bytes12' },
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  Mandate: [
    { name: 'target', type: 'Target' },
    { name: 'originOps', type: 'Op[]' },
    { name: 'destOps', type: 'Op[]' },
    { name: 'q', type: 'bytes32' },
  ],
  Target: [
    { name: 'recipient', type: 'address' },
    { name: 'tokenOut', type: 'Token[]' },
    { name: 'targetChain', type: 'uint256' },
    { name: 'fillExpiry', type: 'uint256' },
  ],
  Token: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  Op: [
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'data', type: 'bytes' },
  ],
} as const

function getIntentData(intentOp: IntentOp) {
  const typedData = {
    domain: {
      name: 'The Compact',
      version: '1',
      chainId: BigInt(intentOp.elements[0].chainId),
      verifyingContract: '0x73d2dc0c21fca4ec1601895d50df7f5624f07d3f',
    },
    types: COMPACT_TYPED_DATA_TYPES,
    primaryType: 'MultichainCompact',
    message: {
      sponsor: intentOp.sponsor,
      nonce: BigInt(intentOp.nonce),
      expires: BigInt(intentOp.expires),
      elements: intentOp.elements.map((element) => ({
        arbiter: element.arbiter,
        chainId: BigInt(element.chainId),
        commitments: element.idsAndAmounts.map((token) => ({
          lockTag: slice(toHex(BigInt(token[0])), 0, 12),
          token: slice(toHex(BigInt(token[0])), 12, 32),
          amount: BigInt(token[1]),
        })),
        mandate: {
          target: {
            recipient: element.mandate.recipient,
            tokenOut: element.mandate.tokenOut.map((token) => ({
              token: slice(toHex(BigInt(token[0])), 12, 32),
              amount: BigInt(token[1]),
            })),
            targetChain: BigInt(element.mandate.destinationChainId),
            fillExpiry: BigInt(element.mandate.fillDeadline),
          },
          originOps: element.mandate.preClaimOps.map((op) => ({
            to: op.to,
            value: BigInt(op.value),
            data: op.data,
          })),
          destOps: element.mandate.destinationOps.map((op) => ({
            to: op.to,
            value: BigInt(op.value),
            data: op.data,
          })),
          q: keccak256(element.mandate.qualifier?.encodedVal ?? '0x'),
        },
      })),
    },
  } as const

  return typedData
}

export {
  COMPACT_ADDRESS,
  ALLOCATOR_ADDRESS,
  getDepositEtherCall,
  getDepositErc20Call,
  getDepositErc20CallWithLockTag,
  getApproveErc20Call,
  computeLockTag,
  computeLockTagFromAllocatorId,
  getAssignEmissaryCall,
  getIntentData,
}
