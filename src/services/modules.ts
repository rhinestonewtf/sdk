import { getWebAuthnValidator } from '@rhinestone/module-sdk'
import {
  getOwnableValidator,
  OWNABLE_VALIDATOR_ADDRESS,
  WEBAUTHN_VALIDATOR_ADDRESS,
} from '@rhinestone/module-sdk'

import { RhinestoneAccountConfig } from '../types'

function toOwners(config: RhinestoneAccountConfig) {
  return config.validators.map((validator) => {
    switch (validator.type) {
      case 'ecdsa':
        return validator.account;
      case 'passkey':
        // return validator.account;
        throw new Error('Unsupported validator type')
    }
  })
}

function getValidators(config: RhinestoneAccountConfig) {
  return config.validators.map((validator) => {
    if (validator.type === 'ecdsa') {
      return getOwnableValidator({
        owners: [validator.account.address],
        threshold: 1,
      })
    }
    if (validator.type === 'passkey') {
      return getWebAuthnValidator({
        pubKey: validator.account.publicKey,
        authenticatorId: validator.account.id,
      })
    }
    throw new Error('Unsupported validator type')
  })
}

function getModules(config: RhinestoneAccountConfig) {
  return config.validators.map((module) => {
    if (module.type === 'ecdsa') {
      return OWNABLE_VALIDATOR_ADDRESS
    }
    if (module.type === 'passkey') {
      return WEBAUTHN_VALIDATOR_ADDRESS
    }
    throw new Error('Unsupported validator type')
  })
}

export { getValidators, getModules, toOwners }
