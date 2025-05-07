// @ts-nocheck - Ignoring type errors in tests due to mocking
import { vi, describe, it, expect, beforeEach } from 'vitest'
import {
    Address,
    domainSeparator,
    encodeAbiParameters,
    encodePacked,
    Hex,
    keccak256,
    TypedDataDomain,
    zeroAddress,
} from 'viem'
import { UserOperation } from 'viem/account-abstraction'

import { HOOK_ADDRESS } from '../modules'

import {
    BundleStatusEnum,
    getEmptyUserOp,
    getOrderBundleHash,
    convertBigIntFields,
    parseCompactResponse,
    parsePendingBundleEvent,
    hashMultichainCompactWithoutDomainSeparator,
    parseUseChainBalances,
    parseOrderCost,
    parseInsufficientBalanceResult,
    parseOrderCostResult,
} from './utils'

vi.mock('viem', () => ({
    domainSeparator: vi.fn(),
    encodeAbiParameters: vi.fn(),
    encodePacked: vi.fn(),
    keccak256: vi.fn(),
    zeroAddress: '0x0000000000000000000000000000000000000000',
}))

vi.mock('../modules', () => ({
    HOOK_ADDRESS: '0x0000000000f6Ed8Be424d673c63eeFF8b9267420',
}))

describe('Orchestrator Utils Tests', () => {
    beforeEach(() => {
        vi.resetAllMocks()
    })

    describe('getEmptyUserOp', () => {
        it('should return an empty user operation with default values', () => {
            const result = getEmptyUserOp()

            expect(result).toEqual({
                sender: zeroAddress,
                nonce: 0n,
                callData: '0x',
                preVerificationGas: 0n,
                maxFeePerGas: 0n,
                maxPriorityFeePerGas: 0n,
                verificationGasLimit: 0n,
                callGasLimit: 0n,
                signature: '0x',
            })
        })
    })

    describe('getOrderBundleHash', () => {
        it('should calculate the hash of an order bundle', () => {
            vi.mocked(domainSeparator).mockReturnValue('0xdomainSeparator')
            vi.mocked(keccak256).mockReturnValue('0xhash')

            const mockOrderBundle = {
                segments: [
                    {
                        chainId: 1n,
                        witness: {
                            recipient: '0xrecipient',
                            tokenOut: [[1n, 100n]],
                            depositId: 123n,
                            targetChain: 2n,
                            fillDeadline: 1000,
                            execs: [],
                            userOpHash: null,
                            maxFeeBps: 500
                        }
                    }
                ]
            }

            const result = getOrderBundleHash(mockOrderBundle)

            expect(domainSeparator).toHaveBeenCalled()
            expect(keccak256).toHaveBeenCalled()
            expect(result).toBe('0xhash')
        })
    })

    describe('convertBigIntFields', () => {
        it('should convert bigint fields to strings', () => {
            const input = {
                number: 42,
                bigint: 123n,
                nested: {
                    bigint: 456n,
                    array: [789n, 1011n]
                },
                array: [
                    { bigint: 1213n },
                    { bigint: 1415n }
                ]
            }

            const result = convertBigIntFields(input)

            expect(result).toEqual({
                number: 42,
                bigint: '123',
                nested: {
                    bigint: '456',
                    array: ['789', '1011']
                },
                array: [
                    { bigint: '1213' },
                    { bigint: '1415' }
                ]
            })
        })

        it('should handle null and undefined values', () => {
            expect(convertBigIntFields(null)).toBeNull()
            expect(convertBigIntFields(undefined)).toBeUndefined()
        })

        it('should handle arrays', () => {
            expect(convertBigIntFields([1n, 2n, 3n])).toEqual(['1', '2', '3'])
        })
    })

    describe('parseCompactResponse', () => {
        it('should parse a compact response with bigint fields', () => {
            const response = {
                sponsor: '0xsponsor',
                nonce: '123',
                expires: '456',
                segments: [
                    {
                        arbiter: '0xarbiter',
                        chainId: '1',
                        idsAndAmounts: [['1', '100']],
                        witness: {
                            recipient: '0xrecipient',
                            tokenOut: [['2', '200']],
                            depositId: '789',
                            targetChain: '2',
                            fillDeadline: 1000,
                            execs: [
                                {
                                    to: '0xto',
                                    value: '300',
                                    data: '0xdata'
                                }
                            ],
                            userOpHash: '0xuserOpHash',
                            maxFeeBps: 500
                        }
                    }
                ]
            }

            const result = parseCompactResponse(response)

            expect(result).toEqual({
                sponsor: '0xsponsor',
                nonce: 123n,
                expires: 456n,
                segments: [
                    {
                        arbiter: '0xarbiter',
                        chainId: 1n,
                        idsAndAmounts: [[1n, 100n]],
                        witness: {
                            recipient: '0xrecipient',
                            tokenOut: [[2n, 200n]],
                            depositId: 789n,
                            targetChain: 2n,
                            fillDeadline: 1000,
                            execs: [
                                {
                                    to: '0xto',
                                    value: 300n,
                                    data: '0xdata'
                                }
                            ],
                            userOpHash: '0xuserOpHash',
                            maxFeeBps: 500
                        }
                    }
                ]
            })
        })
    })

    describe('parseUseChainBalances', () => {
        it('should parse user chain balances', () => {
            const response = {
                '1': {
                    '0xtoken1': { balance: '100' },
                    '0xtoken2': { balance: '200' }
                },
                '2': {
                    '0xtoken3': { balance: '300' }
                }
            }

            const result = parseUseChainBalances(response)

            expect(result).toEqual({
                1: {
                    '0xtoken1': 100n,
                    '0xtoken2': 200n
                },
                2: {
                    '0xtoken3': 300n
                }
            })
        })
    })

    describe('parseOrderCost', () => {
        it('should parse order cost data', () => {
            const response = {
                tokensSpent: {
                    '1': {
                        '0xtoken1': '100',
                        '0xtoken2': '200'
                    }
                },
                tokensReceived: [
                    {
                        tokenAddress: '0xtoken3',
                        hasFulfilled: true,
                        amountSpent: '300',
                        targetAmount: '400',
                        fee: '50'
                    }
                ]
            }

            const result = parseOrderCost(response)

            expect(result).toEqual({
                hasFulfilledAll: true,
                tokensSpent: {
                    1: {
                        '0xtoken1': 100n,
                        '0xtoken2': 200n
                    }
                },
                tokensReceived: [
                    {
                        tokenAddress: '0xtoken3',
                        hasFulfilled: true,
                        amountSpent: 300n,
                        targetAmount: 400n,
                        fee: 50n
                    }
                ]
            })
        })

        it('should throw an error if token balance is not a string', () => {
            const response = {
                tokensSpent: {
                    '1': {
                        '0xtoken1': 100
                    }
                },
                tokensReceived: []
            }

            expect(() => parseOrderCost(response)).toThrow()
        })
    })

    describe('parseInsufficientBalanceResult', () => {
        it('should parse insufficient balance result', () => {
            const response = {
                tokenShortfall: [
                    {
                        tokenAddress: '0xtoken1',
                        targetAmount: '100',
                        amountSpent: '50',
                        fee: '10',
                        tokenSymbol: 'TKN',
                        tokenDecimals: 18
                    }
                ],
                totalTokenShortfallInUSD: '60'
            }

            const result = parseInsufficientBalanceResult(response)

            expect(result).toEqual({
                hasFulfilledAll: false,
                tokenShortfall: [
                    {
                        tokenAddress: '0xtoken1',
                        targetAmount: 100n,
                        amountSpent: 50n,
                        fee: 10n,
                        tokenSymbol: 'TKN',
                        tokenDecimals: 18
                    }
                ],
                totalTokenShortfallInUSD: 60n
            })
        })

        it('should throw an error if tokenShortfall is not an array', () => {
            const response = {
                tokenShortfall: 'not an array',
                totalTokenShortfallInUSD: '60'
            }

            expect(() => parseInsufficientBalanceResult(response)).toThrow('Expected tokenShortfall to be an array')
        })
    })

    describe('parseOrderCostResult', () => {
        it('should parse order cost result when fulfilled', () => {
            const response = {
                hasFulfilledAll: true,
                tokensSpent: {
                    '1': {
                        '0xtoken1': '100'
                    }
                },
                tokensReceived: [
                    {
                        tokenAddress: '0xtoken2',
                        hasFulfilled: true,
                        amountSpent: '100',
                        targetAmount: '100',
                        fee: '10'
                    }
                ]
            }

            const result = parseOrderCostResult(response)

            expect(result.hasFulfilledAll).toBe(true)
            expect(result.tokensSpent[1]['0xtoken1']).toBe(100n)
        })

        it('should parse order cost result when not fulfilled', () => {
            const response = {
                hasFulfilledAll: false,
                tokenShortfall: [
                    {
                        tokenAddress: '0xtoken1',
                        targetAmount: '100',
                        amountSpent: '50',
                        fee: '10',
                        tokenSymbol: 'TKN',
                        tokenDecimals: 18
                    }
                ],
                totalTokenShortfallInUSD: '60'
            }

            const result = parseOrderCostResult(response)

            expect(result.hasFulfilledAll).toBe(false)
            expect(result.tokenShortfall[0].tokenAddress).toBe('0xtoken1')
            expect(result.totalTokenShortfallInUSD).toBe(60n)
        })

        it('should throw an error if hasFulfilledAll is missing', () => {
            const response = {
                tokensSpent: {}
            }

            expect(() => parseOrderCostResult(response)).toThrow('Missing or invalid hasFulfilledAll field')
        })
    })

    describe('parsePendingBundleEvent', () => {
        it('should parse pending bundle event', () => {
            const response = {
                type: 'pending',
                bundleId: '123',
                targetFillPayload: {
                    to: '0xto',
                    data: '0xdata',
                    value: '100',
                    chainId: 1
                },
                acrossDepositEvents: [
                    {
                        message: 'deposit',
                        depositId: '456',
                        depositor: '0xdepositor',
                        recipient: '0xrecipient',
                        inputToken: '0xinputToken',
                        inputAmount: '200',
                        outputToken: '0xoutputToken',
                        fillDeadline: 1000,
                        outputAmount: '300',
                        quoteTimestamp: 2000,
                        exclusiveRelayer: '0xrelayer',
                        destinationChainId: 2,
                        originClaimPayload: {
                            to: '0xclaimTo',
                            data: '0xclaimData',
                            value: '400',
                            chainId: 1
                        },
                        exclusivityDeadline: 3000
                    }
                ]
            }

            const result = parsePendingBundleEvent(response)

            expect(result).toEqual({
                type: 'pending',
                bundleId: 123n,
                targetFillPayload: {
                    to: '0xto',
                    data: '0xdata',
                    value: 100n,
                    chainId: 1
                },
                acrossDepositEvents: [
                    {
                        message: 'deposit',
                        depositId: 456n,
                        depositor: '0xdepositor',
                        recipient: '0xrecipient',
                        inputToken: '0xinputToken',
                        inputAmount: 200n,
                        outputToken: '0xoutputToken',
                        fillDeadline: 1000,
                        outputAmount: 300n,
                        quoteTimestamp: 2000,
                        exclusiveRelayer: '0xrelayer',
                        destinationChainId: 2,
                        originClaimPayload: {
                            to: '0xclaimTo',
                            data: '0xclaimData',
                            value: 400n,
                            chainId: 1
                        },
                        exclusivityDeadline: 3000
                    }
                ]
            })
        })
    })

    describe('hashMultichainCompactWithoutDomainSeparator', () => {
        it('should hash a multichain compact without domain separator', () => {
            vi.mocked(keccak256).mockReturnValue('0xhash')
            vi.mocked(encodeAbiParameters).mockReturnValue('0xencodedParams')

            const multiChainCompact = {
                sponsor: '0xsponsor',
                nonce: 123n,
                expires: 456n,
                segments: []
            }

            const result = hashMultichainCompactWithoutDomainSeparator(multiChainCompact)

            expect(encodeAbiParameters).toHaveBeenCalled()
            expect(keccak256).toHaveBeenCalledWith('0xencodedParams')
            expect(result).toBe('0xhash')
        })
    })
})
