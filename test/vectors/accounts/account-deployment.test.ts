import { keccak256 } from 'viem'
import { describe, expect, test } from 'vitest'
import { createAccountAdapter } from '../../../src/accounts/registry'
import type { AccountConstruction } from '../../../src/accounts/types'
import {
  resolveAccountConfig,
  resolveSdkConfig,
} from '../../../src/config/resolve'
import { type RhinestoneAccountConfig, RhinestoneSDK } from '../../../src/index'
import { planModuleSetup } from '../../../src/modules/plan'
import { resolveValidator } from '../../../src/modules/validators/resolve'
import { accountA } from '../../consts'
import vector from './account-deployment.json'

const configurations: Record<string, () => RhinestoneAccountConfig> = {
  'safe-1.4.1-adapter-1': () => ({
    account: { type: 'safe', version: '1.4.1', adapter: '1.0.0' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'safe-1.4.1-adapter-2': () => ({
    account: { type: 'safe', version: '1.4.1', adapter: '2.0.0' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'nexus-1.0.2': () => ({
    account: { type: 'nexus', version: '1.0.2' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'nexus-1.2.0': () => ({
    account: { type: 'nexus', version: '1.2.0' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'nexus-rhinestone-beta': () => ({
    account: { type: 'nexus', version: 'rhinestone-1.0.0-beta' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'nexus-rhinestone-release': () => ({
    account: { type: 'nexus', version: 'rhinestone-1.0.0' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'kernel-3.1': () => ({
    account: { type: 'kernel', version: '3.1' },
    owners: { type: 'ecdsa', accounts: [accountA] },
  }),
  'kernel-3.2': () => ({
    account: { type: 'kernel', version: '3.2' },
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
    const owner = resolveValidator(resolved.owners)
    const sessionModule =
      resolved.sessions.module.source === 'explicit'
        ? resolved.sessions.module.address
        : undefined
    const compatibilityFallback =
      resolved.sessions.compatibilityFallback.source === 'explicit'
        ? resolved.sessions.compatibilityFallback.address
        : undefined
    const construction: AccountConstruction = {
      account: resolved.account,
      owner: resolved.owners,
      modules: resolved.modules,
      setup: planModuleSetup({
        accountKind: resolved.account.kind,
        owner,
        configured: resolved.modules,
        environment: resolved.sessions.environment,
        sessions: {
          enabled: resolved.sessions.enabled,
          ...(sessionModule ? { module: sessionModule } : {}),
          ...(compatibilityFallback ? { compatibilityFallback } : {}),
        },
      }),
      sessions: { enabled: resolved.sessions.enabled },
      ...(resolved.initData ? { initData: resolved.initData } : {}),
      ...(resolved.eoa ? { eoa: resolved.eoa } : {}),
      chain: { kind: 'evm', id: 1, caip2: 'eip155:1' },
      deployed: false,
    }
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
