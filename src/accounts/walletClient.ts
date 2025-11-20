import type {
  Account,
  Address,
  HashTypedDataParameters,
  Hex,
  SignableMessage,
  TypedData,
  TypedDataDefinition,
  WalletClient,
} from 'viem'
import { WalletClientNoConnectedAccountError } from './error'

/**
 * Adapts a Viem/Wagmi WalletClient into an Account-like signer that the SDK can consume.
 * Ensures address is set and routes sign methods through the provided client.
 */
export function walletClientToAccount(walletClient: WalletClient): Account {
  const address = walletClient.account?.address as Address | undefined
  if (!address) {
    throw new WalletClientNoConnectedAccountError()
  }

  const account = {
    address,
    // EIP-191 message signing
    async signMessage({
      message,
    }: {
      message: Parameters<WalletClient['signMessage']>[0]['message']
    }): Promise<Hex> {
      return walletClient.signMessage({ account: address, message })
    },
    // EIP-712 typed data signing
    async signTypedData<
      typedData extends TypedData | Record<string, unknown> = TypedData,
      primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
    >(
      parameters: HashTypedDataParameters<typedData, primaryType>,
    ): Promise<Hex> {
      const def = parameters as unknown as TypedDataDefinition<
        typedData,
        primaryType
      >
      const signature = (walletClient as any).signTypedData({
        account: address,
        ...def,
      })
      return signature
    },
    // Raw transaction signing (not currently used by the SDK paths, but provided for completeness)
    async signTransaction(transaction: any): Promise<Hex> {
      return (walletClient as any).signTransaction({
        account: address,
        ...transaction,
      })
    },
    // Preserve reference to the wallet client
    // This can be helpful to e.g. get the client's transport
    client: walletClient,
  } as unknown as Account

  return account
}

/**
 * Wraps a Para viem account with custom signing for Rhinestone compatibility.
 *
 * Para's MPC signatures use 0/1 v-byte recovery, but Rhinestone/Smart wallets
 * expect 27/28 v-byte recovery. This wrapper adjusts Para signatures automatically.
 *
 * @param viemAccount - The Para viem account to wrap
 * @param walletId - Optional wallet ID for Para signing operations
 * @returns Account compatible with Rhinestone SDK
 *
 * @example
 * ```ts
 * const paraAccount = // ... Para viem account
 * const wrappedAccount = wrapParaAccount(paraAccount, wallet.id)
 *
 * const rhinestoneAccount = await rhinestone.createAccount({
 *   owners: {
 *     type: "ecdsa",
 *     accounts: [wrappedAccount],
 *   },
 * })
 *
 * // Also works for EIP-7702 (signAuthorization uses original 0/1 v-byte)
 * const authorization = await wrappedAccount.signAuthorization?.({ ... })
 * ```
 */
export function wrapParaAccount(
  viemAccount: Account,
  walletId?: string,
): Account {
  // Store the wallet ID for signing operations (for debugging purposes)
  const effectiveWalletId =
    walletId || (viemAccount as any).walletId || (viemAccount as any)._walletId

  // Store reference for potential debugging
  if (effectiveWalletId) {
    ;(viemAccount as any)._paraWalletId = effectiveWalletId
  }

  return {
    ...viemAccount,
    // Override signMessage to adjust v-byte for smart wallet compatibility
    signMessage: async ({ message }: { message: SignableMessage }) => {
      if (!viemAccount.signMessage) {
        throw new Error('Account does not support signMessage')
      }
      const originalSignature = await viemAccount.signMessage({ message })
      return adjustVByte(originalSignature)
    },
    // Override signTypedData to adjust v-byte for smart wallet compatibility
    signTypedData: async <
      const TTypedData extends TypedData | Record<string, unknown>,
      TPrimaryType extends keyof TTypedData | 'EIP712Domain' = keyof TTypedData,
    >(
      typedData: TypedDataDefinition<TTypedData, TPrimaryType>,
    ) => {
      if (!viemAccount.signTypedData) {
        throw new Error('Account does not support signTypedData')
      }
      const originalSignature = await viemAccount.signTypedData(typedData)
      return adjustVByte(originalSignature)
    },
    // Keep signAuthorization as is for EIP-7702
    signAuthorization: viemAccount.signAuthorization
      ? viemAccount.signAuthorization.bind(viemAccount)
      : undefined,
    // Preserve reference to the wallet client
    // This can be helpful to e.g. get the client's transport
    client: viemAccount.client,
  } as Account
}

/**
 * Adjusts the v-byte in a signature from Para's 0/1 format to Ethereum's 27/28 format.
 * @internal
 */
function adjustVByte(signature: string): Hex {
  const V_OFFSET_FOR_ETHEREUM = 27
  const cleanSig = signature.startsWith('0x') ? signature.slice(2) : signature
  const r = cleanSig.slice(0, 64)
  const s = cleanSig.slice(64, 128)
  let v = parseInt(cleanSig.slice(128, 130), 16)

  if (v < 27) {
    v += V_OFFSET_FOR_ETHEREUM
  }

  const adjustedSignature = `0x${r}${s}${v
    .toString(16)
    .padStart(2, '0')}` as Hex

  return adjustedSignature
}
