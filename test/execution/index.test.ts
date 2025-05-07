// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
    Address,
    Chain,
    createPublicClient,
    encodeAbiParameters,
    encodePacked,
    Hex,
    http,
    keccak256,
    pad,
    toHex,
} from 'viem'
import {
    entryPoint07Address,
    getUserOperationHash,
} from 'viem/account-abstraction'

import {
    sendTransaction,
    waitForExecution,
    getMaxSpendableAmount,
    TransactionResult,
} from '../../src/execution'

import {
    deploySource,
    deployTarget,
    getAddress,
    getBundleInitCode,
    getSmartSessionSmartAccount,
    isDeployed,
    sign,
} from '../../src/accounts'
import { getBundlerClient } from '../../src/accounts/utils'
import { getOwnerValidator } from '../../src/modules'
import { getSmartSessionValidator } from '../../src/modules/validators'
import {
    BUNDLE_STATUS_COMPLETED,
    BUNDLE_STATUS_FAILED,
    BUNDLE_STATUS_FILLED,
    getEmptyUserOp,
    getOrchestrator,
    getOrderBundleHash,
    getTokenBalanceSlot,
} from '../../src/orchestrator'
import { getChainById } from '../../src/orchestrator/registry'
import {
    enableSmartSession,
    getSessionSignature,
    hashErc7739,
} from '../../src/execution/smart-session'

vi.mock('viem', () => ({
    createPublicClient: vi.fn(),
    encodeAbiParameters: vi.fn(),
    encodePacked: vi.fn(),
    http: vi.fn(),
    keccak256: vi.fn(),
    pad: vi.fn(),
    toHex: vi.fn(),
}))

vi.mock('viem/account-abstraction', () => ({
    entryPoint07Address: '0xentryPointAddress',
    getUserOperationHash: vi.fn(),
}))

vi.mock('../../src/accounts', () => ({
    deploySource: vi.fn(),
    deployTarget: vi.fn(),
    getAddress: vi.fn(),
    getBundleInitCode: vi.fn(),
    getSmartSessionSmartAccount: vi.fn(),
    isDeployed: vi.fn(),
    sign: vi.fn(),
}))

vi.mock('../../src/accounts/utils', () => ({
    getBundlerClient: vi.fn(),
}))

vi.mock('../../src/modules', () => ({
    getOwnerValidator: vi.fn(),
}))

vi.mock('../../src/modules/validators', () => ({
    getSmartSessionValidator: vi.fn(),
}))

vi.mock('../../src/orchestrator', () => ({
    BUNDLE_STATUS_COMPLETED: 'completed',
    BUNDLE_STATUS_FAILED: 'failed',
    BUNDLE_STATUS_FILLED: 'filled',
    getEmptyUserOp: vi.fn(),
    getOrchestrator: vi.fn(),
    getOrderBundleHash: vi.fn(),
    getTokenBalanceSlot: vi.fn(),
}))

vi.mock('../../src/orchestrator/registry', () => ({
    getChainById: vi.fn(),
}))

vi.mock('../../src/execution/smart-session', () => ({
    enableSmartSession: vi.fn(),
    getSessionSignature: vi.fn(),
    hashErc7739: vi.fn(),
}))

