// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach } from 'vitest'
import {
    Address,
    Chain,
    createPublicClient,
    encodeAbiParameters,
    encodePacked,
    Hex,
    http,
    keccak256,
} from 'viem'

import { getAddress, getSmartAccount } from '../accounts'
import { getBundlerClient } from '../accounts/utils'
import {
    getAccountEIP712Domain,
    getEnableSessionCall,
    getPermissionId,
    getSessionAllowedERC7739Content,
    isSessionEnabled,
} from '../modules/validators'
import { hashMultichainCompactWithoutDomainSeparator } from '../orchestrator/utils'
import { Session } from '../types'

import {
    enableSmartSession,
    hashErc7739,
    getSessionSignature,
} from './smart-session'

vi.mock('viem', () => ({
    createPublicClient: vi.fn(),
    encodeAbiParameters: vi.fn(),
    encodePacked: vi.fn(),
    http: vi.fn(),
    keccak256: vi.fn(),
}))

vi.mock('../accounts', () => ({
    getAddress: vi.fn(),
    getSmartAccount: vi.fn(),
}))

vi.mock('../accounts/utils', () => ({
    getBundlerClient: vi.fn(),
}))

vi.mock('../modules/validators', () => ({
    getAccountEIP712Domain: vi.fn(),
    getEnableSessionCall: vi.fn(),
    getPermissionId: vi.fn(),
    getSessionAllowedERC7739Content: vi.fn(),
    isSessionEnabled: vi.fn(),
}))

vi.mock('../orchestrator/utils', () => ({
    hashMultichainCompactWithoutDomainSeparator: vi.fn(),
}))

