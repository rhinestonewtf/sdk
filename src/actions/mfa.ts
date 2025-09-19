import { encodeFunctionData, type Hex, padHex, toHex } from 'viem'
import type { RhinestoneAccount } from '..'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import {
  getMultiFactorValidator,
  getValidator,
  MULTI_FACTOR_VALIDATOR_ADDRESS,
} from '../modules/validators/core'
import type {
  Call,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
} from '../types'

/**
 * Enable multi-factor authentication
 * @param rhinestoneAccount Account to enable multi-factor authentication on
 * @param validators List of validators to use
 * @param threshold Threshold for the validators
 * @returns Calls to enable multi-factor authentication
 */
function enable({
  rhinestoneAccount,
  validators,
  threshold = 1,
}: {
  rhinestoneAccount: RhinestoneAccount
  validators: (OwnableValidatorConfig | WebauthnValidatorConfig | null)[]
  threshold?: number
}) {
  const module = getMultiFactorValidator(threshold, validators)
  const calls = getModuleInstallationCalls(rhinestoneAccount.config, module)
  return calls
}

/**
 * Change the multi-factor threshold
 * @param newThreshold New threshold
 * @returns Call to change the threshold
 */
function changeThreshold(newThreshold: number): Call {
  return {
    to: MULTI_FACTOR_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [{ internalType: 'uint8', name: 'threshold', type: 'uint8' }],
          name: 'setThreshold',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'setThreshold',
      args: [newThreshold],
    }),
  }
}

/**
 * Disable multi-factor authentication
 * @param rhinestoneAccount Account to disable multi-factor authentication on
 * @returns Calls to disable multi-factor authentication
 */
function disable({
  rhinestoneAccount,
}: {
  rhinestoneAccount: RhinestoneAccount
}) {
  const module = getMultiFactorValidator(1, [])
  const calls = getModuleUninstallationCalls(rhinestoneAccount.config, module)
  return calls
}

/**
 * Set a sub-validator (multi-factor)
 * @param id Validator ID
 * @param validator Validator module
 * @returns Call to set the sub-validator
 */
function setSubValidator(
  id: Hex | number,
  validator: OwnableValidatorConfig | WebauthnValidatorConfig,
): Call {
  const validatorId = padHex(toHex(id), { size: 12 })
  const validatorModule = getValidator(validator)
  return {
    to: MULTI_FACTOR_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'setValidator',
          inputs: [
            {
              type: 'address',
              name: 'validatorAddress',
            },
            {
              type: 'bytes12',
              name: 'validatorId',
            },
            {
              type: 'bytes',
              name: 'newValidatorData',
            },
          ],
        },
      ],
      functionName: 'setValidator',
      args: [validatorModule.address, validatorId, validatorModule.initData],
    }),
  }
}

/**
 * Remove a sub-validator (multi-factor)
 * @param id Validator ID
 * @param validator Validator module
 * @returns Call to remove the sub-validator
 */
function removeSubValidator(
  id: Hex | number,
  validator: OwnableValidatorConfig | WebauthnValidatorConfig,
): Call {
  const validatorId = padHex(toHex(id), { size: 12 })
  const validatorModule = getValidator(validator)
  return {
    to: MULTI_FACTOR_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'removeValidator',
          inputs: [
            {
              type: 'address',
              name: 'validatorAddress',
            },
            {
              type: 'bytes12',
              name: 'validatorId',
            },
          ],
        },
      ],
      functionName: 'removeValidator',
      args: [validatorModule.address, validatorId],
    }),
  }
}

export { enable, changeThreshold, disable, setSubValidator, removeSubValidator }
