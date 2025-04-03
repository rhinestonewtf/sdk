import {
  Chain,
  createPublicClient,
  http,
  encodeAbiParameters,
  Address,
  encodeFunctionData,
  parseAbi,
  zeroAddress,
  slice,
  getAddress as parseAddress,
  Account,
  createWalletClient,
} from 'viem'
import {
  RHINESTONE_ATTESTER_ADDRESS,
} from '@rhinestone/module-sdk'
import {
  getHookAddress,
  getSameChainModuleAddress,
} from '@rhinestone/orchestrator-sdk'
import { getTargetModuleAddress } from '@rhinestone/orchestrator-sdk'

import { RhinestoneAccountConfig } from '../types'
import { toOwners } from './modules'
import { getValidators } from './modules'

async function getAddress(chain: Chain, config: RhinestoneAccountConfig) {
  const { factory, factoryData } = await getFactoryArgs(chain, config)
  const publicClient = createPublicClient({
    chain: chain,
    transport: http(),
  });
  const result = await publicClient.call({
    to: factory,
    data: factoryData,
  });
  if (!result.data) {
    throw new Error('Failed to get factory address')
  }
  const address = parseAddress(slice(result.data, 12, 32));
  return address;
}

async function deploy(deployer: Account, chain: Chain, config: RhinestoneAccountConfig) {
  const { factory, factoryData } = await getFactoryArgs(chain, config);
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

async function getFactoryArgs(targetChain: Chain, config: RhinestoneAccountConfig) {
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
    
      const proxyFactory: Address = "0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67";
      const saltNonce = 0n;
      const factoryData = encodeFunctionData({
        abi: parseAbi([
          "function createProxyWithNonce(address singleton,bytes calldata initializer,uint256 saltNonce) external payable returns (address)",
        ]),
        functionName: "createProxyWithNonce",
        args: [
          "0x29fcb43b46531bca003ddc8fcb67ffe91900c762",
          initializer,
          saltNonce,
        ],
      });

      return {
        factory: proxyFactory,
        factoryData,
      }
    }
  }
}

export { getAddress, getFactoryArgs, deploy }
