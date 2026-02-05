import { type Address, zeroAddress } from 'viem'
import type { IntentOpElement, Op } from '../orchestrator/types'

interface GasRefund {
  token: Address
  exchangeRate: bigint
  overhead: bigint
}

// TODO: Remove after migration
function getTypedDataLegacy(
  account: Address,
  intentExecutorAddress: Address,
  destinationChainId: string,
  destinationOps: Op,
  nonce: bigint,
) {
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
      gasRefund: {
        token: zeroAddress,
        exchangeRate: 0n,
      },
    },
  }
}

function getTypedDataWithGasRefund(
  account: Address,
  intentExecutorAddress: Address,
  destinationChainId: string,
  destinationOps: Op,
  nonce: bigint,
  gasRefund: GasRefund,
) {
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

function getTypedData(
  account: Address,
  intentExecutorAddress: Address,
  element: IntentOpElement,
  nonce: bigint,
) {
  const { destinationChainId, destinationOps } = element.mandate
  const gasRefund = element.mandate.qualifier.settlementContext.gasRefund

  if (gasRefund) {
    return getTypedDataWithGasRefund(
      account,
      intentExecutorAddress,
      destinationChainId,
      destinationOps,
      nonce,
      gasRefund,
    )
  }

  return getTypedDataLegacy(
    account,
    intentExecutorAddress,
    destinationChainId,
    destinationOps,
    nonce,
  )
}

export { getTypedData }
