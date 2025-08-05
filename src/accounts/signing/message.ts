import {
  type Account,
  type Chain,
  concat,
  type Hex,
  parseSignature,
  toHex,
} from 'viem'
import type { WebAuthnAccount } from 'viem/_types/account-abstraction'
import {
  getWebauthnValidatorSignature,
  isRip7212SupportedNetwork,
} from '../../modules'
import type { SignerSet } from '../../types'
import { SigningNotSupportedForAccountError } from '../error'
import {
  type SigningFunctions,
  signWithGuardians,
  signWithOwners,
  signWithSession,
} from './common'

async function sign(signers: SignerSet, chain: Chain, hash: Hex): Promise<Hex> {
  const signingFunctions: SigningFunctions<Hex> = {
    signEcdsa: (account, hash) => signEcdsa(account, hash),
    signPasskey: (account, chain, hash) => signPasskey(account, chain, hash),
  }

  switch (signers.type) {
    case 'owner': {
      return signWithOwners(signers, chain, hash, signingFunctions, sign)
    }
    case 'session': {
      return signWithSession(signers, chain, hash, sign)
    }
    case 'guardians': {
      return signWithGuardians(signers, hash, signingFunctions)
    }
  }
}

async function signEcdsa(account: Account, hash: Hex) {
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
  const newV = v + 4n
  const newSignature = concat([r, s, toHex(newV)])
  return newSignature
}

async function signPasskey(account: WebAuthnAccount, chain: Chain, hash: Hex) {
  const { webauthn, signature } = await account.sign({ hash })
  const usePrecompiled = isRip7212SupportedNetwork(chain)
  const encodedSignature = getWebauthnValidatorSignature({
    webauthn,
    signature,
    usePrecompiled,
  })
  return encodedSignature
}

export { sign }