describe('Execution Tests', () => {
    let mockConfig
    let mockSourceChain
    let mockTargetChain
    let mockCalls
    let mockTokenRequests
    let mockAccountAddress
    let mockPublicClient
    let mockBundlerClient
    let mockOrchestrator
    let mockSession

    beforeEach(() => {
        vi.resetAllMocks()

        mockConfig = {
            rhinestoneApiKey: 'test-api-key',
            owners: { type: 'ecdsa', accounts: [] },
        }
        mockSourceChain = { id: 1 } as Chain
        mockTargetChain = { id: 2 } as Chain
        mockCalls = [
            { to: '0xto1', data: '0xdata1', value: 100n },
            { to: '0xto2', data: '0xdata2' },
        ]
        mockTokenRequests = [
            { address: '0xtoken1', amount: 1000n },
            { address: '0xtoken2', amount: 2000n },
        ]
        mockAccountAddress = '0xaccountAddress'
        mockSession = {
            permissions: [{ target: '0xtarget', functionSelector: '0xselector' }],
            validUntil: 123456789,
            validAfter: 123456,
            owners: { type: 'ecdsa', accounts: [] },
        }

        mockPublicClient = {
            getCode: vi.fn(),
        }
        vi.mocked(createPublicClient).mockReturnValue(mockPublicClient)
        vi.mocked(http).mockReturnValue('httpTransport')

        mockBundlerClient = {
            sendUserOperation: vi.fn().mockResolvedValue('0xuseropHash'),
            prepareUserOperation: vi.fn().mockResolvedValue({ signature: '0x' }),
            waitForUserOperationReceipt: vi.fn().mockResolvedValue({ receipt: 'mockReceipt' }),
        }
        vi.mocked(getBundlerClient).mockReturnValue(mockBundlerClient)

        mockOrchestrator = {
            getOrderPath: vi.fn().mockResolvedValue([
                {
                    orderBundle: {
                        segments: [{ witness: { execs: [], userOpHash: null } }],
                    },
                    injectedExecutions: [],
                },
            ]),
            postSignedOrderBundle: vi.fn().mockResolvedValue([{ bundleId: 123n }]),
            getBundleStatus: vi.fn().mockResolvedValue({ status: BUNDLE_STATUS_COMPLETED }),
            getMaxTokenAmount: vi.fn().mockResolvedValue(5000n),
        }
        vi.mocked(getOrchestrator).mockReturnValue(mockOrchestrator)

        vi.mocked(isDeployed).mockResolvedValue(true)
        vi.mocked(getAddress).mockReturnValue(mockAccountAddress)
        vi.mocked(getEmptyUserOp).mockReturnValue({ userOp: 'empty' })
        vi.mocked(getOrderBundleHash).mockReturnValue('0xorderBundleHash')
        vi.mocked(sign).mockResolvedValue('0xsignature')
        vi.mocked(encodePacked).mockReturnValue('0xpackedSignature')
        vi.mocked(getOwnerValidator).mockReturnValue({ address: '0xvalidatorAddress' })
        vi.mocked(getSmartSessionValidator).mockReturnValue({ address: '0xsessionValidatorAddress' })
        vi.mocked(hashErc7739).mockResolvedValue({
            hash: '0xhash',
            appDomainSeparator: '0xappDomainSeparator',
            structHash: '0xstructHash',
            contentsType: 'contentsType',
        })
        vi.mocked(getSessionSignature).mockReturnValue('0xsessionSignature')
        vi.mocked(getChainById).mockReturnValue(mockSourceChain)
    })

    describe('sendTransaction', () => {
        it('should handle same-chain transactions', async () => {
            const transaction = {
                chain: mockSourceChain,
                calls: mockCalls,
                tokenRequests: mockTokenRequests,
            }

            const result = await sendTransaction(mockConfig, transaction)

            expect(isDeployed).toHaveBeenCalledWith(mockSourceChain, mockConfig)
            expect(getAddress).toHaveBeenCalledWith(mockConfig)
            expect(getOrchestrator).toHaveBeenCalledWith('test-api-key')
            expect(mockOrchestrator.getOrderPath).toHaveBeenCalled()
            expect(sign).toHaveBeenCalledWith(mockConfig.owners, mockSourceChain, '0xorderBundleHash')
            expect(getOwnerValidator).toHaveBeenCalledWith(mockConfig)
            expect(encodePacked).toHaveBeenCalledWith(
                ['address', 'bytes'],
                ['0xvalidatorAddress', '0xsignature']
            )
            expect(deployTarget).toHaveBeenCalledWith(mockSourceChain, mockConfig, false)
            expect(mockOrchestrator.postSignedOrderBundle).toHaveBeenCalled()
            expect(result).toEqual({
                type: 'bundle',
                id: 123n,
                sourceChain: 1,
                targetChain: 1,
            })
        })

        it('should handle cross-chain transactions', async () => {
            const transaction = {
                sourceChain: mockSourceChain,
                targetChain: mockTargetChain,
                calls: mockCalls,
                tokenRequests: mockTokenRequests,
            }

            const result = await sendTransaction(mockConfig, transaction)

            expect(isDeployed).toHaveBeenCalledWith(mockSourceChain, mockConfig)
            expect(getAddress).toHaveBeenCalledWith(mockConfig)
            expect(getOrchestrator).toHaveBeenCalledWith('test-api-key')
            expect(mockOrchestrator.getOrderPath).toHaveBeenCalled()
            expect(sign).toHaveBeenCalledWith(mockConfig.owners, mockSourceChain, '0xorderBundleHash')
            expect(getOwnerValidator).toHaveBeenCalledWith(mockConfig)
            expect(encodePacked).toHaveBeenCalledWith(
                ['address', 'bytes'],
                ['0xvalidatorAddress', '0xsignature']
            )
            expect(deployTarget).toHaveBeenCalledWith(mockTargetChain, mockConfig, false)
            expect(mockOrchestrator.postSignedOrderBundle).toHaveBeenCalled()
            expect(result).toEqual({
                type: 'bundle',
                id: 123n,
                sourceChain: 1,
                targetChain: 2,
            })
        })

        it('should deploy the account if not already deployed', async () => {
            vi.mocked(isDeployed).mockResolvedValueOnce(false)

            const transaction = {
                chain: mockSourceChain,
                calls: mockCalls,
                tokenRequests: mockTokenRequests,
            }

            await sendTransaction(mockConfig, transaction)

            expect(deploySource).toHaveBeenCalledWith(mockSourceChain, mockConfig)
        })

        it('should handle session-based transactions on the same chain', async () => {
            const transaction = {
                chain: mockSourceChain,
                calls: mockCalls,
                tokenRequests: mockTokenRequests,
                signers: {
                    type: 'session',
                    session: mockSession,
                },
            }

            const mockSessionAccount = { address: mockAccountAddress }
            vi.mocked(getSmartSessionSmartAccount).mockResolvedValue(mockSessionAccount)

            const result = await sendTransaction(mockConfig, transaction)

            expect(enableSmartSession).toHaveBeenCalledWith(mockSourceChain, mockConfig, mockSession)
            expect(getSmartSessionSmartAccount).toHaveBeenCalledWith(
                mockConfig,
                mockPublicClient,
                mockSourceChain,
                mockSession
            )
            expect(mockBundlerClient.sendUserOperation).toHaveBeenCalledWith({
                account: mockSessionAccount,
                calls: mockCalls,
            })
            expect(result).toEqual({
                type: 'userop',
                hash: '0xuseropHash',
                sourceChain: 1,
                targetChain: 1,
            })
        })

        it('should handle session-based cross-chain transactions', async () => {
            const transaction = {
                sourceChain: mockSourceChain,
                targetChain: mockTargetChain,
                calls: mockCalls,
                tokenRequests: mockTokenRequests,
                signers: {
                    type: 'session',
                    session: mockSession,
                },
            }

            const mockSourceSessionAccount = { address: mockAccountAddress }
            const mockTargetSessionAccount = {
                address: mockAccountAddress,
                signUserOperation: vi.fn().mockResolvedValue('0xsignedUserOp')
            }
            vi.mocked(getSmartSessionSmartAccount)
                .mockResolvedValueOnce(mockSourceSessionAccount)
                .mockResolvedValueOnce(mockTargetSessionAccount)

            vi.mocked(getUserOperationHash).mockReturnValue('0xuserOpHash')

            vi.mocked(getTokenBalanceSlot)
                .mockReturnValueOnce(1n)
                .mockReturnValueOnce(2n)

            vi.mocked(keccak256).mockReturnValue('0xslot')

            vi.mocked(pad).mockReturnValue('0xpadded')
            vi.mocked(toHex).mockReturnValue('0xamount')

            const result = await sendTransaction(mockConfig, transaction)

            expect(enableSmartSession).toHaveBeenCalledWith(mockSourceChain, mockConfig, mockSession)
            expect(enableSmartSession).toHaveBeenCalledWith(mockTargetChain, mockConfig, mockSession)
            expect(getSmartSessionSmartAccount).toHaveBeenCalledWith(
                mockConfig,
                mockPublicClient,
                mockSourceChain,
                mockSession
            )
            expect(getSmartSessionSmartAccount).toHaveBeenCalledWith(
                mockConfig,
                expect.anything(),
                mockTargetChain,
                mockSession
            )
            expect(deployTarget).toHaveBeenCalledWith(mockTargetChain, mockConfig, true)
            expect(mockBundlerClient.prepareUserOperation).toHaveBeenCalled()
            expect(mockTargetSessionAccount.signUserOperation).toHaveBeenCalled()
            expect(getUserOperationHash).toHaveBeenCalled()
            expect(hashErc7739).toHaveBeenCalledWith(mockSourceChain, expect.anything(), mockAccountAddress)
            expect(sign).toHaveBeenCalledWith(mockSession.owners, mockTargetChain, '0xhash')
            expect(getSessionSignature).toHaveBeenCalledWith(
                '0xsignature',
                '0xappDomainSeparator',
                '0xstructHash',
                'contentsType',
                mockSession
            )
            expect(getSmartSessionValidator).toHaveBeenCalledWith(mockConfig)
            expect(mockOrchestrator.postSignedOrderBundle).toHaveBeenCalled()
            expect(result).toEqual({
                type: 'bundle',
                id: 123n,
                sourceChain: 1,
                targetChain: 2,
            })
        })
    })

    describe('waitForExecution', () => {
        it('should wait for bundle execution and return the result', async () => {
            const result: TransactionResult = {
                type: 'bundle',
                id: 123n,
                sourceChain: 1,
                targetChain: 2,
            }

            vi.mocked(mockOrchestrator.getBundleStatus)
                .mockResolvedValueOnce({ status: 'pending' })
                .mockResolvedValueOnce({ status: 'processing' })
                .mockResolvedValueOnce({ status: BUNDLE_STATUS_COMPLETED, data: 'success' })

            const bundleResult = await waitForExecution(mockConfig, result)

            expect(getOrchestrator).toHaveBeenCalledWith('test-api-key')
            expect(mockOrchestrator.getBundleStatus).toHaveBeenCalledWith(123n)
            expect(bundleResult).toEqual({ status: BUNDLE_STATUS_COMPLETED, data: 'success' })
        })

        it('should throw an error if bundle fails', async () => {
            const result: TransactionResult = {
                type: 'bundle',
                id: 123n,
                sourceChain: 1,
                targetChain: 2,
            }

            vi.mocked(mockOrchestrator.getBundleStatus)
                .mockResolvedValueOnce({ status: 'pending' })
                .mockResolvedValueOnce({ status: BUNDLE_STATUS_FAILED })

            await expect(waitForExecution(mockConfig, result)).rejects.toThrow('Bundle failed')
        })

        it('should wait for userop execution and return the receipt', async () => {
            const result: TransactionResult = {
                type: 'userop',
                hash: '0xuseropHash',
                sourceChain: 1,
                targetChain: 1,
            }

            const receipt = await waitForExecution(mockConfig, result)

            expect(getChainById).toHaveBeenCalledWith(1)
            expect(createPublicClient).toHaveBeenCalledWith({
                chain: mockSourceChain,
                transport: 'httpTransport',
            })
            expect(getBundlerClient).toHaveBeenCalledWith(mockConfig, mockPublicClient)
            expect(mockBundlerClient.waitForUserOperationReceipt).toHaveBeenCalledWith({
                hash: '0xuseropHash',
            })
            expect(receipt).toEqual({ receipt: 'mockReceipt' })
        })
    })

    describe('getMaxSpendableAmount', () => {
        it('should return the maximum spendable amount for a token', async () => {
            const amount = await getMaxSpendableAmount(
                mockConfig,
                mockSourceChain,
                '0xtoken1',
                1000n
            )

            expect(getAddress).toHaveBeenCalledWith(mockConfig)
            expect(getOrchestrator).toHaveBeenCalledWith('test-api-key')
            expect(mockOrchestrator.getMaxTokenAmount).toHaveBeenCalledWith(
                mockAccountAddress,
                1,
                '0xtoken1',
                1000n
            )
            expect(amount).toBe(5000n)
        })
    })
})
