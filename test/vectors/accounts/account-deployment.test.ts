import { keccak256, toHex } from 'viem'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { describe, expect, test } from 'vitest'
import { createAccountConstruction } from '../../../src/accounts/construction'
import { createAccountAdapter } from '../../../src/accounts/registry'
import {
  resolveAccountConfig,
  resolveSdkConfig,
} from '../../../src/config/resolve'
import { type RhinestoneAccountConfig, RhinestoneSDK } from '../../../src/index'
import { accountA, passkeyAccount } from '../../consts'
import vector from './account-deployment.json'

function passkey(tag: string) {
  return toWebAuthnAccount({
    credential: {
      id: tag,
      publicKey: `0x${keccak256(toHex(`x:${tag}`)).slice(2)}${keccak256(toHex(`y:${tag}`)).slice(2)}`,
    },
  })
}

const configurations: Record<string, () => RhinestoneAccountConfig> = {
  'safe-1.4.1-adapter-1': () => ({
    account: { type: 'safe', version: '1.4.1', adapter: '1.0.0' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'safe-1.4.1-adapter-2': () => ({
    account: { type: 'safe', version: '1.4.1', adapter: '2.0.0' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'nexus-1.2.0': () => ({
    account: { type: 'nexus', version: '1.2.0' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'kernel-3.3': () => ({
    account: { type: 'kernel', version: '3.3' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  startale: () => ({
    account: { type: 'startale' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  hca: () => ({
    account: { type: 'hca' },
    owners: { type: 'ens', owners: [{ account: accountA }] },
  }),
  // Regression guard: production passkey accounts install exactly one
  // credential, and their addresses must not move.
  'nexus-passkey-single': () => ({
    account: { type: 'nexus' },
    owners: { type: 'passkey', accounts: [passkeyAccount] },
  }),
  // Multi-passkey addresses come from the deterministic salt search.
  'nexus-passkey-multi': () => ({
    account: { type: 'nexus' },
    owners: {
      type: 'passkey',
      accounts: [passkey('vector:a'), passkey('vector:b')],
    },
  }),
}

describe('release account deployment vectors', () => {
  const sdk = new RhinestoneSDK({ apiKey: 'vector-only' })

  test.each(vector.cases)('$id', async (expected) => {
    const configuration = configurations[expected.id]
    if (!configuration) throw new Error(`Missing vector input ${expected.id}`)

    const account = await sdk.createAccount(configuration())
    const initData = account.getInitData()

    expect({
      address: account.getAddress(),
      factory: initData.factory,
      factoryDataHash: keccak256(initData.factoryData),
    }).toEqual({
      address: expected.address,
      factory: expected.factory,
      factoryDataHash: expected.factoryDataHash,
    })
  })
})

describe('rewritten account adapter deployment vectors', () => {
  const sdk = resolveSdkConfig({ apiKey: 'vector-only' })

  test.each(vector.cases)('$id', (expected) => {
    const configuration = configurations[expected.id]
    if (!configuration) throw new Error(`Missing vector input ${expected.id}`)
    const resolved = resolveAccountConfig(sdk, configuration())
    if (!resolved.owners) throw new Error(`Missing vector owner ${expected.id}`)
    const sessionModule =
      resolved.sessions.module.source === 'explicit'
        ? resolved.sessions.module.address
        : undefined
    const compatibilityFallback =
      resolved.sessions.compatibilityFallback.source === 'explicit'
        ? resolved.sessions.compatibilityFallback.address
        : undefined
    const construction = createAccountConstruction({
      material: {
        account: resolved.account,
        owner: resolved.owners,
        modules: resolved.modules,
        ...(resolved.initData ? { initData: resolved.initData } : {}),
        ...(resolved.eoa ? { eoa: resolved.eoa } : {}),
        sessions: {
          enabled: resolved.sessions.enabled,
          environment: resolved.sessions.environment,
          ...(sessionModule ? { module: sessionModule } : {}),
          ...(compatibilityFallback ? { compatibilityFallback } : {}),
        },
      },
      chain: { kind: 'evm', id: 1, caip2: 'eip155:1' },
      deployed: false,
    })
    const plan =
      createAccountAdapter(construction).getDeploymentPlan(construction)

    expect({
      address: plan.address,
      factory: plan.factory,
      factoryDataHash: plan.factoryData
        ? keccak256(plan.factoryData)
        : undefined,
    }).toEqual({
      address: expected.address,
      factory: expected.factory,
      factoryDataHash: expected.factoryDataHash,
    })
  })
})
