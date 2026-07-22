import fc from 'fast-check'
import { toHex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test, vi } from 'vitest'
import { passkeyAccount } from '../../test/consts'
import type { AccountInput } from '../accounts/types'
import { currentV2Defaults } from './defaults'
import type { AccountConstructionInput, SdkConstructionInput } from './input'
import { captureLegacySdkConfig, createLegacyAccountConfig } from './legacy'
import {
  materializeAccountInvocationContext,
  resolveAccountConfig,
  resolveConfig,
  resolveSdkConfig,
  resolveStandaloneAccountConfig,
} from './resolve'

const accountA = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const accountB = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const addressA = accountA.address
const addressB = accountB.address
const propertySeed = Number(process.env.SDK_PROPERTY_SEED ?? 0x5d4c3b2a)
const propertyParameters = { seed: propertySeed, numRuns: 100, verbose: true }

const hashArbitrary = fc
  .uint8Array({ minLength: 32, maxLength: 32 })
  .map((value) => toHex(value))

const accountInputArbitrary: fc.Arbitrary<AccountInput> = fc
  .record({
    kind: fc.constantFrom('safe', 'nexus', 'kernel', 'startale', 'hca', 'eoa'),
    explicit: fc.boolean(),
    choice: fc.integer({ min: 0, max: 3 }),
    nonce: fc.bigInt({ min: 0n, max: 1_000n }),
    salt: hashArbitrary,
  })
  .map(({ kind, explicit, choice, nonce, salt }): AccountInput => {
    switch (kind) {
      case 'safe':
        return {
          type: 'safe',
          ...(explicit ? { version: '1.4.1', nonce } : {}),
          ...(choice % 2 === 0 ? { adapter: '1.0.0' } : {}),
        }
      case 'nexus': {
        const versions = [
          '1.0.2',
          '1.2.0',
          'rhinestone-1.0.0-beta',
          'rhinestone-1.0.0',
        ] as const
        return {
          type: 'nexus',
          ...(explicit ? { version: versions[choice], salt } : {}),
        }
      }
      case 'kernel': {
        const versions = ['3.1', '3.2', '3.3'] as const
        return {
          type: 'kernel',
          ...(explicit
            ? { version: versions[choice % versions.length], salt }
            : {}),
        }
      }
      case 'startale':
        return { type: 'startale', ...(explicit ? { salt } : {}) }
      case 'hca':
        return { type: 'hca', ...(explicit ? { factory: addressB } : {}) }
      case 'eoa':
        return { type: 'eoa' }
    }
  })

const accountConfigArbitrary: fc.Arbitrary<AccountConstructionInput> = fc
  .record({
    account: accountInputArbitrary,
    threshold: fc.integer({ min: 1, max: 4 }),
    sessions: fc.boolean(),
    development: fc.boolean(),
    moduleData: fc.boolean(),
  })
  .map(({ account, threshold, sessions, moduleData }) => ({
    account,
    ...(account.type === 'eoa'
      ? { eoa: accountA }
      : {
          owners: {
            type: 'ecdsa' as const,
            accounts: [accountA, accountB],
            threshold,
          },
        }),
    ...(sessions ? { experimental_sessions: { enabled: true } } : {}),
    modules: [
      {
        type: 'executor' as const,
        address: addressA,
        ...(moduleData ? { initData: '0x1234' as const } : {}),
      },
    ],
  }))

const sdkInputArbitrary: fc.Arbitrary<SdkConstructionInput> = fc
  .record({
    apiKey: fc.string({ minLength: 1, maxLength: 20 }),
    endpointUrl: fc.option(fc.webUrl(), { nil: undefined }),
    development: fc.boolean(),
    providerKind: fc.constantFrom('public', 'alchemy', 'custom'),
    providerKey: fc.string({ minLength: 1, maxLength: 20 }),
  })
  .map(({ apiKey, endpointUrl, development, providerKind, providerKey }) => ({
    apiKey,
    ...(endpointUrl === undefined ? {} : { endpointUrl }),
    ...(development ? { useDevContracts: true } : {}),
    ...(providerKind === 'alchemy'
      ? { provider: { type: 'alchemy' as const, apiKey: providerKey } }
      : providerKind === 'custom'
        ? {
            provider: {
              type: 'custom' as const,
              urls: { 1: `https://${providerKey}.invalid` },
            },
          }
        : {}),
  }))

