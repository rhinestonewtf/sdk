import type { Address, Hex, TypedDataDefinition } from 'viem'
import type {
  IntentAccountView,
  Quote,
  QuotePlan,
  SigningPayload,
  SigningRequest,
  SolanaAuthorityDisclosure,
  SwigAuthority,
} from '../../src/clients/orchestrator/public'
import type { OrchestratorExecutionQuote } from '../../src/clients/orchestrator/types'

const ACCOUNT = '0x0000000000000000000000000000000000000010' as Address

export const accountView: IntentAccountView = {
  address: ACCOUNT,
  type: 'erc7579',
}

export function typedData(
  chainId: number,
  overrides: Partial<TypedDataDefinition> = {},
): TypedDataDefinition {
  return {
    domain: { chainId, verifyingContract: ACCOUNT },
    types: { Test: [{ name: 'nonce', type: 'uint256' }] },
    primaryType: 'Test',
    message: { nonce: 1n },
    ...overrides,
  } as TypedDataDefinition
}

export function eip712Request(input: {
  readonly chainId: number
  readonly purpose?: SigningRequest['purpose']
  readonly typedData?: TypedDataDefinition
  readonly signatureFormat?: 'secp256k1' | 'account'
  readonly account?: Address
  readonly authority?: SigningRequest['authority']
}): SigningRequest {
  const caip2 = `eip155:${input.chainId}`
  const address = input.account ?? ACCOUNT
  return {
    account: { vm: 'evm', address },
    authority: input.authority ?? { kind: 'account', vm: 'evm', address },
    scope: {
      vm: 'evm',
      action: input.purpose === 'destinationAuthorization' ? 'fill' : 'claim',
      accounts: [{ chainId: caip2, address }],
    },
    chainIds: [caip2],
    purpose: input.purpose ?? 'originAuthorization',
    validity: [{ kind: 'timestamp', expiresAt: 4_000_000_000 }],
    payload: {
      kind: 'eip712',
      typedData: input.typedData ?? typedData(input.chainId),
      signatureFormat: input.signatureFormat ?? 'account',
    },
  }
}

export function delegationRequest(input: {
  readonly chainId: number
  readonly contract: Address
  readonly account?: Address
  /** The key asked to sign, when it is not the account's own. */
  readonly authority?: Address
}): SigningRequest {
  const caip2 = `eip155:${input.chainId}`
  const address = input.account ?? ACCOUNT
  return {
    account: { vm: 'evm', address },
    authority: { kind: 'secp256k1', address: input.authority ?? address },
    scope: {
      vm: 'evm',
      action: 'delegation',
      accounts: [{ chainId: caip2, address }],
    },
    chainIds: [caip2],
    purpose: 'delegationAuthorization',
    validity: [],
    payload: {
      kind: 'eip7702',
      authorization: { chainId: input.chainId, address: input.contract },
    },
  }
}

export function personalSignRequest(input: {
  readonly chainId: string
  readonly wallet: string
  readonly swigAccount: string
  readonly authority: Address
  readonly message: string
  readonly expiresAtSlot?: string
}): SigningRequest {
  return {
    account: {
      vm: 'svm',
      wallet: input.wallet,
      swigAccount: input.swigAccount,
    },
    authority: {
      kind: 'swigRole',
      roleId: 1,
      authority: { kind: 'secp256k1', address: input.authority },
    },
    scope: {
      vm: 'svm',
      action: 'spend',
      accounts: [{ chainId: input.chainId, address: input.wallet }],
      instructions: [],
      addressLookupTables: [],
      feePayer: { kind: 'role', role: 'relayer' },
      slotWindow: { from: '100', to: '200' },
    },
    chainIds: [input.chainId],
    purpose: 'originAuthorization',
    validity: [
      {
        kind: 'svmSlot',
        chainId: input.chainId,
        expiresAtSlot: input.expiresAtSlot ?? '200',
      },
    ],
    payload: {
      kind: 'personalSign',
      message: { encoding: 'utf8', value: input.message },
    },
  }
}

export function plan(chainId: string): QuotePlan {
  return {
    source: [{ vm: 'evm', chainId, account: accountView }],
    destination: { vm: 'evm', chainId, account: accountView },
    deployments: [],
  }
}

