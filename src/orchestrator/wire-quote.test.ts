import { type Hex, hashTypedData, type TypedDataDefinition } from 'viem'
import { describe, expect, test } from 'vitest'
import { payloadChainId } from '../execution/payload-chain'
import recorded from './__fixtures__/quote-responses.json'
import { OrchestratorError } from './error'
import type { IntentInput } from './types'
import {
  type BlancRoute,
  blancQuoteRequest,
  blancSubmitRequest,
  normalizeTypedData,
  quoteFromBlanc,
  quotesFromBlanc,
} from './wire-quote'

// Real quote pairs recorded from the prod orchestrator: the request 1.22.0
// sent on alps, the same request in blanc's encoding (blanc accepted every one
// alps accepted), blanc's response and the typed data 1.22.0 built locally
// from the alps quote.

interface QuoteCase {
  id: string
  alps: { request: Record<string, unknown> }
  blanc: { request: Record<string, unknown>; status?: number; body?: any }
  local?: {
    origin: TypedDataDefinition[]
    destination: TypedDataDefinition
    targetExecution?: TypedDataDefinition
  }
}

const { cases, devMultiChainOpsRoute } = recorded as unknown as {
  cases: QuoteCase[]
  devMultiChainOpsRoute: BlancRoute
}
const byId = (id: string) => cases.find((c) => c.id === id)!
const ROUTED = cases.filter((c) => c.blanc.status === 200)

// CCTP into the sender's own account: blanc plans Rhinestone relayer delivery
// where alps plans Circle forwarding, so the payloads differ by design.
const PLANNED_DIFFERENTLY = new Set([
  'funded/cctp-safe',
  'options/fee-asset',
  'unfunded/nexus',
  'unfunded/session-per-chain-enable',
])
const SAME_PLAN = ROUTED.filter(
  (c) => c.local && !PLANNED_DIFFERENTLY.has(c.id),
)

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

