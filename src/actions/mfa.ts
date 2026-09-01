import { type Address, encodeFunctionData, type Hex, padHex, toHex } from 'viem'
import type {
  CalldataInput,
  LazyCallInput,
  OwnableValidatorConfig,
  WebauthnValidatorConfig,
} from '../config/account'
import { defineValidator } from '../modules/validators/definition'
import { MULTI_FACTOR_VALIDATOR_ADDRESS } from '../modules/validators/multi-factor'
import {
  resolveAtomicValidator,
  resolveAtomicValidatorStatelessData,
  resolveValidator,
} from '../modules/validators/resolve'
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

function factorDefinition(validator: MfaFactor) {
  return defineValidator(
    validator as AtomicValidatorInput,
  ) as AtomicValidatorDefinition
}

function factorModule(validator: MfaFactor) {
  return resolveValidator(factorDefinition(validator))
}

function multiFactorModule(
  validators: readonly (MfaFactor | null)[],
  threshold: number,
  moduleAddress?: Address,
) {
  const definition: MultiFactorValidatorDefinition = {
    kind: 'multi-factor',
    id: 'action/multi-factor',
    publicId: 0,
    module: moduleAddress
      ? { source: 'explicit', address: moduleAddress }
      : { source: 'default', profile: 'multi-factor' },
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
 * @param moduleAddress Multi-factor module to install. Defaults to the legacy module.
 * @returns Calls to enable multi-factor authentication
 */
function enable(
  validators: (OwnableValidatorConfig | WebauthnValidatorConfig | null)[],
  threshold = 1,
  moduleAddress?: Address,
): LazyCallInput {
  const module = multiFactorModule(validators, threshold, moduleAddress)
  return {
    async resolve(context) {
      return resolveModuleInstallation(context, module)
    },
  }
}

/**
 * Change the multi-factor threshold
 * @param newThreshold New threshold
 * @param moduleAddress Multi-factor module to update. Defaults to the legacy module.
 * @returns Call to change the threshold
 */
function changeThreshold(
  newThreshold: number,
  moduleAddress: Address = MULTI_FACTOR_VALIDATOR_ADDRESS,
): CalldataInput {
  return {
    to: moduleAddress,
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
 * @param moduleAddress Multi-factor module to uninstall. Defaults to the legacy module.
 * @returns Calls to disable multi-factor authentication
 */
function disable(moduleAddress?: Address): LazyCallInput {
  const module = multiFactorModule([], 1, moduleAddress)
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
 * @param moduleAddress Multi-factor module to update. Defaults to the legacy module.
 * @returns Call to set the sub-validator
 */
function setSubValidator(
  id: Hex | number,
  validator: OwnableValidatorConfig | WebauthnValidatorConfig,
  moduleAddress: Address = MULTI_FACTOR_VALIDATOR_ADDRESS,
): CalldataInput {
  const validatorId = padHex(toHex(id), { size: 12 })
  const definition = factorDefinition(validator)
  return {
    to: moduleAddress,
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
      args: [
        resolveAtomicValidator(definition).address,
        validatorId,
        resolveAtomicValidatorStatelessData(definition),
      ],
    }),
  }
}

/**
 * Remove a sub-validator (multi-factor)
 * @param id Validator ID
 * @param validator Validator module
 * @param moduleAddress Multi-factor module to update. Defaults to the legacy module.
 * @returns Call to remove the sub-validator
 */
function removeSubValidator(
  id: Hex | number,
  validator: OwnableValidatorConfig | WebauthnValidatorConfig,
  moduleAddress: Address = MULTI_FACTOR_VALIDATOR_ADDRESS,
): CalldataInput {
  const validatorId = padHex(toHex(id), { size: 12 })
  const validatorModule = factorModule(validator)
  return {
    to: moduleAddress,
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
