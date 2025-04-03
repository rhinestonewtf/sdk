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
} from 'viem'
import {
  RHINESTONE_ATTESTER_ADDRESS,
} from '@rhinestone/module-sdk'
import {
  getHookAddress,
  getSameChainModuleAddress,
  getTargetModuleAddress
} from '@rhinestone/orchestrator-sdk'

import { RhinestoneAccountConfig } from '../types'
import { toOwners } from './modules'
import { getValidators } from './modules'

async function getAddress(chain: Chain, config: RhinestoneAccountConfig) {
  const { factory, initializer } = await getDeployArgs(chain, config)
  const saltNonce = 0n;
  const salt = keccak256(encodePacked(['bytes32', 'uint256'], [keccak256(initializer), saltNonce]))
  const initcode = '0x608060405234801561001057600080fd5b506040516101e63803806101e68339818101604052602081101561003357600080fd5b8101908080519060200190929190505050600073ffffffffffffffffffffffffffffffffffffffff168173ffffffffffffffffffffffffffffffffffffffff1614156100ca576040517f08c379a00000000000000000000000000000000000000000000000000000000081526004018080602001828103825260228152602001806101c46022913960400191505060405180910390fd5b806000806101000a81548173ffffffffffffffffffffffffffffffffffffffff021916908373ffffffffffffffffffffffffffffffffffffffff1602179055505060ab806101196000396000f3fe608060405273ffffffffffffffffffffffffffffffffffffffff600054167fa619486e0000000000000000000000000000000000000000000000000000000060003514156050578060005260206000f35b3660008037600080366000845af43d6000803e60008114156070573d6000fd5b3d6000f3fea264697066735822122003d1488ee65e08fa41e58e888a9865554c535f2c77126a82cb4c0f917f31441364736f6c63430007060033496e76616c69642073696e676c65746f6e20616464726573732070726f766964656400000000000000000000000029fcb43b46531bca003ddc8fcb67ffe91900c762';
  const hash = keccak256(encodePacked(['bytes1', 'address', 'bytes32', 'bytes'], ['0xff', factory, salt, keccak256(initcode)]))
  const address = slice(hash, 12, 32);
  return address;
}

async function isDeployed(chain: Chain, config: RhinestoneAccountConfig) {
  const publicClient = createPublicClient({
    chain: chain,
    transport: http(),
  });
  const address = await getAddress(chain, config);
  const code = await publicClient.getCode({
    address,
  })
  if (!code) {
    return false;
  }
  if (code.startsWith('0xef0100') && code.length === 48) {
    throw new Error('EIP-7702 accounts are not yet supported');
  }
  return size(code) > 0;
}

async function deploy(deployer: Account, chain: Chain, config: RhinestoneAccountConfig) {
  const { factory, factoryData } = await getDeployArgs(chain, config);
  const publicClient = createPublicClient({
    chain: chain,
    transport: http(),
  });
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

async function getDeployArgs(targetChain: Chain, config: RhinestoneAccountConfig) {
  switch (config.account.type) {
    case 'safe': {
      const owners = toOwners(config).map((owner) => owner.address);
      const initializer = encodeFunctionData({
        abi: parseAbi([
          "function setup(address[] calldata _owners,uint256 _threshold,address to,bytes calldata data,address fallbackHandler,address paymentToken,uint256 payment, address paymentReceiver) external",
        ]),
        functionName: "setup",
        args: [
          owners,
          BigInt(1),
          "0x7579011aB74c46090561ea277Ba79D510c6C00ff",
          encodeFunctionData({
            abi: parseAbi([
              "struct ModuleInit {address module;bytes initData;}",
              "function addSafe7579(address safe7579,ModuleInit[] calldata validators,ModuleInit[] calldata executors,ModuleInit[] calldata fallbacks, ModuleInit[] calldata hooks,address[] calldata attesters,uint8 threshold) external",
            ]),
            functionName: "addSafe7579",
            args: [
              "0x7579EE8307284F293B1927136486880611F20002",
              getValidators(config).map((validator) => ({
                module: validator.address,
                initData: validator.initData,
              })),
              [
                {
                  module: getSameChainModuleAddress(targetChain.id),
                  initData: "0x",
                },
                {
                  module: getTargetModuleAddress(targetChain.id),
                  initData: "0x",
                },
                {
                  module: getHookAddress(targetChain.id),
                  initData: "0x",
                },
              ],
              [
                {
                  module: getTargetModuleAddress(targetChain.id),
                  initData: encodeAbiParameters(
                    [
                      { name: "selector", type: "bytes4" },
                      { name: "flags", type: "bytes1" },
                      { name: "data", type: "bytes" },
                    ],
                    ["0x3a5be8cb", "0x00", "0x"],
                  ),
                },
              ],
              [
                {
                  module: getHookAddress(targetChain.id),
                  initData: encodeAbiParameters(
                    [
                      { name: "hookType", type: "uint256" },
                      { name: "hookId", type: "bytes4" },
                      { name: "data", type: "bytes" },
                    ],
                    [
                      0n,
                      "0x00000000",
                      encodeAbiParameters(
                        [{ name: "value", type: "bool" }],
                        [true],
                      ),
                    ],
                  ),
                },
              ],
              [
                RHINESTONE_ATTESTER_ADDRESS,
                "0x6D0515e8E499468DCe9583626f0cA15b887f9d03",
              ],
              1,
            ],
          }),
          "0x7579EE8307284F293B1927136486880611F20002",
          zeroAddress,
          BigInt(0),
          zeroAddress,
        ],
      });
    
      const singleton: Address = '0x29fcb43b46531bca003ddc8fcb67ffe91900c762';
      const proxyFactory: Address = "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67";
      const saltNonce = 0n;
      const factoryData = encodeFunctionData({
        abi: parseAbi([
          "function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)",
        ]),
        functionName: "createProxyWithNonce",
        args: [
          singleton,
          initializer,
          saltNonce,
        ],
      });

      return {
        factory: proxyFactory,
        factoryData,
        singleton,
        initializer,
      }
    }
  }
}

export { getAddress, isDeployed, getDeployArgs, deploy }
