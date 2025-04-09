import {
  Address,
  domainSeparator,
  encodeAbiParameters,
  encodePacked,
  Hex,
  keccak256,
  TypedDataDomain,
} from 'viem'

import {
  BundleEvent,
  Execution,
  MultiChainCompact,
  Segment,
  TokenArrays6909,
  Witness,
} from './types'
import { HOOK_ADDRESS } from '../modules'

const MULTICHAIN_COMPACT_TYPEHASH =
  '0xee54591377b86e048be6b2fbd8913598a6270aed3415776321279495bf4efae5'
const SEGMENT_TYPEHASH =
  '0x54ada5b33a7390e2883c985295cfa2dcd9bb46515ad10cbdfc22a7c73f9807db'
const WITNESS_TYPEHASH =
  '0x78e29a727cef567e7d6dddf5bf7eedf0c84af60d4a57512c586c787aae731629'
const EXECUTION_TYPEHASH =
  '0xa222cbaaad3b88446c3ca031429dafb24afdbda10c5dbd9882c294762857141a'

export function getOrderBundleHash(orderBundle: MultiChainCompact): Hex {
  const notarizedChainId = Number(orderBundle.segments[0].chainId)
  return hashMultiChainCompactWithDomainSeparator(
    orderBundle,
    getCompactDomainSeparator(notarizedChainId, HOOK_ADDRESS),
  )
}

export function convertBigIntFields(obj: any): any {
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
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        result[key] = convertBigIntFields(obj[key])
      }
    }
    return result
  }

  return obj
}

export function parseCompactResponse(response: any): MultiChainCompact {
  return {
    sponsor: response.sponsor as Address,
    nonce: BigInt(response.nonce),
    expires: BigInt(response.expires),
    segments: response.segments.map((segment: any) => {
      return {
        arbiter: segment.arbiter as Address,
        chainId: BigInt(segment.chainId),
        idsAndAmounts: segment.idsAndAmounts.map((idsAndAmount: any) => {
          return [BigInt(idsAndAmount[0]), BigInt(idsAndAmount[1])]
        }),
        witness: {
          recipient: segment.witness.recipient as Address,
          tokenOut: segment.witness.tokenOut.map((tokenOut: any) => {
            return [BigInt(tokenOut[0]), BigInt(tokenOut[1])]
          }),
          depositId: BigInt(segment.witness.depositId),
          targetChain: BigInt(segment.witness.targetChain),
          fillDeadline: segment.witness.fillDeadline,
          execs: segment.witness.execs.map((exec: any) => {
            return {
              to: exec.to as Address,
              value: BigInt(exec.value),
              data: exec.data as Hex,
            } as Execution
          }),
          userOpHash: segment.witness.userOpHash as Hex,
          maxFeeBps: segment.witness.maxFeeBps,
        },
      } as Segment
    }),
  } as MultiChainCompact
}

export function parsePendingBundleEvent(response: any): BundleEvent {
  return {
    type: response.type,
    bundleId: BigInt(response.bundleId),
    targetFillPayload: {
      to: response.targetFillPayload.to as Address,
      data: response.targetFillPayload.data as Hex,
      value: BigInt(response.targetFillPayload.value),
      chainId: response.targetFillPayload.chainId,
    },
    acrossDepositEvents: response.acrossDepositEvents.map((event: any) => {
      return {
        message: event.message,
        depositId: BigInt(event.depositId),
        depositor: event.depositor as Address,
        recipient: event.recipient as Address,
        inputToken: event.inputToken as Address,
        inputAmount: BigInt(event.inputAmount),
        outputToken: event.outputToken as Address,
        fillDeadline: event.fillDeadline,
        outputAmount: BigInt(event.outputAmount),
        quoteTimestamp: event.quoteTimestamp,
        exclusiveRelayer: event.exclusiveRelayer as Address,
        destinationChainId: event.destinationChainId,
        originClaimPayload: {
          to: event.originClaimPayload.to as Address,
          data: event.originClaimPayload.data as Hex,
          value: BigInt(event.originClaimPayload.value),
          chainId: event.originClaimPayload.chainId,
        },
        exclusivityDeadline: event.exclusivityDeadline,
      }
    }),
  }
}

