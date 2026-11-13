import { keccak256 } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { als, createRunContext, type SignerRecord } from '../context'
import { fixturePasskey } from '../funded/fixtures'
import { recordingAccount } from '../signers'
import {
  createTemplater,
  roleKeysFor,
  signerIdentities,
  templateIdentities,
  templateSignatures,
} from './signatures'

const VALIDATOR = '0x000000000013fdb5234e4e3162a810f54d9f7e98'

function typedData(nonce: bigint, chainId = 84532) {
  return {
    domain: { name: 'Test', version: '1', chainId },
    types: { Op: [{ name: 'nonce', type: 'uint256' }] },
    primaryType: 'Op' as const,
    message: { nonce },
  }
}

async function signWrapped(nonce: bigint, prefix = VALIDATOR) {
  const ctx = createRunContext({
    role: 'baseline',
    submitMode: 'capture',
    fault: undefined,
    origins: [],
  })
  const account = recordingAccount(
    privateKeyToAccount(generatePrivateKey()),
    'owner',
  )
  const signature = await als.run(ctx, () =>
    account.signTypedData(typedData(nonce)),
  )
  const blob = `${prefix}${signature.slice(2)}`
  const templater = createTemplater(ctx.records.signer)
  return { blob, templater, records: ctx.records.signer }
}

describe('signature templating', () => {
  test('templates are stable across keys, signatures and digests', async () => {
    const first = await signWrapped(1n)
    const second = await signWrapped(2n)
    expect(first.blob).not.toBe(second.blob)
    const template = first.templater.template(first.blob)
    expect(template).toBe(`${VALIDATOR}<sig:Op@84532#0>`)
    expect(second.templater.template(second.blob)).toBe(template)
  })

  test('a changed prefix stays visible', async () => {
    const { blob, templater } = await signWrapped(1n, '0x01')
    expect(templater.template(blob)).toBe('0x01<sig:Op@84532#0>')
  })

  test('r and s are replaced when a build re-encodes v', async () => {
    const { records, templater } = await signWrapped(1n)
    const signature = records[0].output as string
    const reencoded = `${signature.slice(0, 130)}01`
    expect(templater.template(reencoded)).toBe(
      '0x<sig:Op@84532#0.r><sig:Op@84532#0.s>01',
    )
  })

  test('an eth_sign v shift is templated, whatever the recovery bit', async () => {
    for (const nonce of [1n, 2n, 3n, 4n]) {
      const { records, templater } = await signWrapped(nonce)
      const signature = records[0].output as string
      const v = Number.parseInt(signature.slice(130), 16)
      const shifted = `${signature.slice(0, 130)}${(v + 4).toString(16)}`
      expect(templater.template(shifted)).toBe(
        '0x<sig:Op@84532#0.r><sig:Op@84532#0.s><sig:Op@84532#0.v+4>',
      )
    }
  })

  test('raw hashes handed to signMessage are replaced', async () => {
    const ctx = createRunContext({
      role: 'baseline',
      submitMode: 'capture',
      fault: undefined,
      origins: [],
    })
    const account = recordingAccount(
      privateKeyToAccount(generatePrivateKey()),
      'owner',
    )
    const raw = keccak256('0x01')
    await als.run(ctx, () => account.signMessage({ message: { raw } }))
    const templater = createTemplater(ctx.records.signer)
    expect(templater.template(raw)).toBe('0x<raw:signMessage#0>')
  })

  test('digests are replaced', async () => {
    const { records, templater } = await signWrapped(1n)
    expect(templater.template(records[0].digest as string)).toBe(
      '0x<digest:Op@84532#0>',
    )
  })

  test('role keys derive from content, counting repeats', () => {
    const record = (primaryType: string, chainId: number): SignerRecord => ({
      seq: 0,
      step: undefined,
      signer: 'a',
      method: 'signTypedData',
      payload: { primaryType, domain: { chainId } },
      digest: undefined,
      output: '0x',
    })
    const records = [record('Op', 1), record('Op', 2), record('Op', 1)]
    expect([...roleKeysFor(records).values()]).toEqual([
      'Op@1#0',
      'Op@2#0',
      'Op@1#1',
    ])
  })

  test('templateSignatures reports byte lengths per role', async () => {
    const { blob, templater } = await signWrapped(1n)
    expect(templateSignatures({ origin: [blob] }, templater)).toEqual({
      origin: [{ byteLength: 85, template: `${VALIDATOR}<sig:Op@84532#0>` }],
    })
  })
})

describe('identity templating', () => {
  const account = '0x1111111111111111111111111111111111111111'
  const salt = `0x${'ab'.repeat(32)}`

  test('replaces identities in values, keys and partly templated strings', () => {
    const identities = [
      { label: 'account', value: account },
      { label: 'salt', value: salt },
    ]
    const value = {
      address: account.toUpperCase().replace('0X', '0x'),
      [account]: { data: `0xea6d${salt.slice(2)}00<sig:Op@1#0>` },
      note: `not hex ${account}`,
    }
    expect(templateIdentities(value, identities)).toEqual({
      address: '0x<id:account>',
      '0x<id:account>': { data: '0xea6d<id:salt>00<sig:Op@1#0>' },
      note: `not hex ${account}`,
    })
  })

  test('a changed byte next to an identity still shows', () => {
    const identities = [{ label: 'account', value: account }]
    const a = templateIdentities(`0x00${account.slice(2)}`, identities)
    const b = templateIdentities(`0x01${account.slice(2)}`, identities)
    expect(a).not.toEqual(b)
  })

  test("a fresh signer's signatures and recovery bits become identities", async () => {
    const ctx = createRunContext({
      role: 'baseline',
      submitMode: 'capture',
      fault: undefined,
      origins: [],
    })
    const key = privateKeyToAccount(generatePrivateKey())
    const signer = recordingAccount(key, 'eoa')
    const authorization = await als.run(ctx, () =>
      signer.signAuthorization!({
        chainId: 1,
        contractAddress: account,
        nonce: 0,
      }),
    )
    const declared = [
      { label: 'eoa', value: key.address.toLowerCase(), signer: true as const },
    ]
    const identities = [
      ...declared,
      ...signerIdentities(declared, ctx.records.signer),
    ]
    expect(
      templateIdentities(
        {
          r: authorization.r,
          s: authorization.s,
          yParity: authorization.yParity,
          v: '27n',
        },
        identities,
      ),
    ).toEqual({
      r: '0x<id:eoa.sig#0.r>',
      s: '0x<id:eoa.sig#0.s>',
      yParity: '<id:recovery>',
      v: '<id:recovery>',
    })
    // A fixed signer's recovery bit stays compared.
    expect(
      templateIdentities({ r: '0x01', s: '0x02', v: 27 }, identities),
    ).toEqual({ r: '0x01', s: '0x02', v: 27 })
  })
})

describe('WebAuthn templating', () => {
  test('the challenge in clientDataJSON is templated; the rest stays exact', async () => {
    const ctx = createRunContext({
      role: 'baseline',
      submitMode: 'capture',
      fault: undefined,
      origins: [],
    })
    const hash = keccak256('0x01')
    const { webauthn } = await als.run(ctx, () =>
      fixturePasskey().sign({ hash }),
    )
    const templater = createTemplater(ctx.records.signer)
    const json = Buffer.from(webauthn.clientDataJSON, 'utf8').toString('hex')
    const templated = templater.template(`0x${json}`)
    expect(templated).toContain('<challenge:sign#0>')
    expect(templated).toContain(
      Buffer.from('"origin":"https://parity.rhinestone.test"').toString('hex'),
    )
  })
})
