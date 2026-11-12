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
  test('status', () => {
    const request = { query: {}, body: undefined }
    expect(
      alps.readParams('status', { ...request, path: '/intent-operation/123' }),
    ).toEqual(blanc.readParams('status', { ...request, path: '/intents/123' }))
  })

  test('portfolio', () => {
    const path = '/accounts/0xAbC/portfolio'
    const fromAlps = alps.readParams('portfolio', {
      path,
      query: { chainIds: '84532,421614', tokens: '84532:0xDeF' },
      body: undefined,
    })
    expect(fromAlps).toEqual(
      blanc.readParams('portfolio', {
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

  test('splits', () => {
    const tokens = { '0xAbC': '1000000' }
    expect(
      alps.readParams('splits', {
        path: '/intents/split',
        query: {},
        body: { chainId: 421614, tokens },
      }),
    ).toEqual(
      blanc.readParams('splits', {
        path: '/intents/splits',
        query: {},
        body: { chainId: 'eip155:421614', tokens },
      }),
    )
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
