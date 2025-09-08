import type {
  Account,
  Address,
  HashTypedDataParameters,
  Hex,
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
      return (walletClient as any).signTypedData({
        account: address,
        ...def,
      })
    },
    // Raw transaction signing (not currently used by the SDK paths, but provided for completeness)
    async signTransaction(transaction: any): Promise<Hex> {
      return (walletClient as any).signTransaction({
        account: address,
        ...transaction,
      })
    },
  } as unknown as Account

  return account
}