describe('blancQuoteRequest', () => {
  test.each(cases.map((c) => [c.id, c] as const))(
    '%s encodes as recorded',
    (_id, c) => {
      expect(
        blancQuoteRequest(c.alps.request as unknown as IntentInput),
      ).toEqual(c.blanc.request)
    },
  )

  test('chain ids become CAIP-2 and gas units become a gas limit', () => {
    const body = blancQuoteRequest(
      intentInput({
        destinationGasUnits: 500_000n,
        accountAccessList: { chainIds: [84532] },
        preClaimExecutions: {
          84532: [{ to: ACCOUNT, value: 0n, data: '0x' }],
        },
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

  test('per-chain token maps take CAIP-2 keys, token lists pass through', () => {
    expect(
      blancQuoteRequest(
        intentInput({
          accountAccessList: { chainTokens: { 84532: ['USDC'] } },
        }),
      ).accountAccessList,
    ).toEqual({ chainTokens: { 'eip155:84532': ['USDC'] } })
    expect(
      blancQuoteRequest(
        intentInput({ accountAccessList: { tokens: ['USDC', WETH_BASE] } }),
      ).accountAccessList,
    ).toEqual({ tokens: ['USDC', WETH_BASE] })
  })

  test('folds exact inputs into per-chain tokens and amounts', () => {
    const fold = (list: IntentInput['accountAccessList']) =>
      blancQuoteRequest(intentInput({ accountAccessList: list }))
        .accountAccessList
    expect(
      fold([
        { chainId: 84532, tokenAddress: USDC_BASE, amount: 7n },
        { chainId: 84532, tokenAddress: WETH_BASE },
        { chainId: 84532, tokenAddress: USDC_BASE, amount: 9n },
        { chainId: 11155420, tokenAddress: WETH_BASE },
      ]),
    ).toEqual({
      chainTokens: {
        'eip155:84532': [USDC_BASE, WETH_BASE],
        'eip155:11155420': [WETH_BASE],
      },
      chainTokenAmounts: { 'eip155:84532': { [USDC_BASE]: '9' } },
    })
    expect(fold([{ chainId: 84532, tokenAddress: USDC_BASE }])).toEqual({
      chainTokens: { 'eip155:84532': [USDC_BASE] },
    })
  })

  test('the target-chain mock signature becomes the cross-chain fallback', () => {
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

  test('sponsor flags take blanc names; lock and fee-token options are dropped', () => {
    const body = blancQuoteRequest(
      intentInput({
        options: {
          topupCompact: true,
          feeToken: 'USDC',
          sponsorSettings: {
            gasSponsored: true,
            bridgeFeesSponsored: false,
            swapFeesSponsored: true,
          },
          settlementLayers: ['ACROSS'],
          signatureMode: 5,
        },
      }),
    )
    expect(body.options).toEqual({
      sponsorSettings: { gas: true, bridgeFees: false, swapFees: true },
      settlementLayers: ['ACROSS'],
      signatureMode: 5,
    })
  })
})

describe('quoteFromBlanc', () => {
  test.each(ROUTED.map((c) => [c.id, c] as const))('%s decodes', (_id, c) => {
    const quotes = quotesFromBlanc(c.blanc.body)
    expect(quotes).toHaveLength(c.blanc.body.routes.length)
    const [quote] = quotes
    const route = c.blanc.body.routes[0]
    expect(quote.intentId).toBe(route.intentId)
    expect(quote.expiresAt).toBe(route.expiresAt)
    expect(quote.settlementLayer).toBe(route.settlementLayer)
    expect(quote.signData.origin).toHaveLength(route.signData.origin.length)
    for (const payload of quote.signData.origin) {
      expect(payload).not.toHaveProperty('kind')
      expect(typeof (payload.message as { nonce?: unknown }).nonce).toBe(
        'bigint',
      )
    }
    expect('targetExecution' in quote.signData).toBe(
      Boolean(route.signData.targetExecution),
    )
    for (const token of [...quote.cost.input, ...quote.cost.output]) {
      expect(typeof token.chainId).toBe('number')
      expect(typeof token.amount).toBe('bigint')
    }
    expect(quote.cost.fees).toEqual(route.cost.fees)
  })

  test('decodes token requirements with numeric chains and bigint amounts', () => {
    const { routes } = byId('unfunded/eoa').blanc.body
    const quote = quoteFromBlanc(routes[0])
    const usdc = '0x036cbd53842c5426634e7929541ec2318f3dcf7e'
    const requirement = quote.tokenRequirements?.[84532]?.[usdc]
    expect(requirement).toMatchObject({
      type: 'approval',
      amount: 220569n,
      spender: '0x000000000022d473030f116ddee9f6b43ac78ba3',
    })
    const permit = (requirement as { permit: TypedDataDefinition }).permit
    expect(permit.message).toMatchObject({ nonce: 0n, deadline: 1794543125n })
    expect(hashTypedData(permit)).toBe(
      hashTypedData(routes[0].tokenRequirements['84532'][usdc].permit),
    )
  })

  test('smart-account routes carry no token requirements', () => {
    const quote = quoteFromBlanc(
      byId('planned/unfunded/nexus').blanc.body.routes[0],
    )
    expect(quote).not.toHaveProperty('tokenRequirements')
  })

  test('cost chain ids are numbers and amounts bigints', () => {
    const quote = quoteFromBlanc(byId('unfunded/eoa').blanc.body.routes[0])
    expect(quote.cost.input).toEqual([
      {
        chainId: 84532,
        tokenAddress: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
        symbol: 'USDC',
        decimals: 6,
        price: { usd: 0.9997 },
        amount: 220569n,
      },
    ])
  })

  test('served target execution is decoded; null is absent', () => {
    const route = byId('funded/across-owner-destination-call').blanc.body
      .routes[0]
    const quote = quoteFromBlanc(route)
    expect(quote.signData.targetExecution).toEqual(
      normalizeTypedData(route.signData.targetExecution),
    )
    const withNull = quoteFromBlanc({
      ...route,
      signData: { ...route.signData, targetExecution: null },
    })
    expect(withNull.signData).not.toHaveProperty('targetExecution')
  })

  test('without a destination payload the last origin payload is used', () => {
    const route = byId('unfunded/nexus').blanc.body.routes[0]
    const { destination: _destination, ...signData } = route.signData
    const quote = quoteFromBlanc({ ...route, signData })
    expect(quote.signData.destination).toBe(quote.signData.origin.at(-1))
  })

  test('refuses non-EVM origin payloads', () => {
    const route = byId('unfunded/nexus').blanc.body.routes[0]
    const signData = {
      ...route.signData,
      origin: [{ kind: 'personalSign', message: 'x' }],
    }
    expect(() => quoteFromBlanc({ ...route, signData })).toThrow(
      OrchestratorError,
    )
    expect(() => quoteFromBlanc({ ...route, signData })).toThrow(
      'non-EVM origin payloads are not supported by this SDK version',
    )
  })

  test('no routes decode to an empty list', () => {
    expect(quotesFromBlanc({ routes: [] })).toEqual([])
  })
})

describe('normalizeTypedData', () => {
  test('coerces uints through nested structs and arrays', () => {
    const route = byId('funded/eoa-permit2').blanc.body.routes[0]
    const typedData = normalizeTypedData(route.signData.origin[0])
    expect(typedData.primaryType).toBe('PermitBatchWitnessTransferFrom')
    const message = typedData.message as any
    expect(typeof message.nonce).toBe('bigint')
    expect(typeof message.deadline).toBe('bigint')
    expect(typeof message.permitted[0].amount).toBe('bigint')
    expect(typeof message.permitted[0].token).toBe('string')
    expect(typedData.domain).toEqual(route.signData.origin[0].domain)
    expect(hashTypedData(typedData)).toBe(
      hashTypedData(route.signData.origin[0]),
    )
  })
})

describe('payloadChainId', () => {
  test('reads the signing domain chain', () => {
    const intentExecutor = quoteFromBlanc(
      byId('funded/undeployed-nexus').blanc.body.routes[0],
    )
    expect(intentExecutor.signData.origin[0].primaryType).toBe('SingleChainOps')
    expect(payloadChainId(intentExecutor.signData.origin[0])).toBe(84532)
    const permit2 = quoteFromBlanc(
      byId('funded/eoa-permit2').blanc.body.routes[0],
    )
    expect(payloadChainId(permit2.signData.origin[0])).toBe(11155420)
  })

  test('reads the first leg of a chainless multi-chain payload', () => {
    const quote = quoteFromBlanc(devMultiChainOpsRoute)
    expect(quote.signData.origin[0].primaryType).toBe('MultiChainOps')
    expect(payloadChainId(quote.signData.origin[0])).toBe(421614)
  })
})

describe('blancSubmitRequest', () => {
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

  test('omits absent roles, authorizations and options', () => {
    const body = blancSubmitRequest({
      ...base,
      originSignatures: [...base.originSignatures],
    })
    expect(Object.keys(body)).toEqual(['intentId', 'signatures'])
    expect(Object.keys(body.signatures as object)).toEqual([
      'origin',
      'destination',
    ])
  })

  test('authorizations go to the sponsor with CAIP-2 chains', () => {
    const body = blancSubmitRequest({
      ...base,
      originSignatures: [...base.originSignatures],
      authorizations: [
        { chainId: 84532, address: ACCOUNT, nonce: 3, yParity: 1, r, s },
        { chainId: 0, address: ACCOUNT, nonce: 0, r, s },
      ],
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

  test('dry runs set the root option', () => {
    expect(
      blancSubmitRequest({
        ...base,
        originSignatures: [...base.originSignatures],
        dryRun: true,
      }).options,
    ).toEqual({ dryRun: true })
  })
})

// Leaves that change with every quote (the harness's per-quote typed-data
// paths); op calldata counts when only its arguments differ.
const PER_QUOTE = [
  /\/(nonce|targetExecutionNonce)$/,
  /\/(expires|fillDeadline|fillExpiry|deadline)$/,
  /\/gasRefund\/(exchangeRate|overhead)$/,
  /\/permitted\/\d+\/amount$/,
  /\/originOps\/ops\/\d+\/value$/,
  /\/(idsAndAmounts|spendTokens)\/\d+\/1$/,
  /\/tokenOut\/\d+\/amount$/,
]

function leafPaths(value: unknown, path: string, out: string[] = []) {
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      leafPaths(entry, `${path}/${key}`, out)
    }
  } else {
    out.push(path)
  }
  return out
}

function at(value: unknown, path: string): any {
  return path
    .split('/')
    .filter(Boolean)
    .reduce<any>((node, key) => node?.[key], value)
}

function wire(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : String(value)
}

// Copies 1.22.0's per-quote leaves into the served payload; any other
// difference fails.
function alignPerQuote(
  local: TypedDataDefinition,
  served: TypedDataDefinition,
): TypedDataDefinition {
  const aligned = structuredClone(served)
  for (const path of leafPaths(aligned.message, '/message')) {
    const localLeaf = at(local, path)
    const servedLeaf = at(aligned, path)
    if (wire(localLeaf) === wire(servedLeaf)) continue
    const calldata =
      /\/ops\/\d+\/data$/.test(path) &&
      String(localLeaf).slice(0, 10) === String(servedLeaf).slice(0, 10) &&
      String(localLeaf).length === String(servedLeaf).length
    if (!calldata && !PER_QUOTE.some((pattern) => pattern.test(path))) {
      throw new Error(`structural difference at ${path}`)
    }
    const segments = path.split('/').filter(Boolean)
    at(aligned, segments.slice(0, -1).join('/'))[segments.at(-1)!] = localLeaf
  }
  return normalizeTypedData(aligned)
}

describe('served payloads equal what 1.22.0 built for the same plan', () => {
  test.each(SAME_PLAN.map((c) => [c.id, c] as const))('%s', (_id, c) => {
    const quote = quoteFromBlanc(c.blanc.body.routes[0])
    const local = c.local!
    expect(quote.signData.origin).toHaveLength(local.origin.length)
    local.origin.forEach((payload, index) => {
      expect(
        hashTypedData(alignPerQuote(payload, quote.signData.origin[index])),
      ).toBe(hashTypedData(normalizeTypedData(payload)))
    })
    expect(
      hashTypedData(
        alignPerQuote(local.destination, quote.signData.destination),
      ),
    ).toBe(hashTypedData(normalizeTypedData(local.destination)))
  })
})
