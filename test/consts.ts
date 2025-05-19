import { toWebAuthnAccount, WebAuthnAccount } from 'viem/account-abstraction'
import { Account, privateKeyToAccount } from 'viem/accounts'

const accountA: Account = privateKeyToAccount(
  '0x2be89d993f98bbaab8b83f1a2830cb9414e19662967c7ba2a0f43d2a9125bd6d',
)
const accountB: Account = privateKeyToAccount(
  '0x39e2fec1a04c088f939d81de8f1abebdebf899a6cfb9968f9b663a7afba8301b',
)
const accountC: Account = privateKeyToAccount(
  '0xb63c74af219a3949cf95f5e3a3d20b0137425de053bb03e5cc0f46fe0d19f22f',
)
const passkeyAccount: WebAuthnAccount = toWebAuthnAccount({
  credential: {
    id: '9IwX9n6cn-l9SzqFzfQXvDHRuTM',
    publicKey:
      '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1',
  },
})

const MOCK_API_KEY = 'MOCK_KEY'

export { accountA, accountB, accountC, passkeyAccount, MOCK_API_KEY }
