import {
  Chain,
  createPublicClient,
  http,
  encodeAbiParameters,
  Address,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  Account,
  createWalletClient,
  size,
  keccak256,
  encodePacked,
  slice,
  Hex,
} from 'viem'
import {
  HOOK_ADDRESS,
  SAME_CHAIN_MODULE_ADDRESS,
  TARGET_MODULE_ADDRESS,
} from './orchestrator'

import { RhinestoneAccountConfig } from '../types'
import {
  getValidator,
  toOwners,
  SAFE_7579_LAUNCHPAD_ADDRESS,
  SAFE_7579_ADAPTER_ADDRESS,
  OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
  RHINESTONE_ATTESTER_ADDRESS,
} from './modules'

const SAFE_SINGLETON_ADDRESS: Address =
  '0x29fcb43b46531bca003ddc8fcb67ffe91900c762'
const SAFE_PROXY_FACTORY_ADDRESS: Address =
  '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67'

async function getAddress(chain: Chain, config: RhinestoneAccountConfig) {
  const { factory, salt, hashedInitcode } = await getDeployArgs(chain, config)
  const hash = keccak256(
    encodePacked(
      ['bytes1', 'address', 'bytes32', 'bytes'],
      ['0xff', factory, salt, hashedInitcode],
    ),
  )
  const address = slice(hash, 12, 32)
  return address
}

async function isDeployed(chain: Chain, config: RhinestoneAccountConfig) {
  const publicClient = createPublicClient({
    chain: chain,
    transport: http(),
  })
  const address = await getAddress(chain, config)
  const code = await publicClient.getCode({
    address,
  })
  if (!code) {
    return false
  }
  if (code.startsWith('0xef0100') && code.length === 48) {
    throw new Error('EIP-7702 accounts are not yet supported')
  }
  return size(code) > 0
}

async function deploy(
  deployer: Account,
  chain: Chain,
  config: RhinestoneAccountConfig,
) {
  const { factory, factoryData } = await getDeployArgs(chain, config)
  const publicClient = createPublicClient({
    chain: chain,
    transport: http(),
  })
  const client = createWalletClient({
    account: deployer,
    chain: chain,
    transport: http(),
  })
  const tx = await client.sendTransaction({
    to: factory,
    data: factoryData,
  })
  await publicClient.waitForTransactionReceipt({ hash: tx })
}

async function getDeployArgs(
  targetChain: Chain,
  config: RhinestoneAccountConfig,
) {
  switch (config.account.type) {
    case 'safe': {
      const owners = toOwners(config)
      const initializer = encodeFunctionData({
        abi: parseAbi([
          'function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external',
        ]),
        functionName: 'setup',
        args: [
          owners,
          BigInt(1),
          SAFE_7579_LAUNCHPAD_ADDRESS,
          encodeFunctionData({
            abi: parseAbi([
              'struct ModuleInit {address module;bytes initData;}',
              'function addSafe7579(address safe7579,ModuleInit[] calldata validators,ModuleInit[] calldata executors,ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,address[] calldata attesters,uint8 threshold) external',
            ]),
            functionName: 'addSafe7579',
            args: [
              SAFE_7579_ADAPTER_ADDRESS,
              [
                {
                  module: getValidator(config).address,
                  initData: getValidator(config).initData,
                },
              ],
              [
                {
                  module: SAME_CHAIN_MODULE_ADDRESS,
                  initData: '0x',
                },
                {
                  module: TARGET_MODULE_ADDRESS,
                  initData: '0x',
                },
                {
                  module: HOOK_ADDRESS,
                  initData: '0x',
                },
              ],
              [
                {
                  module: TARGET_MODULE_ADDRESS,
                  initData: encodeAbiParameters(
                    [
                      { name: 'selector', type: 'bytes4' },
                      { name: 'flags', type: 'bytes1' },
                      { name: 'data', type: 'bytes' },
                    ],
                    ['0x3a5be8cb', '0x00', '0x'],
                  ),
                },
              ],
              [
                {
                  module: HOOK_ADDRESS,
                  initData: encodeAbiParameters(
                    [
                      { name: 'hookType', type: 'uint256' },
                      { name: 'hookId', type: 'bytes4' },
                      { name: 'data', type: 'bytes' },
                    ],
                    [
                      0n,
                      '0x00000000',
                      encodeAbiParameters(
                        [{ name: 'value', type: 'bool' }],
                        [true],
                      ),
                    ],
                  ),
                },
              ],
              [RHINESTONE_ATTESTER_ADDRESS, OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS],
              1,
            ],
          }),
          SAFE_7579_ADAPTER_ADDRESS,
          zeroAddress,
          BigInt(0),
          zeroAddress,
        ],
      })

      const saltNonce = 0n
      const factoryData = encodeFunctionData({
        abi: parseAbi([
          'function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)',
        ]),
        functionName: 'createProxyWithNonce',
        args: [SAFE_SINGLETON_ADDRESS, initializer, saltNonce],
      })

      const salt = keccak256(
        encodePacked(
          ['bytes32', 'uint256'],
          [keccak256(initializer), saltNonce],
        ),
      )

      const hashedInitcode: Hex =
        '0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee'

      return {
        factory: SAFE_PROXY_FACTORY_ADDRESS,
        factoryData,
        salt,
        hashedInitcode,
      }
    }
  }
}

export { getAddress, isDeployed, getDeployArgs, deploy }
