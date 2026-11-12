import { describe, expect, test } from 'vitest'
import alpsQuoteRequest from '../__fixtures__/alps/quote-request.json'
import alpsQuoteResponse from '../__fixtures__/alps/quote-response.json'
import alpsSubmitRequest from '../__fixtures__/alps/submit-request.json'
import blancQuoteRequest from '../__fixtures__/blanc/quote-request.json'
import blancQuoteResponse from '../__fixtures__/blanc/quote-response.json'
import blancSubmitRequest from '../__fixtures__/blanc/submit-request.json'
import { compare } from '../compare'
import { normalizeLayer } from '../normalize'
import { RULES } from '../rules'
import { alps } from './alps'
import { blanc } from './blanc'
import { readParams } from './common'

describe('quote request', () => {
  test('alps and blanc fixtures project to the same canonical request', () => {
    const fromAlps = alps.quoteRequest(alpsQuoteRequest)
    const fromBlanc = blanc.quoteRequest(blancQuoteRequest)
    // topupCompact exists only in alps; it stays visible as a diff.
    expect(compare('quoteRequest', fromAlps, fromBlanc)).toEqual([
      {
        layer: 'quoteRequest',
        path: '/options/topupCompact',
        kind: 'missing',
        a: false,
        b: undefined,
      },
    ])
  })

  test('maps CAIP-2 ids, gas limits and lowercases addresses', () => {
    const alpsRequest = {
      destinationChainId: 8453,
      destinationGasUnits: '500000',
      tokenRequests: [{ tokenAddress: '0xAbCd', amount: '1' }],
      account: { address: '0xAAAA', accountType: 'ERC7579', setupOps: [] },
      destinationExecutions: [{ to: '0xBBBB', value: '0', data: '0xDEAD' }],
      preClaimExecutions: { 10: [{ to: '0xCC', value: '1', data: '0x' }] },
      options: {
        sponsorSettings: { gasSponsored: true, bridgeFeesSponsored: false },
        settlementLayers: ['ACROSS'],
        signatureMode: 1,
      },
    }
    const blancRequest = {
      destinationChainId: 'eip155:8453',
      destinationGasLimit: '500000',
      tokenRequests: [{ tokenAddress: '0xabcd', amount: '1' }],
      account: { address: '0xaaaa', accountType: 'ERC7579', setupOps: [] },
      destinationExecutions: [{ to: '0xbbbb', value: '0', data: '0xdead' }],
      preClaimExecutions: {
        'eip155:10': [{ to: '0xcc', value: '1', data: '0x' }],
      },
      options: {
        sponsorSettings: { gas: true, bridgeFees: false },
        settlementLayers: { include: ['ACROSS'] },
        signatureMode: 'ERC1271',
      },
    }
    const canonical = alps.quoteRequest(alpsRequest)
    expect(canonical).toEqual(blanc.quoteRequest(blancRequest))
    expect(canonical).toMatchObject({
      destinationChainId: 8453,
      destinationGasLimit: '500000',
      tokenRequests: [{ token: '0xabcd', amount: '1' }],
      preClaimExecutions: { '10': [{ to: '0xcc', value: '1', data: '0x' }] },
      options: {
        sponsorSettings: { gas: true, bridgeFees: false },
        settlementLayers: { include: ['ACROSS'] },
        signatureMode: 1,
      },
    })
  })

  test('keeps fields only one version knows under their own names', () => {
    expect(
      blanc.quoteRequest({ destinationInstructions: [{ programId: 'x' }] }),
    ).toMatchObject({
      destinationInstructions: [{ programId: 'x' }],
    })
  })
})

const OWNER = '0x36c03e7d593f7b2c6b06fc18b5f4e9a4a29c99b0'
const USDC_ARB = '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'
const USDC_BASE = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
const NATIVE = '0x0000000000000000000000000000000000000000'

