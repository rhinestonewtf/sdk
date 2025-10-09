import type { Address, Hex } from 'viem'
import type { IntentOp } from '../orchestrator'

interface Op {
  to: Address
  value: string
  data: Hex
}

interface ChainOps {
  chainId: bigint
  nonce: bigint
  ops: Op[]
}

function getTypedData(
  account: Address,
  intentExecutorAddress: Address,
  intentOp: IntentOp,
) {
  const ops = intentOp.elements[0].mandate.destinationOps
  const chainOps: ChainOps = {
    chainId: BigInt(intentOp.elements[0].chainId),
    nonce: BigInt(intentOp.nonce),
    ops,
  }

  return {
    domain: {
      name: 'IntentExecutor',
      version: 'v0.0.1',
      verifyingContract: intentExecutorAddress,
    },
    types: {
      MultiChainOps: [
        { name: 'account', type: 'address' },
        { name: 'ops', type: 'ChainOps[]' },
      ],
      ChainOps: [
        { name: 'chainId', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'ops', type: 'Op[]' },
      ],
      Op: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
    },
    primaryType: 'MultiChainOps' as const,
    message: {
      account,
      ops: [chainOps],
    },
  }
}
export { getTypedData }