function serializeInput(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    typeof entry === 'bigint' ? `${entry}n` : entry,
  )
}

describe('SDK config resolution', () => {
  test('matches auth precedence and the legacy missing-auth error', () => {
    const current = { mode: 'apiKey' as const, apiKey: 'current' }
    expect(resolveSdkConfig({ apiKey: 'legacy', auth: current }).auth).toEqual({
      kind: 'api-key',
      apiKey: 'current',
    })
    expect(
      resolveSdkConfig({ apiKey: 'legacy', auth: undefined }).auth,
    ).toEqual({ kind: 'api-key', apiKey: 'legacy' })
    expect(() => resolveSdkConfig({ apiKey: '' })).toThrowError(
      'RhinestoneSDK requires either `apiKey` or `auth` in config',
    )
  })

  test('resolves SDK defaults and preserves opaque references', () => {
    const getToken = vi.fn(async () => 'token')
    const getIntentExtensionToken = vi.fn(async () => 'extension')
    const urls = { 1: 'https://rpc.test' }
    const headers = { 'x-test': 'value' }
    const input: SdkConstructionInput = {
      auth: {
        mode: 'experimental_jwt',
        accessToken: getToken,
        getIntentExtensionToken,
      },
      provider: { type: 'custom', urls },
      headers,
    }

    const resolved = resolveSdkConfig(input)

    expect(resolved).toMatchObject({
      profile: 'current-v2',
      environment: 'production',
      orchestratorUrl: 'https://v1.orchestrator.rhinestone.dev',
      provider: { kind: 'custom', urls },
      headers,
    })
    expect(resolved.auth.kind).toBe('jwt')
    if (resolved.auth.kind !== 'jwt') throw new Error('Expected JWT auth')
    expect(resolved.auth.accessToken).toBe(getToken)
    expect(resolved.auth.getIntentExtensionToken).toBe(getIntentExtensionToken)
    expect(resolved.provider.kind === 'custom' && resolved.provider.urls).toBe(
      urls,
    )
    expect(resolved.headers).toBe(headers)
    expect(getToken).not.toHaveBeenCalled()
    expect(getIntentExtensionToken).not.toHaveBeenCalled()

    const withoutExtension = resolveSdkConfig({
      auth: { mode: 'experimental_jwt', accessToken: getToken },
    })
    expect(withoutExtension.auth).not.toHaveProperty('getIntentExtensionToken')
  })

  test('records custom semantic defaults for staged account materialization', () => {
    const defaults = {
      ...currentV2Defaults,
      orchestratorUrl: 'https://custom-default.test',
      account: {
        ...currentV2Defaults.account,
        safeAdapterProfile: 'safe-legacy-v0-adapter' as const,
      },
    }
    const sdkInput = { apiKey: 'test' } satisfies SdkConstructionInput
    const accountInput: AccountConstructionInput = {
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts: [accountA] },
    }
    const sdk = resolveSdkConfig(sdkInput, defaults)
    const staged = resolveAccountConfig(sdk, accountInput)

    expect(sdk.defaults).toEqual({
      orchestratorUrl: defaults.orchestratorUrl,
      environment: defaults.environment,
      provider: defaults.provider,
      account: defaults.account,
    })
    expect(sdk.orchestratorUrl).toBe('https://custom-default.test')
    expect(staged.account.kind === 'safe' && staged.account.adapter).toEqual({
      source: 'default',
      profile: 'safe-legacy-v0-adapter',
    })
    expect(resolveConfig(sdkInput, accountInput, defaults).account).toEqual(
      staged,
    )
    const compatibility = createLegacyAccountConfig(
      accountInput,
      captureLegacySdkConfig(sdkInput, {}),
    )
    expect(
      materializeAccountInvocationContext(sdk, compatibility, 'get-address').sdk
        .orchestratorUrl,
    ).toBe('https://custom-default.test')
  })

  test('materializes fresh contexts from a fixed profile, shared auth, and live compatibility state', () => {
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    const compatibility = createLegacyAccountConfig(
      {
        account: { type: 'safe' },
        owners: { type: 'ecdsa', accounts: [accountA] },
      },
      captureLegacySdkConfig({ apiKey: 'test' }, sdk.auth),
    )

    const first = materializeAccountInvocationContext(
      sdk,
      compatibility,
      'get-address',
    )
    const second = materializeAccountInvocationContext(
      sdk,
      compatibility,
      'deploy',
    )

    // Freshly materialized: a new context object per call, never reused.
    expect(first).not.toBe(second)
    expect(first.sdk).not.toBe(second.sdk)

    // Fixed default profile and shared auth-provider identity are threaded by
    // reference from the resolved SDK config into every context.
    expect(first.sdk.profile).toBe(sdk.profile)
    expect(first.sdk.defaults).toBe(sdk.defaults)
    expect(first.sdk.auth).toBe(sdk.auth)
    expect(second.sdk.auth).toBe(sdk.auth)

    // Compatibility state is read live: a post-construction mutation is observed
    // by the next materialization.
    expect(first.sdk.environment).toBe('production')
    compatibility.useDevContracts = true
    expect(
      materializeAccountInvocationContext(sdk, compatibility, 'deploy').sdk
        .environment,
    ).toBe('development')
  })

  test('matches the rich resolved-config golden', () => {
    const expiration = new Date('2030-01-01T00:00:00.000Z')
    const sdk = resolveSdkConfig({
      apiKey: 'test',
      endpointUrl: 'https://orchestrator.test',
      provider: { type: 'alchemy', apiKey: 'alchemy' },
      bundler: { type: 'pimlico', apiKey: 'bundler' },
      paymaster: { type: 'custom', url: { 1: 'https://paymaster.test' } },
      useDevContracts: true,
      headers: { 'x-test': 'value' },
    })
    const account = resolveAccountConfig(sdk, {
      account: { type: 'safe', version: '1.4.1', nonce: 7n },
      owners: {
        type: 'multi-factor',
        threshold: 2,
        validators: [
          { type: 'ecdsa', accounts: [accountA], threshold: 1 },
          {
            type: 'ens',
            owners: [{ account: accountB, expiration }],
          },
        ],
      },
      modules: [{ type: 'executor', address: addressA }],
      experimental_sessions: {
        enabled: true,
        module: addressB,
      },
    })

    expect({
      sdk: {
        profile: sdk.profile,
        environment: sdk.environment,
        auth: sdk.auth.kind,
        provider: sdk.provider.kind,
        bundler: sdk.bundler?.kind,
        paymaster: sdk.paymaster?.kind,
      },
      account: {
        profile: account.profile,
        definition: account.account,
        validator:
          account.owners?.kind === 'multi-factor'
            ? {
                kind: account.owners.kind,
                id: account.owners.id,
                threshold: account.owners.threshold,
                module: account.owners.module,
                factors: account.owners.validators.map((validator) => ({
                  kind: validator.kind,
                  id: validator.id,
                  publicId: validator.publicId,
                  threshold: validator.threshold,
                  module: validator.module,
                  signerIds: validator.owners.map((owner) => owner.signerId),
                })),
              }
            : account.owners,
        modules: account.modules,
        sessions: account.sessions,
      },
    }).toEqual({
      sdk: {
        profile: 'current-v2',
        environment: 'development',
        auth: 'api-key',
        provider: 'alchemy',
        bundler: 'pimlico',
        paymaster: 'custom',
      },
      account: {
        profile: 'current-v2',
        definition: {
          kind: 'safe',
          version: { source: 'explicit', value: '1.4.1' },
          adapter: { source: 'default', profile: 'safe-current-adapter' },
          nonce: { source: 'explicit', value: 7n },
        },
        validator: {
          kind: 'multi-factor',
          id: 'owner-validator',
          threshold: 2,
          module: { source: 'default', profile: 'multi-factor' },
          factors: [
            {
              kind: 'ecdsa',
              id: 'owner-validator/factor/0',
              publicId: 0,
              threshold: 1,
              module: { source: 'default', profile: 'ownable' },
              signerIds: [`ecdsa:${addressA.toLowerCase()}`],
            },
            {
              kind: 'ens',
              id: 'owner-validator/factor/1',
              publicId: 1,
              threshold: 1,
              module: { source: 'default', profile: 'ens' },
              signerIds: [`ecdsa:${addressB.toLowerCase()}`],
            },
          ],
        },
        modules: [
          {
            kind: 'executor',
            address: addressA,
            initData: { source: 'omitted' },
            deInitData: { source: 'omitted' },
            additionalContext: { source: 'omitted' },
          },
        ],
        sessions: {
          configured: true,
          enabled: true,
          module: { source: 'explicit', address: addressB },
          compatibilityFallback: {
            source: 'default',
            profile: 'safe-session-fallback',
          },
          environment: 'development',
        },
      },
    })
    const ensOwner =
      account.owners?.kind === 'multi-factor'
        ? account.owners.validators[1]?.owners[0]
        : undefined
    expect(ensOwner?.kind !== 'webauthn' && ensOwner?.expiration).toBe(
      expiration,
    )
  })

  test.each([
    {
      name: 'default account',
      input: {},
      expected: {
        kind: 'nexus',
        version: { source: 'default', profile: 'nexus-current-version' },
        salt: { source: 'default', profile: 'nexus-empty-calldata-salt' },
      },
    },
    {
      name: 'explicit Nexus version and salt',
      input: {
        account: {
          type: 'nexus' as const,
          version: '1.0.2' as const,
          salt: `0x${'33'.repeat(32)}` as const,
        },
      },
      expected: {
        kind: 'nexus',
        version: { source: 'explicit', value: '1.0.2' },
        salt: { source: 'explicit', value: `0x${'33'.repeat(32)}` },
      },
    },
    {
      name: 'default Kernel selections',
      input: { account: { type: 'kernel' as const } },
      expected: {
        kind: 'kernel',
        version: { source: 'default', profile: 'kernel-current-version' },
        salt: { source: 'default', profile: 'kernel-zero-salt' },
      },
    },
    {
      name: 'explicit HCA factory',
      input: { account: { type: 'hca' as const, factory: addressA } },
      expected: {
        kind: 'hca',
        factory: { source: 'explicit', value: addressA },
      },
    },
  ])('resolves $name', ({ input, expected }) => {
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    expect(resolveAccountConfig(sdk, input).account).toEqual(expected)
  })

  test.each([
    { type: 'ecdsa' as const, accounts: [accountA], expected: 1 },
    { type: 'ecdsa' as const, accounts: [accountA], threshold: 0, expected: 0 },
    {
      type: 'ecdsa' as const,
      accounts: [accountA],
      threshold: -1,
      expected: -1,
    },
  ])(
    'uses nullish threshold resolution for $type threshold $threshold',
    ({ expected, ...owners }) => {
      const sdk = resolveSdkConfig({ apiKey: 'test' })
      expect(resolveAccountConfig(sdk, { owners }).owners?.threshold).toBe(
        expected,
      )
    },
  )

  test('uses explicit standalone profiles without synthesizing SDK config', () => {
    const input: AccountConstructionInput = {
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts: [accountA] },
    }

    const current = resolveStandaloneAccountConfig(input, 'current-v2')
    const legacy = resolveStandaloneAccountConfig(input, 'legacy-v0')

    expect(current.profile).toBe('current-v2')
    expect(legacy.profile).toBe('legacy-v0')
    expect(current.account.kind === 'safe' && current.account.adapter).toEqual({
      source: 'default',
      profile: 'safe-current-adapter',
    })
    expect(legacy.account.kind === 'safe' && legacy.account.adapter).toEqual({
      source: 'default',
      profile: 'safe-legacy-v0-adapter',
    })
    expect(current).not.toHaveProperty('auth')
    expect(current).not.toHaveProperty('provider')
  })

  test('resolves passkey owners and explicit validator/session overrides', () => {
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    const account = resolveAccountConfig(sdk, {
      owners: {
        type: 'passkey',
        accounts: [passkeyAccount],
        module: addressA,
        threshold: 1,
      },
      experimental_sessions: {
        enabled: true,
        compatibilityFallback: addressB,
      },
    })

    expect(account.owners).toMatchObject({
      kind: 'passkey',
      module: { source: 'explicit', address: addressA },
      owners: [
        {
          kind: 'webauthn',
          signerId: `webauthn:${passkeyAccount.publicKey.toLowerCase()}`,
          account: passkeyAccount,
        },
      ],
    })
    expect(account.sessions.compatibilityFallback).toEqual({
      source: 'explicit',
      address: addressB,
    })
  })

  test('retains init data and resolves default multi-factor threshold', () => {
    const sdk = resolveSdkConfig({ apiKey: 'test' })
    const initData = { address: addressA }
    const account = resolveAccountConfig(sdk, {
      initData,
      owners: {
        type: 'multi-factor',
        module: addressB,
        validators: [{ type: 'ecdsa', accounts: [accountA] }],
      },
    })

    expect(account.initData).toBe(initData)
    expect(account.owners).toMatchObject({
      kind: 'multi-factor',
      threshold: 1,
      module: { source: 'explicit', address: addressB },
    })
  })
})

