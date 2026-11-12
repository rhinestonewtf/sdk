import {
  type Hex,
  hashMessage,
  hashTypedData,
  type LocalAccount,
  type SignableMessage,
  type TypedDataDefinition,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import { hashAuthorization } from 'viem/utils'
import { currentContext, nextSeq, type SignerRecord } from './context'
import { toPlain } from './serialize'

type SignerMethod = SignerRecord['method']

function digestOf(method: SignerMethod, payload: any): Hex | undefined {
  try {
    switch (method) {
      case 'sign':
        return payload?.hash
      case 'signMessage':
        return hashMessage(payload.message as SignableMessage)
      case 'signTypedData':
        return hashTypedData(payload as TypedDataDefinition)
      case 'signAuthorization':
        return hashAuthorization({
          ...payload,
          address: payload.contractAddress ?? payload.address,
        })
    }
  } catch {
    return undefined
  }
}

function record(
  label: string,
  method: SignerMethod,
  payload: unknown,
  output: unknown,
) {
  const ctx = currentContext()
  if (!ctx) return
  ctx.records.signer.push({
    seq: nextSeq(ctx),
    step: ctx.step,
    signer: label,
    method,
    payload: toPlain(payload),
    digest: digestOf(method, payload)?.toLowerCase(),
    output: toPlain(output),
  })
}

function wrap<T extends (...args: any[]) => Promise<unknown>>(
  label: string,
  method: SignerMethod,
  fn: T | undefined,
): T | undefined {
  if (!fn) return undefined
  return (async (...args: unknown[]) => {
    const output = await fn(...args)
    record(label, method, args[0], output)
    return output
  }) as T
}

// Records every payload handed to the signer and returns the real result.
function recordingAccount<T extends LocalAccount | WebAuthnAccount>(
  account: T,
  label: string,
): T {
  const methods: SignerMethod[] = [
    'sign',
    'signMessage',
    'signTypedData',
    'signAuthorization',
  ]
  const wrapped: Record<string, unknown> = { ...account }
  for (const method of methods) {
    const fn = (account as Record<string, any>)[method]
    if (typeof fn === 'function') {
      wrapped[method] = wrap(label, method, fn.bind(account))
    }
  }
  return wrapped as T
}

export { recordingAccount }
