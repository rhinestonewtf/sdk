import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  toFunctionSelector,
} from 'viem'

// OneTimeUseIdPolicy: a session pins an id it invents and each settlement burns
// it through a pre-claim execution, so a session settles at most once per chain.
export const oneTimeUseIdPolicyAbi = [
  {
    type: 'function',
    name: 'consume',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'consumeFor',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'witness', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

// source: smart-sessions-v2 src/policies/onetime/interfaces/IOneTimeUseIdPolicy.sol
export const CONSUME_SELECTOR = toFunctionSelector('function consume(uint256)')
export const CONSUME_FOR_SELECTOR = toFunctionSelector(
  'function consumeFor(uint256,uint256)',
)

// Which burn call a settlement route needs. `permit2` (Across/Eco via the arbiter)
// proves the burn with a witness; `executor` (IntentExecutor) needs none.
export type OneTimeUseSettlementRoute = 'permit2' | 'executor'

export interface OneTimeUseBurnOp {
  readonly to: Address
  readonly value: bigint
  readonly data: Hex
}

// The id must be a non-zero uint256 — the policy rejects zero ("not configured").
function assertValidOneTimeUseId(id: bigint): void {
  if (id <= 0n || id > (1n << 256n) - 1n) {
    throw new Error('oneTimeUse.id must be a non-zero uint256')
  }
}

// The policy's initData: abi.encode(id, deadline). The deadline is in unix
// SECONDS; zero means never expires. Any other layout reverts at session enable.
export function encodeOneTimeUseIdInitData(id: bigint, deadline = 0n): Hex {
  assertValidOneTimeUseId(id)
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [id, deadline],
  )
}

// The erc1271 policy entry to add to a session's erc7739Policies.erc1271Policies.
export function oneTimeUseIdErc1271Policy(params: {
  policy: Address
  id: bigint
  deadline?: bigint
}): { readonly policy: Address; readonly initData: Hex } {
  return {
    policy: params.policy,
    initData: encodeOneTimeUseIdInitData(params.id, params.deadline),
  }
}

// The burn op for the intent's `preClaimExecutions`: `consume(id)` on the executor
// route, or `consumeFor(id, 0)` on Permit2, whose placeholder witness the
// orchestrator replaces with the order nonce before the mandate is signed.
export function buildOneTimeUseBurnOp(params: {
  policy: Address
  id: bigint
  route: OneTimeUseSettlementRoute
}): OneTimeUseBurnOp {
  const { policy, id, route } = params
  // Reject id=0 here too (not just at initData encoding) so a caller can't emit a
  // burn op whose id doesn't match a validly-pinned session.
  assertValidOneTimeUseId(id)
  const data =
    route === 'permit2'
      ? encodeFunctionData({
          abi: oneTimeUseIdPolicyAbi,
          functionName: 'consumeFor',
          args: [id, 0n],
        })
      : encodeFunctionData({
          abi: oneTimeUseIdPolicyAbi,
          functionName: 'consume',
          args: [id],
        })
  return { to: policy, value: 0n, data }
}
