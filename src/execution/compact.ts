import { hashTypedData, Hex, keccak256, slice, toHex } from 'viem'
import type { IntentOp } from '../orchestrator/types'

const COMPACT_ADDRESS = '0x73d2dc0c21fca4ec1601895d50df7f5624f07d3f'

// Define the typed data structure as const to preserve type safety
const COMPACT_TYPED_DATA_TYPES = {
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
} as const

function getCompactTypedData(intentOp: IntentOp) {
  const typedData = {
    domain: {
      name: 'The Compact',
      version: '1',
      chainId: BigInt(intentOp.elements[0].chainId),
      verifyingContract: '0x73d2dc0c21fca4ec1601895d50df7f5624f07d3f',
    },
    types: COMPACT_TYPED_DATA_TYPES,
    primaryType: 'MultichainCompact',
    message: {
      sponsor: intentOp.sponsor,
      nonce: BigInt(intentOp.nonce),
      expires: BigInt(intentOp.expires),
      elements: intentOp.elements.map((element) => ({
        arbiter: element.arbiter,
        chainId: BigInt(element.chainId),
        commitments: element.idsAndAmounts.map((token) => ({
          lockTag: slice(toHex(BigInt(token[0])), 0, 12),
          token: slice(toHex(BigInt(token[0])), 12, 32),
          amount: BigInt(token[1]),
        })),
        mandate: {
          target: {
            recipient: element.mandate.recipient,
            tokenOut: element.mandate.tokenOut.map((token) => ({
              token: slice(toHex(BigInt(token[0])), 12, 32),
              amount: BigInt(token[1]),
            })),
            targetChain: BigInt(element.mandate.destinationChainId),
            fillExpiry: BigInt(element.mandate.fillDeadline),
          },
          originOps: element.mandate.preClaimOps.map((op) => ({
            to: op.to,
            value: BigInt(op.value),
            data: op.data,
          })),
          destOps: element.mandate.destinationOps.map((op) => ({
            to: op.to,
            value: BigInt(op.value),
            data: op.data,
          })),
          q: keccak256(element.mandate.qualifier.encodedVal),
        },
      })),
    },
  } as const

  return typedData
}

/**
 * Get the compact digest for signing
 * @param intentOp The intent operation
 * @returns The digest hash
 */
function getCompactDigest(intentOp: IntentOp): Hex {
  const typedData = getCompactTypedData(intentOp)
  return hashTypedData(typedData)
}

export { COMPACT_ADDRESS, getCompactTypedData, getCompactDigest }