describe('config resolution properties', () => {
  test('is deterministic, staged-equivalent, and input-immutable', () => {
    fc.assert(
      fc.property(
        sdkInputArbitrary,
        accountConfigArbitrary,
        (sdkInput, accountInput) => {
          const sdkBefore = serializeInput(sdkInput)
          const accountBefore = serializeInput(accountInput)
          const first = resolveConfig(sdkInput, accountInput)
          const second = resolveConfig(sdkInput, accountInput)
          const stagedSdk = resolveSdkConfig(sdkInput)
          const stagedAccount = resolveAccountConfig(stagedSdk, accountInput)

          expect(first).toEqual(second)
          expect(first).toEqual({ sdk: stagedSdk, account: stagedAccount })
          expect(serializeInput(sdkInput)).toBe(sdkBefore)
          expect(serializeInput(accountInput)).toBe(accountBefore)
        },
      ),
      propertyParameters,
    )
  })

  test('resolves sibling accounts independently of order', () => {
    fc.assert(
      fc.property(
        sdkInputArbitrary,
        accountConfigArbitrary,
        accountConfigArbitrary,
        (sdkInput, leftInput, rightInput) => {
          const sdk = resolveSdkConfig(sdkInput)
          const sdkBefore = resolveSdkConfig(sdkInput)
          const leftFirst = resolveAccountConfig(sdk, leftInput)
          const rightSecond = resolveAccountConfig(sdk, rightInput)
          const rightFirst = resolveAccountConfig(sdk, rightInput)
          const leftSecond = resolveAccountConfig(sdk, leftInput)

          expect(leftFirst).toEqual(leftSecond)
          expect(rightFirst).toEqual(rightSecond)
          expect(sdk).toEqual(sdkBefore)
          expect(leftFirst).not.toBe(leftSecond)
          expect(leftFirst.modules).not.toBe(leftSecond.modules)
        },
      ),
      propertyParameters,
    )
  })

  test('preserves opaque identities without invoking them', () => {
    const getToken = vi.fn(async () => 'token')
    const sdkInput: SdkConstructionInput = {
      auth: { mode: 'experimental_jwt', accessToken: getToken },
      provider: { type: 'custom', urls: { 1: 'https://rpc.test' } },
    }
    const sdk = resolveSdkConfig(sdkInput)
    const module = { type: 'executor' as const, address: addressB }
    const accountInput: AccountConstructionInput = {
      owners: { type: 'ecdsa', accounts: [accountA] },
      modules: [module],
    }
    const account = resolveAccountConfig(sdk, accountInput)

    expect(sdk.auth.kind === 'jwt' && sdk.auth.accessToken).toBe(getToken)
    expect(
      account.owners?.kind !== 'multi-factor'
        ? account.owners?.owners[0]?.account
        : undefined,
    ).toBe(accountA)
    expect(account.modules[0]).toEqual({
      kind: 'executor',
      address: addressB,
      initData: { source: 'omitted' },
      deInitData: { source: 'omitted' },
      additionalContext: { source: 'omitted' },
    })
    expect(account.modules).not.toBe(accountInput.modules)
    expect(getToken).not.toHaveBeenCalled()
  })
})

