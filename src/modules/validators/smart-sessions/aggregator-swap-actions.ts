import { type Abi, type Address, type Hex, toFunctionSelector } from 'viem'
import type {
  Permission,
  ScopedAction,
  SessionPolicy,
  UniversalActionPolicyParamRule,
} from './types'

// RHI-6286 (POC): scope a smart session to a specific swap aggregator so a
// session key can only approve the sell token and route a swap through that
// aggregator — nothing else. Pairs with `restrictToActions` on the session
// (which drops the wildcard fallback) so these are the ONLY authorized ops.
//
// 0x (Swap API v2, AllowanceHolder flow). The account performs two calls:
//   1. approve(AllowanceHolder, amount) on the sell token
//   2. AllowanceHolder.exec(operator, token, amount, target, data) — pulls the
//      approved sell token and forwards `data` to the 0x Settler (`target`).
// exec's static words are pinnable: token(1), amount(2), target(3). The buy
// token and route live inside the opaque `data` (the Settler calldata) and can
// NOT be pinned here — so this binds the SELL side (token, cap, forward-to-
// Settler) and the aggregator entrypoint, not the received token.

// 0x AllowanceHolder on Cancun-hardfork chains (incl. Plasma). Verify per chain.
export const ZEROX_ALLOWANCE_HOLDER: Address =
  '0x0000000000001fF3684f28c67538d4D072C22734'

export const erc20ApproveAbi = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi

export const allowanceHolderExecAbi = [
  {
    type: 'function',
    name: 'exec',
    stateMutability: 'payable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'target', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'bytes' }],
  },
] as const satisfies Abi

export const ALLOWANCE_HOLDER_EXEC_SELECTOR = toFunctionSelector(
  'function exec(address,address,uint256,address,bytes)',
)

export interface ZeroExSwapScope {
  // The token the session may sell (e.g. USDC on Plasma).
  readonly sellToken: Address
  // The 0x Settler the AllowanceHolder forwards to (exec.target). 0x rotates
  // Settler versions, so pinning it binds the session to the current one — omit
  // to leave the forward target unpinned (weaker, but survives a rotation).
  readonly settler?: Address
  // Upper bound on the sold amount. Omit for no cap.
  readonly maxSellAmount?: bigint
  // Defaults to ZEROX_ALLOWANCE_HOLDER.
  readonly allowanceHolder?: Address
}

// The complete action set authorizing a 0x AllowanceHolder swap: the sell-token
// approval (spender pinned to AllowanceHolder) and the exec call (token + amount
// + forward-target pinned). Install via `permissions` with `restrictToActions`.
export function zeroExSwapActions(scope: ZeroExSwapScope): Permission[] {
  const allowanceHolder = scope.allowanceHolder ?? ZEROX_ALLOWANCE_HOLDER
  const approve = {
    abi: erc20ApproveAbi as unknown as Abi,
    address: scope.sellToken,
    functions: {
      approve: {
        params: {
          spender: { condition: 'equal', value: allowanceHolder },
          ...(scope.maxSellAmount !== undefined
            ? {
                amount: {
                  condition: 'lessThan',
                  value: scope.maxSellAmount + 1n,
                },
              }
            : {}),
        },
      },
    },
  } as Permission
  const swap = {
    abi: allowanceHolderExecAbi as unknown as Abi,
    address: allowanceHolder,
    functions: {
      exec: {
        params: {
          token: { condition: 'equal', value: scope.sellToken },
          ...(scope.maxSellAmount !== undefined
            ? {
                amount: {
                  condition: 'lessThan',
                  value: scope.maxSellAmount + 1n,
                },
              }
            : {}),
          ...(scope.settler
            ? { target: { condition: 'equal', value: scope.settler } }
            : {}),
        },
      },
    },
  } as Permission
  return [approve, swap]
}

// --- Multi-aggregator scoping (scope BOTH 0x and fynd in one session) ---------

