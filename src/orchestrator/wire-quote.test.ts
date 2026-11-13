import type { Hex } from 'viem'
import { describe, expect, test } from 'vitest'
import type { IntentInput } from './types'
import { blancQuoteRequest, blancSubmitRequest } from './wire-quote'

const ACCOUNT = '0x36C03e7D593F7B2C6b06fC18B5f4E9a4A29C99b0'
const USDC_BASE = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const WETH_BASE = '0x4200000000000000000000000000000000000006'

function intentInput(overrides: Partial<IntentInput> = {}): IntentInput {
  return {
    account: { address: ACCOUNT, accountType: 'ERC7579', setupOps: [] },
    destinationChainId: 421614,
    destinationExecutions: [],
    tokenRequests: [{ tokenAddress: USDC_BASE, amount: 1n }],
    options: { topupCompact: false },
    ...overrides,
  }
}

describe('Blanc request adaptation', () => {
  test('nested chain ids become CAIP-2 and gas units become a decimal gas limit', () => {
    const body = blancQuoteRequest(
      intentInput({
        destinationGasUnits: 500_000n,
        accountAccessList: { chainIds: [84532] },
        preClaimExecutions: { 84532: [{ to: ACCOUNT, value: 0n, data: '0x' }] },
        options: {
          topupCompact: false,
          auxiliaryFunds: { 84532: { [USDC_BASE]: 5n } },
        },
      }),
    )
    expect(body).toMatchObject({
      destinationChainId: 'eip155:421614',
      destinationGasLimit: '500000',
      accountAccessList: { chainIds: ['eip155:84532'] },
      preClaimExecutions: {
        'eip155:84532': [{ to: ACCOUNT, value: '0', data: '0x' }],
      },
      options: { auxiliaryFunds: { 'eip155:84532': { [USDC_BASE]: '5' } } },
    })
    expect(body).not.toHaveProperty('destinationGasUnits')
  })

  test('folds exact inputs into per-chain tokens and amounts without duplicating tokens', () => {
    expect(
      blancQuoteRequest(
        intentInput({
          accountAccessList: [
            { chainId: 84532, tokenAddress: USDC_BASE, amount: 7n },
            { chainId: 84532, tokenAddress: WETH_BASE },
            { chainId: 84532, tokenAddress: USDC_BASE, amount: 9n },
            { chainId: 11155420, tokenAddress: WETH_BASE },
          ],
        }),
      ).accountAccessList,
    ).toEqual({
      chainTokens: {
        'eip155:84532': [USDC_BASE, WETH_BASE],
        'eip155:11155420': [WETH_BASE],
      },
      chainTokenAmounts: { 'eip155:84532': { [USDC_BASE]: '9' } },
    })
  })

  test('the target-chain mock signature becomes the cross-chain fallback without overwriting an explicit fallback', () => {
    const body = blancQuoteRequest(
      intentInput({
        account: {
          address: ACCOUNT,
          accountType: 'ERC7579',
          setupOps: [],
          mockSignature: '0xaa',
          mockSignatures: { '84532': '0xbb' },
        },
        recipient: {
          address: ACCOUNT,
          accountType: 'ERC7579',
          setupOps: [],
          mockSignature: '0xcc',
          mockSignatures: { '0': '0xdd' },
        },
      }),
    )
    expect(body.account).toEqual({
      address: ACCOUNT,
      accountType: 'ERC7579',
      setupOps: [],
      mockSignatures: { '0': '0xaa', '84532': '0xbb' },
    })
    expect(body.recipient).toEqual({
      address: ACCOUNT,
      accountType: 'ERC7579',
      setupOps: [],
      mockSignatures: { '0': '0xdd' },
    })
  })
})

describe('Blanc submit adaptation', () => {
  const r = `0x${'11'.repeat(32)}` as Hex
  const s = `0x${'22'.repeat(32)}` as Hex
  const base = {
    quote: { intentId: '123' },
    originSignatures: [
      '0x01',
      { preClaimSig: '0x02', notarizedClaimSig: '0x03' },
    ] as const,
    destinationSignature: '0x04' as Hex,
    authorizations: [],
    dryRun: false,
  }

  test('sends signatures by role', () => {
    expect(
      blancSubmitRequest({
        ...base,
        originSignatures: [...base.originSignatures],
        targetExecutionSignature: '0x05',
        permitSignatures: { 84532: { [USDC_BASE]: '0x06' } },
      }),
    ).toEqual({
      intentId: '123',
      signatures: {
        origin: ['0x01', { preClaimSig: '0x02', notarizedClaimSig: '0x03' }],
        destination: '0x04',
        targetExecution: '0x05',
        permits: { 84532: { [USDC_BASE]: '0x06' } },
      },
    })
  })

  test('authorizations use CAIP-2 except the EIP-7702 wildcard, and dry runs set the root option', () => {
    const body = blancSubmitRequest({
      ...base,
      originSignatures: [...base.originSignatures],
      authorizations: [
        { chainId: 84532, address: ACCOUNT, nonce: 3, yParity: 1, r, s },
        { chainId: 0, address: ACCOUNT, nonce: 0, r, s },
      ],
      dryRun: true,
    })
    expect(body.authorizations).toEqual({
      sponsor: [
        {
          chainId: 'eip155:84532',
          address: ACCOUNT,
          nonce: 3,
          yParity: 1,
          r,
          s,
        },
        { chainId: 0, address: ACCOUNT, nonce: 0, yParity: 0, r, s },
      ],
    })
    expect(body.options).toEqual({ dryRun: true })
  })

  test('refuses an invalid authorization chain', () => {
    expect(() =>
      blancSubmitRequest({
        ...base,
        originSignatures: [...base.originSignatures],
        authorizations: [{ chainId: -1, address: ACCOUNT, nonce: 0, r, s }],
      }),
    ).toThrow('Invalid EIP-7702 authorization chain ID: -1')
  })
})
