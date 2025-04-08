import {
  type Address,
  concat,
  encodeAbiParameters,
  encodeFunctionData,
  Hex,
  keccak256,
  parseAbi,
} from 'viem'
import { encodePacked } from 'viem'
import { RhinestoneAccountConfig } from '../../types'
import { getValidator, RHINESTONE_ATTESTER_ADDRESS } from '../modules'
import {
  HOOK_ADDRESS,
  SAME_CHAIN_MODULE_ADDRESS,
  TARGET_MODULE_ADDRESS,
} from '../orchestrator'

const NEXUS_FACTORY_ADDRESS: Address =
  '0x000000c3A93d2c5E02Cb053AC675665b1c4217F9'

async function getDeployArgs(config: RhinestoneAccountConfig) {
  const salt = keccak256('0x')
  const initData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [
      '0x879fa30248eeb693dcCE3eA94a743622170a3658',
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
            module: HOOK_ADDRESS,
            initData: encodeAbiParameters(
              [{ name: 'value', type: 'bool' }],
              [true],
            ),
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
          '0x000000000069E2a187AEFFb852bF3cCdC95151B2',
          [
            RHINESTONE_ATTESTER_ADDRESS, // Rhinestone Attester
            '0x6D0515e8E499468DCe9583626f0cA15b887f9d03', // Mock attester for omni account
          ],
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