describe('Smart Session Tests', () => {
    let mockConfig
    let mockChain
    let mockSession
    let mockPublicClient
    let mockBundlerClient
    let mockSmartAccount

    beforeEach(() => {
        vi.resetAllMocks()

        mockConfig = {
            rhinestoneApiKey: 'test-api-key',
            owners: { type: 'ecdsa', accounts: [] },
        }
        mockChain = { id: 1 } as Chain
        mockSession = {
            permissions: [{ target: '0xtarget', functionSelector: '0xselector' }],
            validUntil: 123456789,
            validAfter: 123456,
            owners: { type: 'ecdsa', accounts: [] },
        } as Session

        mockPublicClient = {
            getCode: vi.fn(),
        }
        vi.mocked(createPublicClient).mockReturnValue(mockPublicClient)
        vi.mocked(http).mockReturnValue('httpTransport')

        mockBundlerClient = {
            sendUserOperation: vi.fn().mockResolvedValue('0xuseropHash'),
            waitForUserOperationReceipt: vi.fn().mockResolvedValue({ receipt: 'mockReceipt' }),
        }
        vi.mocked(getBundlerClient).mockReturnValue(mockBundlerClient)

        mockSmartAccount = {
            address: '0xaccountAddress',
        }
        vi.mocked(getSmartAccount).mockResolvedValue(mockSmartAccount)

        vi.mocked(getAddress).mockReturnValue('0xaccountAddress')
        vi.mocked(isSessionEnabled).mockResolvedValue(false)
        vi.mocked(getPermissionId).mockReturnValue('0xpermissionId')
        vi.mocked(getEnableSessionCall).mockResolvedValue({
            to: '0xvalidatorAddress',
            data: '0xenableSessionData',
        })
        vi.mocked(getSessionAllowedERC7739Content).mockResolvedValue({
            appDomainSeparator: '0xappDomainSeparator',
            contentsType: 'MultichainCompact(bytes32 structHash)',
        })
        vi.mocked(hashMultichainCompactWithoutDomainSeparator).mockReturnValue('0xstructHash')
        vi.mocked(getAccountEIP712Domain).mockResolvedValue({
            name: 'Account',
            version: '1',
            chainId: 1,
            verifyingContract: '0xaccountAddress',
            salt: '0xsalt',
        })
    })

    describe('enableSmartSession', () => {
        it('should enable a smart session if not already enabled', async () => {
            await enableSmartSession(mockChain, mockConfig, mockSession)

            expect(createPublicClient).toHaveBeenCalledWith({
                chain: mockChain,
                transport: 'httpTransport',
            })
            expect(getAddress).toHaveBeenCalledWith(mockConfig)
            expect(isSessionEnabled).toHaveBeenCalledWith(
                mockPublicClient,
                '0xaccountAddress',
                '0xpermissionId'
            )
            expect(getSmartAccount).toHaveBeenCalledWith(mockConfig, mockPublicClient, mockChain)
            expect(getBundlerClient).toHaveBeenCalledWith(mockConfig, mockPublicClient)
            expect(getEnableSessionCall).toHaveBeenCalledWith(mockChain, mockSession)
            expect(mockBundlerClient.sendUserOperation).toHaveBeenCalledWith({
                account: mockSmartAccount,
                calls: [{
                    to: '0xvalidatorAddress',
                    data: '0xenableSessionData',
                }],
            })
            expect(mockBundlerClient.waitForUserOperationReceipt).toHaveBeenCalledWith({
                hash: '0xuseropHash',
            })
        })

        it('should not enable a smart session if already enabled', async () => {
            vi.mocked(isSessionEnabled).mockResolvedValueOnce(true)

            await enableSmartSession(mockChain, mockConfig, mockSession)

            expect(isSessionEnabled).toHaveBeenCalledWith(
                mockPublicClient,
                '0xaccountAddress',
                '0xpermissionId'
            )
            expect(getSmartAccount).not.toHaveBeenCalled()
            expect(getBundlerClient).not.toHaveBeenCalled()
            expect(getEnableSessionCall).not.toHaveBeenCalled()
            expect(mockBundlerClient.sendUserOperation).not.toHaveBeenCalled()
        })
    })

    describe('hashErc7739', () => {
        it('should hash an order path following ERC-7739 TypedDataSign workflow', async () => {
            const mockOrderPath = [{
                orderBundle: {
                    segments: [{ witness: { execs: [], userOpHash: null } }],
                },
            }]
            const mockAccountAddress = '0xaccountAddress'

            vi.mocked(keccak256)
                .mockReturnValueOnce('0xtypedDataSignTypehash')  
                .mockReturnValueOnce('0xnameHash')             
                .mockReturnValueOnce('0xversionHash')          
                .mockReturnValueOnce('0xparamsHash')           
                .mockReturnValueOnce('0xfinalHash')            

            vi.mocked(encodePacked)
                .mockReturnValueOnce('0xpackedString')         
                .mockReturnValueOnce('0xpackedName')           
                .mockReturnValueOnce('0xpackedVersion')        
                .mockReturnValueOnce('0xfinalPacked')          

            vi.mocked(encodeAbiParameters).mockReturnValue('0xencodedParams')

            const result = await hashErc7739(mockChain, mockOrderPath, mockAccountAddress)

            expect(createPublicClient).toHaveBeenCalledWith({
                chain: mockChain,
                transport: 'httpTransport',
            })
            expect(getSessionAllowedERC7739Content).toHaveBeenCalledWith(mockChain)
            expect(hashMultichainCompactWithoutDomainSeparator).toHaveBeenCalledWith(mockOrderPath[0].orderBundle)
            expect(getAccountEIP712Domain).toHaveBeenCalledWith(mockPublicClient, mockAccountAddress)

            expect(result).toEqual({
                hash: '0xfinalHash',
                appDomainSeparator: '0xappDomainSeparator',
                contentsType: 'MultichainCompact(bytes32 structHash)',
                structHash: '0xstructHash',
            })
        })
    })

    describe('getSessionSignature', () => {
        it('should return a session signature with the correct format', () => {
            const signature = '0xsignature'
            const appDomainSeparator = '0xappDomainSeparator'
            const structHash = '0xstructHash'
            const contentsType = 'MultichainCompact(bytes32 structHash)'
            const withSession = mockSession

            vi.mocked(getPermissionId).mockReturnValue('0xpermissionId')
            vi.mocked(encodePacked)
                .mockReturnValueOnce('0xerc7739Signature')  
                .mockReturnValueOnce('0xwrappedSignature')  

            const result = getSessionSignature(
                signature,
                appDomainSeparator,
                structHash,
                contentsType,
                withSession
            )

            expect(getPermissionId).toHaveBeenCalledWith(withSession)
            expect(result).toBe('0xwrappedSignature')
        })
    })
})
