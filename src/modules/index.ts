import { type Address, type Chain, encodeAbiParameters } from 'viem'
import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  optimism,
  optimismSepolia,
  polygon,
} from 'viem/chains'

import type { RhinestoneAccountConfig, RhinestoneConfig } from '../types'

import {
  getModule,
  MODULE_TYPE_EXECUTOR,
  MODULE_TYPE_FALLBACK,
  MODULE_TYPE_HOOK,
  MODULE_TYPE_ID_EXECUTOR,
  MODULE_TYPE_ID_FALLBACK,
  MODULE_TYPE_VALIDATOR,
  type Module,
} from './common'
import {
  HOOK_ADDRESS,
  INTENT_EXECUTOR_ADDRESS,
  INTENT_EXECUTOR_ADDRESS_DEV,
} from './omni-account'
import { getOwners, getValidators } from './read'
import { getOwnerValidator, getSmartSessionValidator } from './validators'
import { getSocialRecoveryValidator } from './validators/core'

const SMART_SESSION_COMPATIBILITY_FALLBACK_ADDRESS: Address =
  '0x000000000052e9685932845660777DF43C2dC496'

interface ModeleSetup {
  validators: Module[]
  executors: Module[]
  fallbacks: Module[]
  hooks: Module[]
}

function getSetup(config: RhinestoneAccountConfig): ModeleSetup {
  const ownerValidator = getOwnerValidator(config)
  const smartSessionValidator = getSmartSessionValidator(config)

  const validators: Module[] = [ownerValidator]
  if (smartSessionValidator) {
    validators.push(smartSessionValidator)
  }
  if (config.recovery) {
    const socialRecoveryValidator = getSocialRecoveryValidator(
      config.recovery.guardians,
      config.recovery.threshold,
    )
    validators.push(socialRecoveryValidator)
  }

  const intentExecutor = getIntentExecutor(config)
  const executors: Module[] = [intentExecutor]

  const fallbacks: Module[] = []

  // Some accounts (e.g. Safe) need a fallback method to support smart sessions
  if (config.sessions) {
    if (config.account && config.account.type === 'safe') {
      fallbacks.push({
        address: SMART_SESSION_COMPATIBILITY_FALLBACK_ADDRESS,
        initData: encodeAbiParameters(
          [
            { name: 'selector', type: 'bytes4' },
            { name: 'flags', type: 'bytes1' },
            { name: 'data', type: 'bytes' },
          ],
          ['0x84b0196e', '0xfe', '0x'],
        ),
        deInitData: '0x',
        additionalContext: '0x',
        type: MODULE_TYPE_ID_FALLBACK,
      })
    }
  }

  const hooks: Module[] = []

  if (config.modules) {
    validators.push(
      ...config.modules
        .filter((m) => m.type === MODULE_TYPE_VALIDATOR)
        .map((m) => getModule(m)),
    )
    executors.push(
      ...config.modules
        .filter((m) => m.type === MODULE_TYPE_EXECUTOR)
        .map((m) => getModule(m)),
    )
    fallbacks.push(
      ...config.modules
        .filter((m) => m.type === MODULE_TYPE_FALLBACK)
        .map((m) => getModule(m)),
    )
    hooks.push(
      ...config.modules
        .filter((m) => m.type === MODULE_TYPE_HOOK)
        .map((m) => getModule(m)),
    )
  }

  return {
    validators,
    executors,
    fallbacks,
    hooks,
  }
}

function getIntentExecutor(config: RhinestoneConfig): Module {
  const intentExecutorAddress =
    config.useDevContracts === true
      ? INTENT_EXECUTOR_ADDRESS_DEV
      : INTENT_EXECUTOR_ADDRESS
  return {
    address: intentExecutorAddress,
    initData: '0x',
    deInitData: '0x',
    additionalContext: '0x',
    type: MODULE_TYPE_ID_EXECUTOR,
  }
}

function isRip7212SupportedNetwork(chain: Chain) {
  const supportedChains: Chain[] = [
    optimism,
    optimismSepolia,
    polygon,
    base,
    baseSepolia,
    arbitrum,
    arbitrumSepolia,
  ]
  return supportedChains.includes(chain)
}

export {
  HOOK_ADDRESS,
  getSetup,
  getOwnerValidator,
  getOwners,
  getIntentExecutor,
  getValidators,
  isRip7212SupportedNetwork,
}
