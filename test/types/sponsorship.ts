import type {
  PreparedTransactionData,
  SerializedIntentInput,
  Transaction,
} from '../../src/index'

type Sponsorship = Exclude<NonNullable<Transaction['sponsored']>, boolean>

const supported = {
  gas: true,
  bridging: false,
  swaps: true,
} satisfies Sponsorship
void supported

const withdrawn = {
  gas: true,
  bridging: false,
  swaps: true,
  // @ts-expect-error swap sponsorship uses swaps, not a separate swapValue category
  swapValue: true,
} satisfies Sponsorship
void withdrawn

declare const prepared: PreparedTransactionData
declare const input: SerializedIntentInput

const swapFees: boolean | undefined =
  prepared.intentInput.options?.sponsorship?.swapFees
void swapFees

// @ts-expect-error withdrawn from the prepared sponsorship contract
prepared.intentInput.options?.sponsorship?.swapValue
// @ts-expect-error withdrawn from serialized sponsorship inputs
input.options?.sponsorship?.swapValue

// Solana inputs name the paying Swig; EVM inputs have no `svm` entry.
const swig = prepared.intentInput.account.svm
if (swig) {
  const wallet: string = swig.address
  const stateAccount: string | undefined = swig.swigAccount
  const authority: 'secp256k1' | 'secp256r1' = swig.authorization.kind
  const installed: `0x${string}` | undefined = swig.initData?.id
  const reservation: `0x${string}` | undefined = swig.initData?.reservation
  void [wallet, stateAccount, authority, installed, reservation]
  // @ts-expect-error the Swig entry is always a Swig
  swig.type = 'erc7579'
}
// A Swig creation carries its id or its reservation, never both. A Swig paired
// with the account's EVM entry carries neither: the orchestrator derives its id.
const root = { kind: 'secp256k1', publicKey: '0x02' } as const
type SwigCreation = NonNullable<NonNullable<typeof swig>['initData']>
const creations: SwigCreation[] = [
  { authority: root, id: '0x01' },
  { authority: root, reservation: '0x01' },
  { authority: root },
]
void creations
// @ts-expect-error the wire refuses `reservation` beside `id`
const both: SwigCreation = { authority: root, id: '0x01', reservation: '0x01' }
void both
// @ts-expect-error `svm` is optional
const required: NonNullable<typeof swig> = prepared.intentInput.account.svm
void required
