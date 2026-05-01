import { describe, expect, it, vi } from 'vitest'
import { toRemoteWebAuthnAccount } from './remoteWebAuthn'

describe('toRemoteWebAuthnAccount', () => {
  const mockCredential = {
    id: '9IwX9n6cn-l9SzqFzfQXvDHRuTM',
    publicKey:
      '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1' as const,
  }

  const mockWebAuthnResponse = {
    webauthn: {
      authenticatorData:
        '0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d9763050000004d' as const,
      clientDataJSON:
        '{"type":"webauthn.get","challenge":"dGVzdA","origin":"https://example.com"}',
      challengeIndex: 23,
      typeIndex: 1,
      userVerificationRequired: false,
    },
    signature:
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const,
  }

  it('should create an account with the correct type', () => {
    const account = toRemoteWebAuthnAccount({
      credential: mockCredential,
      sign: vi.fn(),
      signTypedData: vi.fn(),
    })

    expect(account.type).toBe('webAuthn')
    expect(account.id).toBe(mockCredential.id)
    expect(account.publicKey).toBe(mockCredential.publicKey)
  })

  it('should delegate sign() to the provided callback', async () => {
    const signFn = vi.fn().mockResolvedValue(mockWebAuthnResponse)
    const account = toRemoteWebAuthnAccount({
      credential: mockCredential,
      sign: signFn,
      signTypedData: vi.fn(),
    })

    const hash =
      '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const
    const result = await account.sign({ hash })

    expect(signFn).toHaveBeenCalledWith({ hash })
    expect(result.signature).toBe(mockWebAuthnResponse.signature)
    expect(result.webauthn).toBe(mockWebAuthnResponse.webauthn)
  })

  it('should delegate signTypedData() to the provided callback', async () => {
    const signTypedDataFn = vi.fn().mockResolvedValue(mockWebAuthnResponse)
    const account = toRemoteWebAuthnAccount({
      credential: mockCredential,
      sign: vi.fn(),
      signTypedData: signTypedDataFn,
    })

    const typedData = {
      domain: { name: 'Test', chainId: 1 },
      types: { Test: [{ name: 'value', type: 'uint256' }] },
      primaryType: 'Test' as const,
      message: { value: 1n },
    }
    const result = await account.signTypedData(typedData)

    expect(signTypedDataFn).toHaveBeenCalledWith(typedData)
    expect(result.signature).toBe(mockWebAuthnResponse.signature)
    expect(result.webauthn).toBe(mockWebAuthnResponse.webauthn)
  })

  it('should throw on signMessage()', async () => {
    const account = toRemoteWebAuthnAccount({
      credential: mockCredential,
      sign: vi.fn(),
      signTypedData: vi.fn(),
    })

    await expect(account.signMessage({ message: 'hello' })).rejects.toThrow(
      'signMessage is not supported on remote WebAuthn accounts',
    )
  })
})