// The request fields every case shares, in each version's encoding. v1 always
// sends the alps-only topupCompact; it is left out here and pinned as a diff by
// the fixture test.
function alpsRequest(extra: Record<string, unknown>) {
  const { options, account, ...rest } = extra
  return {
    destinationChainId: 421614,
    tokenRequests: [{ tokenAddress: USDC_ARB, amount: '100000' }],
    account: {
      address: OWNER,
      accountType: 'ERC7579',
      setupOps: [],
      ...(account as object),
    },
    destinationExecutions: [],
    options: { signatureMode: 1, ...(options as object) },
    ...rest,
  }
}

function blancRequest(extra: Record<string, unknown>) {
  const { options, account, ...rest } = extra
  return {
    destinationChainId: 'eip155:421614',
    tokenRequests: [{ tokenAddress: USDC_ARB, amount: '100000' }],
    account: {
      address: OWNER,
      accountType: 'ERC7579',
      setupOps: [],
      ...(account as object),
    },
    destinationExecutions: [],
    options: { signatureMode: 'ERC1271', ...(options as object) },
    ...rest,
  }
}

const RECIPIENT_ACCOUNT = {
  address: '0xD49D9aBF00000000000000000000000000000074',
  accountType: 'ERC7579',
  setupOps: [
    { to: '0x0000000000679A258c64d2F20F310e12B64b7375', data: '0xAB' },
  ],
}

// Each option the live scenarios set, as v1 sends it to alps and as a blanc
// mapping would encode it; both must project to the same canonical value.
const EQUIVALENT: [string, Record<string, unknown>, Record<string, unknown>][] =
  [
    [
      'partial sponsorship',
      {
        options: {
          sponsorSettings: {
            gasSponsored: true,
            bridgeFeesSponsored: false,
            swapFeesSponsored: true,
            protocolFeesSponsored: false,
          },
        },
      },
      {
        options: {
          sponsorSettings: {
            gas: true,
            bridgeFees: false,
            swapFees: true,
            protocolFees: false,
          },
        },
      },
    ],
    [
      'app and protocol fees',
      { options: { appFees: { feeBps: 10 }, protocolFees: { feeBps: 5 } } },
      { options: { appFees: { feeBps: 10 }, protocolFees: { feeBps: 5 } } },
    ],
    [
      'custom deadline',
      { options: { customDeadline: 1_900_000_000 } },
      { options: { customDeadline: 1_900_000_000 } },
    ],
    [
      'quoter filter',
      { options: { quoters: { exclude: ['bebop'] } } },
      { options: { quoters: { exclude: ['bebop'] } } },
    ],
    [
      'settlement-layer list',
      { options: { settlementLayers: ['CCTP'] } },
      { options: { settlementLayers: { include: ['CCTP'] } } },
    ],
    [
      'EOA recipient',
      {
        recipient: {
          address: '0x000000000000000000000000000000000000dEaD',
          accountType: 'EOA',
          setupOps: [],
        },
      },
      {
        recipient: {
          address: '0x000000000000000000000000000000000000dead',
          accountType: 'EOA',
          setupOps: [],
        },
      },
    ],
    [
      'account recipient',
      { recipient: RECIPIENT_ACCOUNT },
      { recipient: RECIPIENT_ACCOUNT },
    ],
    [
      'pre-claim executions',
      {
        preClaimExecutions: {
          84532: [
            {
              to: '0x0000000000000000000000000000000000000420',
              value: '0',
              data: '0x69123456',
            },
          ],
        },
      },
      {
        preClaimExecutions: {
          'eip155:84532': [
            {
              to: '0x0000000000000000000000000000000000000420',
              value: '0',
              data: '0x69123456',
            },
          ],
        },
      },
    ],
    [
      'access list of chains and token symbols',
      { accountAccessList: { chainIds: [84532], tokens: ['USDC'] } },
      { accountAccessList: { chainIds: ['eip155:84532'], tokens: ['USDC'] } },
    ],
    [
      'access list of tokens per chain',
      { accountAccessList: { chainTokens: { 84532: ['USDC'] } } },
      { accountAccessList: { chainTokens: { 'eip155:84532': ['USDC'] } } },
    ],
    [
      'exact-input access list with amounts',
      {
        accountAccessList: [
          { chainId: 84532, tokenAddress: USDC_BASE, amount: '200000' },
        ],
      },
      {
        accountAccessList: {
          chainTokenAmounts: { 'eip155:84532': { [USDC_BASE]: '200000' } },
        },
      },
    ],
    [
      'EIP-7702 delegation',
      {
        account: {
          delegations: {
            0: { contract: '0x000000000000000000000000000000000000Ab12' },
          },
        },
      },
      {
        account: {
          delegations: {
            'eip155:0': {
              contract: '0x000000000000000000000000000000000000ab12',
            },
          },
        },
      },
    ],
    [
      'per-chain session mock signatures and signature mode',
      {
        account: { mockSignatures: { 84532: '0xAA', 421614: '0xBB' } },
        options: { signatureMode: 5 },
      },
      {
        account: {
          mockSignatures: { 'eip155:84532': '0xaa', 'eip155:421614': '0xbb' },
        },
        options: { signatureMode: 'EMISSARY_EXECUTION_ERC1271' },
      },
    ],
    [
      'native-token auxiliary funds',
      {
        options: {
          auxiliaryFunds: { 84532: { [NATIVE]: '10000000000000000' } },
        },
      },
      {
        options: {
          auxiliaryFunds: { 'eip155:84532': { [NATIVE]: '10000000000000000' } },
        },
      },
    ],
  ]

