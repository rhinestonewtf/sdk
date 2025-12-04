import { type Address, encodeAbiParameters } from 'viem'
import type { ModuleInput, RhinestoneAccountConfig } from '../types'
import { getSetup } from '.'
import {
  getModule,
  MODULE_TYPE_ID_EXECUTOR,
  MODULE_TYPE_ID_FALLBACK,
  MODULE_TYPE_ID_HOOK,
  MODULE_TYPE_ID_VALIDATOR,
  type ModeleSetup,
} from './common'

const OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS: Address =
  '0x6D0515e8E499468DCe9583626f0cA15b887f9d03'
const RHINESTONE_ATTESTER_ADDRESS: Address =
  '0x000000333034E9f539ce08819E12c1b8Cb29084d'
const HOOK_ADDRESS: Address = '0x0000000000f6Ed8Be424d673c63eeFF8b9267420'
const TARGET_MODULE_ADDRESS: Address =
  '0x0000000000E5a37279A001301A837a91b5de1D5E'
const SAME_CHAIN_MODULE_ADDRESS: Address =
  '0x000000000043ff16d5776c7F0f65Ec485C17Ca04'

function getV0Attesters(): {
  addresses: Address[]
  threshold: number
} {
  return {
    addresses: [
      RHINESTONE_ATTESTER_ADDRESS,
      OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
    ],
    threshold: 1,
  }
}

function getV0Setup(config: RhinestoneAccountConfig): ModeleSetup {
  const defaultSetup = getSetup(config)

  // Define v0 modules
  const v0ModuleInputs: ModuleInput[] = [
    // Same Chain Module
    {
      type: 'executor',
      address: SAME_CHAIN_MODULE_ADDRESS,
    },
    // Target Module
    {
      type: 'executor',
      address: TARGET_MODULE_ADDRESS,
    },
    // "Hook" Executor
    {
      type: 'executor',
      address: HOOK_ADDRESS,
    },
    // Fallback
    {
      type: 'fallback',
      address: TARGET_MODULE_ADDRESS,
      initData: encodeAbiParameters(
        [
          { name: 'selector', type: 'bytes4' },
          { name: 'flags', type: 'bytes1' },
          { name: 'data', type: 'bytes' },
        ],
        ['0x3a5be8cb', '0x00', '0x'],
      ),
    },
  ]

  // Convert and categorize v0 modules once
  const v0Modules = v0ModuleInputs.map((m) => getModule(m))
  const v0Validators = v0Modules.filter(
    (m) => m.type === MODULE_TYPE_ID_VALIDATOR,
  )
  const v0Executors = v0Modules.filter(
    (m) => m.type === MODULE_TYPE_ID_EXECUTOR,
  )
  const v0Fallbacks = v0Modules.filter(
    (m) => m.type === MODULE_TYPE_ID_FALLBACK,
  )
  const v0Hooks = v0Modules.filter((m) => m.type === MODULE_TYPE_ID_HOOK)

  // Merge directly with default setup
  return {
    validators: [...v0Validators, ...defaultSetup.validators],
    executors: [...v0Executors, ...defaultSetup.executors],
    fallbacks: [...v0Fallbacks, ...defaultSetup.fallbacks],
    hooks: [...v0Hooks, ...defaultSetup.hooks],
  }
}

export { getV0Attesters, getV0Setup }
