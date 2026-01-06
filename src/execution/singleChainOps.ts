import { type Address, zeroAddress } from 'viem'
import type { IntentOpElement } from '../orchestrator/types'

function getTypedData(
  account: Address,
  intentExecutorAddress: Address,
  element: IntentOpElement,
  nonce: bigint,
) {
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
      op: element.mandate.destinationOps,
      // todo
      gasRefund: {
        token: zeroAddress,
        exchangeRate: 0n,
      },
    },
  }
}
export { getTypedData }
