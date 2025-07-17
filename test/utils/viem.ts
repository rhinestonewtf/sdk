import {
  type Account,
  createPublicClient,
  createWalletClient,
  type GetBalanceParameters,
  type GetCodeParameters,
  type GetStorageAtParameters,
  type ReadContractParameters,
  type SendTransactionParameters,
  type WaitForTransactionReceiptParameters,
} from 'viem'
import { vi } from 'vitest'

async function setupViemMock(anvil: any, funderAccount: Account) {
  vi.mock('viem', async (importOriginal) => {
    const actual = await importOriginal()

    return {
      // @ts-ignore
      ...actual,
      createPublicClient: vi.fn(),
      createWalletClient: vi.fn(),
      createTestClient: vi.fn(),
    }
  })
  const publicClientMock = createPublicClient as any
  publicClientMock.mockImplementation((_: any) => {
    return {
      getCode: (params: GetCodeParameters) => {
        const client = anvil.getPublicClient()
        return client.getCode(params)
      },
      getBalance: (params: GetBalanceParameters) => {
        const client = anvil.getPublicClient()
        return client.getBalance(params)
      },
      getStorageAt: (params: GetStorageAtParameters) => {
        const client = anvil.getPublicClient()
        return client.getStorageAt(params)
      },
      readContract: (params: ReadContractParameters) => {
        const client = anvil.getPublicClient()
        return client.readContract(params)
      },
      waitForTransactionReceipt: async (
        params: WaitForTransactionReceiptParameters,
      ) => {
        const client = anvil.getPublicClient()
        const receipt = await client.waitForTransactionReceipt(params)
        return receipt
      },
    }
  })

  const walletClient = createWalletClient as any
  walletClient.mockImplementation((_: any) => {
    return {
      sendTransaction: (params: SendTransactionParameters) => {
        const client = anvil.getWalletClient(funderAccount)
        return client.sendTransaction(params)
      },
    }
  })
}

export { setupViemMock }
