// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    Address,
    Chain,
    concat,
    encodeAbiParameters,
    encodeFunctionData,
    Hex,
    keccak256,
    parseAbi,
    PublicClient,
    toHex,
    zeroAddress,
} from 'viem'
import {
    entryPoint07Abi,
    entryPoint07Address,
    getUserOperationHash,
    toSmartAccount,
} from 'viem/account-abstraction'

import {
    getDeployArgs,
    getSmartAccount,
    getSessionSmartAccount,
    get7702SmartAccount,
    get7702InitCalls,
} from '../../src/accounts/nexus'

import { getSetup as getModuleSetup } from '../../src/modules'
import {
    encodeSmartSessionSignature,
    getMockSignature,
    getPermissionId,
    SMART_SESSION_MODE_USE,
} from '../../src/modules/validators'
import { encode7579Calls, getAccountNonce } from '../../src/accounts/utils'

vi.mock('viem', async () => {
    const actual = await vi.importActual('viem')
    return {
        ...actual,
        concat: vi.fn((...args) => actual.concat(...args)),
        encodeAbiParameters: vi.fn((...args) => actual.encodeAbiParameters(...args)),
        encodeFunctionData: vi.fn((...args) => actual.encodeFunctionData(...args)),
        keccak256: vi.fn((...args) => actual.keccak256(...args)),
        parseAbi: vi.fn((...args) => actual.parseAbi(...args)),
        toHex: vi.fn((...args) => actual.toHex(...args)),
    }
})

vi.mock('viem/account-abstraction', () => ({
    entryPoint07Abi: [],
    entryPoint07Address: '0xentryPointAddress',
    getUserOperationHash: vi.fn(),
    toSmartAccount: vi.fn(),
}))

vi.mock('../../src/modules', () => ({
    getSetup: vi.fn(),
}))

vi.mock('../../src/modules/validators', () => ({
    encodeSmartSessionSignature: vi.fn(),
    getMockSignature: vi.fn(),
    getPermissionId: vi.fn(),
    SMART_SESSION_MODE_USE: '0x01',
}))

vi.mock('../../src/accounts/utils', () => ({
    encode7579Calls: vi.fn(),
    getAccountNonce: vi.fn(),
}))