export interface AggregatorSwap {
  // The swap entrypoint the account calls, and the one selector allowed on it.
  readonly swapTarget: Address
  readonly swapSelector: Hex
  // The approve spender for this aggregator's token pull. 0x pulls via the
  // AllowanceHolder; fynd's TychoRouter pulls via an allowance to itself. Defaults
  // to swapTarget.
  readonly approveSpender?: Address
  // Optional arg pins on the swap calldata (raw calldata offsets). Omit to bind
  // the swap by target+selector only (any calldata to that function allowed).
  readonly swapRules?: UniversalActionPolicyParamRule[]
}

export interface SwapSessionScope {
  readonly sellToken: Address
  readonly maxSellAmount?: bigint
  readonly aggregators: [AggregatorSwap, ...AggregatorSwap[]]
}

export interface SwapSessionActions {
  // The single merged approve (spender allowlist across all aggregators + cap).
  readonly permissions: Permission[]
  // One scoped swap action per aggregator.
  readonly actions: ScopedAction[]
}

// 0x AllowanceHolder as an aggregator, pinning exec's sell-side words
// (token@32, amount@64, target@96 = the Settler forward target).
export function zeroExAggregator(scope: {
  sellToken: Address
  settler?: Address
  maxSellAmount?: bigint
  allowanceHolder?: Address
}): AggregatorSwap {
  const allowanceHolder = scope.allowanceHolder ?? ZEROX_ALLOWANCE_HOLDER
  const swapRules: UniversalActionPolicyParamRule[] = [
    {
      condition: 'equal',
      calldataOffset: 32n,
      referenceValue: scope.sellToken,
    },
  ]
  if (scope.maxSellAmount !== undefined) {
    swapRules.push({
      condition: 'lessThan',
      calldataOffset: 64n,
      referenceValue: scope.maxSellAmount + 1n,
    })
  }
  if (scope.settler) {
    swapRules.push({
      condition: 'equal',
      calldataOffset: 96n,
      referenceValue: scope.settler,
    })
  }
  return {
    swapTarget: allowanceHolder,
    swapSelector: ALLOWANCE_HOLDER_EXEC_SELECTOR,
    approveSpender: allowanceHolder,
    swapRules,
  }
}

// fynd (Tycho router) as an aggregator. Its swap calldata comes from the router
// finder and isn't ABI-nameable here, so it is bound by target+selector — the
// selector is the first 4 bytes of a live fynd swap tx. The router pulls the sell
// token via an allowance to itself, so approveSpender defaults to the router.
export function fyndAggregator(scope: {
  router: Address
  swapSelector: Hex
}): AggregatorSwap {
  return { swapTarget: scope.router, swapSelector: scope.swapSelector }
}

// Builds one merged approve (sell token, spender ∈ every aggregator's spender,
// amount ≤ cap) plus one scoped swap action per aggregator. Install the approve
// via `permissions` and the swaps via `actions`, with `restrictToActions: true`,
// so the session key can ONLY approve the sell token to a listed aggregator and
// call that aggregator's swap — nothing else (RHI-6286).
export function swapSessionActions(
  scope: SwapSessionScope,
): SwapSessionActions {
  const spenders = [
    ...new Set(
      scope.aggregators.map((a) =>
        (a.approveSpender ?? a.swapTarget).toLowerCase(),
      ),
    ),
  ].map((s) => s as Address)
  const approve = {
    abi: erc20ApproveAbi as unknown as Abi,
    address: scope.sellToken,
    functions: {
      approve: {
        params: {
          spender:
            spenders.length === 1
              ? { condition: 'equal', value: spenders[0] }
              : { anyOf: spenders },
          ...(scope.maxSellAmount !== undefined
            ? {
                amount: {
                  condition: 'lessThan',
                  value: scope.maxSellAmount + 1n,
                },
              }
            : {}),
        },
      },
    },
  } as Permission
  const actions: ScopedAction[] = scope.aggregators.map((a) => {
    const policies: SessionPolicy[] = a.swapRules?.length
      ? [
          {
            type: 'universal-action',
            rules: a.swapRules as [
              UniversalActionPolicyParamRule,
              ...UniversalActionPolicyParamRule[],
            ],
          },
        ]
      : [{ type: 'sudo' }]
    return { target: a.swapTarget, selector: a.swapSelector, policies }
  })
  return { permissions: [approve], actions }
}
