import type { Address } from 'viem'
import type { Execution, IntentOpElement } from '../orchestrator/types'

function getTypedData(
  account: Address,
  intentExecutorAddress: Address,
  element: IntentOpElement,
  nonce: bigint,
) {
  const ops: Execution[] = element.mandate.destinationOps

  return {
    domain: {
      name: 'IntentExecutor',
      version: 'v0.0.1',
      chainId: Number(element.mandate.destinationChainId),
      verifyingContract: intentExecutorAddress,
    },
    types: {
      SingleChainOps: [
        { name: 'account', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'ops', type: 'Op[]' },
      ],
      Op: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
    },
    primaryType: 'SingleChainOps' as const,
    message: {
      account,
      nonce,
      ops,
    },
  }
}
export { getTypedData }