describe('Nexus Account Tests', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    describe('getDeployArgs', () => {
        it('should return the correct deploy arguments', () => {
            const mockModuleSetup = {
                validators: [{ address: '0xvalidator1', initData: '0xvalidatorData1' }],
                executors: [{ address: '0xexecutor1', initData: '0xexecutorData1' }],
                fallbacks: [{ address: '0xfallback1', initData: '0xfallbackData1' }],
                registry: '0xregistry',
                attesters: ['0xattester1'],
                threshold: 1,
            }
            vi.mocked(getModuleSetup).mockReturnValue(mockModuleSetup)

            const mockInitNexusData = '0xinitNexusData'
            const mockInitData = '0xinitData'
            const mockInitializationCallData = '0x4b6a141900000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000004initData00000000000000000000000000000000000000000000000000000000'
            const mockAccountInitData = '0xaccountInitData'
            const mockSalt = '0xsalt'
            const mockHashedInitcode = '0xhashedInitcode'

            vi.mocked(encodeFunctionData).mockReturnValueOnce(mockInitNexusData)
            vi.mocked(encodeAbiParameters).mockReturnValueOnce(mockInitData)
            vi.mocked(encodeFunctionData).mockReturnValueOnce(mockInitializationCallData)
            vi.mocked(encodeAbiParameters).mockReturnValueOnce(mockAccountInitData)
            vi.mocked(keccak256).mockReturnValueOnce(mockSalt)
            vi.mocked(keccak256).mockReturnValueOnce(mockHashedInitcode)

            const mockConfig = {} as any
            const result = getDeployArgs(mockConfig)

            expect(getModuleSetup).toHaveBeenCalledWith(mockConfig)
            expect(result).toEqual({
                factory: '0x000000001D1D5004a02bAfAb9de2D6CE5b7B13de',
                factoryData: mockInitializationCallData,
                salt: mockSalt,
                hashedInitcode: mockHashedInitcode,
                implementation: '0x000000004f43c49e93c970e84001853a70923b03',
                initializationCallData: mockInitializationCallData,
            })
        })
    })

    describe('getSmartAccount', () => {
        it('should return a smart account with the correct configuration', async () => {
            const mockClient = { chain: { id: 1 } } as PublicClient
            const mockAddress = '0xaccountAddress' as Address
            const mockOwners = { type: 'ecdsa', accounts: [] } as any
            const mockValidatorAddress = '0x0000000000000000000000000000000000000123' as Address
            const mockSign = vi.fn().mockResolvedValue('0xsignature')

            vi.mocked(encode7579Calls).mockReturnValue('0xencodedCalls')
            vi.mocked(getAccountNonce).mockResolvedValue(1n)
            vi.mocked(getUserOperationHash).mockReturnValue('0xuserOpHash')
            vi.mocked(concat).mockReturnValue('0x0000000000000123')

            const mockSmartAccount = { address: mockAddress }
            vi.mocked(toSmartAccount).mockImplementation(async (config) => {
                await config.encodeCalls([{ to: '0x123' }])
                await config.getNonce({})
                await config.getStubSignature()
                await config.signUserOperation({ sender: '0x123' })
                return mockSmartAccount
            })

            const result = await getSmartAccount(
                mockClient,
                mockAddress,
                mockOwners,
                mockValidatorAddress,
                mockSign
            )

            expect(toSmartAccount).toHaveBeenCalled()
            expect(encode7579Calls).toHaveBeenCalled()
            expect(getAccountNonce).toHaveBeenCalled()
            expect(mockSign).toHaveBeenCalled()
            expect(result).toBe(mockSmartAccount)
        })
    })

    describe('getSessionSmartAccount', () => {
        it('should return a session smart account with the correct configuration', async () => {
            const mockClient = { chain: { id: 1 } } as PublicClient
            const mockAddress = '0xaccountAddress' as Address
            const mockSession = {
                permissions: [{ target: '0xtarget', functionSelector: '0xselector' }],
                validUntil: 123456789,
                validAfter: 123456,
            } as any
            const mockValidatorAddress = '0x0000000000000000000000000000000000000123' as Address
            const mockSign = vi.fn().mockResolvedValue('0xsignature')

            vi.mocked(encode7579Calls).mockReturnValue('0xencodedCalls')
            vi.mocked(getAccountNonce).mockResolvedValue(1n)
            vi.mocked(getUserOperationHash).mockReturnValue('0xuserOpHash')
            vi.mocked(concat).mockReturnValue('0x0000000000000123')

            vi.mocked(getPermissionId).mockReturnValue('0xpermissionId')

            vi.mocked(encodeSmartSessionSignature).mockReturnValue('0xsessionSignature')

            const mockSmartAccount = { address: mockAddress }
            vi.mocked(toSmartAccount).mockImplementation(async (config) => {
                await config.encodeCalls([{ to: '0x123' }])
                await config.getNonce({})
                await config.getStubSignature()
                await config.signUserOperation({ sender: '0x123' })
                return mockSmartAccount
            })

            const result = await getSessionSmartAccount(
                mockClient,
                mockAddress,
                mockSession,
                mockValidatorAddress,
                mockSign
            )

            expect(toSmartAccount).toHaveBeenCalled()
            expect(encode7579Calls).toHaveBeenCalled()
            expect(getAccountNonce).toHaveBeenCalled()
            expect(getPermissionId).toHaveBeenCalled()
            expect(encodeSmartSessionSignature).toHaveBeenCalled()
            expect(result).toBe(mockSmartAccount)
        })
    })

    describe('get7702SmartAccount', () => {
        it('should return a 7702 smart account with the correct configuration', async () => {
            const mockEoa = { address: '0xeoaAddress' } as any
            const mockClient = {} as PublicClient

            const mockSmartAccount = { address: mockEoa.address }
            vi.mocked(toSmartAccount).mockResolvedValue(mockSmartAccount)

            const result = await get7702SmartAccount(mockEoa, mockClient)

            expect(toSmartAccount).toHaveBeenCalled()
            expect(result).toBe(mockSmartAccount)
        })
    })

    describe('get7702InitCalls', () => {
        it('should return the correct initialization calls for a 7702 account', () => {
            const mockConfig = {
                eoa: { address: '0xeoaAddress' },
            } as any

            const mockModuleSetup = {
                validators: [{
                    type: 1,
                    address: '0xvalidator1',
                    initData: '0xvalidatorData1'
                }],
                executors: [{
                    type: 2,
                    address: '0xexecutor1',
                    initData: '0xexecutorData1'
                }],
                fallbacks: [{
                    type: 3,
                    address: '0xfallback1',
                    initData: '0xfallbackData1'
                }],
                registry: '0xregistry',
                attesters: ['0xattester1'],
                threshold: 1,
            }
            vi.mocked(getModuleSetup).mockReturnValue(mockModuleSetup)

            vi.mocked(encodeFunctionData)
                .mockReturnValueOnce('0xsetRegistryData')
                .mockReturnValueOnce('0xinstallValidatorData')
                .mockReturnValueOnce('0xinstallExecutorData')
                .mockReturnValueOnce('0xinstallFallbackData')

            const result = get7702InitCalls(mockConfig)

            expect(getModuleSetup).toHaveBeenCalledWith(mockConfig)
            expect(result).toEqual([
                {
                    to: '0xeoaAddress',
                    data: '0xsetRegistryData',
                },
                {
                    to: '0xeoaAddress',
                    data: '0xinstallValidatorData',
                },
                {
                    to: '0xeoaAddress',
                    data: '0xinstallExecutorData',
                },
                {
                    to: '0xeoaAddress',
                    data: '0xinstallFallbackData',
                },
            ])
        })

        it('should throw an error if eoa is not defined', () => {
            const mockConfig = {} as any

            expect(() => get7702InitCalls(mockConfig)).toThrow('EIP-7702 accounts must have an EOA account')
        })
    })
})