import {
  type Address,
  type Chain,
  createPublicClient,
  encodeAbiParameters,
  encodePacked,
  type Hex,
  http,
  keccak256,
} from 'viem'

import { getAddress, getSmartAccount } from '../accounts'
import { getBundlerClient } from '../accounts/utils'
import {
  getAccountEIP712Domain,
  getEnableSessionCall,
  getPermissionId,
  getSessionAllowedERC7739Content,
  isSessionEnabled,
} from '../modules/validators'
import type { OrderPath } from '../orchestrator'
import { hashMultichainCompactWithoutDomainSeparator } from '../orchestrator/utils'
import type { RhinestoneAccountConfig, Session } from '../types'

async function enableSmartSession(
  chain: Chain,
  config: RhinestoneAccountConfig,
  session: Session,
) {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })
  const address = getAddress(config)
  const isEnabled = await isSessionEnabled(
    publicClient,
    address,
    getPermissionId(session),
  )
  if (isEnabled) {
    return
  }
  const smartAccount = await getSmartAccount(config, publicClient, chain)
  const bundlerClient = getBundlerClient(config, publicClient)
  const enableSessionCall = await getEnableSessionCall(chain, session)
  const opHash = await bundlerClient.sendUserOperation({
    account: smartAccount,
    calls: [enableSessionCall],
  })
  await bundlerClient.waitForUserOperationReceipt({
    hash: opHash,
  })
}

async function hashErc7739(
  sourceChain: Chain,
  orderPath: OrderPath,
  accountAddress: Address,
) {
  const publicClient = createPublicClient({
    chain: sourceChain,
    transport: http(),
  })

  const { appDomainSeparator, contentsType } =
    await getSessionAllowedERC7739Content(sourceChain)
  // Create hash following ERC-7739 TypedDataSign workflow
  const typedDataSignTypehash = keccak256(
    encodePacked(
      ['string'],
      [
        'TypedDataSign(MultichainCompact contents,string name,string version,uint256 chainId,address verifyingContract,bytes32 salt)'.concat(
          contentsType,
        ),
      ],
    ),
  )
  // Original struct hash
  const structHash = hashMultichainCompactWithoutDomainSeparator(
    orderPath[0].orderBundle,
  )
  const { name, version, chainId, verifyingContract, salt } =
    await getAccountEIP712Domain(publicClient, accountAddress)
  // Final hash according to ERC-7739
  const hash = keccak256(
    encodePacked(
      ['bytes2', 'bytes32', 'bytes32'],
      [
        '0x1901',
        appDomainSeparator,
        keccak256(
          encodeAbiParameters(
            [
              { name: 'typedDataSignTypehash', type: 'bytes32' },
              { name: 'structHash', type: 'bytes32' },
              { name: 'name', type: 'bytes32' },
              { name: 'version', type: 'bytes32' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
              { name: 'salt', type: 'bytes32' },
            ],
            [
              typedDataSignTypehash,
              structHash,
              keccak256(encodePacked(['string'], [name])),
              keccak256(encodePacked(['string'], [version])),
              BigInt(Number(chainId)),
              verifyingContract,
              salt,
            ],
          ),
        ),
      ],
    ),
  )

  return {
    hash,
    appDomainSeparator,
    contentsType,
    structHash,
  }
}

function getSessionSignature(
  signature: Hex,
  appDomainSeparator: Hex,
  structHash: Hex,
  contentsType: string,
  withSession: Session,
) {
  const erc7739Signature = encodePacked(
    ['bytes', 'bytes32', 'bytes32', 'string', 'uint16'],
    [
      signature,
      appDomainSeparator,
      structHash,
      contentsType,
      contentsType.length,
    ],
  )
  // Pack with permissionId for smart session
  const wrappedSignature = encodePacked(
    ['bytes32', 'bytes'],
    [getPermissionId(withSession), erc7739Signature],
  )
  return wrappedSignature
}

export { enableSmartSession, hashErc7739, getSessionSignature }
