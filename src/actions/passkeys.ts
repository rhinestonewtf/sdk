import { encodeFunctionData } from 'viem'
import {
  getModuleInstallationCalls,
  getModuleUninstallationCalls,
} from '../accounts'
import {
  getWebAuthnValidator,
  WEBAUTHN_VALIDATOR_ADDRESS,
  type WebauthnCredential,
} from '../modules/validators/core'
import type { CalldataInput, LazyCallInput } from '../types'

/**
 * Enable passkeys authentication
 * @param pubKey Public key for the passkey
 * @param authenticatorId Authenticator ID for the passkey
 * @returns Calls to enable passkeys authentication
 */
function enable({
  pubKey,
  authenticatorId,
}: WebauthnCredential): LazyCallInput {
  const module = getWebAuthnValidator(1, [{ pubKey, authenticatorId }])
  return {
    async resolve({ config }) {
      return getModuleInstallationCalls(config, module)
    },
  }
}

/**
 * Disable passkeys (WebAuthn) authentication
 * @returns Calls to disable passkeys authentication
 */
function disable(): LazyCallInput {
  const module = getWebAuthnValidator(1, [
    {
      // Mocked values
      pubKey:
        '0x580a9af0569ad3905b26a703201b358aa0904236642ebe79b22a19d00d3737637d46f725a5427ae45a9569259bf67e1e16b187d7b3ad1ed70138c4f0409677d1',
      authenticatorId: '0x',
    },
  ])
  return {
    async resolve({ config }) {
      return getModuleUninstallationCalls(config, module)
    },
  }
}

/**
 * Add a passkey owner
 * @param pubKeyX Public key X
 * @param pubKeyY Public key Y
 * @param requireUserVerification Whether to require user verification
 * @returns Call to add the passkey owner
 */
function addOwner(
  pubKeyX: bigint,
  pubKeyY: bigint,
  requireUserVerification: boolean,
): CalldataInput {
  return {
    to: WEBAUTHN_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [
            { name: 'pubKeyX', type: 'uint256' },
            { name: 'pubKeyY', type: 'uint256' },
            {
              name: 'requireUserVerification',
              type: 'bool',
            },
          ],
          name: 'addCredential',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'addCredential',
      args: [pubKeyX, pubKeyY, requireUserVerification],
    }),
  }
}

/**
 * Remove a passkey owner
 * @param pubKeyX Public key X
 * @param pubKeyY Public key Y
 * @returns Call to remove the passkey owner
 */
function removeOwner(pubKeyX: bigint, pubKeyY: bigint): CalldataInput {
  return {
    to: WEBAUTHN_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [
            { name: 'pubKeyX', type: 'uint256' },
            { name: 'pubKeyY', type: 'uint256' },
          ],
          name: 'removeCredential',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'removeCredential',
      args: [pubKeyX, pubKeyY],
    }),
  }
}

/**
 * Change an account's signer threshold (passkey)
 * @param newThreshold New threshold
 * @returns Call to change the threshold
 */
function changeThreshold(newThreshold: number): CalldataInput {
  return {
    to: WEBAUTHN_VALIDATOR_ADDRESS,
    value: 0n,
    data: encodeFunctionData({
      abi: [
        {
          inputs: [
            { internalType: 'uint256', name: '_threshold', type: 'uint256' },
          ],
          name: 'setThreshold',
          outputs: [],
          stateMutability: 'nonpayable',
          type: 'function',
        },
      ],
      functionName: 'setThreshold',
      args: [BigInt(newThreshold)],
    }),
  }
}

export { addOwner, removeOwner, changeThreshold, disable, enable }
