import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vitest'
import { als, createRunContext, type SignerRecord } from '../context'
import { recordingAccount } from '../signers'
import { createTemplater, roleKeysFor, templateSignatures } from './signatures'

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
    buildId: 'published',
    role: 'baseline',
    scenarioId: 'test',
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
    const reencoded = `${signature.slice(0, 130)}1f`
    expect(templater.template(reencoded)).toBe(
      '0x<sig:Op@84532#0.r><sig:Op@84532#0.s>1f',
    )
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
