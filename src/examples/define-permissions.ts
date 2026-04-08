/**
 * Example: Using definePermissions to build complex session key permissions
 *
 * This example demonstrates a DeFi session key that grants a backend
 * limited, scoped access to a Uniswap V3 router and an ERC-20 token.
 * It combines param-level constraints (universal-action policy) with
 * spending limits, time windows, and usage caps.
 */
import type { Address } from 'viem'
import { base } from 'viem/chains'
import { definePermissions } from '../actions/permissions'
import type { Session } from '../types'

// -- Contracts ----------------------------------------------------------------

const USDC: Address = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const TREASURY: Address = '0x000000000000000000000000000000000000dead'

// Minimal Uniswap V3 SwapRouter ABI (only the functions we need)
const swapRouterAbi = [
  {
    type: 'function',
    name: 'exactInputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'exactOutputSingle',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountOut', type: 'uint256' },
          { name: 'amountInMaximum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountIn', type: 'uint256' }],
    stateMutability: 'payable',
  },
] as const

// ERC-20 ABI (transfer + approve only)
const erc20Abi = [
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
  },
] as const

// -- Permissions --------------------------------------------------------------

const SWAP_ROUTER: Address = '0x2626664c2603336E57B271c5C0b26F421741e481'
const ALLOWED_SPENDER: Address = SWAP_ROUTER

const now = Date.now()
const ONE_HOUR = 60 * 60 * 1000

// 1) USDC permissions: transfer only to treasury, approve only the router
const usdcActions = definePermissions({
  abi: erc20Abi,
  address: USDC,
  functions: {
    // Allow transfers only to the treasury, capped at 10k USDC per call
    transfer: {
      policies: [
        // Max 50 transfer calls total
        { type: 'usage-limit', limit: 50n },
        // Only valid for the next hour
        {
          type: 'time-frame',
          validAfter: now,
          validUntil: now + ONE_HOUR,
        },
        // Spend at most 100k USDC across all calls
        {
          type: 'spending-limits',
          limits: [{ token: USDC, amount: 100_000n * 10n ** 6n }],
        },
      ],
      // Param-level constraints generate a universal-action policy automatically
      params: {
        to: { condition: 'equal', value: TREASURY },
        amount: { condition: 'lessThanOrEqual', value: 10_000n * 10n ** 6n },
      },
    },
    // Allow approvals only for the swap router, max 50k USDC
    approve: {
      policies: [{ type: 'usage-limit', limit: 5n }],
      params: {
        spender: { condition: 'equal', value: ALLOWED_SPENDER },
        amount: { condition: 'lessThanOrEqual', value: 50_000n * 10n ** 6n },
      },
    },
  },
})

// 2) Swap router permissions: allow exactInputSingle and exactOutputSingle
//    with value limit (max 1 ETH of native value per swap call)
const swapActions = definePermissions({
  abi: swapRouterAbi,
  address: SWAP_ROUTER,
  functions: {
    // exactInputSingle: allow with a native value cap
    exactInputSingle: {
      valueLimitPerUse: 10n ** 18n, // max 1 ETH per call
      policies: [
        { type: 'usage-limit', limit: 20n },
        {
          type: 'time-frame',
          validAfter: now,
          validUntil: now + ONE_HOUR,
        },
      ],
      // Note: tuple params (like `params` in exactInputSingle) are dynamic at
      // the ABI level, so we can't add param-level rules for them here.
      // The universal-action policy is still created because of valueLimitPerUse.
    },
    // exactOutputSingle: policies only, no param constraints
    exactOutputSingle: {
      policies: [
        { type: 'usage-limit', limit: 10n },
        { type: 'value-limit', limit: 10n ** 18n },
      ],
    },
  },
})

// -- Session ------------------------------------------------------------------

// Combine permissions from both contracts into a single session
const _session: Session = {
  chain: base,
  owners: {
    type: 'ecdsa',
    accounts: [], // session key signer would go here
    threshold: 1,
  },
  actions: [...usdcActions, ...swapActions],
}

// The session.actions array now contains 4 scoped actions:
//   1. USDC transfer  — param rules (to=treasury, amount<=10k) + usage + time + spending
//   2. USDC approve   — param rules (spender=router, amount<=50k) + usage
//   3. exactInputSingle — value limit + usage + time
//   4. exactOutputSingle — usage + value limit