describe('quote request options', () => {
  test.each(EQUIVALENT)(
    '%s projects the same from alps and blanc',
    (_name, a, b) => {
      const fromAlps = alps.quoteRequest(alpsRequest(a))
      expect(fromAlps).toEqual(blanc.quoteRequest(blancRequest(b)))
      // The option itself must survive projection, not just match by omission.
      expect(fromAlps).not.toEqual(alps.quoteRequest(alpsRequest({})))
    },
  )

  // Encodings with no blanc counterpart. They stay visible as diffs until the
  // blanc mapping decides them.
  test('feeToken exists only in alps', () => {
    const fromAlps = alps.quoteRequest(
      alpsRequest({ options: { feeToken: 'USDC' } }),
    )
    const fromBlanc = blanc.quoteRequest(blancRequest({}))
    expect(compare('quoteRequest', fromAlps, fromBlanc)).toEqual([
      {
        layer: 'quoteRequest',
        path: '/options/feeToken',
        kind: 'missing',
        a: 'USDC',
        b: undefined,
      },
    ])
  })

  test('the deprecated singular mock signature is a diff when dropped', () => {
    const fromAlps = alps.quoteRequest(
      alpsRequest({ account: { mockSignature: '0xAA' } }),
    )
    const fromBlanc = blanc.quoteRequest(blancRequest({}))
    expect(compare('quoteRequest', fromAlps, fromBlanc)).toEqual([
      {
        layer: 'quoteRequest',
        path: '/account/mockSignature',
        kind: 'missing',
        a: '0xaa',
        b: undefined,
      },
    ])
  })

  test('an amountless exact-input access list has no blanc amount form', () => {
    const fromAlps = alps.quoteRequest(
      alpsRequest({
        accountAccessList: [{ chainId: 84532, tokenAddress: USDC_BASE }],
      }),
    )
    expect(fromAlps.accountAccessList).toEqual({
      chainTokenAmounts: { '84532': { [USDC_BASE]: null } },
    })
    const fromBlanc = blanc.quoteRequest(
      blancRequest({
        accountAccessList: { chainTokens: { 'eip155:84532': [USDC_BASE] } },
      }),
    )
    expect(
      compare('quoteRequest', fromAlps, fromBlanc).map((diff) => diff.path),
    ).toEqual([
      '/accountAccessList/chainTokenAmounts',
      '/accountAccessList/chainTokens',
    ])
  })
})

