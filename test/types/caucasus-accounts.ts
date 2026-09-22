import type { OrchestratorSvmAccount } from '../../src/clients/orchestrator/types'
import type { operations } from '../../src/clients/orchestrator/wire.gen'
import type {
  IntentAccountSummary,
  IntentAccountView,
  IntentOpStatus,
  QuotePlan,
  SigningRequest,
} from '../../src/index'

type JsonResponse<
  Operation extends keyof operations,
  Status extends number = 200,
> = NonNullable<
  operations[Operation]['responses'] extends Record<Status, infer Ok>
    ? Ok extends { content: { 'application/json': infer Body } }
      ? Body
      : never
    : never
>

type WireIntent = JsonResponse<'getIntent'>
type WireIntentAccount = NonNullable<WireIntent['accounts']>[number]['account']
type WireDeploymentAccount = NonNullable<
  NonNullable<WireIntent['details']>['deployments']
>[number]['account']
type WireListItem = JsonResponse<'listIntents'>['data'][number]
type WireListAccount = NonNullable<WireListItem['accounts']>[number]['account']
type WireQuote = Extract<
  JsonResponse<'createQuote'>,
  { status: 'quoted' }
>['routes'][number]
type WireSourceAccount = WireQuote['plan']['source'][number]['account']
type WireDestinationAccount = WireQuote['plan']['destination']['account']
type WirePlanDeploymentAccount =
  WireQuote['plan']['deployments'][number]['account']
type WireRequirementAccount = WireQuote['requirements'][number]['account']

const wallet = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
const swigAccount = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const chainId = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp'
const address = '0x0000000000000000000000000000000000000001'
const publicKey = `0x02${'11'.repeat(32)}` as const

const withoutAuthority = { wallet, swigAccount } as const
const withEcdsa = {
  wallet,
  swigAccount,
  authority: { kind: 'secp256k1', address },
} as const
const withPasskey = {
  wallet,
  swigAccount,
  authority: { kind: 'secp256r1', publicKey },
} as const

withoutAuthority satisfies IntentAccountView
withEcdsa satisfies IntentAccountView
withPasskey satisfies IntentAccountView

const summaries = [withoutAuthority, withEcdsa, withPasskey].map((account) => ({
  vm: 'svm' as const,
  chainId,
  account,
})) satisfies IntentAccountSummary[]

const status = {
  traceId: 'trace-1',
  purpose: 'execution',
  status: 'PENDING',
  accounts: summaries,
  operations: [],
  details: {
    nonce: '1',
    createdAt: 1,
    latencyMs: 1,
    settlementLayer: 'SAME_CHAIN',
    source: [],
    destination: {
      chainId,
      tokens: [],
      status: 'PENDING',
    },
    deployments: summaries,
    cost: { sponsored: false },
  },
} satisfies IntentOpStatus

const plan = {
  source: summaries.map(({ account }) => ({
    vm: 'svm' as const,
    chainId,
    account,
  })),
  destination: { vm: 'svm', chainId, account: withoutAuthority },
  deployments: [{ vm: 'svm', chainId, account: withPasskey }],
} satisfies QuotePlan

const wireIntentAccounts: WireIntentAccount[] = [
  withoutAuthority,
  withEcdsa,
  withPasskey,
]
const wireDeploymentAccounts: WireDeploymentAccount[] = [
  withoutAuthority,
  withEcdsa,
  withPasskey,
]
const wireListAccounts: WireListAccount[] = [
  withoutAuthority,
  withEcdsa,
  withPasskey,
]
const wireSourceAccounts: WireSourceAccount[] = [
  withoutAuthority,
  withEcdsa,
  withPasskey,
]
const wireDestinationAccounts: WireDestinationAccount[] = [
  withoutAuthority,
  withEcdsa,
  withPasskey,
]
const wirePlanDeploymentAccounts: WirePlanDeploymentAccount[] = [
  withoutAuthority,
  withEcdsa,
  withPasskey,
]
const wireRequirementAccounts: WireRequirementAccount[] = [
  withoutAuthority,
  withEcdsa,
  withPasskey,
]

function recordedAuthority(account: IntentAccountView): string | undefined {
  if (!('swigAccount' in account)) return undefined
  // @ts-expect-error callers must handle unavailable authority evidence
  account.authority.kind
  if (!account.authority) return undefined
  return account.authority.kind === 'secp256k1'
    ? account.authority.address
    : account.authority.publicKey
}

const missingEcdsaAddress: IntentAccountView = {
  wallet,
  swigAccount,
  // @ts-expect-error a present secp256k1 authority requires its address
  authority: { kind: 'secp256k1' },
}
const missingPasskeyPublicKey: IntentAccountView = {
  wallet,
  swigAccount,
  // @ts-expect-error a present secp256r1 authority requires its public key
  authority: { kind: 'secp256r1' },
}
const nullAuthority: IntentAccountView = {
  wallet,
  swigAccount,
  // @ts-expect-error absent authority is represented by omission, not null
  authority: null,
}

type SwigRoleAuthority = Extract<
  SigningRequest['authority'],
  { kind: 'swigRole' }
>
// @ts-expect-error signing requests must identify the selected role's authority
const missingSigningAuthority: SwigRoleAuthority = {
  kind: 'swigRole',
  roleId: 1,
}
// @ts-expect-error callers must still provide the Swig authorization they expect
const missingCallerAuthorization: OrchestratorSvmAccount = {
  type: 'swig',
  address: wallet,
  swigAccount,
}

void status
void plan
void wireIntentAccounts
void wireDeploymentAccounts
void wireListAccounts
void wireSourceAccounts
void wireDestinationAccounts
void wirePlanDeploymentAccounts
void wireRequirementAccounts
void recordedAuthority
void missingEcdsaAddress
void missingPasskeyPublicKey
void nullAuthority
void missingSigningAuthority
void missingCallerAuthorization
