import { hashTypedData, zeroHash } from 'viem'
import { expect, test } from 'vitest'
import type { IntentOp, IntentOpElement } from '../orchestrator/types'
import {
  getCompactDigest,
  getCompactTypedData,
  getPermit2Digest,
} from './compact'
import { getTypedData as permit2TypedData } from './permit2'
import { getTypedData as singleChainTypedData } from './singleChainOps'

const account = '0x0000000000000000000000000000000000000001'
const executor = '0x0000000000000000000000000000000000000002'
const ops = {
  vt: zeroHash,
  ops: [{ to: executor, value: 5n, data: '0x1234' as const }],
}
const gasRefund = { token: account, exchangeRate: 1n, overhead: 2n }
const tokenId = BigInt(
  '0x3000000000000000000000000000000000000000000000000000000000000001',
).toString()
const outputId = BigInt(
  '0x3000000000000000000000000000000000000000000000000000000000000002',
).toString()
const element: IntentOpElement = {
  chainId: '1',
  arbiter: executor,
  idsAndAmounts: [[tokenId, '42']],
  spendTokens: [[account, '42']],
  beforeFill: true,
  mandate: {
    destinationChainId: '10',
    destinationOps: ops,
    preClaimOps: { vt: zeroHash, ops: [] },
    recipient: account,
    tokenOut: [[outputId, '7']],
    fillDeadline: '100',
    minGas: '3',
    qualifier: {
      encodedVal: '0x1234',
      settlementContext: {
        settlementLayer: 'SAME_CHAIN',
        fundingMethod: 'COMPACT',
        using7579: false,
        gasRefund,
      },
    },
  },
}
const intent: IntentOp = {
  sponsor: account,
  nonce: '9',
  targetExecutionNonce: '10',
  expires: '100',
  elements: [element],
  serverSignature: '0x',
  signedMetadata: {
    fees: {},
    quotes: {},
    tokenPrices: {},
    opGasParams: { estimatedCalldataSize: 0 },
    gasPrices: {},
    account: {
      address: account,
      accountType: 'EOA',
      setupOps: [],
      accountContext: {},
    },
  },
}

test('legacy single-chain typed data retains its signing payload', () => {
  const single = singleChainTypedData(account, executor, element, 9n)
  expect(single.domain).toEqual({
    name: 'IntentExecutor',
    version: 'v0.0.1',
    chainId: 10,
    verifyingContract: executor,
  })
  expect(single.primaryType).toBe('SingleChainOps')
  expect(single.message).toEqual({ account, nonce: 9n, op: ops, gasRefund })
  expect(hashTypedData(single)).toBe(
    '0x6b24a50e66ce9755f007ad56fa0c9e8ec58b6fd1dad7245401fed6b76192ce38',
  )
})

test('legacy Permit2 typed data and digest retain their signing payload', () => {
  const permit = permit2TypedData(element, 9n, 100n)
  expect(permit.domain).toEqual({
    name: 'Permit2',
    chainId: 1,
    verifyingContract: '0x000000000022D473030F116dDEE9F6B43aC78BA3',
  })
  expect(permit.primaryType).toBe('PermitBatchWitnessTransferFrom')
  expect(permit.message).toMatchObject({
    permitted: [{ token: account, amount: 42n }],
    spender: executor,
    nonce: 9n,
    deadline: 100n,
    mandate: {
      target: {
        recipient: account,
        tokenOut: [{ token: executor, amount: 7n }],
        targetChain: 10n,
        fillExpiry: 100n,
      },
      minGas: 3n,
      originOps: element.mandate.preClaimOps,
      destOps: ops,
    },
  })
  expect(hashTypedData(permit)).toBe(
    '0x6f261d7f2a79a08b02cf9706de5f89292892a336f2214831ea13093baf14e1de',
  )
  expect(getPermit2Digest(element, 9n, 100n)).toBe(
    '0x6f261d7f2a79a08b02cf9706de5f89292892a336f2214831ea13093baf14e1de',
  )
})

test('legacy Compact typed data and digest retain their signing payload', () => {
  const compact = getCompactTypedData(intent)
  expect(compact.domain).toEqual({
    name: 'The Compact',
    version: '1',
    chainId: 1,
    verifyingContract: '0x73d2dc0c21fca4ec1601895d50df7f5624f07d3f',
  })
  expect(compact.primaryType).toBe('MultichainCompact')
  expect(compact.message).toMatchObject({
    sponsor: account,
    nonce: 9n,
    expires: 100n,
    elements: [
      {
        arbiter: executor,
        chainId: 1n,
        commitments: [
          {
            lockTag: '0x300000000000000000000000',
            token: account,
            amount: 42n,
          },
        ],
      },
    ],
  })
  expect(hashTypedData(compact)).toBe(
    '0xfd2845d6fc3d613e958a4958c62ed454e61e315e861196aeb36b749ef153bfed',
  )
  expect(getCompactDigest(intent)).toBe(
    '0xfd2845d6fc3d613e958a4958c62ed454e61e315e861196aeb36b749ef153bfed',
  )
})
