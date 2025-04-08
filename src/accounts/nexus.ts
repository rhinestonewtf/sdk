import {
  type Address,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  Hex,
  keccak256,
  parseAbi,
  encodePacked,
  zeroAddress,
} from 'viem'

import { RhinestoneAccountConfig } from '../types'
import {
  getValidator,
  OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
  RHINESTONE_ATTESTER_ADDRESS,
  RHINESTONE_MODULE_REGISTRY_ADDRESS,
} from '../modules'
import {
  HOOK_ADDRESS,
  SAME_CHAIN_MODULE_ADDRESS,
  TARGET_MODULE_ADDRESS,
} from '../orchestrator'

const NEXUS_FACTORY_ADDRESS: Address =
  '0x000000c3A93d2c5E02Cb053AC675665b1c4217F9'
const NEXUS_BOOTSTRAP_ADDRESS: Address =
  '0x879fa30248eeb693dcCE3eA94a743622170a3658'

async function getDeployArgs(config: RhinestoneAccountConfig) {
  const salt = keccak256('0x')
  const initData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [
      NEXUS_BOOTSTRAP_ADDRESS,
      encodeFunctionData({
        abi: parseAbi([
          'struct BootstrapConfig {address module;bytes initData;}',
          'function initNexus(BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,address registry,address[] calldata attesters,uint8 threshold) external',
        ]),
        functionName: 'initNexus',
        args: [
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
          {
            module: zeroAddress,
            initData: '0x',
          },
          [
            {
              module: TARGET_MODULE_ADDRESS,
              initData: encodePacked(
                ['bytes4', 'bytes1', 'bytes'],
                ['0x3a5be8cb', '0x00', '0x'],
              ),
            },
          ],
          RHINESTONE_MODULE_REGISTRY_ADDRESS,
          [RHINESTONE_ATTESTER_ADDRESS, OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS],
          1,
        ],
      }),
    ],
  )
  const factoryData = encodeFunctionData({
    abi: parseAbi(['function createAccount(bytes,bytes32)']),
    functionName: 'createAccount',
    args: [initData, salt],
  })

  const actualSalt = keccak256(concat([initData, salt]))
  const hashedInitcode: Hex =
    '0xbf5658acdb0d71e91f2e2ac658b87c63b81f244ccb8c0aef176c5e397e08c2ba'

  return {
    factory: NEXUS_FACTORY_ADDRESS,
    factoryData,
    salt: actualSalt,
    hashedInitcode,
  }
}

export { getDeployArgs }