describe('submit request', () => {
  test('alps and blanc fixtures project to the same canonical submission', () => {
    expect(alps.submitRequest(alpsSubmitRequest)).toEqual(
      blanc.submitRequest(blancSubmitRequest),
    )
  })

  test('maps authorizations into the sponsor role', () => {
    const auth = {
      chainId: 84532,
      address: '0xAB',
      nonce: 0,
      yParity: 1,
      r: '0x01',
      s: '0x02',
    }
    const fromAlps = alps.submitRequest({
      signedIntentOp: { originSignatures: [], signedAuthorizations: [auth] },
    })
    const fromBlanc = blanc.submitRequest({
      intentId: '1',
      signatures: { origin: [] },
      authorizations: { sponsor: [{ ...auth, chainId: 'eip155:84532' }] },
    })
    expect(fromAlps).toEqual(fromBlanc)
    expect(fromAlps.authorizations?.sponsor?.[0]).toMatchObject({
      chainId: 84532,
      address: '0xab',
    })
  })

  test('submit stubs echo the version-specific id', () => {
    expect(alps.submitStub({ signedIntentOp: { nonce: '7' } })).toEqual({
      status: 200,
      body: { result: { id: '7', status: 'PENDING' } },
    })
    expect(blanc.submitStub({ intentId: 'x' })).toEqual({
      status: 201,
      body: { intentId: 'x' },
    })
  })
})

describe('cost', () => {
  test('alps and blanc fixtures agree within the cost rules', () => {
    const fromAlps = alps.cost(alpsQuoteResponse, alpsQuoteRequest)
    const fromBlanc = blanc.cost(blancQuoteResponse, blancQuoteRequest)
    expect(fromAlps?.inputs).toEqual(fromBlanc?.inputs)
    expect(fromAlps?.outputs).toEqual(fromBlanc?.outputs)
    const a = normalizeLayer('cost', { prepare: fromAlps }, RULES, {})
    const b = normalizeLayer('cost', { prepare: fromBlanc }, RULES, {})
    expect(compare('cost', a, b)).toEqual([])
  })

  test('a fee category present in one version only is a diff', () => {
    const fromAlps = alps.cost(alpsQuoteResponse, alpsQuoteRequest)!
    const fromBlanc = blanc.cost(blancQuoteResponse, blancQuoteRequest)!
    fromBlanc.fees.swap.usd = 0.01
    const a = normalizeLayer('cost', { prepare: fromAlps }, RULES, {})
    const b = normalizeLayer('cost', { prepare: fromBlanc }, RULES, {})
    expect(compare('cost', a, b).map((diff) => diff.path)).toEqual([
      '/prepare/fees/swap/usd',
    ])
  })
})

describe('reads', () => {
  test('alps and blanc portfolio queries project the same', () => {
    const path = '/accounts/0xAbC/portfolio'
    const fromAlps = readParams('portfolio', {
      path,
      query: { chainIds: '84532,421614', tokens: '84532:0xDeF' },
      body: undefined,
    })
    expect(fromAlps).toEqual(
      readParams('portfolio', {
        path,
        query: {
          chainIds: 'eip155:84532,eip155:421614',
          tokens: 'eip155:84532:0xdef',
        },
        body: undefined,
      }),
    )
    expect(fromAlps).toEqual({
      account: '0xabc',
      chainIds: [84532, 421614],
      tokens: { '84532': ['0xdef'] },
    })
  })
})

describe('errors', () => {
  test('alps reads the code from the first error context', () => {
    expect(
      alps.wireError(422, {
        errors: [
          {
            message: 'No balances available',
            context: { code: 'ZERO_BALANCE' },
          },
        ],
      }),
    ).toEqual({ status: 422, code: 'ZERO_BALANCE' })
  })

  test('the shared auth envelope maps the same in both versions', () => {
    const body = { code: 'UNAUTHORIZED', message: 'Invalid API key' }
    expect(alps.wireError(401, body)).toEqual(blanc.wireError(401, body))
    expect(blanc.wireError(401, body)).toEqual({
      status: 401,
      code: 'UNAUTHORIZED',
    })
  })
})
