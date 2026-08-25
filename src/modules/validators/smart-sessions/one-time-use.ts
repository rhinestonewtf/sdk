import { type Address, encodeFunctionData, type Hex, pad, toHex } from 'viem'

// OneTimeUseIdPolicy (RHI-5798): a session pins an id it invents, and each
// settlement burns that id through an injected pre-claim execution, so a session
// settles at most once per chain regardless of route. This module produces the
// two SDK-side artifacts: the session's erc1271 policy entry, and the burn op the
// caller places in the intent's `preClaimExecutions`.
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
    throw new Error('OneTimeUseId id must be a non-zero uint256')
  }
}

// Encodes the pinned id as the policy's initData (a bytes32).
export function encodeOneTimeUseIdInitData(id: bigint): Hex {
  assertValidOneTimeUseId(id)
  return pad(toHex(id), { size: 32 })
}

// The erc1271 policy entry to add to a session's erc7739Policies.erc1271Policies.
export function oneTimeUseIdErc1271Policy(params: {
  policy: Address
  id: bigint
}): { readonly policy: Address; readonly initData: Hex } {
  return {
    policy: params.policy,
    initData: encodeOneTimeUseIdInitData(params.id),
  }
}

// The burn op to inject into the intent's `preClaimExecutions`.
//   - executor route: `consume(id)` — no witness.
//   - permit2 route:  `consumeFor(id, 0)` — a PLACEHOLDER witness. The witness
//     must equal the settlement's Permit2 order nonce, which only the orchestrator
//     knows, so it stamps the real nonce into this op before the mandate is signed.
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
