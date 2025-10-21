import type { Address } from 'viem'
import type { IntentOp } from '../orchestrator'
import type { Execution } from '../orchestrator/types'

function getTypedData(
  account: Address,
  intentExecutorAddress: Address,
  intentOp: IntentOp,
) {
  const element = intentOp.elements[0]
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
      nonce: intentOp.nonce,
      ops,
    },
  }
}
export { getTypedData }