describe('account invocation materialization', () => {
  test('reflects live compatibility mutations under the original profile', () => {
    const sdkInput: SdkConstructionInput = {
      apiKey: 'test',
      provider: { type: 'alchemy', apiKey: 'initial' },
      headers: { initial: 'true' },
    }
    const sdk = resolveSdkConfig(sdkInput)
    const accountInput: AccountConstructionInput = {
      account: { type: 'safe' },
      owners: { type: 'ecdsa', accounts: [accountA] },
      experimental_sessions: { enabled: false },
    }
    const authProvider = {}
    const compatibility = createLegacyAccountConfig(
      accountInput,
      captureLegacySdkConfig(sdkInput, authProvider),
    )

    compatibility.provider = {
      type: 'custom',
      urls: { 1: 'https://replacement.test' },
    }
    compatibility.headers = { replacement: 'true' }
    compatibility.endpointUrl = 'https://replacement-orchestrator.test'
    compatibility.useDevContracts = true
    compatibility.owners = {
      type: 'ecdsa',
      accounts: [accountB],
      threshold: 1,
    }
    if (!compatibility.experimental_sessions) {
      throw new Error('Expected sessions compatibility input')
    }
    compatibility.experimental_sessions.enabled = true

    const context = materializeAccountInvocationContext(
      sdk,
      compatibility,
      'prepare-intent',
    )

    expect(context.method).toBe('prepare-intent')
    expect(context.compatibilityConfig).toBe(compatibility)
    expect(context.sdk).toMatchObject({
      profile: 'current-v2',
      environment: 'development',
      orchestratorUrl: 'https://replacement-orchestrator.test',
      provider: {
        kind: 'custom',
        urls: compatibility.provider.urls,
      },
      headers: compatibility.headers,
    })
    expect(context.account.profile).toBe('current-v2')
    expect(
      context.account.owners?.kind !== 'multi-factor'
        ? context.account.owners?.owners[0]?.account
        : undefined,
    ).toBe(accountB)
    expect(context.account.sessions.enabled).toBe(true)
    expect(context.account.sessions.environment).toBe('development')
  })

  test('reapplies omitted SDK defaults and current service replacements', () => {
    const sdkInput = { apiKey: 'test' } satisfies SdkConstructionInput
    const sdk = resolveSdkConfig(sdkInput)
    const compatibility = createLegacyAccountConfig(
      { owners: { type: 'ecdsa', accounts: [accountA] } },
      captureLegacySdkConfig(sdkInput, {}),
    )
    compatibility.bundler = { type: 'biconomy', apiKey: 'bundler' }
    compatibility.paymaster = {
      type: 'custom',
      url: 'https://paymaster.test',
    }

    const context = materializeAccountInvocationContext(
      sdk,
      compatibility,
      'get-address',
    )

    expect(context.sdk).toMatchObject({
      environment: 'production',
      orchestratorUrl: 'https://v1.orchestrator.rhinestone.dev',
      provider: { kind: 'public' },
      bundler: { kind: 'biconomy', apiKey: 'bundler' },
      paymaster: { kind: 'custom', urls: 'https://paymaster.test' },
      headers: {},
    })
  })
})
