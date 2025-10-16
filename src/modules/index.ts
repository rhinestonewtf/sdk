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
import { PROD_ORCHESTRATOR_URL } from '../orchestrator/consts'
import type { RhinestoneAccountConfig, RhinestoneConfig } from '../types'
import {
  MODULE_TYPE_ID_EXECUTOR,
  MODULE_TYPE_ID_FALLBACK,
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

  return {
    validators,
    executors,
    fallbacks,
    hooks,
  }
}

function getIntentExecutor(config: RhinestoneConfig): Module {
  const intentExecutorAddress =
    config.endpointUrl === PROD_ORCHESTRATOR_URL
      ? INTENT_EXECUTOR_ADDRESS
      : INTENT_EXECUTOR_ADDRESS_DEV
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
