import { describe, expect, it } from 'vitest'

import { wrapParaAccount } from './walletClient'

const createSignature = (v: string) =>
  `0x${'11'.repeat(32)}${'22'.repeat(32)}${v}` as const

describe('wrapParaAccount', () => {
  it('adjusts Para message signatures with 0/1 v-byte', async () => {
    const account = wrapParaAccount({
      address: '0x0000000000000000000000000000000000000001',
      signMessage: async () => createSignature('01'),
      type: 'local',
    } as any)

    await expect(account.signMessage({ message: 'hello' })).resolves.toBe(
      createSignature('1c'),
    )
  })

  it('rejects malformed Para message signatures', async () => {
    const account = wrapParaAccount({
      address: '0x0000000000000000000000000000000000000001',
      signMessage: async () => `${'11'.repeat(32)}${'22'.repeat(32)}zz`,
      type: 'local',
    } as any)

    await expect(account.signMessage({ message: 'hello' })).rejects.toThrow(
      'Invalid signature',
    )
  })
})
