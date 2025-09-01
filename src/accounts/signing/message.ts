import {
  type Account,
  type Address,
  type Chain,
  concat,
  type Hex,
  parseSignature,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/account-abstraction'
import type { SignerSet } from '../../types'
import { SigningNotSupportedForAccountError } from '../error'
import {
  type SigningFunctions,
  signWithGuardians,
  signWithOwners,
  signWithSession,
} from './common'

async function sign(
  signers: SignerSet,
  chain: Chain,
  address: Address,
  hash: Hex,
): Promise<Hex> {
  const signingFunctions: SigningFunctions<Hex> = {
    signEcdsa: (account, hash, updateV) => signEcdsa(account, hash, updateV),
    signPasskey: (account, hash) => signPasskey(account, hash),
  }

  switch (signers.type) {
    case 'owner': {
      return signWithOwners(
        signers,
        chain,
        address,
        hash,
        signingFunctions,
        sign,
      )
    }
    case 'session': {
      return signWithSession(signers, chain, address, hash, sign)
    }
    case 'guardians': {
      return signWithGuardians(signers, hash, signingFunctions)
    }
  }
}

async function signEcdsa(account: Account, hash: Hex, updateV: boolean) {
  if (!account.signMessage) {
    throw new SigningNotSupportedForAccountError()
  }
  const originalSignature = await account.signMessage({
    message: { raw: hash },
  })
  // Manually tweak the `v` value to trigger the message prefixing onchain
  // https://github.com/rhinestonewtf/checknsignatures/blob/main/src/CheckNSignatures.sol#L53-L61
  const { r, s, v } = parseSignature(originalSignature)
  if (!v) {
    throw new Error('Invalid signature')
  }
  const newV = updateV ? v + 4n : v
  const newSignature = concat([r, s, toHex(newV)])
  return newSignature
}

async function signPasskey(account: WebAuthnAccount, hash: Hex) {
  const { webauthn, signature } = await account.sign({ hash })
  return {
    webauthn,
    signature,
  }
}

export { sign }
