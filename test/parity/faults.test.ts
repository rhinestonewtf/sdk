import { describe, expect, test } from 'vitest'
import { alps } from './canonical/alps'
import { blanc } from './canonical/blanc'
import { compare } from './compare'
import { getFault } from './faults'

const ACCOUNT = '0x36c03e7d593f7b2c6b06fc18b5f4e9a4a29c99b0'
const USDC = '0x75faf114eafb1bdbe2f0316df893fd58ce46aa4d'

const alpsBody = {
  destinationChainId: 421614,
  tokenRequests: [{ tokenAddress: USDC, amount: '100000' }],
  account: {
    address: ACCOUNT,
    accountType: 'ERC7579',
    setupOps: [],
    delegations: { 0: { contract: '0xaa' } },
    mockSignature: '0x01',
    mockSignatures: { 84532: '0x01' },
  },
  recipient: { address: '0xdead', accountType: 'EOA', setupOps: [] },
  destinationExecutions: [{ to: '0xdead', value: '0', data: '0x' }],
  destinationGasUnits: '200000',
  accountAccessList: { chainIds: [84532] },
  preClaimExecutions: { 84532: [{ to: '0x0420', value: '0', data: '0x69' }] },
  options: {
    topupCompact: true,
    feeToken: 'USDC',
    sponsorSettings: { gasSponsored: true },
    appFees: { feeBps: 10 },
    signatureMode: 1,
    auxiliaryFunds: { 84532: { [USDC]: '5000000' } },
  },
}

const blancBody = {
  destinationChainId: 'eip155:421614',
  tokenRequests: [{ tokenAddress: USDC, amount: '100000' }],
  account: {
    address: ACCOUNT,
    accountType: 'ERC7579',
    setupOps: [],
    delegations: { 'eip155:0': { contract: '0xaa' } },
    mockSignatures: { 'eip155:84532': '0x01' },
  },
  recipient: { address: '0xdead', accountType: 'EOA', setupOps: [] },
  destinationExecutions: [{ to: '0xdead', value: '0', data: '0x' }],
  destinationGasLimit: '200000',
  accountAccessList: { chainIds: ['eip155:84532'] },
  preClaimExecutions: {
    'eip155:84532': [{ to: '0x0420', value: '0', data: '0x69' }],
  },
  options: {
    sponsorSettings: { gas: true },
    appFees: { feeBps: 10 },
    signatureMode: 'ERC1271',
    auxiliaryFunds: { 'eip155:84532': { [USDC]: '5000000' } },
  },
}

const ENCODINGS = [
  { version: 'alps' as const, adapter: alps, body: alpsBody },
  { version: 'blanc' as const, adapter: blanc, body: blancBody },
]

function faultedPaths(
  faultId: string,
  { version, adapter, body }: (typeof ENCODINGS)[number],
): string[] {
  const faulted = getFault(faultId).transform(structuredClone(body), version)
  return compare(
    'quoteRequest',
    adapter.quoteRequest(body),
    adapter.quoteRequest(faulted),
  ).map((diff) => diff.path)
}

describe('quote.drop-options', () => {
  test.each(ENCODINGS)('names every dropped option ($version)', (encoding) => {
    const expected =
      encoding.version === 'alps'
        ? [
            '/options/appFees',
            '/options/feeToken',
            '/options/signatureMode',
            '/options/sponsorSettings',
            '/options/topupCompact',
          ]
        : [
            '/options/appFees',
            '/options/signatureMode',
            '/options/sponsorSettings',
          ]
    expect(faultedPaths('quote.drop-options', encoding).sort()).toEqual(
      expected,
    )
  })

  test('is a no-op without options', () => {
    const body = { destinationChainId: 1 }
    expect(getFault('quote.drop-options').transform(body, 'alps')).toEqual({
      destinationChainId: 1,
    })
  })
})

describe('quote.drop-optional-fields', () => {
  // Alps's singular mock signature projects into `mockSignatures['0']`.
  test.each(ENCODINGS)('names every dropped field ($version)', (encoding) => {
    const expected = [
      '/account/delegations',
      '/account/mockSignatures',
      '/accountAccessList',
      '/destinationExecutions/0',
      '/destinationGasLimit',
      '/preClaimExecutions',
      '/recipient',
    ]
    expect(faultedPaths('quote.drop-optional-fields', encoding).sort()).toEqual(
      expected,
    )
  })

  test('is a no-op when no optional field is set', () => {
    const body = {
      destinationChainId: 1,
      destinationExecutions: [],
      account: { address: ACCOUNT, setupOps: [] },
    }
    expect(
      getFault('quote.drop-optional-fields').transform(
        structuredClone(body),
        'blanc',
      ),
    ).toEqual(body)
  })
})

describe('submit.corrupt-origin-signature', () => {
  const fault = getFault('submit.corrupt-origin-signature')

  test('flips the last byte of the first alps origin signature', () => {
    const body = {
      signedIntentOp: {
        originSignatures: ['0x1234ab', '0x99'],
        destinationSignature: '0x1234ab',
      },
    }
    expect(fault.transform(structuredClone(body), 'alps')).toEqual({
      signedIntentOp: {
        originSignatures: ['0x123454', '0x99'],
        destinationSignature: '0x1234ab',
      },
    })
  })

  test('corrupts the notarized claim signature of a session pair', () => {
    const body = {
      signedIntentOp: {
        originSignatures: [
          { preClaimSig: '0x01', notarizedClaimSig: '0x00ff' },
        ],
      },
    }
    expect(fault.transform(structuredClone(body), 'alps')).toEqual({
      signedIntentOp: {
        originSignatures: [
          { preClaimSig: '0x01', notarizedClaimSig: '0x0000' },
        ],
      },
    })
  })

  test('flips the first blanc origin signature', () => {
    const body = { signatures: { origin: ['0x0a1b'], destination: '0x0a1b' } }
    expect(fault.transform(structuredClone(body), 'blanc')).toEqual({
      signatures: { origin: ['0x0ae4'], destination: '0x0a1b' },
    })
  })

  test('applies to submits only', () => {
    expect(fault.op).toBe('submit')
  })
})
