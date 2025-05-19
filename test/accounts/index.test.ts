// @ts-nocheck - Ignoring type errors in tests due to mocking
import { getAddress, isDeployed, getBundleInitCode, getSmartAccount, getSmartSessionSmartAccount, sign, exportedForTesting } from '../../src/accounts/index'
import { getDeployArgs, deploySource, deployTarget } from '../../src/accounts/index'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    Chain,
    concat,
    createPublicClient,
    createWalletClient,
    encodePacked,
    Hex,
    http,
    keccak256,
    size,
    slice,
    zeroAddress,
    zeroHash
} from 'viem'
import {
    getWebauthnValidatorSignature,
    isRip7212SupportedNetwork,
} from '../../src/modules'
import {
    getOwnerValidator,
    getSmartSessionValidator,
} from '../../src/modules/validators'
import {
    get7702SmartAccount as get7702NexusAccount,
    get7702InitCalls as get7702NexusInitCalls,
    getDeployArgs as getNexusDeployArgs,
    getSessionSmartAccount as getNexusSessionSmartAccount,
    getSmartAccount as getNexusSmartAccount,
} from '../../src/accounts/nexus'
import {
    get7702SmartAccount as get7702SafeAccount,
    get7702InitCalls as get7702SafeInitCalls,
    getDeployArgs as getSafeDeployArgs,
    getSessionSmartAccount as getSafeSessionSmartAccount,
    getSmartAccount as getSafeSmartAccount,
} from '../../src/accounts/safe'


vi.mock('viem', async () => {
  const actual = await vi.importActual('viem')
  return {
    ...actual,
    encodeAbiParameters: vi.fn(),
    createPublicClient:  vi.fn(),
    createWalletClient:  vi.fn(),
    http:             vi.fn(),
    size:             vi.fn(),
    keccak256:        vi.fn((...args) => actual.keccak256(...args)),
    slice:            vi.fn((...args) => actual.slice(...args)),
    encodePacked: vi.fn((...args) => actual.encodePacked(...args)),
    concat:       vi.fn((...args) => actual.concat(...args)),
    zeroHash: '0x0000000000000000000000000000000000000000000000000000000000000000'
  }
})

vi.mock('../../src/accounts/safe', async () => ({
    ...vi.importActual('../../src/accounts/safe'),
    get7702SmartAccount: vi.fn(),
    get7702InitCalls: vi.fn(),
    getDeployArgs: vi.fn(),
    getSessionSmartAccount: vi.fn(),
    getSmartAccount: vi.fn(),
}))

vi.mock('../../src/accounts/nexus', async () => ({
    ...vi.importActual('../../src/accounts/nexus'),
    get7702SmartAccount: vi.fn(),
    get7702InitCalls: vi.fn(),
    getDeployArgs: vi.fn(),
    getSessionSmartAccount: vi.fn(),
    getSmartAccount: vi.fn(),
}))

import { getBundlerClient } from '../../src/accounts/utils'

vi.mock('../../src/accounts/utils', () => ({
    getBundlerClient: vi.fn(),
}))

vi.mock('../../src/modules/validators', () => ({
    getOwnerValidator: vi.fn(),
    getSmartSessionValidator: vi.fn(),
}))

vi.mock('../../src/modules', () => ({
    getWebauthnValidatorSignature: vi.fn(),
    isRip7212SupportedNetwork: vi.fn(),
}))

