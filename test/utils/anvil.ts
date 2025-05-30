import { createServer } from 'prool'
import { anvil } from 'prool/instances'
import {
  Account,
  Chain,
  createClient,
  http,
  publicActions,
  walletActions,
} from 'viem'

const PORT = 8545
const POOL_ID = 1

function getAnvil(chain: Chain, forkUrl: string) {
  const server = createServer({
    instance: anvil({
      chainId: chain.id,
      forkUrl,
    }),
    port: PORT,
    limit: 1,
  })

  const rpcUrl = `http://127.0.0.1:${PORT}/${POOL_ID}`

  return {
    getPublicClient() {
      return createClient({
        chain,
        transport: http(rpcUrl),
      }).extend(publicActions)
    },
    getWalletClient(account: Account) {
      return createClient({
        chain,
        account,
        transport: http(rpcUrl),
      }).extend(walletActions)
    },
    async start() {
      await server.start()
    },
  }
}

export { getAnvil }
