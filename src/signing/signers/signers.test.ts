import type { Account, Hex, WalletClient } from 'viem'
import { describe, expect, test, vi } from 'vitest'
import { WalletClientNoConnectedAccountError } from '../../accounts/error'
import { walletClientToAccount, wrapParaAccount } from './compatibility'
import { normalizeRecovery } from './ecdsa'
import { createSignerInvocationPort } from './registry'
import { selectSignerChain } from './wallet-chain'

const chain = { kind: 'evm' as const, id: 1, caip2: 'eip155:1' as const }
const address = '0x1111111111111111111111111111111111111111'
const signature = `0x${'22'.repeat(64)}00` as Hex
const typedData = {
  domain: { name: 'Test', version: '1', chainId: 1 },
  types: { Test: [{ name: 'value', type: 'uint256' }] },
  primaryType: 'Test',
  message: { value: 1n },
} as const

describe('signer adapters', () => {
  test('invokes ECDSA methods with their exact public inputs', async () => {
    const signMessage = vi.fn(async () => signature)
    const signTypedData = vi.fn(async () => signature)
    const account = {
      address,
      signMessage,
      signTypedData,
    } as unknown as Account
    const port = createSignerInvocationPort({
      signers: { owner: { kind: 'ecdsa', account } },
    })
    await expect(
      port.invoke(
        { id: 'owner', kind: 'ecdsa' },
        { kind: 'ecdsa-sign-message', message: { raw: '0x1234' } },
      ),
    ).resolves.toEqual({
      kind: 'ecdsa-signature',
      signature: `0x${'22'.repeat(64)}1b`,
    })
    await port.invoke(
      { id: 'owner', kind: 'ecdsa' },
      { kind: 'ecdsa-sign-typed-data', typedData },
    )
    expect(signMessage).toHaveBeenCalledWith({ message: { raw: '0x1234' } })
    expect(signTypedData).toHaveBeenCalledWith(typedData)
    expect(port.has?.({ id: 'owner', kind: 'ecdsa' })).toBe(true)
    expect(port.has?.({ id: 'owner', kind: 'webauthn' })).toBe(false)
  })

  test('keeps WebAuthn hash and typed-data calls distinct', async () => {
    const result = {
      signature: `0x${'33'.repeat(64)}` as Hex,
      webauthn: {
        authenticatorData: '0x1234' as Hex,
        clientDataJSON: '{}',
        challengeIndex: 2,
        typeIndex: 1,
        userVerificationRequired: true,
      },
    }
    const sign = vi.fn(async () => result)
    const signTypedData = vi.fn(async () => result)
    const port = createSignerInvocationPort({
      signers: {
        passkey: {
          kind: 'webauthn',
          account: { type: 'webAuthn', sign, signTypedData } as never,
        },
      },
    })
    const hashResult = await port.invoke(
      { id: 'passkey', kind: 'webauthn' },
      { kind: 'webauthn-sign-hash', hash: '0x1234' },
    )
    await port.invoke(
      { id: 'passkey', kind: 'webauthn' },
      { kind: 'webauthn-sign-typed-data', typedData },
    )
    expect(sign).toHaveBeenCalledWith({ hash: '0x1234' })
    expect(signTypedData).toHaveBeenCalledWith(typedData)
    expect(hashResult).toMatchObject({
      kind: 'webauthn-assertion',
      challengeIndex: 2,
      userVerificationRequired: true,
    })
  })

  test('returns structured authorizations without validator encoding', async () => {
    const authorization = {
      address,
      chainId: 1,
      nonce: 0,
      r: `0x${'11'.repeat(32)}` as Hex,
      s: `0x${'22'.repeat(32)}` as Hex,
      yParity: 0,
    }
    const signAuthorization = vi.fn(async () => authorization)
    const port = createSignerInvocationPort({
      signers: {
        wallet: {
          kind: 'wallet-authorization',
          account: { address, signAuthorization } as unknown as Account,
        },
      },
    })
    await expect(
      port.invoke(
        { id: 'wallet', kind: 'wallet-authorization' },
        {
          kind: 'sign-authorization',
          chain,
          authorization: { contractAddress: address, chainId: 1, nonce: 0 },
        },
      ),
    ).resolves.toEqual({ kind: 'signed-authorization', authorization })
  })

  test('rejects missing, mismatched, and unsupported signer methods', async () => {
    const port = createSignerInvocationPort({
      signers: { owner: { kind: 'ecdsa', account: { address } as Account } },
    })
    await expect(
      port.invoke(
        { id: 'missing', kind: 'ecdsa' },
        { kind: 'ecdsa-sign-message', message: { raw: '0x12' } },
      ),
    ).rejects.toThrow('not registered')
    await expect(
      port.invoke(
        { id: 'owner', kind: 'webauthn' },
        { kind: 'webauthn-sign-hash', hash: '0x12' },
      ),
    ).rejects.toThrow('expected')
    await expect(
      port.invoke(
        { id: 'owner', kind: 'ecdsa' },
        { kind: 'ecdsa-sign-message', message: { raw: '0x12' } },
      ),
    ).rejects.toThrow('signMessage')
  })

  test('switches a transport-backed signer before invoking it', async () => {
    const request = vi.fn(async () => null)
    const account = {
      address,
      client: { transport: { request } },
    } as unknown as Account
    await selectSignerChain({
      account,
      chain,
      resolveChain: () => ({
        id: 1,
        name: 'Test',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: ['http://localhost'] } },
      }),
    })
    expect(request).toHaveBeenCalledWith(
      {
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: '0x1' }],
      },
      undefined,
    )
  })

  test('preserves wallet-client and Para compatibility behavior', async () => {
    expect(() => walletClientToAccount({} as WalletClient)).toThrow(
      WalletClientNoConnectedAccountError,
    )
    expect(() =>
      walletClientToAccount({ account: undefined } as WalletClient),
    ).toThrow('missing a default account')
    const wallet = {
      account: { address },
      signMessage: vi.fn(async () => signature),
      signTypedData: vi.fn(async () => signature),
      signTransaction: vi.fn(async () => '0x1234' as Hex),
    } as unknown as WalletClient
    const adapted = walletClientToAccount(wallet)
    await adapted.signMessage?.({ message: 'hello' })
    await adapted.signTypedData?.(typedData)
    expect(adapted.client).toBe(wallet)

    const signAuthorization = vi.fn()
    const para = wrapParaAccount(
      {
        address,
        signMessage: async () => signature,
        signTypedData: async () => signature,
        signAuthorization,
        client: wallet,
      } as unknown as Account,
      'wallet-id',
    )
    await expect(para.signMessage?.({ message: 'hello' })).resolves.toBe(
      `0x${'22'.repeat(64)}1b`,
    )
    await expect(para.signTypedData?.(typedData)).resolves.toBe(
      `0x${'22'.repeat(64)}1b`,
    )
    expect(para.signAuthorization).toBeDefined()
    expect(normalizeRecovery(`0x${'22'.repeat(64)}1b`)).toBe(
      `0x${'22'.repeat(64)}1b`,
    )
    expect(normalizeRecovery('0x12')).toBe('0x12')
  })
})
