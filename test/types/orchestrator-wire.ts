import type {
  WireIntentRequest,
  WireIntentStatusResponse,
  WireProof,
  WireQuote,
  WireSigningRequest,
} from '../../src/clients/orchestrator/wire'
import type { operations } from '../../src/clients/orchestrator/wire.gen'

type Property<Member, Key extends PropertyKey> = Member extends {
  [PropertyName in Key]?: infer Value
}
  ? Value
  : never
type RouteAccount = WireQuote['plan']['source'][number]['account']
type DestinationExecution = NonNullable<
  NonNullable<WireIntentStatusResponse['details']>['executions']
>['destination']
type ChainOperation = Exclude<
  WireIntentStatusResponse['operations'][number]['items'][number],
  { type: 'EXECUTION' }
>
type Receipt = Property<
  NonNullable<Property<ChainOperation, 'allocation'>>,
  'receipt'
>
type QuoteErrorStatus = Exclude<
  keyof operations['createQuote']['responses'],
  200
>
type IntentErrorStatus = Exclude<
  keyof operations['createIntent']['responses'],
  201
>

const routePurposes: WireQuote['purpose'][] = ['execution', 'deployment']

const evmRouteAccount = {
  address: '0x0000000000000000000000000000000000000001',
  type: 'erc7579',
  deployed: false,
  implementation: { name: 'Nexus', version: 'v1.0.0' },
} satisfies RouteAccount
const svmRouteAccount = {
  wallet: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM',
  swigAccount: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  authority: {
    kind: 'secp256r1',
    publicKey: `0x02${'11'.repeat(32)}`,
  },
} satisfies RouteAccount
function routeAccountAddress(account: RouteAccount): string {
  return 'wallet' in account ? account.swigAccount : account.address
}
const evmRouteAddress = routeAccountAddress(evmRouteAccount)
const svmRouteAddress = routeAccountAddress(svmRouteAccount)

const eip712Payload = {
  kind: 'eip712',
  typedData: {
    domain: { chainId: 8453 },
    types: { Intent: [{ name: 'nonce', type: 'uint256' }] },
    primaryType: 'Intent',
    message: { nonce: '1' },
  },
  signatureFormat: 'account',
} satisfies Extract<WireSigningRequest['payload'], { kind: 'eip712' }>
const svmSlotValidity = {
  kind: 'svmSlot',
  chainId: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
  expiresAtSlot: '370123516',
} satisfies Extract<WireSigningRequest['validity'][number], { kind: 'svmSlot' }>
const eip7702Proof = {
  kind: 'eip7702',
  nonce: 3,
  signature: { r: '0x01', s: '0x02', yParity: 0 },
} satisfies Extract<WireProof, { kind: 'eip7702' }>
const webauthnProof = {
  kind: 'webauthn',
  assertion: {
    credentialId: 'credential',
    authenticatorData: '0x00',
    clientDataJSON: '{}',
    signature: '0x00',
  },
} satisfies Extract<WireIntentRequest['proofs'][number], { kind: 'webauthn' }>

const evmExecution = {
  vm: 'evm',
  chainId: 'eip155:8453',
  calls: [
    {
      to: '0x0000000000000000000000000000000000000001',
      value: '0',
      data: '0x',
    },
  ],
} satisfies Extract<DestinationExecution, { vm: 'evm' }>
const noDestinationExecution: Extract<DestinationExecution, null> = null
const evmReceipt = {
  vm: 'evm',
  blockHash: null,
  blockNumber: '1',
  gasUsed: null,
  effectiveGasPriceWei: null,
  l1FeeWei: null,
  blobFeeWei: null,
} satisfies Extract<Receipt, { vm: 'evm' }>
const svmReceipt = {
  vm: 'svm',
  slot: '299123456',
} satisfies Extract<Receipt, { vm: 'svm' }>
const noReceipt: Extract<Receipt, null> = null

const quoteErrorStatuses: QuoteErrorStatus[] = [400, 403, 422, 500]
const intentErrorStatuses: IntentErrorStatus[] = [
  400, 403, 404, 409, 422, 500, 503,
]

void routePurposes
void evmRouteAccount
void svmRouteAccount
void evmRouteAddress
void svmRouteAddress
void eip712Payload
void svmSlotValidity
void eip7702Proof
void webauthnProof
void evmExecution
void noDestinationExecution
void evmReceipt
void svmReceipt
void noReceipt
void quoteErrorStatuses
void intentErrorStatuses
