import type { OwnerSet, SignerSet } from '../../types'

function convertOwnerSetToSignerSet(owners: OwnerSet): SignerSet {
  switch (owners.type) {
    case 'ecdsa': {
      return {
        type: 'owner',
        kind: 'ecdsa',
        accounts: owners.accounts,
      }
    }
    case 'passkey': {
      return {
        type: 'owner',
        kind: 'passkey',
        account: owners.account,
      }
    }
    case 'multi-factor': {
      return {
        type: 'owner',
        kind: 'multi-factor',
        validators: owners.validators.map((validator, index) => {
          switch (validator.type) {
            case 'ecdsa': {
              return {
                type: 'ecdsa',
                id: index,
                accounts: validator.accounts,
              }
            }
            case 'passkey': {
              return {
                type: 'passkey',
                id: index,
                account: validator.account,
              }
            }
          }
        }),
      }
    }
  }
}

export { convertOwnerSetToSignerSet }