describe('Accounts Index Tests', () => {
    beforeEach(() => {
        vi.resetAllMocks()
        // vi.mocked(concat).mockReturnValue('0xcombinedsig' as Hex)
        // vi.mocked(encodePacked).mockReturnValue('0xencoded' as Hex)
    })

    describe('getDeployArgs', () => {
        it('should call getSafeDeployArgs when account type is "safe"', async () => {
            const mockConfig = { account: { type: 'safe' } } as any
            vi.mocked(getSafeDeployArgs).mockReturnValue('safeDeployArgs' as any)

            const result = getDeployArgs(mockConfig)

            expect(getSafeDeployArgs).toHaveBeenCalledWith(mockConfig)
            expect(result).toBe('safeDeployArgs')
        })

        it('should call getNexusDeployArgs when account type is "nexus"', async () => {
            const mockConfig = { account: { type: 'nexus' } } as any
            vi.mocked(getNexusDeployArgs).mockReturnValue('nexusDeployArgs' as any)

            const result = getDeployArgs(mockConfig)

            expect(getNexusDeployArgs).toHaveBeenCalledWith(mockConfig)
            expect(result).toBe('nexusDeployArgs')
        })

        it('should return undefined for unsupported account types', async () => {
            const mockConfig = { account: { type: 'unsupported' } } as any
            expect(getDeployArgs(mockConfig)).toBeUndefined()
        })

        describe('getAddress', () => {
            it('should return the EOA address for EIP-7702 accounts', () => {
                const eoaAddress = '0x1234567890abcdef1234567890abcdef12345678'
                const mockConfig = { eoa: { address: eoaAddress } } as any
                expect(getAddress(mockConfig)).toBe(eoaAddress)
            })

            it.skip('should throw an error if EIP-7702 account does not have an EOA', async () => {
                const mockConfig = { eoa: undefined } as any
                await expect(getAddress(mockConfig)).rejects.toThrow('EIP-7702 accounts must have an EOA account')
            })

            it('should calculate and return the address for non-EIP-7702 accounts', () => {
                const mockConfig = { account: { type: 'safe' } } as any
                const mockDeployArgs = {
                    factory: zeroAddress,
                    salt: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                    hashedInitcode: zeroAddress,
                }

                vi.mocked(getSafeDeployArgs).mockReturnValue(mockDeployArgs as any)

                const result = getAddress(mockConfig)

                expect(getSafeDeployArgs).toHaveBeenCalledWith(mockConfig)
                expect(encodePacked).toHaveBeenCalledWith(
                    ['bytes1', 'address', 'bytes32', 'bytes'],
                    ['0xff', mockDeployArgs.factory, mockDeployArgs.salt, mockDeployArgs.hashedInitcode]
                )
                expect(keccak256).toHaveBeenCalledWith(    encodePacked(
                      ['bytes1', 'address', 'bytes32', 'bytes'],
                      ['0xff', mockDeployArgs.factory, mockDeployArgs.salt, mockDeployArgs.hashedInitcode],
                    ))
                expect(slice).toHaveBeenCalledWith(
                    keccak256(encodePacked(
                      ['bytes1', 'address', 'bytes32', 'bytes'],
                      ['0xff', mockDeployArgs.factory, mockDeployArgs.salt, mockDeployArgs.hashedInitcode],
                    )), 12, 32
                )
                expect(result).toBe(
                    slice( keccak256(encodePacked(
                      ['bytes1', 'address', 'bytes32', 'bytes'],
                      ['0xff', mockDeployArgs.factory, mockDeployArgs.salt, mockDeployArgs.hashedInitcode],
                    )), 12, 32))
            })
        })
    });

    describe('is7702', () => {
        it('should return true when eoa is defined', () => {
            const mockConfig = { eoa: { address: '0x1234' } } as any
            expect(exportedForTesting.is7702(mockConfig)).toBe(true)
        })

        it('should return false when eoa is undefined', () => {
            const mockConfig = { eoa: undefined } as any
            expect(exportedForTesting.is7702(mockConfig)).toBe(false)
        })
    })

    describe('getBundleInitCode', () => {
        it('should return undefined for EIP-7702 accounts', async () => {
            const mockConfig = { eoa: { address: '0x1234' } } as any
            expect(getBundleInitCode(mockConfig)).toBeUndefined()
        })

        it('should encode factory and factory data for non-EIP-7702 accounts', async () => {
            const mockConfig = { account: { type: 'safe' } } as any
            const mockDeployArgs = { factory: zeroAddress, factoryData: zeroAddress }

            vi.mocked(getSafeDeployArgs).mockReturnValue(mockDeployArgs as any)

            const result = getBundleInitCode(mockConfig)

            expect(getSafeDeployArgs).toHaveBeenCalledWith(mockConfig)
            expect(encodePacked).toHaveBeenCalledWith(['address', 'bytes'], [zeroAddress, zeroAddress])
            expect(result).toBe(encodePacked(['address', 'bytes'], [zeroAddress, zeroAddress]))
        })

        it('should throw an error when factory args are not available', async () => {
            const mockConfig = { account: { type: 'safe' } } as any
            vi.mocked(getSafeDeployArgs).mockReturnValue({ factory: undefined, factoryData: undefined } as any)

            expect(() => getBundleInitCode(mockConfig)).toThrow('Factory args not available')
        })
    })

    describe('isDeployed', () => {
        const mockChain = { id: 1 } as Chain
        let mockPublicClient: any

        beforeEach(() => {
            mockPublicClient = { getCode: vi.fn() }
            vi.mocked(createPublicClient).mockReturnValue(mockPublicClient)
            vi.mocked(size).mockReturnValue(0)
        })

        it('should return false when no code is found at the address', async () => {
            const mockConfig = { eoa: { address: '0xmockAddress' } } as any
            mockPublicClient.getCode.mockResolvedValue(undefined)

            const result = await isDeployed(mockChain, mockConfig)

            expect(createPublicClient).toHaveBeenCalled()
            expect(mockPublicClient.getCode).toHaveBeenCalledWith({ address: '0xmockAddress' })
            expect(result).toBe(false)
        })

        it.each([10, 0])('should return true/false based on code size when code is found at the address', async (mockCodeSize: number) => {
            const mockConfig = { eoa: { address: '0xmockAddress' } } as any
            mockPublicClient.getCode.mockResolvedValue('0xsomecode')
            vi.mocked(size).mockReturnValue(mockCodeSize)

            const result = await isDeployed(mockChain, mockConfig)

            expect(mockPublicClient.getCode).toHaveBeenCalledWith({ address: '0xmockAddress' })
            expect(size).toHaveBeenCalledWith('0xsomecode')
            expect(result).toBe(mockCodeSize > 0)
        })

        it('should throw an error when an EIP-7702 account is detected', async () => {
            const mockConfig = { eoa: { address: '0xmockAddress' } } as any
            const mockCode = '0xef0100' + '0'.repeat(40)
            mockPublicClient.getCode.mockResolvedValue(mockCode)

            await expect(isDeployed(mockChain, mockConfig)).rejects.toThrow('Existing EIP-7702 accounts are not yet supported')
            expect(mockPublicClient.getCode).toHaveBeenCalledWith({ address: '0xmockAddress' })
        })
    })

    describe('sign', () => {
        const mockChain = { id: 1 } as Chain
        const mockHash = '0xhash' as Hex

        it('should concatenate all ECDSA signatures', async () => {
            const mockAccount1 = { signMessage: vi.fn().mockResolvedValue('0xsig1') }
            const mockAccount2 = { signMessage: vi.fn().mockResolvedValue('0xsig2') }
            const mockValidators = { type: 'ecdsa', accounts: [mockAccount1, mockAccount2] } as any

            const result = await sign(mockValidators, mockChain, mockHash)

            expect(mockAccount1.signMessage).toHaveBeenCalledWith({ message: { raw: mockHash } })
            expect(mockAccount2.signMessage).toHaveBeenCalledWith({ message: { raw: mockHash } })
            expect(concat).toHaveBeenCalledWith(['0xsig1', '0xsig2'])
            expect(result).toBe(concat(['0xsig1', '0xsig2']))
        })

        it('should throw an error if ECDSA account does not support signing', async () => {
            const mockValidators = { type: 'ecdsa', accounts: [{ signMessage: undefined }] } as any
            await expect(sign(mockValidators, mockChain, mockHash)).rejects.toThrow('Signing not supported for the account')
        })

        it('should sign using passkey', async () => {
            const mockWebauthn = {}
            const mockSignature = {}
            const mockPasskeyAccount = {
                sign: vi.fn().mockResolvedValue({ webauthn: mockWebauthn, signature: mockSignature })
            }
            const mockValidators = { type: 'passkey', account: mockPasskeyAccount } as any

            vi.mocked(isRip7212SupportedNetwork).mockReturnValue(true)
            vi.mocked(getWebauthnValidatorSignature).mockReturnValue('0xpasskeysig')

            const result = await sign(mockValidators, mockChain, mockHash)

            expect(mockPasskeyAccount.sign).toHaveBeenCalledWith({ hash: mockHash })
            expect(isRip7212SupportedNetwork).toHaveBeenCalledWith(mockChain)
            expect(getWebauthnValidatorSignature).toHaveBeenCalledWith({
                webauthn: mockWebauthn,
                signature: mockSignature,
                usePrecompiled: true
            })
            expect(result).toBe('0xpasskeysig')
        })

        it('should sign using passkey without precompile on unsupported networks', async () => {
            const mockWebauthn = {}
            const mockSignature = {}
            const mockPasskeyAccount = {
                sign: vi.fn().mockResolvedValue({ webauthn: mockWebauthn, signature: mockSignature })
            }
            const mockValidators = { type: 'passkey', account: mockPasskeyAccount } as any

            vi.mocked(isRip7212SupportedNetwork).mockReturnValue(false)
            vi.mocked(getWebauthnValidatorSignature).mockReturnValue('0xpasskeysig')

            const result = await sign(mockValidators, mockChain, mockHash)

            expect(isRip7212SupportedNetwork).toHaveBeenCalledWith(mockChain)
            expect(getWebauthnValidatorSignature).toHaveBeenCalledWith({
                webauthn: mockWebauthn,
                signature: mockSignature,
                usePrecompiled: false
            })
            expect(result).toBe('0xpasskeysig')
        })
    })

    describe('getAccount', () => {
        it('should return the account from config when it exists', () => {
            const mockAccount = { type: 'safe' }
            const mockConfig = { account: mockAccount } as any
            expect(exportedForTesting.getAccount(mockConfig)).toBe(mockAccount)
        })

        it('should return a default nexus account when config.account is undefined', () => {
            const mockConfig = { account: undefined } as any
            expect(exportedForTesting.getAccount(mockConfig)).toEqual({ type: 'nexus' })
        })
    })

    describe('get7702SmartAccount', () => {
        const mockClient = {}
        const mockEoa = { address: '0x1234' }

        it('should throw an error if EIP-7702 account does not have an EOA', async () => {
            const mockConfig = { eoa: undefined, account: { type: 'safe' } } as any
            await expect(exportedForTesting.get7702SmartAccount(mockConfig, mockClient))
                .rejects.toThrow('EIP-7702 accounts must have an EOA account')
        })

        it('should call get7702SafeAccount for safe account type', async () => {
            const mockConfig = { eoa: mockEoa, account: { type: 'safe' } } as any
            vi.mocked(get7702SafeAccount).mockResolvedValue('safeAccount' as any)

            const result = await exportedForTesting.get7702SmartAccount(mockConfig, mockClient)

            expect(get7702SafeAccount).toHaveBeenCalled()
            expect(result).toBe('safeAccount')
        })

        it('should call get7702NexusAccount for nexus account type', async () => {
            const mockConfig = { eoa: mockEoa, account: { type: 'nexus' } } as any
            vi.mocked(get7702NexusAccount).mockResolvedValue('nexusAccount' as any)

            const result = await exportedForTesting.get7702SmartAccount(mockConfig, mockClient)

            expect(get7702NexusAccount).toHaveBeenCalledWith(mockEoa, mockClient)
            expect(result).toBe('nexusAccount')
        })
    })

    describe('get7702InitCalls', () => {
        it('should call get7702SafeInitCalls for safe account type', async () => {
            const mockConfig = { account: { type: 'safe' } } as any
            vi.mocked(get7702SafeInitCalls).mockResolvedValue('safeInitCalls' as any)

            const result = await exportedForTesting.get7702InitCalls(mockConfig)

            expect(get7702SafeInitCalls).toHaveBeenCalled()
            expect(result).toBe('safeInitCalls')
        })

        it('should call get7702NexusInitCalls for nexus account type', async () => {
            const mockConfig = { account: { type: 'nexus' } } as any
            vi.mocked(get7702NexusInitCalls).mockResolvedValue('nexusInitCalls' as any)

            const result = await exportedForTesting.get7702InitCalls(mockConfig)

            expect(get7702NexusInitCalls).toHaveBeenCalledWith(mockConfig)
            expect(result).toBe('nexusInitCalls')
        })
    })

    describe('getSmartAccount', () => {
        const mockChain = { id: 1 } as Chain
        const mockClient = {}
        const mockAddress = '0xmockAddress' as Address
        const mockValidatorAddress = '0xvalidatorAddress' as Address
        const mockOwners = {
            type: 'ecdsa',
            accounts: [{ address: '0xowner1', signMessage: vi.fn().mockResolvedValue('0xsig1') }]
        } as any

        beforeEach(() => {
            vi.mocked(getOwnerValidator).mockReturnValue({ address: mockValidatorAddress })
        })

        it('should call getSafeSmartAccount for safe account type', async () => {
            const mockConfig = {
                account: { type: 'safe' },
                owners: mockOwners,
                eoa: { address: mockAddress }
            } as any

            vi.mocked(getSafeSmartAccount).mockResolvedValue('safeSmartAccount' as any)

            const result = await getSmartAccount(mockConfig, mockClient, mockChain)

            expect(getOwnerValidator).toHaveBeenCalledWith(mockConfig)
            expect(getSafeSmartAccount).toHaveBeenCalledWith(
                mockClient,
                mockAddress,
                mockOwners,
                mockValidatorAddress,
                expect.any(Function)
            )
            expect(result).toBe('safeSmartAccount')
        })

        it('should call getNexusSmartAccount for nexus account type', async () => {
            const mockConfig = {
                account: { type: 'nexus' },
                owners: mockOwners,
                eoa: { address: mockAddress }
            } as any

            vi.mocked(getNexusSmartAccount).mockResolvedValue('nexusSmartAccount' as any)

            const result = await getSmartAccount(mockConfig, mockClient, mockChain)

            expect(getOwnerValidator).toHaveBeenCalledWith(mockConfig)
            expect(getNexusSmartAccount).toHaveBeenCalledWith(
                mockClient,
                mockAddress,
                mockOwners,
                mockValidatorAddress,
                expect.any(Function)
            )
            expect(result).toBe('nexusSmartAccount')
        })
    })

    describe('getSmartSessionSmartAccount', () => {
        const mockChain = { id: 1 } as Chain
        const mockClient = {}
        const mockAddress = '0xmockAddress' as Address
        const mockValidatorAddress = '0xvalidatorAddress' as Address
        const mockSession = {
            owners: {
                type: 'ecdsa',
                accounts: [{ address: '0xowner1', signMessage: vi.fn().mockResolvedValue('0xsig1') }]
            }
        } as any

        it('should throw an error if smart sessions are not enabled', async () => {
            const mockConfig = { account: { type: 'safe' }, eoa: { address: mockAddress } } as any
            vi.mocked(getSmartSessionValidator).mockReturnValue(undefined)

            await expect(getSmartSessionSmartAccount(mockConfig, mockClient, mockChain, mockSession))
                .rejects.toThrow('Smart sessions are not enabled for this account')
        })

        it('should call getSafeSessionSmartAccount for safe account type', async () => {
            const mockConfig = { account: { type: 'safe' }, eoa: { address: mockAddress } } as any

            vi.mocked(getSmartSessionValidator).mockReturnValue({ address: mockValidatorAddress })
            vi.mocked(getSafeSessionSmartAccount).mockResolvedValue('safeSessionSmartAccount' as any)

            const result = await getSmartSessionSmartAccount(mockConfig, mockClient, mockChain, mockSession)

            expect(getSmartSessionValidator).toHaveBeenCalledWith(mockConfig)
            expect(getSafeSessionSmartAccount).toHaveBeenCalledWith(
                mockClient,
                mockAddress,
                mockSession,
                mockValidatorAddress,
                expect.any(Function)
            )
            expect(result).toBe('safeSessionSmartAccount')
        })

        it('should call getNexusSessionSmartAccount for nexus account type', async () => {
            const mockConfig = { account: { type: 'nexus' }, eoa: { address: mockAddress } } as any

            vi.mocked(getSmartSessionValidator).mockReturnValue({ address: mockValidatorAddress })
            vi.mocked(getNexusSessionSmartAccount).mockResolvedValue('nexusSessionSmartAccount' as any)

            const result = await getSmartSessionSmartAccount(mockConfig, mockClient, mockChain, mockSession)

            expect(getSmartSessionValidator).toHaveBeenCalledWith(mockConfig)
            expect(getNexusSessionSmartAccount).toHaveBeenCalledWith(
                mockClient,
                mockAddress,
                mockSession,
                mockValidatorAddress,
                expect.any(Function)
            )
            expect(result).toBe('nexusSessionSmartAccount')
        })
    })

    describe('deploySource', () => {
        const mockChain = { id: 1 } as Chain
        let deploy7702SelfSpy
        let deployStandaloneSpy

        beforeEach(() => {
            deploy7702SelfSpy = vi.spyOn(exportedForTesting, 'deploy7702Self').mockResolvedValue()
            deployStandaloneSpy = vi.spyOn(exportedForTesting, 'deployStandalone').mockResolvedValue()
        })

        afterEach(() => {
            deploy7702SelfSpy.mockRestore()
            deployStandaloneSpy.mockRestore()
        })

        it.skip('should call deploy7702Self for EIP-7702 accounts', async () => {
        })

        it.skip('should call deployStandalone for non-EIP-7702 accounts', async () => {
        })
    })

    describe('deployTarget', () => {
        const mockChain = { id: 1 } as Chain
        let deploy7702WithBundlerSpy
        let deployStandaloneSpy

        beforeEach(() => {
            deploy7702WithBundlerSpy = vi.spyOn(exportedForTesting, 'deploy7702WithBundler').mockResolvedValue()
            deployStandaloneSpy = vi.spyOn(exportedForTesting, 'deployStandalone').mockResolvedValue()
        })

        afterEach(() => {
            deploy7702WithBundlerSpy.mockRestore()
            deployStandaloneSpy.mockRestore()
        })

        it.skip('should call deploy7702WithBundler for EIP-7702 accounts', async () => {
        })

        it.skip('should call deployStandalone when asUserOp is true for non-EIP-7702 accounts', async () => {
        })

        it('should not call any deployment function when asUserOp is false for non-EIP-7702 accounts', async () => {
            const mockConfig = { account: { type: 'safe' } } as any

            vi.spyOn(exportedForTesting, 'is7702').mockReturnValue(false)

            await deployTarget(mockChain, mockConfig, false)

            expect(deploy7702WithBundlerSpy).not.toHaveBeenCalled()
            expect(deployStandaloneSpy).not.toHaveBeenCalled()
        })
    })

    describe('deployStandalone', () => {
        const mockChain = { id: 1 } as Chain
        it.skip('should call deployStandaloneWithEoa when deployer account is provided', async () => {
        })

        it.skip('should call deployStandaloneWithBundler when bundler config is provided', async () => {
        })

        it('should throw an error when neither deployer account nor bundler config is provided', async () => {
            const mockConfig = { account: { type: 'safe' } } as any
            vi.mocked(getSafeDeployArgs).mockReturnValue({ factory: undefined, factoryData: undefined } as any)

            await expect(exportedForTesting.deployStandalone(mockChain, mockConfig))
                .rejects.toThrow()
        })
    })

    describe('deploy7702Self', () => {
        const mockChain = { id: 1 } as Chain
        let mockPublicClient
        let mockWalletClient
        let mockEoa
        let mockConfig

        beforeEach(() => {
            mockEoa = {
                address: '0xeoa',
                signAuthorization: vi.fn().mockResolvedValue('0xauthorization')
            }
            mockConfig = {
                eoa: mockEoa,
                account: { type: 'safe' },
                rhinestoneApiKey: 'test-api-key'
            }
            mockPublicClient = {
                waitForTransactionReceipt: vi.fn().mockResolvedValue({})
            }
            mockWalletClient = {
                sendTransaction: vi.fn().mockResolvedValue('0xtxhash'),
                signAuthorization: vi.fn().mockResolvedValue('0xauthorization')
            }

            vi.mocked(createPublicClient).mockReturnValue(mockPublicClient)
            vi.mocked(createWalletClient).mockReturnValue(mockWalletClient)
            vi.mocked(http).mockReturnValue(() => {})

            vi.spyOn(exportedForTesting, 'getAccount').mockReturnValue({ type: 'safe' })
            vi.mocked(getSafeDeployArgs).mockReturnValue({
                implementation: '0ximplementation',
                initializationCallData: '0xinitdata'
            })
        })

        it('should throw an error if EIP-7702 account does not have an EOA', async () => {
            const configWithoutEoa = { eoa: undefined } as any
            await expect(exportedForTesting.deploy7702Self(mockChain, configWithoutEoa))
                .rejects.toThrow('EIP-7702 accounts must have an EOA account')
        })

        it('should throw an error if initialization call data is not available', async () => {
            vi.mocked(getSafeDeployArgs).mockReturnValue({
                implementation: '0ximplementation',
                initializationCallData: undefined
            } as any)

            await expect(exportedForTesting.deploy7702Self(mockChain, mockConfig))
                .rejects.toThrow('Initialization call data not available for safe')
        })

        it('should deploy the EIP-7702 account using the EOA with safe account type', async () => {
            await exportedForTesting.deploy7702Self(mockChain, mockConfig)

            expect(createPublicClient).toHaveBeenCalledWith({
                chain: mockChain,
                transport: expect.any(Function)
            })
            expect(createWalletClient).toHaveBeenCalledWith({
                account: mockEoa,
                chain: mockChain,
                transport: expect.any(Function)
            })
            expect(mockWalletClient.signAuthorization).toHaveBeenCalledWith({
                contractAddress: '0ximplementation',
                executor: 'self'
            })
            expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith({
                chain: mockChain,
                authorizationList: ['0xauthorization'],
                to: mockEoa.address,
                data: '0xinitdata'
            })
            expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: '0xtxhash' })
        })

        it('should deploy the EIP-7702 account using the EOA with nexus account type', async () => {
            vi.spyOn(exportedForTesting, 'getAccount').mockReturnValue({ type: 'nexus' })
            vi.mocked(getNexusDeployArgs).mockReturnValue({
                implementation: '0xneximplementation',
                initializationCallData: '0xnexinitdata'
            })

            const nexusConfig = {
                ...mockConfig,
                account: { type: 'nexus' }
            }

            await exportedForTesting.deploy7702Self(mockChain, nexusConfig)

            expect(mockWalletClient.signAuthorization).toHaveBeenCalledWith({
                contractAddress: '0xneximplementation',
                executor: 'self'
            })
            expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith({
                chain: mockChain,
                authorizationList: ['0xauthorization'],
                to: mockEoa.address,
                data: '0xnexinitdata'
            })
        })
    })

    describe('deploy7702WithBundler', () => {
        it('should throw an error if EIP-7702 account does not have an EOA', async () => {
            const mockChain = { id: 1 } as Chain
            const configWithoutEoa = { eoa: undefined } as any
            await expect(exportedForTesting.deploy7702WithBundler(mockChain, configWithoutEoa))
                .rejects.toThrow('EIP-7702 accounts must have an EOA account')
        })

        it.skip('should deploy the EIP-7702 account using the bundler with safe account type', async () => {
        })

        it.skip('should deploy the EIP-7702 account using the bundler with nexus account type', async () => {
        })
    })

    describe('deployStandaloneWithEoa', () => {
        const mockChain = { id: 1 } as Chain
        let mockPublicClient
        let mockWalletClient
        let mockDeployer
        let mockConfig

        beforeEach(() => {
            mockDeployer = {
                address: '0xdeployer'
            }
            mockConfig = {
                account: { type: 'safe' },
                rhinestoneApiKey: 'test-api-key'
            }
            mockPublicClient = {
                waitForTransactionReceipt: vi.fn().mockResolvedValue({})
            }
            mockWalletClient = {
                sendTransaction: vi.fn().mockResolvedValue('0xtxhash')
            }

            vi.mocked(createPublicClient).mockReturnValue(mockPublicClient)
            vi.mocked(createWalletClient).mockReturnValue(mockWalletClient)
            vi.mocked(http).mockReturnValue(() => {})

            vi.mocked(getSafeDeployArgs).mockReturnValue({
                factory: '0xfactory',
                factoryData: '0xfactorydata'
            })
        })

        it('should deploy the standalone account using the EOA with safe account type', async () => {
            await exportedForTesting.deployStandaloneWithEoa(mockChain, mockConfig, mockDeployer)

            expect(createPublicClient).toHaveBeenCalledWith({
                chain: mockChain,
                transport: expect.any(Function)
            })
            expect(createWalletClient).toHaveBeenCalledWith({
                account: mockDeployer,
                chain: mockChain,
                transport: expect.any(Function)
            })
            expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith({
                to: '0xfactory',
                data: '0xfactorydata'
            })
            expect(mockPublicClient.waitForTransactionReceipt).toHaveBeenCalledWith({ hash: '0xtxhash' })
        })

        it('should deploy the standalone account using the EOA with nexus account type', async () => {
            const nexusConfig = {
                ...mockConfig,
                account: { type: 'nexus' }
            }

            vi.mocked(getNexusDeployArgs).mockReturnValue({
                factory: '0xnexusfactory',
                factoryData: '0xnexusfactorydata'
            })

            await exportedForTesting.deployStandaloneWithEoa(mockChain, nexusConfig, mockDeployer)

            expect(mockWalletClient.sendTransaction).toHaveBeenCalledWith({
                to: '0xnexusfactory',
                data: '0xnexusfactorydata'
            })
        })
    })

    describe('deployStandaloneWithBundler', () => {
        it('should deploy the standalone account using the bundler with safe account type', async () => {
            const mockConfig = { account: { type: 'safe' } ,
        eoa: { address: '0xeoa' } } as any
            const mockDeployArgs = {
                factory: zeroAddress,
                factoryData: {salt: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
                hashedInitcode: zeroAddress}
            }
            const mockChain = { id: 1 } as Chain
            const mockBundlerClient = {
                sendUserOperation: vi.fn().mockResolvedValue('0xophash'),
                waitForUserOperationReceipt: vi.fn().mockResolvedValue({})
            } as any
            vi.mocked(getBundlerClient).mockReturnValue(mockBundlerClient)
            vi.mocked(getSafeDeployArgs).mockReturnValue(mockDeployArgs as any)
            vi.mocked(createPublicClient).mockReturnValue({} as any)
            vi.mocked(getOwnerValidator).mockReturnValue({ address: '0xvalidator' })
            vi.mocked(getSafeSmartAccount).mockReturnValue({} as any)

            await exportedForTesting.deployStandaloneWithBundler(mockChain, mockConfig)

            expect(getBundlerClient).toHaveBeenCalledWith(mockConfig, expect.anything())
            expect(getSafeSmartAccount).toHaveBeenCalled()
            expect(mockBundlerClient.sendUserOperation).toHaveBeenCalledWith({
                account: {},
                factory: zeroAddress,
                factoryData: expect.anything(),
                calls: [{ to: zeroHash, value: 0n, data: '0x' }]
            })
            expect(mockBundlerClient.waitForUserOperationReceipt).toHaveBeenCalledWith({ hash: '0xophash' })
            expect(getSafeDeployArgs).toHaveBeenCalledWith(mockConfig)
            expect(createPublicClient).toHaveBeenCalledWith({chain: mockChain, transport: http()})
        })
    })

    describe('signEcdsa', () => {
        const mockHash = '0xhash' as Hex

        it('should throw an error if account does not support signing', async () => {
            const mockAccount = { signMessage: undefined } as any
            await expect(exportedForTesting.signEcdsa(mockAccount, mockHash))
                .rejects.toThrow('Signing not supported for the account')
        })

        it('should sign the message using the account', async () => {
            const mockAccount = { signMessage: vi.fn().mockResolvedValue('0xsignature') } as any
            const result = await exportedForTesting.signEcdsa(mockAccount, mockHash)

            expect(mockAccount.signMessage).toHaveBeenCalledWith({ message: { raw: mockHash } })
            expect(result).toBe('0xsignature')
        })
    })

    describe('signPasskey', async () => {
        let mockChain = { id: 1 } as Chain
        let mockHash = '0xhash' as Hex
        let mockWebauthn = {}
        let mockSignature = {}
        let mockPasskeyAccount = {
            sign: vi.fn().mockResolvedValue({ webauthn: mockWebauthn, signature: mockSignature })
        }

        beforeEach(() => {
            mockChain = { id: 1 } as Chain
            mockHash = '0xhash' as Hex
            mockWebauthn = {}
            mockSignature = {}
            mockPasskeyAccount = {
                sign: vi.fn().mockResolvedValue({ webauthn: mockWebauthn, signature: mockSignature })
            }

            vi.mocked(getWebauthnValidatorSignature).mockReturnValue('0xpasskeysig')
        })

        it('should sign using passkey with precompile on supported networks', async () => {
            vi.mocked(isRip7212SupportedNetwork).mockReturnValue(true)
            vi.mocked(getWebauthnValidatorSignature).mockReturnValue('0xpasskeysig')
            const result = await exportedForTesting.signPasskey(mockPasskeyAccount, mockChain, mockHash)

            expect(mockPasskeyAccount.sign).toHaveBeenCalledWith({ hash: mockHash })
            expect(isRip7212SupportedNetwork).toHaveBeenCalledWith(mockChain)
            expect(getWebauthnValidatorSignature).toHaveBeenCalledWith({
                webauthn: mockWebauthn,
                signature: mockSignature,
                usePrecompiled: true
            })
            expect(result).toBe('0xpasskeysig')
        })

        it('should sign using passkey without precompile on unsupported networks', async () => {
            vi.mocked(isRip7212SupportedNetwork).mockReturnValue(false)
            vi.mocked(getWebauthnValidatorSignature).mockReturnValue('0xpasskeysig')

            const result = await exportedForTesting.signPasskey(mockPasskeyAccount, mockChain, mockHash)

            expect(mockPasskeyAccount.sign).toHaveBeenCalledWith({ hash: mockHash })
            expect(isRip7212SupportedNetwork).toHaveBeenCalledWith(mockChain)
            expect(getWebauthnValidatorSignature).toHaveBeenCalledWith({
                webauthn: mockWebauthn,
                signature: mockSignature,
                usePrecompiled: false
            })
            expect(result).toBe('0xpasskeysig')
        })
    })
});
