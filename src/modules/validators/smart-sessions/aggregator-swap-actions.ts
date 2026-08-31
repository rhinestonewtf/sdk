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
// exec's static words are pinnable: operator(0), token(1), amount(2), target(3).
// operator and target are both pinned to the Settler so the pulled sell token
// can only be consumed by 0x's swap. For 0x specifically the BUY token/route live
// inside the opaque `data` (the Settler calldata), so 0x binds the sell side only.
//
// The buy token (and recipient) ARE bindable for aggregators that expose them at
// a fixed calldata offset — e.g. kyberswap encodes the output token as an ABI word
// — via `AggregatorSwap.swapRules` (the same offset rule used for the OFT/CCTP
// pins). It is only 0x's nested exec.data that can't be pinned.

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
  // The 0x Settler the AllowanceHolder forwards to. Pinned on BOTH exec.operator
  // and exec.target. Required: leaving them unpinned lets a session key set
  // operator/target to its own contract and pull the approved sell token (up to
  // the cap) instead of swapping through 0x. 0x rotates Settler versions, so this
  // binds the session to the current one — re-issue the session on a rotation.
  readonly settler: Address
  // Cumulative cap on TOTAL sell-token spend across the session (a spending-limit
  // on the approve sums approved amounts). Omit for no cap.
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
        // Cumulative cap: the spending-limit policy sums approved amounts across
        // the session, so maxSellAmount bounds TOTAL sell-token spend, not just a
        // single swap (which repeated swaps could otherwise drain past).
        ...(scope.maxSellAmount !== undefined
          ? {
              spendingLimit: {
                token: scope.sellToken,
                amount: scope.maxSellAmount,
              },
            }
          : {}),
        params: {
          spender: { condition: 'equal', value: allowanceHolder },
        },
      },
    },
  } as Permission
  const swap = {
    abi: allowanceHolderExecAbi as unknown as Abi,
    address: allowanceHolder,
    functions: {
      exec: {
        // exec is payable — cap native value so the session can't route value
        // through the router (the sell-token cap only bounds the ERC-20 pull).
        valueLimit: 0n,
        params: {
          // Pin both the permit consumer (operator) and the call target to the
          // Settler so the pulled sell token can only be spent by 0x's swap.
          operator: { condition: 'equal', value: scope.settler },
          token: { condition: 'equal', value: scope.sellToken },
          ...(scope.maxSellAmount !== undefined
            ? {
                amount: {
                  condition: 'lessThan',
                  value: scope.maxSellAmount + 1n,
                },
              }
            : {}),
          target: { condition: 'equal', value: scope.settler },
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
  // the swap by target+selector only. Use this to pin the BUY token and/or
  // recipient where the aggregator exposes them at a fixed offset (e.g. kyberswap
  // encodes the output token as an ABI word), binding "receive token Y", not just
  // "spend token X". The offset is aggregator- and route-shape-specific — derive
  // it from a sample of that aggregator's calldata for the pair.
  readonly swapRules?: UniversalActionPolicyParamRule[]
  // Max native value the swap may carry. Defaults to 0 — the approve cap only
  // bounds ERC-20 pulls, so without this a payable swap selector could still send
  // arbitrary native value through the router. Raise it only for native-in swaps.
  readonly maxValue?: bigint
}

export interface SwapSessionScope {
  readonly sellToken: Address
  // Cumulative cap on TOTAL sell-token spend across the session (spending-limit
  // on the merged approve). Omit for no cap.
  readonly maxSellAmount?: bigint
  readonly aggregators: [AggregatorSwap, ...AggregatorSwap[]]
}

export interface SwapSessionActions {
  // The single merged approve (spender allowlist across all aggregators + cap).
  readonly permissions: Permission[]
  // One scoped swap action per aggregator.
  readonly actions: ScopedAction[]
}

// 0x AllowanceHolder as an aggregator. exec(operator, token, amount, target, data)
// — pins operator@0 and target@96 to the Settler (so the pulled sell token can
// only be spent by 0x's swap, not redirected), token@32, and amount@64.
export function zeroExAggregator(scope: {
  sellToken: Address
  // Required — see ZeroExSwapScope.settler for why leaving it unpinned is unsafe.
  settler: Address
  maxSellAmount?: bigint
  allowanceHolder?: Address
}): AggregatorSwap {
  const allowanceHolder = scope.allowanceHolder ?? ZEROX_ALLOWANCE_HOLDER
  const swapRules: UniversalActionPolicyParamRule[] = [
    { condition: 'equal', calldataOffset: 0n, referenceValue: scope.settler }, // operator
    {
      condition: 'equal',
      calldataOffset: 32n,
      referenceValue: scope.sellToken,
    },
    { condition: 'equal', calldataOffset: 96n, referenceValue: scope.settler }, // target
  ]
  if (scope.maxSellAmount !== undefined) {
    swapRules.push({
      condition: 'lessThan',
      calldataOffset: 64n,
      referenceValue: scope.maxSellAmount + 1n,
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
        // Cumulative session cap across all aggregators (see zeroExSwapActions).
        ...(scope.maxSellAmount !== undefined
          ? {
              spendingLimit: {
                token: scope.sellToken,
                amount: scope.maxSellAmount,
              },
            }
          : {}),
        params: {
          spender:
            spenders.length === 1
              ? { condition: 'equal', value: spenders[0] }
              : { anyOf: spenders },
        },
      },
    },
  } as Permission
  const actions: ScopedAction[] = scope.aggregators.map((a) => {
    const maxValue = a.maxValue ?? 0n
    const policies: SessionPolicy[] = a.swapRules?.length
      ? [
          {
            type: 'universal-action',
            valueLimitPerUse: maxValue,
            rules: a.swapRules as [
              UniversalActionPolicyParamRule,
              ...UniversalActionPolicyParamRule[],
            ],
          },
        ]
      : // No arg pins: bind (target, selector) and cap native value (a plain sudo
        // would let the swap carry arbitrary value through the router).
        [{ type: 'value-limit', limit: maxValue }]
    return { target: a.swapTarget, selector: a.swapSelector, policies }
  })
  return { permissions: [approve], actions }
}
