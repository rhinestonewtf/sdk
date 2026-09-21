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
  prepared.intentInput.options?.sponsorSettings?.swapFees
void swapFees

// @ts-expect-error withdrawn from the prepared sponsorship contract
prepared.intentInput.options?.sponsorSettings?.swapValue
// @ts-expect-error withdrawn from serialized sponsorship inputs
input.options?.sponsorSettings?.swapValue
