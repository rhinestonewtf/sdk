// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    Address,
    Chain,
    concat,
    encodeFunctionData,
    encodePacked,
    Hex,
    keccak256,
    parseAbi,
    PublicClient,
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
} from './safe'

import { getSetup as getModuleSetup } from '../modules'
import {
    encodeSmartSessionSignature,
    getMockSignature,
    getPermissionId,
    SMART_SESSION_MODE_USE,
} from '../modules/validators'
import { encode7579Calls, getAccountNonce } from './utils'

vi.mock('viem', async () => {
    const actual = await vi.importActual('viem')
    return {
        ...actual,
        concat: vi.fn((...args) => actual.concat(...args)),
        encodeFunctionData: vi.fn((...args) => actual.encodeFunctionData(...args)),
        encodePacked: vi.fn((...args) => actual.encodePacked(...args)),
        keccak256: vi.fn((...args) => actual.keccak256(...args)),
        parseAbi: vi.fn((...args) => actual.parseAbi(...args)),
    }
})

vi.mock('viem/account-abstraction', () => ({
    entryPoint07Abi: [],
    entryPoint07Address: '0xentryPointAddress',
    getUserOperationHash: vi.fn(),
    toSmartAccount: vi.fn(),
}))

vi.mock('../modules', () => ({
    getSetup: vi.fn(),
}))

vi.mock('../modules/validators', () => ({
    encodeSmartSessionSignature: vi.fn(),
    getMockSignature: vi.fn(),
    getPermissionId: vi.fn(),
    SMART_SESSION_MODE_USE: '0x01',
}))

vi.mock('./utils', () => ({
    encode7579Calls: vi.fn(),
    getAccountNonce: vi.fn(),
}))

describe('Safe Account Tests', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    describe('getDeployArgs', () => {
        it('should return the correct deploy arguments', () => {
            const mockModuleSetup = {
                validators: [{ address: '0xvalidator1', initData: '0xvalidatorData1' }],
                executors: [{ address: '0xexecutor1', initData: '0xexecutorData1' }],
                fallbacks: [{ address: '0xfallback1', initData: '0xfallbackData1' }],
                hooks: [{ address: '0xhook1', initData: '0xhookData1' }],
                registry: '0xregistry',
                attesters: ['0xattester1'],
                threshold: 1,
            }
            vi.mocked(getModuleSetup).mockReturnValue(mockModuleSetup)

            const mockOwners = {
                type: 'ecdsa',
                accounts: [{ address: '0xowner1' }, { address: '0xowner2' }],
                threshold: 2
            }

            const mockInitData = '0xinitData'
            const mockFactoryData = '0xfactoryData'
            const mockSalt = '0xsalt'

            vi.mocked(encodeFunctionData)
                .mockReturnValueOnce(mockInitData)  
                .mockReturnValueOnce('0xaddSafe7579Data')  
                .mockReturnValueOnce(mockFactoryData)

            vi.mocked(encodePacked).mockReturnValue('0xencodedPacked')
            vi.mocked(keccak256)
                .mockReturnValueOnce('0xkeccak256InitData')
                .mockReturnValueOnce(mockSalt)

            const mockConfig = {
                owners: mockOwners
            } as any
            const result = getDeployArgs(mockConfig)

            expect(getModuleSetup).toHaveBeenCalledWith(mockConfig)
            expect(result).toEqual({
                factory: '0x4e1dcf7ad4e460cfd30791ccc4f9c8a4f820ec67',
                factoryData: mockFactoryData,
                salt: mockSalt,
                hashedInitcode: '0xe298282cefe913ab5d282047161268a8222e4bd4ed106300c547894bbefd31ee',
                implementation: '0x29fcb43b46531bca003ddc8fcb67ffe91900c762',
                initializationCallData: null,
            })
        })

        it('should handle passkey owners correctly', () => {
            const mockModuleSetup = {
                validators: [{ address: '0xvalidator1', initData: '0xvalidatorData1' }],
                executors: [{ address: '0xexecutor1', initData: '0xexecutorData1' }],
                fallbacks: [{ address: '0xfallback1', initData: '0xfallbackData1' }],
                hooks: [{ address: '0xhook1', initData: '0xhookData1' }],
                registry: '0xregistry',
                attesters: ['0xattester1'],
                threshold: 1,
            }
            vi.mocked(getModuleSetup).mockReturnValue(mockModuleSetup)

            const mockOwners = {
                type: 'passkey',
                account: { address: '0xpasskey1' }
            }

            vi.mocked(encodeFunctionData)
                .mockReturnValueOnce('0xinitData')
                .mockReturnValueOnce('0xaddSafe7579Data')
                .mockReturnValueOnce('0xfactoryData')

            vi.mocked(encodePacked).mockReturnValue('0xencodedPacked')
            vi.mocked(keccak256)
                .mockReturnValueOnce('0xkeccak256InitData')
                .mockReturnValueOnce('0xsalt')

            const mockConfig = {
                owners: mockOwners
            } as any
            const result = getDeployArgs(mockConfig)

            expect(getModuleSetup).toHaveBeenCalledWith(mockConfig)
            expect(encodeFunctionData).toHaveBeenCalledWith(
                expect.objectContaining({
                    args: expect.arrayContaining([
                        ['0xbabe99e62d8bcbd3acf5ccbcfcd4f64fe75e5e72']
                    ])
                })
            )
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
                await config.getNonce()
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
                owners: { type: 'ecdsa', accounts: [] }
            } as any
            const mockValidatorAddress = '0x0000000000000000000000000000000000000123' as Address
            const mockSign = vi.fn().mockResolvedValue('0xsignature')

            vi.mocked(encode7579Calls).mockReturnValue('0xencodedCalls')
            vi.mocked(getAccountNonce).mockResolvedValue(1n)
            vi.mocked(getUserOperationHash).mockReturnValue('0xuserOpHash')
            vi.mocked(concat).mockReturnValue('0x0000000000000123')

            vi.mocked(getMockSignature).mockReturnValue('0xmockSignature')

            vi.mocked(getPermissionId).mockReturnValue('0xpermissionId')

            vi.mocked(encodeSmartSessionSignature)
                .mockReturnValueOnce('0xstubSessionSignature')
                .mockReturnValueOnce('0xrealSessionSignature')

            const mockSmartAccount = { address: mockAddress }
            vi.mocked(toSmartAccount).mockImplementation(async (config) => {
                await config.encodeCalls([{ to: '0x123' }])
                await config.getNonce()
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
            expect(getMockSignature).toHaveBeenCalledWith(mockSession.owners)
            expect(getPermissionId).toHaveBeenCalledWith(mockSession)
            expect(encodeSmartSessionSignature).toHaveBeenCalledTimes(2)
            expect(mockSign).toHaveBeenCalled()
            expect(result).toBe(mockSmartAccount)
        })
    })

    describe('get7702SmartAccount', () => {
        it('should throw an error as EIP-7702 is not supported for Safe accounts', () => {
            expect(() => get7702SmartAccount()).toThrow('EIP-7702 is not supported for Safe accounts')
        })
    })

    describe('get7702InitCalls', () => {
        it('should throw an error as EIP-7702 is not supported for Safe accounts', () => {
            expect(() => get7702InitCalls()).toThrow('EIP-7702 is not supported for Safe accounts')
        })
    })
})