import {
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  zeroHash,
} from 'viem'
import { describe, expect, test } from 'vitest'
import { accountA, accountB } from '../../../test/consts'
import type { AccountConstructionInput } from '../../config/input'
import { resolveStandaloneAccountConfig } from '../../config/resolve'
import type { ResolvedModule } from '../../modules/types'
import type { ResolvedValidatorDefinition } from '../../modules/validators/types'
import { createAccountConstruction } from '../construction'
import { ModuleInstallationNotSupportedError } from '../error'
import type {
  AccountConstruction,
  AccountKind,
  AccountSignatureEnvelope,
} from '../types'
import { createEoaAdapter } from './eoa'
import { createHcaAdapter } from './hca'
import {
  createKernelAdapter,
  kernelInstallData,
  wrapKernelMessageHash,
} from './kernel'
import {
  createNexusAdapter,
  nexusDefaultValidator,
  nexusMaterial,
} from './nexus'
import { createSafeAdapter, safeV0FactoryMaterial } from './safe'
import {
  encodeAddressEnvelope,
  primaryOwnerAddresses,
  primaryThreshold,
} from './shared'
import {
  createStartaleAdapter,
  K1_DEFAULT_VALIDATOR_ADDRESS,
  startaleEip712Domain,
} from './startale'

const ecdsa = { type: 'ecdsa' as const, accounts: [accountA] }
const inputs = {
  safe: { account: { type: 'safe' as const }, owners: ecdsa },
  nexus: { account: { type: 'nexus' as const }, owners: ecdsa },
  kernel: { account: { type: 'kernel' as const }, owners: ecdsa },
  startale: { account: { type: 'startale' as const }, owners: ecdsa },
  hca: {
    account: { type: 'hca' as const },
    owners: { type: 'ens' as const, owners: [{ account: accountA }] },
  },
  eoa: { account: { type: 'eoa' as const }, eoa: accountA },
} satisfies Record<AccountKind, AccountConstructionInput>

function construction(input: AccountConstructionInput): AccountConstruction {
  const resolved = resolveStandaloneAccountConfig(input, 'current-v2')
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
      },
    },
    chain: { kind: 'evm', id: 1, caip2: 'eip155:1' },
    deployed: false,
  })
}

const adapters = {
  safe: createSafeAdapter,
  nexus: createNexusAdapter,
  kernel: createKernelAdapter,
  startale: createStartaleAdapter,
  hca: createHcaAdapter,
  eoa: createEoaAdapter,
}

const module = (kind: ResolvedModule['kind']): ResolvedModule => ({
  kind,
  address: '0x0000000000000000000000000000000000000099',
  initData:
    kind === 'fallback'
      ? encodeAbiParameters(
          [{ type: 'bytes4' }, { type: 'bytes1' }, { type: 'bytes' }],
          ['0x12345678', '0x01', '0xabcd'],
        )
      : '0x1234',
  deInitData: '0x5678',
  additionalContext: '0x',
})

