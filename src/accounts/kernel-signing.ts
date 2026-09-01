import {
  concatHex,
  domainSeparator,
  encodeAbiParameters,
  type Hex,
  keccak256,
  stringToHex,
} from 'viem'

export function wrapKernelMessageHash(messageHash: Hex, account: Hex): Hex {
  const separator = domainSeparator({
    domain: {
      name: 'Kernel',
      version: '0.3.3',
      chainId: 0,
      verifyingContract: account,
    },
  })
  const structHash = keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }],
      [keccak256(stringToHex('Kernel(bytes32 hash)')), messageHash],
    ),
  )
  return keccak256(concatHex(['0x1901', separator, structHash]))
}
