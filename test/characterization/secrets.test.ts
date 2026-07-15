import { describe, expect, it } from 'vitest'
import { assertNoSecrets, SecretScanError, scanForSecrets } from './secrets'

describe('characterization secret scan', () => {
  it('finds sensitive fields recursively without reporting their values', () => {
    const privateKey = `0x${'ab'.repeat(32)}`
    const findings = scanForSecrets({
      auth: {
        headers: { 'x-api-key': 'project-secret' },
        signer: { privateKey },
      },
    })

    expect(findings).toEqual([
      {
        kind: 'api-key',
        path: '/auth/headers/x-api-key',
        message: 'sensitive field "x-api-key"',
      },
      {
        kind: 'private-key',
        path: '/auth/signer/privateKey',
        message: 'sensitive field "privateKey"',
      },
    ])
    expect(JSON.stringify(findings)).not.toContain(privateKey)
  })

  it('finds JWTs, authentication values, credential URLs, and wallet keystores', () => {
    const findings = scanForSecrets({
      log: 'request used Bearer opaque-credential',
      response: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      endpoint: 'https://user:password@example.com/rpc',
      wallet: {
        crypto: {
          cipher: 'aes-128-ctr',
          ciphertext: 'deadbeef',
          kdf: 'scrypt',
          mac: 'bead',
        },
      },
    })

    expect(findings.map(({ kind, path }) => ({ kind, path }))).toEqual([
      { kind: 'credential-url', path: '/endpoint' },
      { kind: 'auth-header', path: '/log' },
      { kind: 'jwt', path: '/response' },
      { kind: 'wallet-payload', path: '/wallet/crypto' },
    ])
  })

  it('does not confuse public chain artifacts with private keys', () => {
    expect(
      scanForSecrets({
        artifacts: {
          authorizations: [
            {
              chainId: 1,
              address: '0x0000000000000000000000000000000000000001',
              nonce: 0,
              signature: `0x${'34'.repeat(65)}`,
            },
          ],
        },
        transactionHash: `0x${'12'.repeat(32)}`,
        token: '0x0000000000000000000000000000000000000001',
      }),
    ).toEqual([])
  })

  it('rejects Authorization headers while allowing protocol authorizations', () => {
    expect(scanForSecrets({ authorization: { chainId: 1, nonce: 0 } })).toEqual(
      [],
    )
    expect(
      scanForSecrets({
        headers: { authorization: 'protocol-value-without-bearer-prefix' },
      }).map(({ kind, path }) => ({ kind, path })),
    ).toEqual([{ kind: 'auth-header', path: '/headers/authorization' }])
  })

  it('throws a typed error containing paths but not credentials', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature'

    try {
      assertNoSecrets({ nested: { jwt } })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(SecretScanError)
      expect(String(error)).toContain('jwt at /nested/jwt')
      expect(String(error)).not.toContain(jwt)
    }
  })
})
