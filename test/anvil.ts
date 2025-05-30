import { createServer } from 'prool'
import { anvil } from 'prool/instances'

function getAnvil(chainId: number) {
  const server = createServer({
    instance: anvil({
      chainId: chainId,
    }),
  })

  return server
}

export { getAnvil }