function hashMultiChainCompactWithDomainSeparator(
  multiChainCompact: MultiChainCompact,
  domainSeparator: Hex,
): Hex {
  return keccak256(
    encodePacked(
      ['string', 'bytes32', 'bytes32'],
      [
        '\x19\x01',
        domainSeparator,
        hashMultichainCompactWithoutDomainSeparator(multiChainCompact),
      ],
    ),
  )
}

function hashMultichainCompactWithoutDomainSeparator(
  multiChainCompact: MultiChainCompact,
): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'typehash', type: 'bytes32' },
        { name: 'sponsor', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'expires', type: 'uint256' },
        { name: 'segments', type: 'bytes32' },
      ],
      [
        MULTICHAIN_COMPACT_TYPEHASH,
        multiChainCompact.sponsor,
        multiChainCompact.nonce,
        multiChainCompact.expires,
        hashSegments([...multiChainCompact.segments]),
      ],
    ),
  )
}

function hashSegments(segment: Segment[]): Hex {
  return keccak256(encodePacked(['bytes32[]'], [segment.map(hashSegment)]))
}

function hashSegment(segment: Segment): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'typehash', type: 'bytes32' },
        { name: 'arbiter', type: 'address' },
        { name: 'chainId', type: 'uint256' },
        { name: 'idsAndAmounts', type: 'bytes32' },
        { name: 'witness', type: 'bytes32' },
      ],
      [
        SEGMENT_TYPEHASH,
        segment.arbiter,
        segment.chainId,
        hashIdsAndAmounts(segment.idsAndAmounts),
        hashWitness(segment.witness),
      ],
    ),
  )
}

function hashWitness(witness: Witness): Hex {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'typehash', type: 'bytes32' },
        { name: 'recipient', type: 'address' },
        { name: 'tokenOut', type: 'bytes32' },
        { name: 'depositId', type: 'uint256' },
        { name: 'targetChain', type: 'uint256' },
        { name: 'fillDeadline', type: 'uint32' },
        { name: 'execs', type: 'bytes32' }, // Assuming XchainExec[] is complex
        { name: 'userOpHash', type: 'bytes32' },
        { name: 'maxFeeBps', type: 'uint32' },
      ],
      [
        WITNESS_TYPEHASH,
        witness.recipient,
        hashIdsAndAmounts(witness.tokenOut),
        witness.depositId,
        witness.targetChain,
        witness.fillDeadline,
        hashExecutionArray(witness.execs),
        witness.userOpHash,
        witness.maxFeeBps,
      ],
    ),
  )
}

function getCompactDomainSeparator(
  chainId: number,
  verifyingContract: Address,
) {
  return domainSeparator({
    domain: getCompactDomain(chainId, verifyingContract),
  })
}

function getCompactDomain(
  chainId: number,
  verifyingContract: Address,
): TypedDataDomain {
  return {
    name: 'The Compact',
    version: '0',
    chainId: chainId,
    verifyingContract: verifyingContract,
  }
}

function hashIdsAndAmounts(idsAndAmounts: TokenArrays6909): Hex {
  return keccak256(encodePacked(['uint256[2][]'], [idsAndAmounts]))
}

function hashExecutionArray(executionArray: Execution[]) {
  const hashes = executionArray.map(hashExecution)
  return keccak256(encodePacked(['bytes32[]'], [hashes]))
}

function hashExecution(execution: Execution) {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'typehash', type: 'bytes32' },
        { name: 'target', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'callData', type: 'bytes32' },
      ],
      [
        EXECUTION_TYPEHASH,
        execution.to,
        execution.value,
        keccak256(execution.data),
      ],
    ),
  )
}
