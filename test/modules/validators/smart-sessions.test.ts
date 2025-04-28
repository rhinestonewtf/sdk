import { privateKeyToAccount } from 'viem/accounts'
import { expect, test } from 'vitest'

import { getPermissionId } from '../../../src/modules/validators/smart-sessions'

test('getPermissionId', () => {
  const accountA = privateKeyToAccount(
    '0x2be89d993f98bbaab8b83f1a2830cb9414e19662967c7ba2a0f43d2a9125bd6d',
  )
  const accountB = privateKeyToAccount(
    '0x39e2fec1a04c088f939d81de8f1abebdebf899a6cfb9968f9b663a7afba8301b',
  )

  expect(
    getPermissionId({
      owners: {
        type: 'ecdsa',
        accounts: [accountA, accountB],
      },
    }),
  ).toBe('0xa16d89135da22ae1b97b6ac6ebc047dce282640bbbf56059958d96527b720344')

  expect(
    getPermissionId({
      owners: {
        type: 'ecdsa',
        accounts: [accountA, accountB],
      },
      salt: '0x97340e1cfff3319c76ef22b2bc9d3231071d550125d68c9d4a8972823f166320',
    }),
  ).toBe('0x85ff7cd77e7e0f8fbc2e42c86cdb948e4c79ac5a5e4595def4c38d7ed804eef9')
})
