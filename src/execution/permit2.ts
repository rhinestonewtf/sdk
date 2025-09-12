import { type Address, keccak256 } from 'viem'
import type { IntentOp } from '../orchestrator/types'

interface TokenPermissions {
  token: Address
  amount: bigint
}

const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3'

function asSanitizedAddress(accountValue: bigint): string {
  return `0x${(accountValue & ((1n << 160n) - 1n)).toString(16).padStart(40, '0')}`
}

function toToken(id: bigint): Address {
  return asSanitizedAddress(id) as Address
}

function getTypedData(intentOp: IntentOp) {
  const element = intentOp.elements[0]
  const tokens = element.idsAndAmounts.map(([id, amount]) => [
    BigInt(id),
    BigInt(amount),
  ])
  const tokenPermissions = tokens.reduce<TokenPermissions[]>(
    (permissions, [id, amountIn]) => {
      const token = toToken(BigInt(id))
      const amount = BigInt(amountIn)
      const permission: TokenPermissions = { token, amount }
      permissions.push(permission)
      return permissions
    },
    [],
  )
  const spender = element.arbiter
  const mandate = element.mandate
  const typedData = {
    domain: {
      name: 'Permit2',
      chainId: Number(intentOp.elements[0].chainId),
      verifyingContract: PERMIT2_ADDRESS,
    },
    types: {
      TokenPermissions: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      Token: [
        { name: 'token', type: 'address' },
        { name: 'amount', type: 'uint256' },
      ],
      Target: [
        { name: 'recipient', type: 'address' },
        { name: 'tokenOut', type: 'Token[]' },
        { name: 'targetChain', type: 'uint256' },
        { name: 'fillExpiry', type: 'uint256' },
      ],
      Op: [
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'data', type: 'bytes' },
      ],
      Mandate: [
        { name: 'target', type: 'Target' },
        { name: 'originOps', type: 'Op[]' },
        { name: 'destOps', type: 'Op[]' },
        { name: 'q', type: 'bytes32' },
      ],
      PermitBatchWitnessTransferFrom: [
        { name: 'permitted', type: 'TokenPermissions[]' },
        { name: 'spender', type: 'address' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
        { name: 'mandate', type: 'Mandate' },
      ],
    },
    primaryType: 'PermitBatchWitnessTransferFrom',
    message: {
      permitted: tokenPermissions,
      spender: spender,
      nonce: BigInt(intentOp.nonce),
      deadline: BigInt(intentOp.expires),
      mandate: {
        target: {
          recipient: mandate.recipient,
          tokenOut: mandate.tokenOut.map((token) => ({
            token: toToken(BigInt(token[0])),
            amount: BigInt(token[1]),
          })),
          targetChain: BigInt(mandate.destinationChainId),
          fillExpiry: BigInt(mandate.fillDeadline),
        },
        originOps: mandate.preClaimOps.map((op) => ({
          to: op.to,
          value: BigInt(op.value),
          data: op.data,
        })),
        destOps: mandate.destinationOps.map((op) => ({
          to: op.to,
          value: BigInt(op.value),
          data: op.data,
        })),
        q: keccak256(mandate.qualifier.encodedVal),
      },
    },
  } as const

  return typedData
}

export { getTypedData }
