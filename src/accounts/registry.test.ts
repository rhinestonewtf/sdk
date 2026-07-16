import { keccak256, toHex, zeroAddress } from 'viem'
import { describe, expect, test } from 'vitest'
import { accountA } from '../../test/consts'
import type { AccountConstructionInput } from '../config/input'
import { resolveStandaloneAccountConfig } from '../config/resolve'
import { createAccountConstruction } from './construction'
import { ModuleInstallationNotSupportedError } from './error'
import { createAccountAdapter } from './registry'

function construction(input: AccountConstructionInput) {
  const resolved = resolveStandaloneAccountConfig(input, 'current-v2')
  const module =
    resolved.sessions.module.source === 'explicit'
      ? resolved.sessions.module.address
      : undefined
  const compatibilityFallback =
    resolved.sessions.compatibilityFallback.source === 'explicit'
      ? resolved.sessions.compatibilityFallback.address
      : undefined
  return createAccountConstruction({
    material: {
      account: resolved.account,
      ...(resolved.owners ? { owner: resolved.owners } : {}),
      modules: resolved.modules,
      ...(resolved.eoa ? { eoa: resolved.eoa } : {}),
      ...(resolved.initData ? { initData: resolved.initData } : {}),
      sessions: {
        enabled: resolved.sessions.enabled,
        environment: resolved.sessions.environment,
        ...(module ? { module } : {}),
        ...(compatibilityFallback ? { compatibilityFallback } : {}),
      },
    },
    chain: { kind: 'evm', id: 1, caip2: 'eip155:1' },
    deployed: false,
  })
}

const ecdsa = { type: 'ecdsa' as const, accounts: [accountA] }
const accountInputs = {
  safe: { account: { type: 'safe' as const }, owners: ecdsa },
  nexus: { account: { type: 'nexus' as const }, owners: ecdsa },
  kernel: { account: { type: 'kernel' as const }, owners: ecdsa },
  startale: { account: { type: 'startale' as const }, owners: ecdsa },
  hca: {
    account: { type: 'hca' as const },
    owners: { type: 'ens' as const, owners: [{ account: accountA }] },
  },
  eoa: { account: { type: 'eoa' as const }, eoa: accountA },
} satisfies Record<string, AccountConstructionInput>

describe('account adapter registry', () => {
  test('requires smart-account owners and accepts a prepared module setup', () => {
    const input = construction(accountInputs.safe)
    expect(() =>
      createAccountConstruction({
        material: {
          account: input.account,
          modules: [],
          sessions: { enabled: false, environment: 'production' },
        },
        chain: input.chain,
        deployed: false,
      }),
    ).toThrow('Smart account owner is required')
    expect(
      createAccountConstruction({
        material: {
          account: input.account,
          owner: input.owner,
          modules: [],
          sessions: { enabled: false, environment: 'production' },
        },
        setup: input.setup,
        chain: input.chain,
        deployed: true,
      }).setup,
    ).toBe(input.setup)
  })

  test.each([
    ['safe', true, true],
    ['nexus', true, true],
    ['kernel', true, true],
    ['startale', true, true],
    ['hca', false, false],
    ['eoa', false, false],
  ] as const)(
    '%s exposes explicit modular and session capabilities',
    (kind, modular, sessions) => {
      const input = construction(accountInputs[kind])
      const adapter = createAccountAdapter(input)
      expect(adapter.account.kind).toBe(kind)
      expect(adapter.capabilities.modular).toBe(modular)
      expect(adapter.capabilities.supportsSmartSessions).toBe(sessions)
      expect(adapter.getIdentity(input).address).toMatch(/^0x[\da-f]{40}$/i)
    },
  )

  test('adopted smart accounts use their EOA identity without deployment data', () => {
    const input = construction({
      account: { type: 'nexus' },
      owners: ecdsa,
      eoa: accountA,
    })
    const plan = createAccountAdapter(input).getDeploymentPlan(input)
    expect(plan).toEqual({
      chain: input.chain,
      address: accountA.address,
      deployed: false,
    })
  })

  test('adapts module lifecycle encoding by account family', () => {
    const module = {
      kind: 'validator' as const,
      address: '0x0000000000000000000000000000000000000099' as const,
      initData: '0x1234' as const,
      deInitData: '0x5678' as const,
      additionalContext: '0x' as const,
    }
    for (const kind of ['safe', 'nexus', 'startale'] as const) {
      const adapter = createAccountAdapter(construction(accountInputs[kind]))
      expect(adapter.encodeModuleInstallation(module)[0]?.slice(0, 10)).toBe(
        '0x9517e29f',
      )
      expect(adapter.encodeModuleUninstallation(module).slice(0, 10)).toBe(
        '0xa71763a8',
      )
    }
    const kernel = createAccountAdapter(construction(accountInputs.kernel))
    expect(
      kernel.encodeModuleInstallation(module).map((data) => data.slice(0, 10)),
    ).toEqual(['0x9517e29f', '0xb9b82941'])

    for (const kind of ['hca', 'eoa'] as const) {
      const adapter = createAccountAdapter(construction(accountInputs[kind]))
      expect(() => adapter.encodeModuleInstallation(module)).toThrow(
        ModuleInstallationNotSupportedError,
      )
    }
  })

  test('encodes account signature envelopes without invoking signers', () => {
    const contribution = '0x1234' as const
    const encoded = Object.fromEntries(
      Object.entries(accountInputs).map(([kind, config]) => {
        const input = construction(config)
        const adapter = createAccountAdapter(input)
        return [
          kind,
          adapter.encodeSignatureEnvelope({
            account: adapter.getIdentity(input),
            envelope: adapter.capabilities.signatureEnvelope,
            validatorContribution: contribution,
            purpose: 'erc1271',
          }),
        ]
      }),
    )
    expect(encoded.safe).toBe('0x000000000013fdb5234e4e3162a810f54d9f7e981234')
    expect(encoded.nexus).toBe(`${zeroAddress}${contribution.slice(2)}`)
    expect(encoded.kernel).toBe(
      `0x00${keccak256(toHex('kernel.replayable.signature')).slice(2)}${contribution.slice(2)}`,
    )
    expect(encoded.startale).toBe(
      '0x000000000013fdb5234e4e3162a810f54d9f7e981234',
    )
    expect(encoded.hca).toBe(`${zeroAddress}${contribution.slice(2)}`)
    expect(encoded.eoa).toBe(contribution)
  })
})
