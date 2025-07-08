import { setupOrchestratorMock } from './orchestrator'
import { setupViemMock } from './utils/viem'

const deployerPrivateKey =
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const deployerAccount = privateKeyToAccount(deployerPrivateKey)

const sourceChain = base
const anvil = getAnvil(sourceChain, getForkUrl(sourceChain))

setupOrchestratorMock()
setupViemMock(anvil, deployerAccount)

import { type Address, createPublicClient, http, zeroAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { base } from 'viem/chains'
import { describe, expect, it } from 'vitest'

import './utils/polyfill'
import { createRhinestoneAccount } from '../src'
import { biconomyImplementationAbi } from './abi/biconomy'
import { ownbleValidatorAbi } from './abi/validators'
import { getAnvil } from './utils/anvil'
import { getForkUrl } from './utils/utils'

const SENTINEL_ADDRESS: Address = '0x0000000000000000000000000000000000000001'
const OWNABLE_VALIDATOR_ADDRESS: Address =
  '0x2483DA3A338895199E5e538530213157e931Bf06'
const INTENT_EXECUTOR_ADDRESS: Address =
  '0x0530Ff05cf0F7e44db6F33Fc2D10C2838e38ec79'

export function runDeploymentTests() {
  describe('Account Deployment', () => {
    describe('Source Chain', () => {
      it(
        'should deploy an account using an EOA',
        {
          timeout: 10_000,
        },
        async () => {
          const ownerPrivateKey = generatePrivateKey()
          const ownerAccount = privateKeyToAccount(ownerPrivateKey)
          const rhinestoneApiKey = 'MOCK_KEY'

          const rhinestoneAccount = await createRhinestoneAccount({
            account: {
              type: 'nexus',
            },
            owners: {
              type: 'ecdsa',
              accounts: [ownerAccount],
            },
            rhinestoneApiKey,
            deployerAccount,
          })

          // Check the account is not yet deployed

          const publicClient = createPublicClient({
            chain: sourceChain,
            transport: http(),
          })
          const codeBefore = await publicClient.getCode({
            address: rhinestoneAccount.getAddress(),
          })
          expect(codeBefore).toBeUndefined()

          await rhinestoneAccount.sendTransaction({
            chain: sourceChain,
            calls: [
              {
                to: ownerAccount.address,
                data: '0x',
              },
            ],
            tokenRequests: [],
          })

          // Check the account is deployed
          const codeAfter = await publicClient.getCode({
            address: rhinestoneAccount.getAddress(),
          })
          expect(codeAfter).not.toBeUndefined()
          expect(codeAfter).toMatch(/^0x[0-9a-fA-F]+$/)

          // Check the account implementation is Nexus
          const implementationStorage = await publicClient.getStorageAt({
            address: rhinestoneAccount.getAddress(),
            slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
          })
          expect(implementationStorage).toEqual(
            '0x000000000000000000000000000000004f43c49e93c970e84001853a70923b03',
          )

          // Check the ownable module is installed
          const validatorList = await publicClient.readContract({
            address: rhinestoneAccount.getAddress(),
            abi: biconomyImplementationAbi,
            functionName: 'getValidatorsPaginated',
            args: [SENTINEL_ADDRESS, 10n],
          })
          const validators = validatorList[0].filter(
            (validator) => validator !== SENTINEL_ADDRESS,
          )
          expect(validators).toEqual([OWNABLE_VALIDATOR_ADDRESS])

          // Check the owner account is the owner of the smart account
          const owners = await publicClient.readContract({
            address: OWNABLE_VALIDATOR_ADDRESS,
            abi: ownbleValidatorAbi,
            functionName: 'getOwners',
            args: [rhinestoneAccount.getAddress()],
          })
          expect(owners).toEqual([ownerAccount.address])
          const threshold = await publicClient.readContract({
            address: OWNABLE_VALIDATOR_ADDRESS,
            abi: ownbleValidatorAbi,
            functionName: 'threshold',
            args: [rhinestoneAccount.getAddress()],
          })
          expect(threshold).toEqual(1n)

          // Check omni account modules are installed
          const executorList = await publicClient.readContract({
            address: rhinestoneAccount.getAddress(),
            abi: biconomyImplementationAbi,
            functionName: 'getExecutorsPaginated',
            args: [SENTINEL_ADDRESS, 10n],
          })
          const executors = executorList[0].filter(
            (validator) => validator !== SENTINEL_ADDRESS,
          )
          expect(executors).toEqual([INTENT_EXECUTOR_ADDRESS])
          const fallbackHandler = await publicClient.readContract({
            address: rhinestoneAccount.getAddress(),
            abi: biconomyImplementationAbi,
            functionName: 'getFallbackHandlerBySelector',
            args: ['0x3a5be8cb'],
          })
          expect(fallbackHandler[1]).toEqual(zeroAddress)
        },
      )
    })
  })
}

export function runDeploymentTestCases() {
  describe('Account Deployment', () => {
    describe('Source Chain', () => {
      it(
        'should deploy an account using an EOA',
        {
          timeout: 10_000,
        },
        async () => {
          const ownerPrivateKey = generatePrivateKey()
          const ownerAccount = privateKeyToAccount(ownerPrivateKey)
          const rhinestoneApiKey = 'MOCK_KEY'

          const rhinestoneAccount = await createRhinestoneAccount({
            account: {
              type: 'nexus',
            },
            owners: {
              type: 'ecdsa',
              accounts: [ownerAccount],
            },
            rhinestoneApiKey,
            deployerAccount,
          })

          // Check the account is not yet deployed

          const publicClient = createPublicClient({
            chain: sourceChain,
            transport: http(),
          })
          const codeBefore = await publicClient.getCode({
            address: rhinestoneAccount.getAddress(),
          })
          expect(codeBefore).toBeUndefined()

          await rhinestoneAccount.sendTransaction({
            chain: sourceChain,
            calls: [
              {
                to: ownerAccount.address,
                data: '0x',
              },
            ],
            tokenRequests: [],
          })

          // Check the account is deployed
          const codeAfter = await publicClient.getCode({
            address: rhinestoneAccount.getAddress(),
          })
          expect(codeAfter).not.toBeUndefined()
          expect(codeAfter).toMatch(/^0x[0-9a-fA-F]+$/)

          // Check the account implementation is Nexus
          const implementationStorage = await publicClient.getStorageAt({
            address: rhinestoneAccount.getAddress(),
            slot: '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc',
          })
          expect(implementationStorage).toEqual(
            '0x000000000000000000000000000000004f43c49e93c970e84001853a70923b03',
          )

          // Check the ownable module is installed
          const validatorList = await publicClient.readContract({
            address: rhinestoneAccount.getAddress(),
            abi: biconomyImplementationAbi,
            functionName: 'getValidatorsPaginated',
            args: [SENTINEL_ADDRESS, 10n],
          })
          const validators = validatorList[0].filter(
            (validator) => validator !== SENTINEL_ADDRESS,
          )
          expect(validators).toEqual([OWNABLE_VALIDATOR_ADDRESS])

          // Check the owner account is the owner of the smart account
          const owners = await publicClient.readContract({
            address: OWNABLE_VALIDATOR_ADDRESS,
            abi: ownbleValidatorAbi,
            functionName: 'getOwners',
            args: [rhinestoneAccount.getAddress()],
          })
          expect(owners).toEqual([ownerAccount.address])
          const threshold = await publicClient.readContract({
            address: OWNABLE_VALIDATOR_ADDRESS,
            abi: ownbleValidatorAbi,
            functionName: 'threshold',
            args: [rhinestoneAccount.getAddress()],
          })
          expect(threshold).toEqual(1n)

          // Check omni account modules are installed
          const executorList = await publicClient.readContract({
            address: rhinestoneAccount.getAddress(),
            abi: biconomyImplementationAbi,
            functionName: 'getExecutorsPaginated',
            args: [SENTINEL_ADDRESS, 10n],
          })
          const executors = executorList[0].filter(
            (validator) => validator !== SENTINEL_ADDRESS,
          )
          expect(executors).toEqual([INTENT_EXECUTOR_ADDRESS])
          const fallbackHandler = await publicClient.readContract({
            address: rhinestoneAccount.getAddress(),
            abi: biconomyImplementationAbi,
            functionName: 'getFallbackHandlerBySelector',
            args: ['0x3a5be8cb'],
          })
          expect(fallbackHandler[1]).toEqual(zeroAddress)
        },
      )
    })
  })
}
