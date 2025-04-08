import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  Hex,
  keccak256,
  parseAbi,
  encodePacked,
  zeroAddress,
  concat,
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

const NEXUS_IMPLEMENTATION_ADDRESS: Address =
  '0x000000004f43c49e93c970e84001853a70923b03'
const NEXUS_FACTORY_ADDRESS: Address =
  '0x000000001D1D5004a02bAfAb9de2D6CE5b7B13de'
const NEXUS_BOOTSTRAP_ADDRESS: Address =
  '0x00000000D3254452a909E4eeD47455Af7E27C289'

async function getDeployArgs(config: RhinestoneAccountConfig) {
  const salt = keccak256('0x')
  const initData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'bytes' }],
    [
      NEXUS_BOOTSTRAP_ADDRESS,
      encodeFunctionData({
        abi: parseAbi([
          'struct BootstrapConfig {address module;bytes initData;}',
          'struct BootstrapPreValidationHookConfig {uint256 hookType;address module;bytes data;}',
          'struct RegistryConfig {address registry;address[] attesters;uint8 threshold;}',
          'function initNexus(BootstrapConfig[] calldata validators,BootstrapConfig[] calldata executors,BootstrapConfig calldata hook,BootstrapConfig[] calldata fallbacks,BootstrapPreValidationHookConfig[] calldata preValidationHooks,RegistryConfig registryConfig) external',
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
          [],
          {
            registry: RHINESTONE_MODULE_REGISTRY_ADDRESS,
            attesters: [
              RHINESTONE_ATTESTER_ADDRESS,
              OMNI_ACCOUNT_MOCK_ATTESTER_ADDRESS,
            ],
            threshold: 1,
          },
        ],
      }),
    ],
  )
  const factoryData = encodeFunctionData({
    abi: parseAbi(['function createAccount(bytes,bytes32)']),
    functionName: 'createAccount',
    args: [initData, salt],
  })

  const creationCode =
    '0x60806040526102aa803803806100148161018c565b92833981016040828203126101885781516001600160a01b03811692909190838303610188576020810151906001600160401b03821161018857019281601f8501121561018857835161006e610069826101c5565b61018c565b9481865260208601936020838301011161018857815f926020809301865e8601015260017f90b772c2cb8a51aa7a8a65fc23543c6d022d5b3f8e2b92eed79fba7eef8293005d823b15610176577f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc80546001600160a01b031916821790557fbc7cd75a20ee27fd9adebab32041f755214dbc6bffa90cc0225b39da2e5c2d3b5f80a282511561015e575f8091610146945190845af43d15610156573d91610137610069846101c5565b9283523d5f602085013e6101e0565b505b604051606b908161023f8239f35b6060916101e0565b50505034156101485763b398979f60e01b5f5260045ffd5b634c9c8ce360e01b5f5260045260245ffd5b5f80fd5b6040519190601f01601f191682016001600160401b038111838210176101b157604052565b634e487b7160e01b5f52604160045260245ffd5b6001600160401b0381116101b157601f01601f191660200190565b9061020457508051156101f557805190602001fd5b63d6bda27560e01b5f5260045ffd5b81511580610235575b610215575090565b639996b31560e01b5f9081526001600160a01b0391909116600452602490fd5b50803b1561020d56fe60806040523615605c575f8073ffffffffffffffffffffffffffffffffffffffff7f360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc5416368280378136915af43d5f803e156058573d5ff35b3d5ffd5b00fea164736f6c634300081b000a'
  const initializationCallData = encodeFunctionData({
    abi: parseAbi(['function initializeAccount(bytes)']),
    functionName: 'initializeAccount',
    args: [initData],
  })
  const accountInitData = encodeAbiParameters(
    [
      {
        name: 'address',
        type: 'address',
      },
      {
        name: 'calldata',
        type: 'bytes',
      },
    ],
    [NEXUS_IMPLEMENTATION_ADDRESS, initializationCallData],
  )
  const hashedInitcode: Hex = keccak256(concat([creationCode, accountInitData]))

  return {
    factory: NEXUS_FACTORY_ADDRESS,
    factoryData,
    salt,
    hashedInitcode,
  }
}

export { getDeployArgs }
