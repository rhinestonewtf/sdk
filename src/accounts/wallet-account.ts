import type { Account, Address } from 'viem'
import { toAccount } from 'viem/accounts'

export function toViewOnlyAccount(address: Address): Account {
  const unsupported = async (): Promise<never> => {
    throw new Error('Signing is not supported for view-only accounts')
  }
  return toAccount({
    address,
    signMessage: unsupported,
    signTypedData: unsupported,
    signTransaction: unsupported,
  })
}
