import type { Address } from 'viem'
import type { IntentOpElement } from '../orchestrator/types'

function getTypedData(
  account: Address,
  intentExecutorAddress: Address,
  element: IntentOpElement,
  nonce: bigint,
) {
  const { destinationChainId, destinationOps } = element.mandate
  const gasRefund = element.mandate.qualifier.settlementContext.gasRefund

  return {
    domain: {
      name: 'IntentExecutor',
      version: 'v0.0.1',
      chainId: Number(destinationChainId),
      verifyingContract: intentExecutorAddress,
    },
    types: {
      SingleChainOps: [
        { name: 'account', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'op', type: 'Op' },
        { name: 'gasRefund', type: 'GasRefund' },
      ],
      Op: [
        { name: 'vt', type: 'bytes32' },
        { name: 'ops', type: 'Ops[]' },
      ],
      GasRefund: [
        { name: 'token', type: 'address' },
        { name: 'exchangeRate', type: 'uint256' },
        { name: 'overhead', type: 'uint256' },
      ],
      Ops: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
    },
    primaryType: 'SingleChainOps' as const,
    message: {
      account,
      nonce,
      op: destinationOps,
      gasRefund,
    },
  }
}

export { getTypedData }
