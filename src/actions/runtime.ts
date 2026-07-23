import { encodeFunctionData, maxUint256, size } from 'viem'
import { createAccountConstruction } from '../accounts/construction'
import { DefaultValidatorAlreadyInitializedError } from '../accounts/error'
import { createAccountAdapter } from '../accounts/registry'
import { materializeRpcReader } from '../clients/rpc/compatibility'
import type {
  CalldataInput,
  CallResolveContext,
  Session,
} from '../config/account'
import { resolveStandaloneAccountConfig } from '../config/resolve'
import { assertAccountOwnersConfigured } from '../config/validate'
import {
  encodeAccountModuleDeInitData,
  readInstalledModules,
  readValidatorInitialized,
} from '../modules/read-core'
import type { ResolvedModule } from '../modules/types'
import { OWNABLE_VALIDATOR_ADDRESS } from '../modules/validators/ownable'
import { SESSION_LOCK_TAG } from '../modules/validators/smart-sessions/authorization'
import { encodeDisableSessionCall } from '../modules/validators/smart-sessions/calls'
import { readSessionNonce } from '../modules/validators/smart-sessions/state'
import type { Session as DomainSession } from '../modules/validators/smart-sessions/types'

function actionContext(context: CallResolveContext) {
  const resolved = resolveStandaloneAccountConfig(context.config, 'current-v2')
  assertAccountOwnersConfigured(resolved)
  const module =
    resolved.sessions.module.source === 'explicit'
      ? resolved.sessions.module.address
      : undefined
  const compatibilityFallback =
    resolved.sessions.compatibilityFallback.source === 'explicit'
      ? resolved.sessions.compatibilityFallback.address
      : undefined
  const chain = {
    kind: 'evm',
    id: context.chain.id,
    caip2: `eip155:${context.chain.id}`,
  } as const
  const construction = createAccountConstruction({
    material: {
      account: resolved.account,
      ...(resolved.owners ? { owner: resolved.owners } : {}),
      modules: resolved.modules,
      ...(resolved.initData ? { initData: resolved.initData } : {}),
      ...(resolved.eoa ? { eoa: resolved.eoa } : {}),
      sessions: {
        enabled: resolved.sessions.enabled,
        environment:
          context.config.useDevContracts === true
            ? 'development'
            : 'production',
        ...(module ? { module } : {}),
        ...(compatibilityFallback ? { compatibilityFallback } : {}),
      },
    },
    chain,
    deployed: false,
  })
  const adapter = createAccountAdapter(construction)
  return {
    resolved,
    construction,
    adapter,
    address: adapter.getIdentity(construction).address,
  }
}

function calls(
  target: `0x${string}`,
  encoded: readonly `0x${string}`[],
): CalldataInput[] {
  return encoded.map((data) => ({ to: target, value: 0n, data }))
}

function defaultValidatorConfigured(
  context: ReturnType<typeof actionContext>,
  validator: `0x${string}`,
): boolean {
  return (
    !context.resolved.initData &&
    context.construction.setup.validators.some(
      (module) =>
        module.address.toLowerCase() === validator.toLowerCase() &&
        size(module.initData) > 0,
    )
  )
}

export async function resolveValidatorInstallation(
  context: CallResolveContext,
  module: ResolvedModule,
): Promise<CalldataInput[]> {
  const runtime = actionContext(context)
  if (runtime.construction.account.kind === 'nexus') {
    const defaultValidator = OWNABLE_VALIDATOR_ADDRESS
    if (module.address.toLowerCase() === defaultValidator.toLowerCase()) {
      let initialized = defaultValidatorConfigured(runtime, defaultValidator)
      if (!initialized) {
        const reader = materializeRpcReader({
          chain: context.chain,
          provider: context.config.provider,
        })
        initialized = await readValidatorInitialized({
          rpc: reader.rpc,
          chain: reader.chain,
          account: runtime.address,
          validator: defaultValidator,
        })
      }
      if (initialized) throw new DefaultValidatorAlreadyInitializedError()
      return [
        {
          to: defaultValidator,
          value: 0n,
          data: encodeFunctionData({
            abi: [
              {
                type: 'function',
                name: 'onInstall',
                inputs: [{ type: 'bytes', name: 'data' }],
                outputs: [],
                stateMutability: 'nonpayable',
              },
            ],
            functionName: 'onInstall',
            args: [module.initData],
          }),
        },
      ]
    }
  }
  return calls(
    runtime.address,
    runtime.adapter.encodeModuleInstallation(module),
  )
}

export async function resolveModuleInstallation(
  context: CallResolveContext,
  module: ResolvedModule,
): Promise<CalldataInput[]> {
  const runtime = actionContext(context)
  return calls(
    runtime.address,
    runtime.adapter.encodeModuleInstallation(module),
  )
}

export async function resolveModuleUninstallation(
  context: CallResolveContext,
  module: ResolvedModule,
): Promise<CalldataInput[]> {
  const runtime = actionContext(context)
  let deInitData = module.deInitData
  if (
    module.kind === 'validator' &&
    ['nexus', 'safe', 'startale'].includes(runtime.construction.account.kind)
  ) {
    const reader = materializeRpcReader({
      chain: context.chain,
      provider: context.config.provider,
    })
    const installed = await readInstalledModules({
      rpc: reader.rpc,
      chain: reader.chain,
      accountKind: runtime.construction.account.kind,
      account: runtime.address,
      kind: 'validator',
    })
    deInitData = encodeAccountModuleDeInitData({
      accountKind: runtime.construction.account.kind,
      module,
      installed,
    })
  }
  return calls(runtime.address, [
    runtime.adapter.encodeModuleUninstallation({ ...module, deInitData }),
  ])
}

export async function resolveSessionDisable(input: {
  readonly context: CallResolveContext
  readonly account: `0x${string}`
  readonly session: Session
  readonly expires?: Date
}): Promise<CalldataInput> {
  const reader = materializeRpcReader({
    chain: input.session.chain,
    provider: input.context.config.provider,
  })
  const runtimeEnvironment =
    input.context.config.useDevContracts === true ? 'development' : 'production'
  const nonce = await readSessionNonce({
    rpc: reader.rpc,
    chain: reader.chain,
    account: input.account,
    lockTag: SESSION_LOCK_TAG,
    environment: runtimeEnvironment,
  })
  const call = encodeDisableSessionCall({
    account: input.account,
    session: input.session as DomainSession,
    expires: input.expires
      ? BigInt(Math.floor(input.expires.getTime() / 1000))
      : maxUint256,
    nonce,
    environment: runtimeEnvironment,
  })
  return { to: call.target, value: call.value, data: call.data }
}
