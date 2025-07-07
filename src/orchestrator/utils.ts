import {
  type Address,
  type Hex,
  hashTypedData,
  keccak256,
  slice,
  toHex,
  zeroAddress,
} from 'viem'

import type { IntentOp, SettlementSystem } from './types'

function getClaimProofer(settlementSystem: SettlementSystem): Address {
  switch (settlementSystem) {
    case 'ACROSS':
      return '0x1990c54b361C42e23E90d60Eb84071b50b04bE4a'
    case 'SAME_CHAIN':
      return zeroAddress
  }
}

function getIntentOpHash(intentOp: IntentOp) {
  const notarizedChainElement = intentOp.elements[0]
  const settlementSystem =
    notarizedChainElement.mandate.qualifier.settlementSystem
  const claimProofer = getClaimProofer(settlementSystem)
  return hashTypedData({
    domain: {
      name: 'The Compact',
      version: '1',
      chainId: BigInt(notarizedChainElement.chainId),
      verifyingContract: '0xa2E6C7Ba8613E1534dCB990e7e4962216C0a5d58',
    },
    types: {
      MultichainCompact: [
        { name: 'sponsor', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expires', type: 'uint256' },
        { name: 'elements', type: 'Element[]' },
      ],
      Element: [
        { name: 'arbiter', type: 'address' },
        { name: 'chainId', type: 'uint256' },
        { name: 'commitments', type: 'Lock[]' },
        { name: 'mandate', type: 'Mandate' },
      ],
      Lock: [
        { name: 'lockTag', type: 'bytes12' },
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      Mandate: [
        { name: 'target', type: 'Target' },
        { name: 'originOps', type: 'Op[]' },
        { name: 'destOps', type: 'Op[]' },
        { name: 'q', type: 'bytes32' },
      ],
      Target: [
        { name: 'recipient', type: 'address' },
        { name: 'tokenOut', type: 'Token[]' },
        { name: 'targetChain', type: 'uint256' },
        { name: 'fillExpiry', type: 'uint256' },
        { name: 'claimProofer', type: 'address' },
      ],
      Token: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      Op: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
    },
    primaryType: 'MultichainCompact',
    message: {
      sponsor: intentOp.sponsor,
      nonce: BigInt(intentOp.nonce),
      expires: BigInt(intentOp.expires),
      elements: intentOp.elements.map((element: any) => ({
        arbiter: element.arbiter,
        chainId: BigInt(element.chainId),
        commitments: element.idsAndAmounts.map((token: any) => ({
          lockTag: slice(toHex(BigInt(token[0])), 0, 12),
          token: slice(toHex(BigInt(token[0])), 12, 32),
          amount: BigInt(token[1]),
        })),
        mandate: {
          target: {
            recipient: element.mandate.recipient,
            tokenOut: element.mandate.tokenOut.map((token: any) => ({
              token: slice(toHex(BigInt(token[0])), 12, 32),
              amount: BigInt(token[1]),
            })),
            targetChain: element.mandate.destinationChainId,
            fillExpiry: element.mandate.fillDeadline,
            claimProofer: claimProofer,
          },
          originOps: element.mandate.preClaimOps.map((op: any) => ({
            to: op.to,
            value: op.value,
            data: op.data,
          })),
          destOps: element.mandate.destinationOps.map((op: any) => ({
            to: op.to,
            value: BigInt(op.value),
            data: op.data,
          })),
          q: keccak256(element.mandate.qualifier?.encodedVal ?? '0x'),
        },
      })),
    },
  })
}

function convertBigIntFields(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj
  }

  if (typeof obj === 'bigint') {
    return obj.toString()
  }

  if (Array.isArray(obj)) {
    return obj.map(convertBigIntFields)
  }

  if (typeof obj === 'object') {
    const result: any = {}
    for (const key in obj) {
      if (Object.hasOwn(obj, key)) {
        result[key] = convertBigIntFields(obj[key])
      }
    }
    return result
  }

  return obj
}

export { getIntentOpHash, convertBigIntFields }
