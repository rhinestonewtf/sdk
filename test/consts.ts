import {
  toWebAuthnAccount,
  type WebAuthnAccount,
} from 'viem/account-abstraction'
import { type Account, privateKeyToAccount } from 'viem/accounts'

const accountA: Account = privateKeyToAccount(
  '0x2be89d993f98bbaab8b83f1a2830cb9414e19662967c7ba2a0f43d2a9125bd6d',
)
const accountB: Account = privateKeyToAccount(
  '0x39e2fec1a04c088f939d81de8f1abebdebf899a6cfb9968f9b663a7afba8301b',
)
const accountC: Account = privateKeyToAccount(
  '0xb63c74af219a3949cf95f5e3a3d20b0137425de053bb03e5cc0f46fe0d19f22f',
)
const accountD: Account = privateKeyToAccount(
  '0xa4aba81871b7b51fff56bfe441ea7f9a4879dd4bc8ce8c15fdb06dc92e63d1d7',
)
// 0xaa7d… and 0xb1a4…: byte order and Danish-family collation disagree on this
// pair, so ordering bugs are visible in the derived address.
const collationAccountLow: Account = privateKeyToAccount(
  '0x20438a6e377aee6f3ecd82abbe9710ad5aa29586b54ebe2b2992171d0adbcd40',
)
const collationAccountHigh: Account = privateKeyToAccount(
  '0x29b0743c3c66dd86fd3cc92b157925232de9aadef57dedd8bc079b6d92af7d87',
)
// 0xb4b51Dd5… and 0xB55a34a8…: checksum casing inverts their value order, so
// sorting the checksummed text yields a list the validator rejects.
const casingAccountLow: Account = privateKeyToAccount(
  '0x73933815d0ed675d1c67b941320f20a7c11ae258d8f9304fdac5c0c9065a2945',
)
const casingAccountHigh: Account = privateKeyToAccount(
  '0x4fba6dd55fe9650812ae445065c5aec276353ae7224e2f544c575f8403b8b633',
)
const passkeyAccount: WebAuthnAccount = toWebAuthnAccount({
  credential: {
    id: '9IwX9n6cn-l9SzqFzfQXvDHRuTM',
    publicKey:
      '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1',
  },
})

const MOCK_API_KEY = 'MOCK_KEY'

export {
  accountA,
  accountB,
  accountC,
  accountD,
  casingAccountHigh,
  casingAccountLow,
  collationAccountHigh,
  collationAccountLow,
  passkeyAccount,
  MOCK_API_KEY,
}
