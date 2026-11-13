// Independent contract fixture from orchestrator/test/unit/api/sponsorshipAuthorization.test.ts.
export const BACKEND_DIGEST =
  '2ad73721798154dc0645fe3e745ca582cab557c749fe7a949ff226365d19e635'
export const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
export const ACCOUNT = '0x0000000000000000000000000000000000000010'
export const FACTORY = '0x0000000000000000000000000000000000000020'

export const BACKEND_WIRE = {
  account: {
    address: ACCOUNT,
    accountType: 'ERC7579',
    setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
  },
  destinationChainId: 'eip155:8453',
  destinationExecutions: [{ to: USDC, value: '0', data: '0xabcd' }],
  destinationGasLimit: '250000',
  tokenRequests: [{ tokenAddress: USDC, amount: '1000000' }],
  accountAccessList: {
    chainIds: ['eip155:8453'],
    chainTokenAmounts: { 'eip155:1': { [USDC]: '5' } },
  },
  options: {
    sponsorSettings: { gas: true, bridgeFees: true, swapFees: false },
    signatureMode: 1,
    auxiliaryFunds: {
      'eip155:42161': {
        '0xaf88d065e77c8cc2239327c5edb3a432268e5831': '500000000',
      },
    },
  },
  preClaimExecutions: {
    'eip155:1': [{ to: FACTORY, value: '0', data: '0xbeef' }],
  },
}

// Hand-authored legacy -> wire -> projection vector, not produced by SDK mappers.
// SHA-256 independently computed with Python hashlib + sorted compact JSON;
// this vector uses only ASCII keys, strings, booleans and safe integer numbers.
export const LEGACY_DIGEST =
  'fea71aa96eb53ec99537b8167a956e341e7f61277834e96c83ebbd56955855d3'

export const LEGACY_INPUT = {
  account: {
    address: ACCOUNT,
    accountType: 'ERC7579',
    setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
    mockSignature: '0xaaaa',
    mockSignatures: { 0: '0xbbbb', 8453: '0xcccc' },
    delegations: { 0: { contract: FACTORY }, 8453: { contract: ACCOUNT } },
  },
  recipient: {
    address: FACTORY,
    accountType: 'EOA',
    setupOps: [],
    mockSignature: '0xdddd',
  },
  destinationChainId: 8453,
  destinationGasUnits: '250000',
  destinationExecutions: [
    { to: USDC, value: '900719925474099312345', data: '0xabcd' },
  ],
  tokenRequests: [
    { tokenAddress: USDC, amount: '900719925474099312346' },
    { tokenAddress: FACTORY },
  ],
  accountAccessList: [
    { chainId: 1, tokenAddress: USDC, amount: '5' },
    { chainId: 1, tokenAddress: FACTORY },
    { chainId: 1, tokenAddress: USDC, amount: '900719925474099312347' },
    { chainId: 1, tokenAddress: USDC },
    { chainId: 8453, tokenAddress: FACTORY },
  ],
  options: {
    topupCompact: true,
    feeToken: USDC,
    sponsorSettings: {
      gasSponsored: true,
      bridgeFeesSponsored: false,
      swapFeesSponsored: false,
      protocolFeesSponsored: true,
    },
    signatureMode: 1,
    auxiliaryFunds: { 42161: { [USDC]: '900719925474099312348' } },
  },
  preClaimExecutions: {
    1: [{ to: FACTORY, value: '0', data: '0xbeef' }],
  },
}

export const EXPECTED_PROJECTED = {
  account: {
    address: ACCOUNT,
    accountType: 'ERC7579',
    setupOps: [{ to: FACTORY, data: '0xdeadbeef' }],
    mockSignatures: { 0: '0xbbbb', 8453: '0xcccc' },
    delegations: { 0: { contract: FACTORY }, 8453: { contract: ACCOUNT } },
  },
  recipient: {
    address: FACTORY,
    accountType: 'EOA',
    setupOps: [],
    mockSignatures: { 0: '0xdddd' },
  },
  destinationChainId: 8453,
  destinationGasUnits: '250000',
  destinationExecutions: [
    { to: USDC, value: '900719925474099312345', data: '0xabcd' },
  ],
  tokenRequests: [
    { tokenAddress: USDC, amount: '900719925474099312346' },
    { tokenAddress: FACTORY },
  ],
  accountAccessList: {
    chainTokens: { 1: [USDC, FACTORY], 8453: [FACTORY] },
    chainTokenAmounts: { 1: { [USDC]: '900719925474099312347' } },
  },
  options: {
    sponsorSettings: {
      gas: true,
      bridgeFees: false,
      swapFees: false,
      protocolFees: true,
    },
    signatureMode: 1,
    auxiliaryFunds: { 42161: { [USDC]: '900719925474099312348' } },
  },
  preClaimExecutions: {
    1: [{ to: FACTORY, value: '0', data: '0xbeef' }],
  },
}

export const EXPECTED_WIRE = {
  account: EXPECTED_PROJECTED.account,
  recipient: EXPECTED_PROJECTED.recipient,
  destinationChainId: 'eip155:8453',
  destinationGasLimit: '250000',
  destinationExecutions: EXPECTED_PROJECTED.destinationExecutions,
  tokenRequests: EXPECTED_PROJECTED.tokenRequests,
  accountAccessList: {
    chainTokens: { 'eip155:1': [USDC, FACTORY], 'eip155:8453': [FACTORY] },
    chainTokenAmounts: { 'eip155:1': { [USDC]: '900719925474099312347' } },
  },
  options: {
    sponsorSettings: {
      gas: true,
      bridgeFees: false,
      swapFees: false,
      protocolFees: true,
    },
    signatureMode: 1,
    auxiliaryFunds: { 'eip155:42161': { [USDC]: '900719925474099312348' } },
  },
  preClaimExecutions: {
    'eip155:1': [{ to: FACTORY, value: '0', data: '0xbeef' }],
  },
}
