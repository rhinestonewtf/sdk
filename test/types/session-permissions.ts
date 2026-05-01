import { type Address, erc20Abi } from 'viem'
import { base } from 'viem/chains'
import { type Permission, toSession } from '../../src/index'
import { accountA } from '../consts'

const USDC: Address = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const RECIPIENT: Address = '0x1111111111111111111111111111111111111111'

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            recipient: { condition: 'equal', value: RECIPIENT },
            amount: { condition: 'lessThan', value: 1000n },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error recipient is an address param, not a bigint.
            recipient: { condition: 'equal', value: 1000n },
          },
        },
      },
    },
  ],
})

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: erc20Abi,
      address: USDC,
      functions: {
        transfer: {
          params: {
            // @ts-expect-error amount is a uint256 param, not an address.
            amount: { condition: 'lessThan', value: RECIPIENT },
          },
        },
      },
    },
  ],
})

const bytesAbi = [
  {
    type: 'function',
    name: 'send',
    inputs: [{ name: 'data', type: 'bytes' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [
    {
      abi: bytesAbi,
      address: USDC,
      functions: {
        send: {
          params: {
            // @ts-expect-error dynamic bytes params cannot be constrained.
            data: { condition: 'equal', value: '0x1234' },
          },
        },
      },
    },
  ],
})

const permission = {
  abi: erc20Abi,
  address: USDC,
  functions: {
    approve: {
      params: {
        spender: { condition: 'equal', value: RECIPIENT },
        amount: { condition: 'lessThanOrEqual', value: 1000n },
      },
    },
  },
} as const satisfies Permission<typeof erc20Abi>

toSession({
  chain: base,
  owners: { type: 'ecdsa', accounts: [accountA] },
  permissions: [permission],
})