describe('account adapter contract', () => {
  test.each(Object.keys(adapters) as AccountKind[])(
    '%s rejects constructions and envelopes for another family',
    (kind) => {
      const valid = construction(inputs[kind])
      const other = construction(inputs[kind === 'safe' ? 'nexus' : 'safe'])
      const adapter = adapters[kind](valid)
      const invalidEnvelope: AccountSignatureEnvelope =
        kind === 'eoa'
          ? { kind: 'safe', validator: zeroAddress }
          : { kind: 'none' }
      expect(() => adapters[kind](other)).toThrow('Expected')
      expect(() => adapter.getIdentity(other)).toThrow()
      expect(() =>
        adapter.encodeSignatureEnvelope({
          account: adapter.getIdentity(valid),
          envelope: invalidEnvelope,
          validatorContribution: '0x12',
          purpose: 'erc1271',
        }),
      ).toThrow()
    },
  )

  test.each(['safe', 'nexus', 'kernel', 'startale', 'hca'] as const)(
    '%s accepts address-only, adopted, and reconstructed factory material',
    (kind) => {
      const original = construction(inputs[kind])
      const adapter = adapters[kind](original)
      const plan = adapter.getDeploymentPlan(original)
      const addressOnly = {
        ...original,
        initData: { address: accountB.address },
      } satisfies AccountConstruction
      expect(adapter.getIdentity(addressOnly).address).toBe(accountB.address)
      expect(adapter.getIdentity({ ...original, eoa: accountB }).address).toBe(
        accountB.address,
      )

      const factory = {
        ...original,
        initData: {
          address: plan.address,
          factory: plan.factory as `0x${string}`,
          factoryData: plan.factoryData as `0x${string}`,
          intentExecutorInstalled: true,
        },
      } satisfies AccountConstruction
      expect(adapter.getDeploymentPlan(factory).factoryData).toBe(
        plan.factoryData,
      )
    },
  )

  test('Nexus defaults to 1.2.1 and pins the previous implementation for 1.2.0', () => {
    const current = nexusMaterial(construction(inputs.nexus))
    expect(current.factory).toBe('0x0000000099d5576c73a3b190dabeeaa0f128ce6b')
    expect(current.implementation).toBe(
      '0x000000000d41c0bf0063dba53343389cdb2c9c78',
    )

    const explicit = nexusMaterial(
      construction({
        account: { type: 'nexus', version: '1.2.1' },
        owners: ecdsa,
      }),
    )
    expect(explicit.factory).toBe(current.factory)
    expect(explicit.implementation).toBe(current.implementation)

    const previous = nexusMaterial(
      construction({
        account: { type: 'nexus', version: '1.2.0' },
        owners: ecdsa,
      }),
    )
    expect(previous.factory).toBe('0x0000000000679a258c64d2f20f310e12b64b7375')
    expect(previous.implementation).toBe(
      '0x000000000032ddc454c3bdcba80484ad5a798705',
    )
    // Only the implementation + factory differ; the bootstrap is identical.
    expect(previous.factoryData).toBe(current.factoryData)
    expect(previous.initializationCallData).toBe(current.initializationCallData)

    for (const version of [
      '1.0.2',
      'rhinestone-1.0.0-beta',
      'rhinestone-1.0.0',
    ] as const) {
      const legacy = nexusMaterial(
        construction({ account: { type: 'nexus', version }, owners: ecdsa }),
      )
      expect(legacy.factory).toBe(previous.factory)
      expect(legacy.implementation).toBe(previous.implementation)
    }
  })

  test('EOA enforces its required account and unsupported operations', () => {
    const input = construction(inputs.eoa)
    const adapter = createEoaAdapter(input)
    const missing = { ...input, eoa: undefined }
    expect(() => adapter.getIdentity(missing)).toThrow(
      'EOA account is required',
    )
    expect(() =>
      adapter.encodeCalls({ chain: input.chain, calls: [], mode: 'single' }),
    ).toThrow('EOA calls do not use ERC-7579 encoding')
    expect(() => adapter.encodeModuleInstallation(module('validator'))).toThrow(
      ModuleInstallationNotSupportedError,
    )
    expect(() =>
      adapter.encodeModuleUninstallation(module('validator')),
    ).toThrow(ModuleInstallationNotSupportedError)
    expect(adapter.getDeploymentPlan(input).deployed).toBe(true)
  })

  test('shared ownership and envelope helpers cover every owner shape', () => {
    const owner = construction(inputs.safe).owner as ResolvedValidatorDefinition
    if (owner.kind === 'multi-factor') throw new Error('Expected atomic owner')
    expect(primaryOwnerAddresses(owner)).toEqual([accountA.address])
    expect(primaryThreshold(owner)).toBe(1n)
    const passkey = { ...owner, kind: 'passkey' } as ResolvedValidatorDefinition
    expect(primaryOwnerAddresses(passkey)).toHaveLength(1)
    expect(primaryThreshold(passkey)).toBe(1n)
    expect(() =>
      primaryOwnerAddresses({
        ...owner,
        owners: [{ ...owner.owners[0], kind: 'webauthn' }],
      } as ResolvedValidatorDefinition),
    ).toThrow('does not expose an address')
    expect(encodeAddressEnvelope(zeroAddress, '0x12', zeroAddress)).toBe(
      `${zeroAddress}12`,
    )
    expect(encodeAddressEnvelope(accountA.address, '0x12', zeroAddress)).toBe(
      `${accountA.address.toLowerCase()}12`,
    )
  })

  test('account-specific setup branches remain explicit', () => {
    const safe = construction({
      account: { type: 'safe', nonce: 2n },
      owners: ecdsa,
    })
    expect(
      createSafeAdapter(safe).getDeploymentPlan(safe).factoryData,
    ).toBeDefined()
    expect(() =>
      safeV0FactoryMaterial({
        ...safe,
        initData: { address: accountA.address },
      }),
    ).toThrow('Custom V0 accounts are not supported')
    const expandedSafe = {
      ...safe,
      setup: {
        validators: safe.setup.validators,
        executors: [module('executor')],
        fallbacks: [module('fallback')],
        hooks: [module('hook')],
      },
    } satisfies AccountConstruction
    expect(
      createSafeAdapter(expandedSafe).getDeploymentPlan(expandedSafe)
        .factoryData,
    ).toBeDefined()
    const missingSafeOwner = { ...safe, owner: undefined }
    expect(() =>
      createSafeAdapter(missingSafeOwner).getIdentity(missingSafeOwner),
    ).toThrow('Safe account owners are required')
    expect(() => safeV0FactoryMaterial(missingSafeOwner)).toThrow(
      'Safe account owners are required',
    )
    expect(() => safeV0FactoryMaterial(construction(inputs.nexus))).toThrow(
      'Expected Safe account',
    )

    const nexus = construction({
      account: { type: 'nexus', salt: zeroHash },
      owners: ecdsa,
    })
    expect(nexusMaterial(nexus).salt).toBe(zeroHash)
    expect(nexusDefaultValidator('1.0.2')).not.toBe(
      nexusDefaultValidator('1.2.0'),
    )
    // 1.2.0 and 1.2.1 both hardwire the Ownable (default) validator.
    expect(nexusDefaultValidator('1.2.0')).toBe(
      nexusDefaultValidator(undefined),
    )
    expect(nexusDefaultValidator('1.2.1')).toBe(
      nexusDefaultValidator(undefined),
    )
    expect(nexusDefaultValidator('rhinestone-1.0.0-beta')).not.toBe(
      nexusDefaultValidator(undefined),
    )
    const adoptedNexus = construction({ ...inputs.nexus, eoa: accountB })
    expect(
      createNexusAdapter(adoptedNexus).getEip7702AdoptionPlan?.(adoptedNexus),
    ).toMatchObject({
      contract: expect.any(String),
      initData: expect.stringMatching(/^0x/u),
    })
    // The signed init call wraps the signature + packed module data in an
    // `initializeAccount` call, embedding the provided init signature.
    const nexusInitCall = createNexusAdapter(adoptedNexus).getEip7702InitCall?.(
      adoptedNexus,
      '0xabcd',
    )
    expect(nexusInitCall).toMatch(/^0x[0-9a-f]+$/u)
    expect(nexusInitCall).toContain('abcd')

    const kernel = construction({
      account: { type: 'kernel', salt: zeroHash },
      owners: ecdsa,
    })
    expect(
      createKernelAdapter(kernel).getDeploymentPlan(kernel).factoryData,
    ).toBeDefined()
    for (const kind of ['executor', 'fallback', 'hook'] as const) {
      expect(kernelInstallData(module(kind))).toHaveLength(1)
    }
    const kernelPlan = createKernelAdapter(kernel).getDeploymentPlan(kernel)
    const wrongFactoryData = encodeFunctionData({
      abi: parseAbi([
        'function deployWithFactory(address factory,bytes createData,bytes32 salt)',
      ]),
      functionName: 'deployWithFactory',
      args: [accountA.address, '0x', zeroHash],
    })
    expect(() =>
      createKernelAdapter(kernel).getIdentity({
        ...kernel,
        initData: {
          address: kernelPlan.address,
          factory: kernelPlan.factory as `0x${string}`,
          factoryData: wrongFactoryData,
          intentExecutorInstalled: true,
        },
      }),
    ).toThrow('Unsupported Kernel implementation')
    const emptySetup = {
      ...kernel,
      setup: { validators: [], executors: [], fallbacks: [], hooks: [] },
    } satisfies AccountConstruction
    expect(() =>
      createKernelAdapter(emptySetup).getIdentity(emptySetup),
    ).toThrow('Kernel root validator is required')
    expect(
      createKernelAdapter(kernel)
        .encodeSignatureEnvelope({
          account: createKernelAdapter(kernel).getIdentity(kernel),
          envelope: {
            kind: 'kernel',
            validator: accountA.address,
            isRoot: false,
          },
          validatorContribution: '0x12',
          purpose: 'erc1271',
        })
        .toLowerCase(),
    ).toContain(accountA.address.slice(2).toLowerCase())
    expect(wrapKernelMessageHash(zeroHash, accountA.address)).toMatch(
      /^0x[0-9a-f]{64}$/u,
    )
  })

  test('Startale supports K1 bootstrapping and rejects multiple K1 owners', () => {
    const input = construction(inputs.startale)
    const root = input.setup.validators[0] as ResolvedModule
    const k1 = {
      ...input,
      setup: {
        ...input.setup,
        validators: [{ ...root, address: K1_DEFAULT_VALIDATOR_ADDRESS }],
      },
    }
    if (!k1.owner || k1.owner.kind === 'multi-factor') {
      throw new Error('Expected atomic K1 owner')
    }
    expect(
      createStartaleAdapter(k1).getDeploymentPlan(k1).factoryData,
    ).toBeDefined()
    const twoOwners = {
      ...k1,
      owner: {
        ...k1.owner,
        owners: [...(k1.owner?.owners ?? []), k1.owner?.owners[0]],
      },
    } as AccountConstruction
    expect(() =>
      createStartaleAdapter(twoOwners).getIdentity(twoOwners),
    ).toThrow('only supports a single owner')
    const missingOwner = { ...k1, owner: undefined }
    expect(() =>
      createStartaleAdapter(missingOwner).getIdentity(missingOwner),
    ).toThrow('Startale K1 owner is required')
    const emptySetup = {
      ...input,
      setup: { validators: [], executors: [], fallbacks: [], hooks: [] },
    } satisfies AccountConstruction
    expect(() =>
      createStartaleAdapter(emptySetup).getIdentity(emptySetup),
    ).toThrow('Startale owner validator is required')
    expect(
      createStartaleAdapter(input).getIdentity({
        ...input,
        initData: {
          address: accountB.address,
          factory: accountA.address,
          factoryData: '0xdead',
          intentExecutorInstalled: false,
        },
      }).address,
    ).toBe(accountB.address)
    expect(startaleEip712Domain(accountA.address, 1)).toEqual({
      name: 'Startale',
      version: '1.0.0',
      chainId: 1,
      verifyingContract: accountA.address,
      salt: zeroHash,
    })
  })

  test('HCA rejects unsupported setup and preserves opaque custom addresses', () => {
    const input = construction(inputs.hca)
    const adapter = createHcaAdapter(input)
    expect(() =>
      adapter.getIdentity({
        ...input,
        sessions: { enabled: true, environment: 'production' },
      }),
    ).toThrow('cannot install sessions')
    expect(() => adapter.getIdentity({ ...input, owner: undefined })).toThrow(
      'require ENS owners',
    )
    expect(() =>
      adapter.getIdentity({
        ...input,
        initData: {
          address: accountB.address,
          factory: accountA.address,
          factoryData: '0xdead',
          intentExecutorInstalled: false,
        },
      }),
    ).not.toThrow()
    expect(() =>
      adapter.encodeModuleUninstallation(module('validator')),
    ).toThrow(ModuleInstallationNotSupportedError)
  })
})