export function quote(
  input: {
    readonly intentId?: string
    readonly chainId?: number
    readonly settlementLayer?: OrchestratorExecutionQuote['settlementLayer']
    readonly signingRequests?: readonly SigningRequest[]
    readonly expiresAt?: number
    readonly cost?: OrchestratorExecutionQuote['cost']
  } = {},
): OrchestratorExecutionQuote {
  const chainId = input.chainId ?? 1
  const caip2 = `eip155:${chainId}`
  return {
    intentId: input.intentId ?? 'intent-1',
    purpose: 'execution',
    expiresAt: input.expiresAt ?? 4_000_000_000,
    estimatedFillTime: { seconds: 10 },
    settlementLayer: input.settlementLayer ?? 'SAME_CHAIN',
    plan: plan(caip2),
    cost: input.cost ?? emptyCost(),
    requirements: [],
    signingRequests: input.signingRequests ?? [eip712Request({ chainId })],
  }
}

export function emptyCost(): OrchestratorExecutionQuote['cost'] {
  return {
    input: [],
    output: [],
    fees: {
      total: { usd: 0 },
      breakdown: {
        gas: { usd: 0, sponsored: false },
        bridge: { usd: 0, sponsored: false },
        swap: { usd: 0, sponsored: false },
        app: { usd: 0, sponsored: false },
        protocol: { usd: 0, sponsored: false },
        sponsorSurcharge: { usd: 0, sponsored: false },
      },
    },
  }
}

export function costEntry(input: {
  readonly chainId: string
  readonly tokenAddress: string
  readonly amount: bigint
}) {
  return {
    chainId: input.chainId,
    tokenAddress: input.tokenAddress,
    symbol: null,
    decimals: null,
    price: null,
    amount: input.amount,
  }
}

export function publicQuote(
  value: OrchestratorExecutionQuote = quote(),
): Quote {
  return value as unknown as Quote
}

export function eip712Payload(request: SigningRequest): SigningPayload {
  return request.payload
}

export const zeroHex = '0x' as Hex

/**
 * A well-formed Swig authority-change route: one `manageAuthority` request by
 * the acting role, and a plan disclosing the same change, run by the state
 * account.
 */
export function authorityQuote(input: {
  readonly chainId: string
  readonly wallet: string
  readonly swigAccount: string
  readonly acting: SwigAuthority
  readonly disclosure: SolanaAuthorityDisclosure
  readonly payload: SigningPayload
  readonly roleId?: number
  readonly intentId?: string
  readonly expiresAt?: number
}): OrchestratorExecutionQuote {
  const request: SigningRequest = {
    account: {
      vm: 'svm',
      wallet: input.wallet,
      swigAccount: input.swigAccount,
    },
    authority: {
      kind: 'swigRole',
      roleId: input.roleId ?? 0,
      authority: input.acting,
    },
    scope: {
      vm: 'svm',
      action: 'manageAuthority',
      accounts: [{ chainId: input.chainId, address: input.swigAccount }],
      authority: input.disclosure,
      instructions: [],
      feePayer: { kind: 'role', role: 'relayer' },
      slotWindow: { from: '100', to: '200' },
    },
    chainIds: [input.chainId],
    purpose: 'originAuthorization',
    validity: [
      { kind: 'svmSlot', chainId: input.chainId, expiresAtSlot: '200' },
      { kind: 'timestamp', expiresAt: input.expiresAt ?? 2_000_000_000 },
    ],
    payload: input.payload,
  }
  return {
    intentId: input.intentId ?? 'authority-intent',
    purpose: 'execution',
    expiresAt: input.expiresAt ?? 2_000_000_000,
    estimatedFillTime: { seconds: 2 },
    settlementLayer: 'SAME_CHAIN',
    plan: {
      source: [],
      destination: {
        vm: 'svm',
        chainId: input.chainId,
        account: {
          wallet: input.wallet,
          swigAccount: input.swigAccount,
          authority: input.acting,
        },
        // As the wire sends it: the block, not the execution, names VM and chain.
        execution: {
          executedBy: { kind: 'account', address: input.swigAccount },
          authority: structuredClone(input.disclosure),
        } as unknown as NonNullable<QuotePlan['destination']['execution']>,
      },
      deployments: [],
    },
    cost: emptyCost(),
    requirements: [],
    signingRequests: [request],
  }
}
