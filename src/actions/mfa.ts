import { encodeFunctionData, type Hex, padHex, toHex } from 'viem'
import type {
  CalldataInput,
  LazyCallInput,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
} from '../config/account'
import { defineValidator } from '../modules/validators/definition'
import { MULTI_FACTOR_VALIDATOR_ADDRESS } from '../modules/validators/multi-factor'
import { resolveValidator } from '../modules/validators/resolve'
import type {
  AtomicValidatorDefinition,
  AtomicValidatorInput,
  MultiFactorValidatorDefinition,
} from '../modules/validators/types'
import {
  resolveModuleInstallation,
  resolveModuleUninstallation,
} from './runtime'

type MfaFactor = OwnableValidatorConfig | WebauthnValidatorConfig

function factorModule(validator: MfaFactor) {
  return resolveValidator(defineValidator(validator as AtomicValidatorInput))
}

function multiFactorModule(
  validators: readonly (MfaFactor | null)[],
  threshold: number,
) {
  const definition: MultiFactorValidatorDefinition = {
    kind: 'multi-factor',
    id: 'action/multi-factor',
    publicId: 0,
    module: { source: 'default', profile: 'multi-factor' },
    validators: validators.flatMap((validator, index) =>
      validator
        ? [
            defineValidator(
              validator as AtomicValidatorInput,
              `action/multi-factor/${index}`,
              index,
            ) as AtomicValidatorDefinition,
          ]
        : [],
    ),
    threshold,
  }
  return resolveValidator(definition)
}

/**
 * Enable multi-factor authentication
 * @param validators List of validators to use
 * @param threshold Threshold for the validators
 * @returns Calls to enable multi-factor authentication
 */
function enable(
  validators: (OwnableValidatorConfig | WebauthnValidatorConfig | null)[],
  threshold = 1,
): LazyCallInput {
  const module = multiFactorModule(validators, threshold)
  return {
    async resolve(context) {
      return resolveModuleInstallation(context, module)
    },
  }
}

/**
 * Change the multi-factor threshold
 * @param newThreshold New threshold
 * @returns Call to change the threshold
 */
function changeThreshold(newThreshold: number): CalldataInput {
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
function disable(): LazyCallInput {
  const module = multiFactorModule([], 1)
  return {
    async resolve(context) {
      return resolveModuleUninstallation(context, module)
    },
  }
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
): CalldataInput {
  const validatorId = padHex(toHex(id), { size: 12 })
  const validatorModule = factorModule(validator)
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
): CalldataInput {
  const validatorId = padHex(toHex(id), { size: 12 })
  const validatorModule = factorModule(validator)
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
