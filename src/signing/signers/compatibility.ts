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
import { WalletClientNoConnectedAccountError } from '../../accounts/error'

export function walletClientToAccount(walletClient: WalletClient): Account {
  const address = walletClient.account?.address as Address | undefined
  if (!address) throw new WalletClientNoConnectedAccountError()
  return {
    address,
    signMessage: ({ message }: { message: SignableMessage }) =>
      walletClient.signMessage({ account: address, message }),
    signTypedData: <
      typedData extends TypedData | Record<string, unknown> = TypedData,
      primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
    >(
      parameters: HashTypedDataParameters<typedData, primaryType>,
    ): Promise<Hex> =>
      (walletClient as WalletClient).signTypedData({
        account: address,
        ...(parameters as unknown as TypedDataDefinition),
      } as never),
    signTransaction: (
      transaction: Parameters<NonNullable<Account['signTransaction']>>[0],
    ) =>
      walletClient.signTransaction({
        account: address,
        ...transaction,
      } as never),
    client: walletClient,
  } as unknown as Account
}

export function wrapParaAccount(account: Account, walletId?: string): Account {
  const para = account as Account & {
    walletId?: string
    _walletId?: string
    _paraWalletId?: string
  }
  const effectiveWalletId = walletId || para.walletId || para._walletId
  if (effectiveWalletId) para._paraWalletId = effectiveWalletId
  return {
    ...account,
    signMessage: async ({ message }: { message: SignableMessage }) => {
      if (!account.signMessage)
        throw new Error('Account does not support signMessage')
      return normalizeParaRecovery(await account.signMessage({ message }))
    },
    signTypedData: async <
      const typedData extends TypedData | Record<string, unknown>,
      primaryType extends keyof typedData | 'EIP712Domain' = keyof typedData,
    >(
      typedData: TypedDataDefinition<typedData, primaryType>,
    ) => {
      if (!account.signTypedData) {
        throw new Error('Account does not support signTypedData')
      }
      return normalizeParaRecovery(await account.signTypedData(typedData))
    },
    signAuthorization: account.signAuthorization
      ? account.signAuthorization.bind(account)
      : undefined,
    client: account.client,
  } as Account
}

function normalizeParaRecovery(signature: Hex): Hex {
  const value = signature.slice(2)
  const r = value.slice(0, 64)
  const s = value.slice(64, 128)
  const recovery = Number.parseInt(value.slice(128, 130), 16)
  const normalized = recovery < 27 ? recovery + 27 : recovery
  return `0x${r}${s}${normalized.toString(16).padStart(2, '0')}`
}
